/* 層1：標準回答の台帳（一覧・登録・編集・削除） */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var ui, esc;

  var form, list, editingId = null, dirty = false, snapshot = '';

  var FIELD_IDS = {
    major: 'f-major', minor: 'f-minor', question: 'f-question', answer: 'f-answer',
    basisDoc: 'f-basis-doc', basisSection: 'f-basis-section', basisPage: 'f-basis-page',
    basisQuote: 'f-basis-quote', kakari: 'f-kakari', updated: 'f-updated'
  };

  function readForm() {
    var o = { id: editingId || '' };
    Object.keys(FIELD_IDS).forEach(function (k) { o[k] = document.getElementById(FIELD_IDS[k]).value.trim(); });
    return o;
  }
  function writeForm(e) {
    Object.keys(FIELD_IDS).forEach(function (k) { document.getElementById(FIELD_IDS[k]).value = e[k] || ''; });
  }
  function formKey() { return JSON.stringify(readForm()); }

  function openForm(entry, isNew) {
    editingId = entry && entry.id && !isNew ? entry.id : null;
    var e = entry || {};
    writeForm(Object.assign({ updated: MK.state.today() }, e, isNew ? { updated: e.updated || MK.state.today() } : {}));
    ui.$('#ledger-form-title').textContent = editingId ? '標準回答の修正' : '標準回答の新規登録';
    ui.$('#btn-entry-delete').hidden = !editingId;
    form.hidden = false;
    snapshot = isNew && entry ? '' : formKey();
    dirty = isNew && entry ? true : false;
    updateDocOptions();
    form.scrollIntoView({ block: 'start' });
    document.getElementById('f-major').focus();
  }

  function closeForm() {
    form.hidden = true;
    editingId = null;
    dirty = false;
    snapshot = '';
  }

  function isDirty() {
    if (form.hidden) return false;
    return dirty || formKey() !== snapshot;
  }

  function confirmDiscard() {
    if (!isDirty()) return true;
    return root.confirm('標準回答の入力が保存されていません。入力を破棄してよろしいですか。');
  }

  function save(ev) {
    if (ev) ev.preventDefault();
    var e = readForm();
    if (!e.minor || !e.answer) {
      ui.notice('小分類と標準回答は必ず入力してください。', 'error');
      return;
    }
    if (!e.updated) e.updated = MK.state.today();
    MK.state.upsertEntry(e).then(function (saved) {
      closeForm();
      ui.notice('台帳に登録しました（' + (saved.major ? saved.major + '／' : '') + saved.minor + '）。');
    });
  }

  function remove() {
    if (!editingId) return;
    if (!root.confirm('この標準回答を台帳から削除します。よろしいですか。')) return;
    MK.state.removeEntry(editingId).then(function () {
      closeForm();
      ui.notice('削除しました。');
    });
  }

  function uniqueValues(field) {
    var s = {};
    MK.state.ledger.forEach(function (e) { if (e[field]) s[e[field]] = 1; });
    return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  }

  function updateDatalists() {
    fill('dl-major', uniqueValues('major'));
    fill('dl-minor', uniqueValues('minor'));
    fill('dl-kakari', uniqueValues('kakari'));
    var sel = ui.$('#ledger-filter-major');
    var cur = sel.value;
    sel.innerHTML = '<option value="">すべての大分類</option>' + uniqueValues('major').map(function (m) {
      return '<option>' + esc(m) + '</option>';
    }).join('');
    sel.value = cur;
  }
  function updateDocOptions() {
    var names = {};
    MK.state.docs.forEach(function (d) { names[d.name] = 1; });
    uniqueValues('basisDoc').forEach(function (n) { names[n] = 1; });
    fill('dl-doc', Object.keys(names));
  }
  function fill(id, values) {
    var dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = values.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('');
  }

  function flagsFor(e) {
    return MK.analysis ? MK.analysis.flagsFor(e) : [];
  }

  function flagHtml(flags) {
    return flags.map(function (f) {
      return '<span class="flag flag-' + f.kind + '" title="' + esc(f.detail || '') + '">' + esc(f.label) + '</span>';
    }).join('');
  }

  function basisText(e) {
    var parts = [];
    if (e.basisDoc) parts.push(e.basisDoc);
    if (e.basisSection) parts.push(e.basisSection);
    if (e.basisPage) parts.push(e.basisPage + 'ページ');
    return parts.join('　');
  }

  function variantsHtml(e) {
    if (!MK.analysis) return '';
    var v = MK.analysis.variants(e);
    if (!v.length) return '';
    return '<details class="variants"><summary>同じ小分類の、内容の違う回答（' + v.length + '件）を比べる</summary>' +
      v.map(function (x) {
        return '<div class="basis-quote">' + esc(x.answer) + '<br><span class="muted">根拠：' + esc(basisText(x) || '（未記入）') +
          '　担当：' + esc(x.kakari || '—') + '　更新：' + esc(ui.fmtDate(x.updated) || '—') + '</span></div>';
      }).join('') + '</details>';
  }

  function render() {
    updateDatalists();
    var q = MK.norm.splitTerms(ui.$('#ledger-filter-text').value).map(MK.norm.normalizeQueryTerm);
    var major = ui.$('#ledger-filter-major').value;
    var flagFilter = ui.$('#ledger-filter-flag').value;
    if (MK.analysis) MK.analysis.refresh();
    var items = MK.state.ledger.filter(function (e) {
      if (major && e.major !== major) return false;
      if (q.length) {
        var hay = MK.norm.normalize([e.major, e.minor, e.question, e.answer, basisText(e), e.kakari].join(' '));
        if (!q.every(function (t) { return hay.indexOf(t) >= 0; })) return false;
      }
      if (flagFilter) {
        var fl = flagsFor(e);
        if (flagFilter === 'any' && !fl.length) return false;
        if (flagFilter !== 'any' && !fl.some(function (f) { return f.kind === flagFilter; })) return false;
      }
      return true;
    });
    items.sort(function (a, b) {
      return (a.major || '').localeCompare(b.major || '', 'ja') || (a.minor || '').localeCompare(b.minor || '', 'ja') ||
        (a.question || '').localeCompare(b.question || '', 'ja');
    });
    ui.$('#ledger-count').textContent = '登録 ' + MK.state.ledger.length + ' 件／表示 ' + items.length + ' 件';
    if (!MK.state.ledger.length) {
      list.innerHTML = '<p class="empty">台帳に標準回答がありません。「新規登録」から登録するか、「設定・データ」で見本データまたはJSONを読み込んでください。</p>';
      return;
    }
    if (!items.length) {
      list.innerHTML = '<p class="empty">条件に当てはまる標準回答はありません。</p>';
      return;
    }
    var html = '';
    var lastGroup = null;
    items.forEach(function (e) {
      var group = (e.major || '（大分類なし）');
      if (group !== lastGroup) {
        html += '<h3 class="group-head">' + esc(group) + '</h3>';
        lastGroup = group;
      }
      var flags = flagsFor(e);
      html += '<article class="entry' + (flags.length ? ' has-flag' : '') + '" data-id="' + esc(e.id) + '">' +
        '<div class="entry-head"><span class="entry-minor">' + esc(e.minor) + '</span>' + flagHtml(flags) + '</div>' +
        (e.question ? '<p class="entry-q"><span class="lbl">問</span>' + esc(e.question) + '</p>' : '') +
        '<p class="entry-a"><span class="lbl">答</span>' + esc(e.answer) + '</p>' +
        '<dl class="entry-meta">' +
        '<div><dt>根拠</dt><dd>' + (basisText(e) ? esc(basisText(e)) : '<span class="muted">（未記入）</span>') + '</dd></div>' +
        '<div><dt>担当の係</dt><dd>' + esc(e.kakari || '—') + '</dd></div>' +
        '<div><dt>最終更新日</dt><dd>' + esc(ui.fmtDate(e.updated) || '—') + '</dd></div>' +
        '</dl>' +
        variantsHtml(e) +
        '<div class="entry-actions"><button type="button" class="btn-small" data-act="edit">修正</button>' +
        '<button type="button" class="btn-small" data-act="copy">複製して登録</button></div>' +
        '</article>';
    });
    list.innerHTML = html;
  }

  function onListClick(ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var art = btn.closest('.entry');
    var e = MK.state.findEntry(art.getAttribute('data-id'));
    if (!e) return;
    if (!confirmDiscard()) return;
    if (btn.getAttribute('data-act') === 'edit') openForm(e, false);
    else {
      var c = Object.assign({}, e, { id: '', updated: MK.state.today() });
      openForm(c, true);
    }
  }

  function init() {
    ui = MK.ui; esc = ui.esc;
    form = ui.$('#ledger-form');
    list = ui.$('#ledger-list');
    form.addEventListener('submit', save);
    form.addEventListener('input', function () { dirty = formKey() !== snapshot; });
    ui.$('#btn-entry-cancel').addEventListener('click', function () { if (confirmDiscard()) closeForm(); });
    ui.$('#btn-entry-delete').addEventListener('click', remove);
    ui.$('#btn-entry-new').addEventListener('click', function () {
      if (!confirmDiscard()) return;
      openForm(null, false);
    });
    list.addEventListener('click', onListClick);
    ['#ledger-filter-text', '#ledger-filter-major', '#ledger-filter-flag'].forEach(function (s) {
      ui.$(s).addEventListener('input', render);
    });
    MK.state.on('ledger', render);
    MK.state.on('docs', function () { render(); updateDocOptions(); });
  }

  MK.ledger = {
    init: init,
    render: render,
    isDirty: isDirty,
    confirmDiscard: confirmDiscard,
    openNew: function (prefill) { openForm(prefill, true); },
    close: closeForm,
    basisText: basisText,
    flagHtml: flagHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
