/* SG Power Deals — shared behaviour: copy-to-clipboard + chart fill on scroll */
(function () {
  var el = document.getElementById('code');
  if (!el) return;
  var code = el.textContent.trim();
  var said = document.getElementById('said');

  function flash(btn) {
    if (said) {
      said.textContent = 'Copied — now paste it at sign-up.';
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
