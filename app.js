/* Click counter: page views, code copies, sign-up clicks, other-site card. Sends one tiny beacon to /api/c; no cookies, no personal data. (Cloudflare Web Analytics is injected separately by Cloudflare automatic setup.) */
(function () {
  /* Owner opt-out: visit any page with ?notrack=1 once (per browser) to stop counting your own visits; ?notrack=0 undoes it. */
  try {
    if (/[?&]notrack=1/.test(location.search)) localStorage.setItem('notrack', '1');
    if (/[?&]notrack=0/.test(location.search)) localStorage.removeItem('notrack');
    if (localStorage.getItem('notrack')) return;
  } catch (e) {}
  function send(a) {
    try {
      var body = JSON.stringify({ a: a, p: location.pathname });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/c', body);
      else fetch('/api/c', { method: 'POST', body: body, keepalive: true });
    } catch (e) {}
  }
  send('view');
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('a,button') : null;
    if (!t) return;
    if (t.matches('[data-copy]')) send('copy');
    else if (t.matches('a.ps-tab')) send('tab');
    else if (t.matches('a.sister')) send('sister');
    else if (t.matches('.rslab a, .dock a, a.b-go, a.b-copy')) send('signup');
  }, true);
})();

/* SG Power Deals — shared behaviour: copy-to-clipboard + chart fill on scroll.
   A button copies its own data-copy value if it has one (guide-page code boxes, .gc),
   otherwise the page's #code. Status text goes to the box's .said, else #said. */
(function () {
  var main = document.getElementById('code');
  var mainSaid = document.getElementById('said');

  function codeFor(btn) { return btn.getAttribute('data-copy') || (main ? main.textContent.trim() : ''); }
  function saidFor(btn) {
    var box = btn.closest ? btn.closest('.gc') : null;
    return (box && box.querySelector('.said')) || mainSaid;
  }

  function flash(btn) {
    var said = saidFor(btn);
    if (said) {
      said.textContent = said.getAttribute('data-msg') || 'Copied — now paste it at sign-up.';
      setTimeout(function () { said.textContent = ''; }, 4000);
    }
    var t = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(function () { btn.textContent = t; }, 2200);
  }

  function fallback(btn, code) {
    var t = document.createElement('textarea');
    t.value = code;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:absolute;left:-9999px';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); flash(btn); }
    catch (e) { var said = saidFor(btn); if (said) said.textContent = 'Copy manually: ' + code; }
    document.body.removeChild(t);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
    btn.addEventListener('click', function () {
      var code = codeFor(btn);
      if (!code) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { flash(btn); },
                                                function () { fallback(btn, code); });
      } else { fallback(btn, code); }
    });
  });

  var chart = document.getElementById('chart');
  if (!chart) return;
  var fills = chart.querySelectorAll('.fill');
  function draw() {
    Array.prototype.forEach.call(fills, function (f, i) {
      setTimeout(function () { f.style.width = f.getAttribute('data-w') + '%'; }, i * 90);
    });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) { draw(); io.disconnect(); } });
    }, { threshold: 0.25 });
    io.observe(chart);
  } else { draw(); }
})();
