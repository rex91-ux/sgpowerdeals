/* SG Power Deals — homepage leaderboard: term toggle + usage slider */
(function () {
  var dataEl = document.getElementById('rates');
  var board = document.getElementById('board');
  if (!dataEl || !board) return;
  var D = JSON.parse(dataEl.textContent);

  var term = 36, kwh = 388.5;
  var slider = document.getElementById('kwh');
  var out = document.getElementById('kwhOut');
  var spTot = document.getElementById('spTot');
  var spLine = document.getElementById('spline');

  function money(n) { return '$' + Math.round(n).toLocaleString('en-SG'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // codes for the plan shown in each row: copy buttons (or a link), right in the board
  function chips(list) {
    if (!list || !list.length) return '';
    return '<div class="rcodes">' + list.map(function (k) {
      var cls = 'rc' + (k.mine ? ' mine' : '');
      if (k.href) return '<a class="' + cls + ' b-go" href="' + esc(k.href) +
        '" rel="nofollow sponsored noopener" target="_blank"><span>' + esc(k.l) + '</span><b>' +
        esc(k.c) + '</b><em>Open ↗</em></a>';
      return '<button class="' + cls + '" type="button" data-copy="' + esc(k.c) + '"><span>' +
        esc(k.l) + '</span><b>' + esc(k.c) + '</b><em>Copy</em></button>';
    }).join('') + '</div>';
  }

  function copied(btn) {
    var em = btn.querySelector('em');
    btn.classList.add('done'); if (em) em.textContent = 'Copied ✓';
    setTimeout(function () { btn.classList.remove('done'); if (em) em.textContent = 'Copy'; }, 2200);
  }
  board.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button.rc') : null;
    if (!btn) return;
    var code = btn.getAttribute('data-copy');
    function fallback() {
      var t = document.createElement('textarea');
      t.value = code; t.setAttribute('readonly', ''); t.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); copied(btn); } catch (err) {}
      document.body.removeChild(t);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { copied(btn); }, fallback);
    } else { fallback(); }
  });

  function render() {
    var units = kwh * term;
    var sp = units * D.sp / 100;
    var rows = D.retailers.map(function (r) {
      // where a retailer has more than one route, show whichever is cheaper at this usage
      var best = null;
      r['t' + term].forEach(function (o) {
        var tot = units * o.rate / 100 - o.rebate;
        if (!best || tot < best.tot) best = { o: o, tot: tot };
      });
      return { r: r, o: best.o, tot: best.tot };
    }).sort(function (a, b) { return a.tot - b.tot; });

    var top = rows[0].tot;
    var maxSave = sp - top;
    board.innerHTML = rows.map(function (x, i) {
      var save = sp - x.tot;
      var w = maxSave > 0 ? Math.max(2, save / maxSave * 100) : 0;
      var diff = i === 0 ? 'saves ' + money(save) + ' vs SP' : '+' + money(x.tot - top);
      return '<li class="row' + (i === 0 ? ' best' : '') + '"><a href="' + x.r.url + '">' +
        '<span class="rk">' + (i + 1) + '</span>' +
        '<div class="who"><b>' + esc(x.r.name) + '</b>' +
        '<span>' + esc(x.o.plan) + ' · ' + x.o.rate.toFixed(2) + '¢</span>' +
        '<small>' + esc(x.o.note) + '</small>' +
        '<div class="sbar"><i style="width:' + w.toFixed(1) + '%"></i></div></div>' +
        '<div class="tot"><b>' + money(x.tot) + '</b><span>' + diff + '</span></div>' +
        '</a>' + chips(x.o.codes) + '</li>';
    }).join('');

    if (spTot) spTot.textContent = money(sp);
    if (spLine) spLine.lastChild.textContent = ' over ' + (term / 12) + ' years';
    if (out) out.textContent = (kwh % 1 ? kwh.toFixed(1) : kwh) + ' kWh';
  }

  Array.prototype.forEach.call(document.querySelectorAll('.seg button'), function (b) {
    b.addEventListener('click', function () {
      term = +b.getAttribute('data-term');
      Array.prototype.forEach.call(document.querySelectorAll('.seg button'), function (x) {
        x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      });
      render();
    });
  });

  var presets = document.querySelectorAll('.presets button');
  function markPreset() {
    Array.prototype.forEach.call(presets, function (p) {
      p.classList.toggle('on', +p.getAttribute('data-kwh') === kwh);
    });
  }
  if (slider) slider.addEventListener('input', function () {
    kwh = +slider.value; markPreset(); render();
  });
  Array.prototype.forEach.call(presets, function (p) {
    p.addEventListener('click', function () {
      kwh = +p.getAttribute('data-kwh'); if (slider) slider.value = kwh; markPreset(); render();
    });
  });

  render();
})();
