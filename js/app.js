/* 画面の切り替え、データ画面、起動 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var ui;
  var currentTab = null;

  function showTab(name, skipCheck) {
    if (name === currentTab) return;
    if (!skipCheck && currentTab === 'ledger' && MK.ledger) {
      if (!MK.ledger.confirmDiscard()) return;
      MK.ledger.close();
    }
    ui.$all('.tab').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    ui.$all('.panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + name; });
    currentTab = name;
    try { root.sessionStorage.setItem('mk-tab', name); } catch (e) { /* 保存できなくても動く */ }
    root.scrollTo(0, 0);
    MK.state.emit('tab', name);
  }

  function hasUnsaved() {
    if (MK.ledger && MK.ledger.isDirty()) return true;
    if (MK.compose && MK.compose.hasContent && MK.compose.hasContent()) return true;
    return false;
  }

  function bindData() {
    ui.$('#btn-export-json').addEventListener('click', function () { MK.io.exportJson(false); });
    ui.$('#btn-export-json-all').addEventListener('click', function () { MK.io.exportJson(true); });
    ui.$('#btn-export-csv').addEventListener('click', function () { MK.io.exportCsv(); });
    var input = ui.$('#file-import-json');
    var mode = 'replace';
    ui.$('#btn-import-replace').addEventListener('click', function () { mode = 'replace'; input.value = ''; input.click(); });
    ui.$('#btn-import-merge').addEventListener('click', function () { mode = 'merge'; input.value = ''; input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      MK.io.importFile(file, mode).then(function (msg) {
        if (msg) { ui.notice(msg); setResult(msg); }
      }).catch(function (err) {
        ui.notice('読み込めませんでした：' + err.message, 'error');
        setResult('読み込めませんでした：' + err.message);
      });
    });
    var sampleBtn = ui.$('#btn-load-sample');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', function () {
        if (!MK.sample) return;
        MK.sample.load().then(function (msg) { if (msg) { ui.notice(msg); setResult(msg); } });
      });
    }
    ui.$('#btn-clear-all').addEventListener('click', function () {
      if (!root.confirm('台帳と取り込んだ文書を、このブラウザからすべて消去します。よろしいですか。\n（先に「台帳と文書をまとめて書き出す」で控えを取ってください）')) return;
      Promise.all([MK.state.setLedger([]), MK.state.setDocs([])]).then(function () {
        ui.notice('消去しました。');
        setResult('台帳と文書を消去しました。');
      });
    });
    MK.state.on('ledger', updateSummary);
    MK.state.on('docs', updateSummary);
  }

  function setResult(msg) {
    var el = ui.$('#data-result');
    if (el) el.textContent = msg;
  }

  function updateSummary() {
    var el = ui.$('#data-summary');
    if (!el) return;
    el.textContent = '台帳 ' + MK.state.ledger.length + ' 件、取り込んだ文書 ' + MK.state.docs.length + ' 本を、このブラウザに保存しています。';
  }

  function init() {
    ui = MK.ui;
    ui.$all('.tab').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
      b.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        var tabs = ui.$all('.tab');
        var i = tabs.indexOf(b) + (ev.key === 'ArrowRight' ? 1 : -1);
        var t = tabs[(i + tabs.length) % tabs.length];
        t.focus();
        showTab(t.getAttribute('data-tab'));
      });
    });
    root.addEventListener('beforeunload', function (ev) {
      if (hasUnsaved()) { ev.preventDefault(); ev.returnValue = ''; return ''; }
    });
    ['ledger', 'docs', 'compose', 'llm', 'print'].forEach(function (m) {
      if (MK[m] && MK[m].init) MK[m].init();
    });
    bindData();
    MK.storage.isAvailable().then(function (ok) {
      if (!ok) {
        var w = ui.$('#storage-warning');
        if (w) w.hidden = false;
      }
    });
    var first = ui.$('.tab') ? ui.$('.tab').getAttribute('data-tab') : null;
    var saved = null;
    try { saved = root.sessionStorage.getItem('mk-tab'); } catch (e) { saved = null; }
    if (saved && ui.$('#panel-' + saved)) first = saved;
    showTab(first, true);
    return MK.state.load();
  }

  MK.app = { init: init, showTab: showTab, hasUnsaved: hasUnsaved };
  MK.ready = new Promise(function (resolve) {
    document.addEventListener('DOMContentLoaded', function () { init().then(resolve); });
  });
})(window);
