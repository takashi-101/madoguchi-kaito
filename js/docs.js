/* 層2：マニュアル・例規の画面（取り込み、一覧、全文検索） */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var ui, esc;

  function srcHtml(doc, block) {
    return '<div class="hit-src"><span>文書 <b>' + esc(doc.name) + '</b></span>' +
      '<span>章・見出し <b>' + (block.h ? esc(block.h) : '（見出しなし）') + '</b></span>' +
      '<span>ページ <b>' + (block.p != null ? esc(block.p) : '—') + '</b></span></div>';
  }

  /** 検索結果の1箇所を表示する HTML */
  function renderHit(hit, terms, extra) {
    extra = extra || '';
    return '<div class="hit" data-doc="' + esc(hit.doc.id) + '" data-index="' + hit.index + '">' +
      srcHtml(hit.doc, hit.block) +
      '<p class="hit-text">' + ui.highlight(hit.block.t, terms) + '</p>' + extra + '</div>';
  }

  function renderDocs() {
    var listEl = ui.$('#doc-list');
    var docs = MK.state.docs;
    ui.$('#doc-count').textContent = '取り込んだ文書 ' + docs.length + ' 本';
    var sel = ui.$('#search-doc');
    var cur = sel.value;
    sel.innerHTML = '<option value="">すべての文書</option>' + docs.map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>';
    }).join('');
    sel.value = cur;
    if (!docs.length) {
      listEl.innerHTML = '<li class="muted">まだ文書を取り込んでいません。</li>';
      return;
    }
    listEl.innerHTML = docs.map(function (d) {
      var chars = d.blocks.reduce(function (n, b) { return n + b.t.length; }, 0);
      return '<li data-id="' + esc(d.id) + '"><span class="doc-name">' + esc(d.name) + '</span>' +
        '<span class="doc-info">' + esc(d.type) + (d.pageCount ? '・' + d.pageCount + 'ページ' : '') +
        '・' + d.blocks.length + '箇所・約' + chars.toLocaleString() + '字・取り込み ' + esc(ui.fmtDate((d.importedAt || '').slice(0, 10))) + '</span>' +
        '<span class="btn-row"><button type="button" class="btn-small" data-act="view">本文を見る</button>' +
        '<button type="button" class="btn-small" data-act="rename">名前を変える</button>' +
        '<button type="button" class="btn-small btn-danger" data-act="delete">削除</button></span></li>';
    }).join('');
  }

  function onDocListClick(ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.closest('li').getAttribute('data-id');
    var d = MK.state.findDoc(id);
    if (!d) return;
    var act = btn.getAttribute('data-act');
    if (act === 'delete') {
      if (!root.confirm('「' + d.name + '」をこのブラウザから削除します。よろしいですか。')) return;
      MK.state.setDocs(MK.state.docs.filter(function (x) { return x.id !== id; })).then(function () { ui.notice('削除しました。'); });
    } else if (act === 'rename') {
      var nn = root.prompt('文書の名前（台帳の「根拠（文書名）」と合わせてください）', d.name);
      if (nn == null || !nn.trim()) return;
      var list = MK.state.docs.map(function (x) { return x.id === id ? Object.assign({}, x, { name: nn.trim() }) : x; });
      MK.state.setDocs(list);
    } else if (act === 'view') {
      showBody(d);
    }
  }

  function showBody(d) {
    var el = ui.$('#search-results');
    ui.$('#search-summary').textContent = '「' + d.name + '」の本文（' + d.blocks.length + '箇所）';
    el.innerHTML = d.blocks.map(function (b, i) {
      return renderHit({ doc: d, block: b, index: i }, []);
    }).join('');
    el.scrollIntoView({ block: 'start' });
  }

  function importFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var status = ui.$('#import-status');
    var results = [];
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        status.textContent = '「' + f.name + '」を読んでいます…';
        return MK.docparse.parseFile(f, function (p, total) {
          status.textContent = '「' + f.name + '」を読んでいます… ' + p + '／' + total + 'ページ';
        }).then(function (doc) {
          var same = MK.state.docs.find(function (x) { return x.name === doc.name; });
          var list = MK.state.docs.slice();
          if (same && root.confirm('同じ名前の文書「' + doc.name + '」があります。新しいファイルで置き換えますか。\n（キャンセルを押すと、別の文書として追加します）')) {
            doc.id = same.id;
            list = list.map(function (x) { return x.id === same.id ? doc : x; });
          } else {
            if (same) doc.name = doc.name + '（' + (list.length + 1) + '）';
            list.push(doc);
          }
          return MK.state.setDocs(list).then(function () {
            results.push('「' + doc.name + '」を取り込みました（' + doc.blocks.length + '箇所' + (doc.pageCount ? '、' + doc.pageCount + 'ページ' : '') + '）。');
          });
        }).catch(function (err) {
          results.push('「' + f.name + '」は取り込めませんでした：' + err.message);
        });
      });
    });
    return chain.then(function () {
      status.textContent = results.join('\n');
      ui.notice(results[results.length - 1] || '');
    });
  }

  function runSearch() {
    var q = ui.$('#search-q').value;
    var terms = MK.norm.splitTerms(q);
    var el = ui.$('#search-results');
    var sum = ui.$('#search-summary');
    if (!terms.length) { sum.textContent = ''; el.innerHTML = ''; return; }
    if (!MK.state.docs.length) {
      sum.textContent = '検索する文書がありません。先に文書を取り込んでください。';
      el.innerHTML = '';
      return;
    }
    var hits = MK.search.search(terms, { mode: ui.$('#search-mode').value, docId: ui.$('#search-doc').value });
    var docCount = {};
    hits.forEach(function (h) { docCount[h.doc.id] = 1; });
    sum.textContent = hits.length ? '当てはまる箇所 ' + hits.length + ' 件（' + Object.keys(docCount).length + ' 文書）。すべて表示しています。'
      : '当てはまる箇所はありません。語句を短くするか、「いずれかを含む」で探してください。';
    el.innerHTML = hits.map(function (h) { return renderHit(h, terms); }).join('');
  }

  function init() {
    ui = MK.ui; esc = ui.esc;
    var dz = ui.$('#dropzone');
    var input = ui.$('#file-docs');
    ui.$('#btn-pick-docs').addEventListener('click', function () { input.value = ''; input.click(); });
    input.addEventListener('change', function () { importFiles(input.files); });
    ['dragenter', 'dragover'].forEach(function (t) {
      dz.addEventListener(t, function (ev) { ev.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dz.addEventListener(t, function (ev) { ev.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (ev) { importFiles(ev.dataTransfer && ev.dataTransfer.files); });
    // 枠の外に落としたときに、ブラウザがファイルを開いて画面が移らないようにする
    root.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    root.addEventListener('drop', function (ev) { ev.preventDefault(); });
    ui.$('#doc-list').addEventListener('click', onDocListClick);
    ui.$('#search-form').addEventListener('submit', function (ev) { ev.preventDefault(); runSearch(); });
    ui.$('#search-mode').addEventListener('change', runSearch);
    ui.$('#search-doc').addEventListener('change', runSearch);
    MK.state.on('docs', function () { renderDocs(); if (ui.$('#search-q').value) runSearch(); });
  }

  MK.docs = { init: init, renderHit: renderHit, importFiles: importFiles, runSearch: runSearch };
})(typeof window !== 'undefined' ? window : globalThis);
