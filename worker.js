// Click counter for sgpowerdeals.com / sginvestdeals.com.
// Everything except /api/* is served straight from the static assets.
//   POST /api/c          — beacon from /app.js: {a: action, p: path}
//   GET  /api/stats?k=…   — private stats page (k must equal the STATS_KEY secret)
// Counts live in the shared D1 database "deals-clicks" (binding DB).

const ACTIONS = ['view', 'copy', 'signup', 'sister', 'tab'];
const SCHEMA = 'CREATE TABLE IF NOT EXISTS clicks (day TEXT NOT NULL, site TEXT NOT NULL, page TEXT NOT NULL, action TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, page, action))';
let ready = false;
async function ensure(env) { if (!ready) { await env.DB.prepare(SCHEMA).run(); ready = true; } }

function sgDay(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600e3 - offsetDays * 864e5).toISOString().slice(0, 10);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function record(req, env, url) {
  const site = url.hostname.replace(/^www\./, '');
  const origin = req.headers.get('Origin') || req.headers.get('Referer') || '';
  // Only count beacons sent by our own pages.
  if (!origin.includes(site)) return new Response(null, { status: 204 });
  let b;
  try { b = JSON.parse(await req.text()); } catch { return new Response(null, { status: 204 }); }
  const action = ACTIONS.includes(b && b.a) ? b.a : null;
  const page = typeof (b && b.p) === 'string' && /^\/[a-z0-9\-\/]{0,60}$/.test(b.p) ? b.p : null;
  if (!action || !page) return new Response(null, { status: 204 });
  await ensure(env);
  await env.DB.prepare('INSERT INTO clicks (day, site, page, action, n) VALUES (?1, ?2, ?3, ?4, 1) ' +
    'ON CONFLICT (day, site, page, action) DO UPDATE SET n = n + 1').bind(sgDay(), site, page, action).run();
  return new Response(null, { status: 204 });
}

async function stats(env, url) {
  if (!env.STATS_KEY || url.searchParams.get('k') !== env.STATS_KEY) return new Response('Not found', { status: 404 });
  await ensure(env);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 1), 365);
  const since = sgDay(days - 1);
  const { results: tot } = await env.DB.prepare(
    "SELECT site, page, SUM(CASE WHEN action='view' THEN n ELSE 0 END) v, SUM(CASE WHEN action='copy' THEN n ELSE 0 END) c, " +
    "SUM(CASE WHEN action='signup' THEN n ELSE 0 END) s, SUM(CASE WHEN action='sister' THEN n ELSE 0 END) x " +
    'FROM clicks WHERE day >= ?1 GROUP BY site, page ORDER BY site, (c + s) DESC, v DESC').bind(since).all();
  const { results: daily } = await env.DB.prepare(
    "SELECT day, site, SUM(CASE WHEN action='view' THEN n ELSE 0 END) v, SUM(CASE WHEN action IN ('copy','signup') THEN n ELSE 0 END) k, " +
    "SUM(CASE WHEN action='sister' THEN n ELSE 0 END) x FROM clicks WHERE day >= ?1 GROUP BY day, site ORDER BY day DESC, site").bind(sgDay(13)).all();
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
  const row = r => `<tr><td>${esc(r.site)}</td><td>${esc(r.page)}</td><td>${r.v}</td><td>${r.c}</td><td>${r.s}</td><td>${pct(Math.max(r.c, r.s), r.v)}</td><td>${r.x}</td></tr>`;
  const drow = r => `<tr><td>${esc(r.day)}</td><td>${esc(r.site)}</td><td>${r.v}</td><td>${r.k}</td><td>${r.x}</td></tr>`;
  const sum = (k) => tot.reduce((a, r) => a + r[k], 0);
  const opts = [7, 30, 90, 365].map(d => `<a href="?k=${encodeURIComponent(url.searchParams.get('k'))}&days=${d}"${d === days ? ' class="on"' : ''}>${d}d</a>`).join(' ');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Click stats</title><style>
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px 16px;background:#F4F6F5;color:#13201F}
.w{max-width:900px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}p{color:#5B6B69;margin:0 0 12px}
.k{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.k div{background:#fff;border-radius:12px;padding:12px 16px;min-width:120px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.k b{display:block;font-size:24px}.k span{font-size:12px;color:#5B6B69;text-transform:uppercase;letter-spacing:.08em}
.t{overflow-x:auto;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #E6EBEA;white-space:nowrap}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#5B6B69}
td:nth-child(n+3),th:nth-child(n+3){text-align:right}a{color:#0C5C63;margin-right:6px}a.on{font-weight:700;text-decoration:none}</style></head><body><div class="w">
<h1>Click stats</h1><p>Last ${days} days (Singapore time) · ${opts}</p>
<div class="k"><div><span>Page views</span><b>${sum('v')}</b></div><div><span>Code copies</span><b>${sum('c')}</b></div><div><span>Sign-up clicks</span><b>${sum('s')}</b></div><div><span>To other site</span><b>${sum('x')}</b></div></div>
<p>Views count real browsers only (JavaScript must run), so bots are mostly excluded. A sign-up click opens the provider's page — whether they finish signing up shows on your bills / in the provider app.</p>
<h2>By page</h2><div class="t"><table><tr><th>Site</th><th>Page</th><th>Views</th><th>Copies</th><th>Sign-up clicks</th><th title="Larger of copies or sign-up clicks, as a share of views">Take-up</th><th>To other site</th></tr>${tot.map(row).join('') || '<tr><td colspan="7">No data yet</td></tr>'}</table></div>
<h2>Last 14 days</h2><div class="t"><table><tr><th>Day</th><th>Site</th><th>Views</th><th>Copies + sign-ups</th><th>To other site</th></tr>${daily.map(drow).join('') || '<tr><td colspan="5">No data yet</td></tr>'}</table></div>
</div></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/api/c' && req.method === 'POST') return await record(req, env, url);
      if (url.pathname === '/api/stats' && req.method === 'GET') return await stats(env, url);
    } catch (e) {
      if (url.pathname === '/api/c') return new Response(null, { status: 204 }); // never break the page
      return new Response('Error: ' + e.message, { status: 500 });
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(req);
  }
};
