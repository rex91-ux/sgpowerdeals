#!/usr/bin/env python3
"""
Tuas Power rates tripwire.

Fetches Tuas's own plans page, campaign page and factsheet links, compares what
it finds against watch/expected.json, and writes rates-watch.json at the repo
root. That file is the hand-off to the Claude scheduled task, which can read
raw.githubusercontent.com but cannot reach api.github.com.

Design notes, so future-you knows why it looks like this:

  * It is deliberately NOT a precise scraper. Tuas encodes the effective date
    and the ex-GST rate in each factsheet PDF filename, e.g.
    powerfix_36_20260803(269.7).pdf. Watching those filenames is far more
    robust than parsing rendered rate text out of their markup, which changes
    whenever they touch the template.
  * A fetch failure is NEVER reported as "unchanged". Silence must not look
    like calm. Status becomes FETCH_FAILED and the run exits non-zero so
    GitHub emails you about the broken workflow.
  * It writes a heartbeat to rates-watch.json on every run, change or not, so
    the Claude task can detect a tripwire that has silently stopped running.

Standard library only, so there is nothing to install and nothing to pin.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED_PATH = os.path.join(REPO_ROOT, "watch", "expected.json")
OUT_PATH = os.path.join(REPO_ROOT, "rates-watch.json")
LOG_PATH = os.path.join(REPO_ROOT, "watch", "WATCHLOG.md")

PAGES = {
    "plans": "https://www.savewithtuas.com/our-electricity-plans/",
    "promotions": "https://www.savewithtuas.com/promotions/",
    # The campaign sub-page is where the PER-PLAN rebates live. The
    # /promotions/ landing page only advertises the headline "up to $200",
    # so checking rebate amounts there produces a false positive every run.
    # URL is derived from the campaign code in expected.json.
    "campaign": None,
}

# A real browser UA — the default urllib one gets refused by their edge.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

FACTSHEET_RE = re.compile(
    r"(powerfix|powerdot)[_\-]?(\d+)[^\"'>]*?_(\d{8})\(([\d.]+)\)\.pdf",
    re.IGNORECASE,
)
# Rates appear as either $0.2940 or 29.40¢ / 29.40 cents depending on the page.
DECIMAL_RATE_RE = re.compile(r"\$?0\.(\d{4})\b")
CENTS_RATE_RE = re.compile(r"\b(\d{2}\.\d{2})\s*(?:¢|cents?|c/kWh)", re.IGNORECASE)
REBATE_RE = re.compile(r"\$\s?(\d{2,3})\b")


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-SG,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read()
    return raw.decode("utf-8", errors="replace")


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    with open(EXPECTED_PATH) as fh:
        expected = json.load(fh)

    pages = dict(PAGES)
    pages["campaign"] = ("https://www.savewithtuas.com/promotions/%s/"
                         % expected["campaign"]["code"].lower())

    html, errors = {}, []
    campaign_page_gone = False
    for name, url in pages.items():
        try:
            html[name] = fetch(url)
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            if name == "campaign":
                # Expected once the campaign ends — Tuas takes the sub-page
                # down. That is a finding, not a broken run.
                campaign_page_gone = True
                html[name] = ""
            else:
                errors.append(f"{name} ({url}): {exc}")

    if errors:
        write_out({
            "last_run": now,
            "status": "FETCH_FAILED",
            "changes": [],
            "errors": errors,
            "note": "Could not read Tuas's pages, so nothing was verified. "
                    "This is NOT a clean bill of health.",
        })
        append_log(now, "FETCH_FAILED", "; ".join(errors))
        print("FETCH FAILED:\n  " + "\n  ".join(errors), file=sys.stderr)
        sys.exit(1)

    blob = "\n".join(html.values())
    changes = []

    # --- 1. Factsheet versions: the primary repricing signal -----------------
    found = {}
    for plan, term, date, rate in FACTSHEET_RE.findall(blob):
        found[f"{plan.lower()}_{term}"] = f"{date}({rate})"

    exp_fs = {k: v for k, v in expected["factsheet_versions"].items()
              if not k.startswith("_")}

    # Self-baselining: any plan listed as "unknown" adopts whatever the first
    # run observes, and expected.json is rewritten. Without this, a plan we
    # track but whose current version we never confirmed by hand would fire
    # every single day forever, and a tripwire that always cries wolf is worse
    # than none. Informational only — it never sets status CHANGED.
    baselined = {}
    for key, exp_version in list(exp_fs.items()):
        if exp_version in (None, "", "unknown") and key in found:
            baselined[key] = found[key]
            expected["factsheet_versions"][key] = found[key]
            exp_fs[key] = found[key]
    if baselined:
        with open(EXPECTED_PATH, "w") as fh:
            json.dump(expected, fh, indent=2)
            fh.write("\n")

    # A plan whose version was never confirmed AND which we cannot see is not
    # evidence of anything — most likely the key guessed here never matched
    # their filename. Record it, don't cry wolf about it.
    not_yet_seen = [k for k, v in exp_fs.items()
                    if v in (None, "", "unknown") and k not in found]

    for key, exp_version in exp_fs.items():
        if key in baselined or key in not_yet_seen:
            continue
        live = found.get(key)
        if live is None:
            changes.append({
                "field": f"factsheet {key}",
                "was": exp_version,
                "now": "NOT FOUND on plans page",
                "severity": "investigate",
                "note": "Either the plan was withdrawn or their markup changed. "
                        "Check by hand before trusting this.",
            })
        elif live != exp_version:
            was_rate = version_to_inc_gst(exp_version)
            now_rate = version_to_inc_gst(live)
            changes.append({
                "field": f"factsheet {key}",
                "was": exp_version,
                "now": live,
                "was_rate_inc_gst": was_rate,
                "now_rate_inc_gst": now_rate,
                "severity": "repriced",
            })

    for key, live in sorted(found.items()):
        if key not in exp_fs:
            changes.append({
                "field": f"factsheet {key}",
                "was": "(not tracked)",
                "now": live,
                "severity": "new_plan",
            })

    # --- 2. Campaign still live? -------------------------------------------
    camp = expected["campaign"]
    promo = html["promotions"]
    code_present = camp["code"].lower() in promo.lower() and not campaign_page_gone
    if not code_present:
        changes.append({
            "field": "campaign " + camp["code"],
            "was": "live",
            "now": "no longer on the promotions page",
            "severity": "campaign_ended",
            "note": "The $%s/$%s rebates and the 'up to S$220' claims on the "
                    "Tuas page are now stale. Needs a prose rewrite, not a "
                    "find-and-replace." % (camp["rebate_powerfix_24"],
                                           camp["rebate_powerfix_36"]),
        })

    # Look for per-plan rebates across BOTH the landing page and the campaign
    # sub-page — the landing page carries only the headline figure.
    rebates_seen = {int(m) for m in REBATE_RE.findall(promo + html["campaign"])}
    for label, amount in (("PowerFIX 24", camp["rebate_powerfix_24"]),
                          ("PowerFIX 36", camp["rebate_powerfix_36"])):
        if code_present and amount not in rebates_seen:
            changes.append({
                "field": f"rebate {label}",
                "was": f"${amount}",
                "now": "not found on promotions page",
                "severity": "investigate",
                "observed_amounts": sorted(rebates_seen),
            })

    # --- 3. Editorial inversion: the one that changes the site's argument ---
    pl = expected["pacificlight_reference_inc_gst_cents"]
    for key, live in found.items():
        if not key.startswith("powerfix"):
            continue
        rate = version_to_inc_gst(live)
        term = key.split("_")[-1]
        ref = pl.get(f"Savvy Saver {term}")
        if rate and ref and rate < ref:
            changes.append({
                "field": f"EDITORIAL INVERSION on {term}-month",
                "was": f"Tuas dearer (PacificLight {ref}c)",
                "now": f"Tuas now CHEAPER at {rate}c",
                "severity": "inversion",
                "note": "Both pages now argue their retailer is best. The "
                        "site contradicts itself until rewritten. Escalate.",
            })

    status = "CHANGED" if changes else "UNCHANGED"
    payload = {
        "last_run": now,
        "status": status,
        "expected_baseline": expected.get("verified_on"),
        "changes": changes,
        "baselined_this_run": baselined,
        "tracked_but_never_seen": not_yet_seen,
        "observed": {
            "factsheets": found,
            "campaign_code_present": code_present,
            "campaign_page_reachable": not campaign_page_gone,
            # Diagnostic: every PDF link seen, so the real filenames for plans
            # we could not key correctly (25 G+, PowerDOT 6) show up here and
            # can be added to expected.json properly.
            "all_pdf_links": sorted({m for m in
                                     re.findall(r"[\w/%.\-()+]+\.pdf", blob)})[:40],
            "rebate_amounts_on_promotions_page": sorted(rebates_seen),
            "cents_rates_seen": sorted({float(x) for x in
                                        CENTS_RATE_RE.findall(blob)}),
            "decimal_rates_seen": sorted({round(int(x) / 10000, 4) for x in
                                          DECIMAL_RATE_RE.findall(blob)}),
        },
        "sources": PAGES,
    }
    # Diagnostic only — isolated so a PacificLight failure can never affect
    # the Tuas verdict or the exit code.
    try:
        payload["pacificlight_discovery"] = discover_pacificlight()
    except Exception as exc:                            # noqa: BLE001
        payload["pacificlight_discovery"] = {
            "error": f"{type(exc).__name__}: {exc}"[:200]}

    write_out(payload)
    append_log(now, status,
               "; ".join(f"{c['field']}: {c['was']} -> {c['now']}"
                         for c in changes) or "no change")

    print(f"status={status}  changes={len(changes)}")
    print(json.dumps(payload["observed"], indent=2))
    for c in changes:
        print(f"  [{c['severity']}] {c['field']}: {c['was']} -> {c['now']}")

    print("\n--- PacificLight discovery (diagnostic, affects nothing) ---")
    print(json.dumps(payload.get("pacificlight_discovery", {}), indent=2)[:4000])

    # Non-zero exit surfaces it in the Actions UI and emails you, but only for
    # things that genuinely need a human. A plain repricing is handled by the
    # issue and by the Claude task.
    if any(c["severity"] == "inversion" for c in changes):
        sys.exit(2)


PL_PAGES = {
    "pl_home": "https://www.pacificlight.com.sg/",
    "pl_factsheets": "https://www.pacificlight.com.sg/support/factsheet",
    "pl_residential": "https://www.pacificlight.com.sg/home/residential-plans",
}


def discover_pacificlight():
    """TEMPORARY diagnostic. Delete once a real PacificLight check is built.

    PacificLight's factsheet pages are JavaScript-rendered, so a plain fetch
    returns an empty shell. But their factsheet URLs encode the plan AND the
    date in the slug — `05-savvy-saver-24-8-may-2026` — which is the same
    trick that makes the Tuas check reliable. If those slugs turn out to be
    reachable without a browser, a PacificLight tripwire costs one fetch.

    This function only LOOKS and REPORTS. It never contributes to `changes`
    and never sets status CHANGED, so it cannot raise a false alarm while we
    are still learning the shape of their site. Any failure here is swallowed:
    the Tuas check is the job, and this must not be able to break it.
    """
    out = {}
    for name, url in PL_PAGES.items():
        try:
            html = fetch(url)
        except Exception as exc:                        # noqa: BLE001
            out[name] = {"error": f"{type(exc).__name__}: {exc}"[:200]}
            continue
        low = html.lower()
        out[name] = {
            "bytes": len(html),
            # Slugs are the prize: plan + factsheet date, like Tuas filenames.
            "factsheet_slugs": sorted(set(
                re.findall(r"factsheet[\w-]*detail/([\w\-.%]+)", html)))[:30],
            # If the rates come from an endpoint, we can read that directly
            # instead of rendering their page.
            "api_paths": sorted({u for u in re.findall(
                r"[\"'](/[\w\-/]*api[\w\-/]*)[\"']", html)})[:20],
            "json_urls": sorted({u for u in re.findall(
                r"https?://[\w.\-/]+\.json\b", html)})[:20],
            # Server-rendered payload would mean the data is already in the
            # HTML, just not in the visible markup.
            "ssr_markers": [m for m in ("__NEXT_DATA__", "__NUXT__",
                                        "__INITIAL_STATE__",
                                        "application/ld+json",
                                        "application/json")
                            if m in html],
            "script_srcs": sorted({u for u in re.findall(
                r"<script[^>]+src=[\"']([^\"']+)", html)})[:15],
            "decimal_rates_seen": sorted({round(int(x) / 10000, 4) for x in
                                          DECIMAL_RATE_RE.findall(html)})[:20],
            "cents_rates_seen": sorted({float(x) for x in
                                        CENTS_RATE_RE.findall(html)})[:20],
            "mentions_savvy_saver": low.count("savvy saver"),
            # A big page that never says "savvy saver" and carries no rates is
            # the signature of a shell that renders client-side.
            "looks_like_js_shell": low.count("savvy saver") == 0
            and not DECIMAL_RATE_RE.search(html),
        }
    return out


def version_to_inc_gst(version):
    """'20260803(269.7)' -> 29.40  (ex-GST tenths of a cent, plus 9% GST)."""
    m = re.search(r"\(([\d.]+)\)", version or "")
    if not m:
        return None
    try:
        return round(float(m.group(1)) / 10 * 1.09, 2)
    except ValueError:
        return None


def write_out(payload):
    with open(OUT_PATH, "w") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")


def append_log(now, status, detail):
    new = not os.path.exists(LOG_PATH)
    with open(LOG_PATH, "a") as fh:
        if new:
            fh.write("# Tuas rates watch log\n\n"
                     "Appended by `.github/workflows/rates-watch.yml`. Every "
                     "run writes a line, including quiet ones — a daily commit "
                     "keeps GitHub from auto-disabling the schedule after 60 "
                     "days of inactivity.\n\n"
                     "| run (UTC) | status | detail |\n|---|---|---|\n")
        fh.write(f"| {now} | {status} | {detail} |\n")


if __name__ == "__main__":
    main()
