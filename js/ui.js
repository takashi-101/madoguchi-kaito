/* 画面共通の小さな部品 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var esc = function (s) { return MK.norm.escapeHtml(s); };

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  var toastTimer = null;
  function notice(msg, kind) {
    var el = $('#notice');
    if (!el) return;
    el.textContent = msg;
    el.className = 'notice show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'notice'; }, kind === 'error' ? 9000 : 5000);
  }

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  /** 文字コードを判定して文字列にする（UTF-8 を優先し、だめならシフトJIS） */
  function decodeText(buf, hint) {
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (hint) {
      try { return new TextDecoder(hint).decode(bytes); } catch (e) { /* 次へ */ }
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try { return new TextDecoder('shift_jis').decode(bytes); } catch (e2) { /* 次へ */ }
      try { return new TextDecoder('euc-jp').decode(bytes); } catch (e3) { /* 次へ */ }
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  function fmtDate(s) {
    if (!s) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }

  /** 語句を強調した HTML を作る（原文を壊さず、正規化して当てた位置に印を付ける） */
  function highlight(text, terms) {
    text = String(text || '');
    if (!terms || !terms.length) return esc(text);
    var nm = MK.norm.normalizeWithMap(text);
    var marks = [];
    terms.forEach(function (t) {
      var q = MK.norm.normalizeQueryTerm(t);
      if (!q) return;
      var from = 0;
      while (true) {
        var i = nm.norm.indexOf(q, from);
        if (i < 0) break;
        var start = nm.map[i];
        var endIdx = i + q.length - 1;
        var end = nm.map[endIdx] + 1;
        // 終わりの文字がサロゲートペアなら2文字分
        var cc = text.charCodeAt(end - 1);
        if (cc >= 0xD800 && cc <= 0xDBFF) end++;
        marks.push([start, end]);
        from = i + Math.max(1, q.length);
      }
    });
    if (!marks.length) return esc(text);
    marks.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    var merged = [];
    marks.forEach(function (m) {
      var last = merged[merged.length - 1];
      if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
      else merged.push([m[0], m[1]]);
    });
    var out = '', pos = 0;
    merged.forEach(function (m) {
      out += esc(text.slice(pos, m[0])) + '<mark>' + esc(text.slice(m[0], m[1])) + '</mark>';
      pos = m[1];
    });
    return out + esc(text.slice(pos));
  }

  MK.ui = {
    $: $, $all: $all, esc: esc, notice: notice, download: download,
    readFileAsArrayBuffer: readFileAsArrayBuffer, decodeText: decodeText,
    fmtDate: fmtDate, highlight: highlight
  };
})(typeof window !== 'undefined' ? window : globalThis);
