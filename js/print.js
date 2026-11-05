/* 層6：「窓口対応 標準回答集」の印刷（A4、分類ごと、根拠と最終更新日を含む） */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var ui, esc;

  function sorted(list) {
    return list.slice().sort(function (a, b) {
      return (a.major || '').localeCompare(b.major || '', 'ja') || (a.minor || '').localeCompare(b.minor || '', 'ja') ||
        (a.question || '').localeCompare(b.question || '', 'ja');
    });
  }

  function build() {
    var title = ui.$('#print-title').value.trim() || '窓口対応 標準回答集';
    var major = ui.$('#print-major').value;
    var withFlags = ui.$('#print-flags').checked;
    var items = sorted(MK.state.ledger.filter(function (e) { return !major || e.major === major; }));
    if (MK.analysis) MK.analysis.refresh();
    var groups = [];
    var idx = {};
    items.forEach(function (e) {
      var g = e.major || '（大分類なし）';
      if (!(g in idx)) { idx[g] = groups.length; groups.push({ name: g, items: [] }); }
      groups[idx[g]].items.push(e);
    });
    var html = '<div class="sheet-head"><h1>' + esc(title) + '</h1>' +
      '<p>作成日 ' + esc(ui.fmtDate(MK.state.today())) + '　掲載 ' + items.length + ' 件' + (major ? '　（大分類：' + esc(major) + '）' : '') + '</p>' +
      '<p class="sheet-note">回答の根拠は、記載のマニュアル・例規の原文です。内容が変わったときは、担当の係が台帳を更新してください。</p></div>';
    if (groups.length > 1) {
      html += '<div class="sheet-toc"><h2>目次</h2><ol>' + groups.map(function (g) {
        return '<li>' + esc(g.name) + '（' + g.items.length + '件）</li>';
      }).join('') + '</ol></div>';
    }
    groups.forEach(function (g, gi) {
      html += '<section class="sheet-group"><h2>' + (gi + 1) + '．' + esc(g.name) + '</h2>';
      g.items.forEach(function (e) {
        var flags = withFlags && MK.analysis ? MK.analysis.flagsFor(e) : [];
        html += '<article class="sheet-entry"><h3>' + esc(e.minor) +
          (flags.length ? '<span class="sheet-flag">［' + flags.map(function (f) { return esc(f.label); }).join('］［') + '］</span>' : '') + '</h3>' +
          '<table><tbody>' +
          (e.question ? '<tr><th>問い合わせ</th><td>' + esc(e.question) + '</td></tr>' : '') +
          '<tr><th>標準回答</th><td>' + esc(e.answer) + '</td></tr>' +
          '<tr><th>根拠</th><td>' + (MK.ledger.basisText(e) ? esc(MK.ledger.basisText(e)) : '（未記入）') + '</td></tr>' +
          '<tr><th>担当の係</th><td>' + esc(e.kakari || '—') + '</td></tr>' +
          '<tr><th>最終更新日</th><td>' + esc(ui.fmtDate(e.updated) || '—') + '</td></tr>' +
          '</tbody></table></article>';
      });
      html += '</section>';
    });
    if (!items.length) html += '<p>掲載する標準回答がありません。</p>';
    return html;
  }

  function preview() {
    var sel = ui.$('#print-major');
    var cur = sel.value;
    var majors = {};
    MK.state.ledger.forEach(function (e) { if (e.major) majors[e.major] = 1; });
    sel.innerHTML = '<option value="">すべての大分類</option>' + Object.keys(majors).sort(function (a, b) { return a.localeCompare(b, 'ja'); })
      .map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('');
    sel.value = cur;
    ui.$('#print-preview').innerHTML = build();
  }

  function doPrint() {
    var area = ui.$('#print-area');
    area.innerHTML = build();
    document.body.classList.add('printing');
    var done = function () {
      document.body.classList.remove('printing');
      area.innerHTML = '';
      root.removeEventListener('afterprint', done);
    };
    root.addEventListener('afterprint', done);
    root.print();
    // afterprint が来ない環境のための後始末
    setTimeout(function () { if (document.body.classList.contains('printing')) done(); }, 60000);
  }

  function init() {
    ui = MK.ui; esc = ui.esc;
    ['#print-title', '#print-major', '#print-flags'].forEach(function (s) { ui.$(s).addEventListener('input', preview); ui.$(s).addEventListener('change', preview); });
    ui.$('#btn-print').addEventListener('click', doPrint);
    MK.state.on('ledger', preview);
    MK.state.on('docs', preview);
    MK.state.on('tab', function (t) { if (t === 'print') preview(); });
  }

  MK.print = { init: init, build: build };
})(typeof window !== 'undefined' ? window : globalThis);
