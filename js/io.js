/* データの書き出し・読み込み（JSON、CSV） */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var FORMAT = 'madoguchi-kaito';
  var VERSION = 1;

  var CSV_COLUMNS = [
    ['major', '大分類'], ['minor', '小分類'], ['question', 'よくある問い合わせ'], ['answer', '標準回答'],
    ['basisDoc', '根拠（文書名）'], ['basisSection', '根拠（章・条・見出し）'], ['basisPage', '根拠（ページ）'],
    ['basisQuote', '根拠の該当文言'], ['kakari', '担当の係'], ['updated', '最終更新日']
  ];

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function buildJson(includeDocs) {
    var o = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), ledger: MK.state.ledger };
    if (includeDocs) o.documents = MK.state.docs;
    return JSON.stringify(o, null, 2);
  }

  function exportJson(includeDocs) {
    MK.ui.download((includeDocs ? '台帳と文書_' : '標準回答台帳_') + stamp() + '.json', buildJson(includeDocs), 'application/json');
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    // 表計算ソフトで式として扱われないようにする
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv() {
    if (MK.analysis) MK.analysis.refresh();
    var head = CSV_COLUMNS.map(function (c) { return c[1]; }).concat(['確認の印']);
    var rows = [head.map(csvCell).join(',')];
    MK.state.ledger.forEach(function (e) {
      var flags = MK.analysis ? MK.analysis.flagsFor(e).map(function (f) { return f.label; }).join('／') : '';
      rows.push(CSV_COLUMNS.map(function (c) { return csvCell(e[c[0]]); }).concat([csvCell(flags)]).join(','));
    });
    // Excel で文字化けしないよう、先頭に BOM を付けた UTF-8、改行は CRLF
    return '﻿' + rows.join('\r\n') + '\r\n';
  }

  function exportCsv() {
    MK.ui.download('標準回答台帳_' + stamp() + '.csv', buildCsv(), 'text/csv;charset=utf-8');
  }

  /** JSON を解釈する。台帳だけの配列にも対応する。 */
  function parseJson(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('JSONとして読めませんでした。'); }
    if (Array.isArray(data)) return { ledger: data, documents: null };
    if (!data || typeof data !== 'object') throw new Error('このツールの書き出し形式ではありません。');
    if (data.format && data.format !== FORMAT) throw new Error('このツールの書き出し形式ではありません。');
    var ledger = Array.isArray(data.ledger) ? data.ledger : null;
    var docs = Array.isArray(data.documents) ? data.documents.filter(validDoc) : null;
    if (!ledger && !docs) throw new Error('台帳も文書も含まれていません。');
    return { ledger: ledger, documents: docs };
  }

  function validDoc(d) {
    return d && typeof d === 'object' && d.name && Array.isArray(d.blocks);
  }

  function entryKey(e) {
    var n = MK.norm.normalize;
    return [n(e.major), n(e.minor), n(e.question), n(e.answer), n(e.basisDoc), n(e.basisSection), n(e.basisPage)].join('\u0001');
  }
  function docKey(d) {
    var text = (d.blocks || []).map(function (b) { return b.t; }).join('\n');
    return MK.norm.normalize(d.name) + '\u0001' + simpleHash(text);
  }
  function simpleHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16) + ':' + s.length;
  }

  /** 置き換え */
  function replaceWith(parsed) {
    var tasks = [];
    var msg = [];
    if (parsed.ledger) {
      tasks.push(MK.state.setLedger(parsed.ledger));
      msg.push('台帳 ' + parsed.ledger.length + ' 件');
    }
    if (parsed.documents) {
      tasks.push(MK.state.setDocs(parsed.documents));
      msg.push('文書 ' + parsed.documents.length + ' 本');
    }
    return Promise.all(tasks).then(function () { return '読み込みました（置き換え）：' + msg.join('、') + '。'; });
  }

  /** 追加の取り込み（重なりは取り込まず、件数を報告する） */
  function merge(parsed) {
    var tasks = [];
    var msg = [];
    if (parsed.ledger) {
      var ids = {}, keys = {};
      MK.state.ledger.forEach(function (e) { ids[e.id] = 1; keys[entryKey(e)] = 1; });
      var add = [], dup = 0;
      parsed.ledger.forEach(function (raw) {
        var e = MK.state.cleanEntry(raw);
        var k = entryKey(e);
        if ((raw.id && ids[raw.id]) || keys[k]) { dup++; return; }
        ids[e.id] = 1; keys[k] = 1;
        add.push(e);
      });
      tasks.push(MK.state.setLedger(MK.state.ledger.concat(add)));
      msg.push('台帳：追加 ' + add.length + ' 件、重なりのため取り込まなかったもの ' + dup + ' 件');
    }
    if (parsed.documents) {
      var dids = {}, dkeys = {};
      MK.state.docs.forEach(function (d) { dids[d.id] = 1; dkeys[docKey(d)] = 1; });
      var addD = [], dupD = 0;
      parsed.documents.forEach(function (d) {
        var k = docKey(d);
        if ((d.id && dids[d.id]) || dkeys[k]) { dupD++; return; }
        if (!d.id) d.id = MK.state.newId('D');
        dids[d.id] = 1; dkeys[k] = 1;
        addD.push(d);
      });
      tasks.push(MK.state.setDocs(MK.state.docs.concat(addD)));
      msg.push('文書：追加 ' + addD.length + ' 本、重なりのため取り込まなかったもの ' + dupD + ' 本');
    }
    return Promise.all(tasks).then(function () { return '追加で取り込みました。' + msg.join('。') + '。'; });
  }

  function importFile(file, mode) {
    return MK.ui.readFileAsArrayBuffer(file).then(function (buf) {
      var parsed = parseJson(MK.ui.decodeText(buf));
      if (mode === 'replace') {
        var what = [];
        if (parsed.ledger) what.push('台帳');
        if (parsed.documents) what.push('取り込み済みの文書');
        if (!root.confirm('今の' + what.join('と') + 'を、ファイルの内容で置き換えます。よろしいですか。\n（先に書き出しておくと元に戻せます）')) {
          return null;
        }
        return replaceWith(parsed);
      }
      return merge(parsed);
    });
  }

  MK.io = {
    exportJson: exportJson,
    exportCsv: exportCsv,
    buildCsv: buildCsv,
    buildJson: buildJson,
    parseJson: parseJson,
    importFile: importFile,
    merge: merge,
    replaceWith: replaceWith,
    CSV_COLUMNS: CSV_COLUMNS
  };
})(typeof window !== 'undefined' ? window : globalThis);
