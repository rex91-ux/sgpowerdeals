/* Click counter: page views, code copies, sign-up clicks, other-site card. Sends one tiny beacon to /api/c; no cookies, no personal data. Also loads Cloudflare Web Analytics. */
(function () {
  /* Owner opt-out: visit any page with ?notrack=1 once (per browser) to stop counting your own visits; ?notrack=0 undoes it. */
  try {
    if (/[?&]notrack=1/.test(location.search)) localStorage.setItem('notrack', '1');
    if (/[?&]notrack=0/.test(location.search)) localStorage.removeItem('notrack');
    if (localStorage.getItem('notrack')) return;
  } catch (e) {}
  /* Cloudflare Web Analytics (cookieless): shows where visitors come from */
  try {
    var cf = document.createElement('script');
    cf.type = 'module';
    cf.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    cf.setAttribute('data-cf-beacon', '{"token": "53f3c99ec48642dabce68d51114a6d8b"}');
    document.head.appendChild(cf);
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
    else if (t.matches('a.sister')) send('sister');
    else if (t.matches('.rslab a, .dock a, a.b-go, a.b-copy')) send('signup');
  }, true);
})();

/* SG Power Deals — shared behaviour: copy-to-clipboard + chart fill on scroll */
(function () {
  var el = document.getElementById('code');
  if (!el) return;
  var code = el.textContent.trim();
  var said = document.getElementById('said');

  function flash(btn) {
    if (said) {
      said.textContent = said.getAttribute('data-msg') || 'Copied — now paste it at sign-up.';
      setTimeout(function () { said.textContent = ''; }, 4000);
    }
    var t = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(function () { btn.textContent = t; }, 2200);
  }

  function fallback(btn) {
    var t = document.createElement('textarea');
    t.value = code;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:absolute;left:-9999px';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); flash(btn); }
    catch (e) { if (said) said.textContent = 'Copy manually: ' + code; }
    document.body.removeChild(t);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
    btn.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { flash(btn); },
                                                function () { fallback(btn); });
      } else { fallback(btn); }
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
