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
        '</a></li>';
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
