/* 層2：マニュアル・例規の取り込み（テキスト、HTML、文字を選べるPDF）
 * 文書を「箇所」（段落・条）に分け、それぞれに見出し（章・節・条）とページを付ける。 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var VERSION_MARK = '20261105-1';
  var MAX_BLOCK = 600;

  var NUM = '[0-9０-９一二三四五六七八九十百千〇]+';
  var RE_PART = new RegExp('^第' + NUM + '[編章](?:\\s|　|$|[^0-9０-９条])');
  var RE_SECTION = new RegExp('^第' + NUM + '[節款](?:\\s|　|$|[^0-9０-９条])');
  var RE_ARTICLE = new RegExp('^(第' + NUM + '条(?:の' + NUM + ')?)(?:[\\s　]*[（(]([^）)]{1,30})[）)])?');
  var RE_CAPTION = /^[（(]([^）)]{1,30})[）)]$/;
  var RE_SUPPL = /^附[\s　]*則/;
  var RE_MD = /^(#{1,6})\s+(.+)$/;
  var RE_BRACKET = /^【([^】]{1,30})】$/;
  var RE_NUMHEAD = /^([0-9０-９]{1,2}(?:[-－.．][0-9０-９]{1,2})*)[.．、\s　]\s*(\S.{0,28})$/;

  function cleanLine(s) {
    return String(s || '').replace(/ /g, ' ').replace(/[ \t]+$/g, '');
  }

  /** 行の並びから箇所を作る。
   * lines: [{ text, page, level? (HTML の見出し), para? (段落の切れ目) }] */
  function linesToBlocks(lines) {
    var heads = ['', '', '', '']; // 0:編・章 1:節 2:条・小見出し 3:予備
    var blocks = [];
    var headings = [];
    var buf = [];
    var bufPage = null;
    var pendingCaption = null;

    function headingPath() {
      return heads.filter(function (h) { return h; }).join(' ＞ ');
    }
    function flush() {
      if (!buf.length) return;
      var text = buf.join('\n').trim();
      buf = [];
      if (!text) return;
      // 長い段落は行の切れ目で分ける
      if (text.length > MAX_BLOCK) {
        var parts = text.split('\n');
        var cur = '';
        parts.forEach(function (ln) {
          if (cur && (cur.length + ln.length) > MAX_BLOCK) {
            blocks.push({ p: bufPage, h: headingPath(), t: cur });
            cur = '';
          }
          cur = cur ? cur + '\n' + ln : ln;
        });
        if (cur) blocks.push({ p: bufPage, h: headingPath(), t: cur });
      } else {
        blocks.push({ p: bufPage, h: headingPath(), t: text });
      }
    }
    function setHead(level, label, page) {
      heads[level] = label;
      for (var i = level + 1; i < heads.length; i++) heads[i] = '';
      headings.push({ level: level, label: label, p: page });
    }

    lines.forEach(function (ln) {
      var raw = cleanLine(ln.text);
      var text = raw.trim();
      var page = ln.page == null ? null : ln.page;
      if (ln.para || !text) {
        flush();
        if (!text) return;
      }
      if (ln.level) {
        flush();
        var lv = Math.min(ln.level, 3) - 1;
        if (lv > 2) lv = 2;
        setHead(lv, text, page);
        blocks.push({ p: page, h: headingPath(), t: text, head: 1 });
        return;
      }
      var m;
      if ((m = RE_MD.exec(text))) {
        flush();
        setHead(Math.min(m[1].length, 3) - 1, m[2].trim(), page);
        blocks.push({ p: page, h: headingPath(), t: m[2].trim(), head: 1 });
        return;
      }
      if (RE_PART.test(text) || RE_SUPPL.test(text)) {
        flush();
        setHead(0, text, page);
        blocks.push({ p: page, h: headingPath(), t: text, head: 1 });
        pendingCaption = null;
        return;
      }
      if (RE_SECTION.test(text)) {
        flush();
        setHead(1, text, page);
        blocks.push({ p: page, h: headingPath(), t: text, head: 1 });
        pendingCaption = null;
        return;
      }
      if ((m = RE_CAPTION.exec(text))) {
        // 例規の条の見出し（次の行の「第○条」に付ける）
        flush();
        pendingCaption = m[1];
        return;
      }
      if ((m = RE_ARTICLE.exec(text))) {
        flush();
        var cap = m[2] || pendingCaption;
        setHead(2, m[1] + (cap ? '（' + cap + '）' : ''), page);
        pendingCaption = null;
        bufPage = page;
        buf.push(text);
        return;
      }
      if ((m = RE_BRACKET.exec(text)) || ((m = RE_NUMHEAD.exec(text)) && !/[。．]$/.test(text) && text.length <= 32)) {
        flush();
        setHead(2, text, page);
        blocks.push({ p: page, h: headingPath(), t: text, head: 1 });
        pendingCaption = null;
        return;
      }
      if (pendingCaption) {
        // 見出しだけで条が続かなかったときは、そのまま本文として扱う
        buf.push('（' + pendingCaption + '）');
        pendingCaption = null;
      }
      if (!buf.length) bufPage = page;
      if (page !== bufPage) { flush(); bufPage = page; }
      buf.push(raw.trim());
    });
    flush();
    return { blocks: blocks, headings: headings };
  }

  function parsePlainText(text) {
    text = String(text).replace(/\r\n?/g, '\n');
    var pages = text.split('\f');
    var hasPages = pages.length > 1;
    var lines = [];
    pages.forEach(function (pg, i) {
      pg.split('\n').forEach(function (l) { lines.push({ text: l, page: hasPages ? i + 1 : null }); });
      lines.push({ text: '', page: hasPages ? i + 1 : null });
    });
    var r = linesToBlocks(lines);
    r.pageCount = hasPages ? pages.length : null;
    return r;
  }

  var BLOCK_TAGS = /^(P|DIV|LI|UL|OL|DL|DT|DD|TABLE|THEAD|TBODY|TFOOT|TR|PRE|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|MAIN|FIGURE|FIGCAPTION|CAPTION|FORM|FIELDSET|ADDRESS|HR|BR)$/;

  function parseHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    Array.prototype.forEach.call(doc.querySelectorAll('script,style,noscript,template,iframe,object,svg'), function (n) { n.remove(); });
    var lines = [];
    var cur = '';
    function push(para) {
      var t = cur.replace(/[ \t\r\n]+/g, ' ').trim();
      cur = '';
      if (t) lines.push({ text: t, page: null, para: para });
    }
    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { cur += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        var tag = c.tagName;
        var hm = /^H([1-6])$/.exec(tag);
        if (hm) {
          push(true);
          var ht = c.textContent.replace(/\s+/g, ' ').trim();
          if (ht) lines.push({ text: ht, page: null, level: Number(hm[1]) });
          continue;
        }
        if (tag === 'BR') { push(false); continue; }
        if (tag === 'TD' || tag === 'TH') { walk(c); cur += '　'; continue; }
        if (BLOCK_TAGS.test(tag)) {
          push(true);
          walk(c);
          push(false);
          continue;
        }
        walk(c);
      }
    }
    var title = doc.querySelector('title');
    walk(doc.body || doc.documentElement);
    push(true);
    var r = linesToBlocks(lines);
    r.pageCount = null;
    r.title = title ? title.textContent.trim() : '';
    return r;
  }

  function htmlCharset(buf) {
    var head = new TextDecoder('ascii').decode(new Uint8Array(buf).subarray(0, 2048));
    var m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
    if (!m) return null;
    var cs = m[1].toLowerCase();
    if (cs === 'shift_jis' || cs === 'sjis' || cs === 'x-sjis' || cs === 'windows-31j' || cs === 'cp932') return 'shift_jis';
    if (cs === 'euc-jp') return 'euc-jp';
    if (cs === 'utf-8') return 'utf-8';
    return null;
  }

  // ---- PDF（pdf.js を同梱。必要になったときに読み込む） ----
  var pdfReady = null;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error(src + ' を読み込めませんでした。')); };
      document.head.appendChild(s);
    });
  }
  function ensurePdfjs() {
    if (pdfReady) return pdfReady;
    var base = 'vendor/pdfjs/';
    var v = '?v=' + VERSION_MARK;
    pdfReady = loadScript(base + 'pdf.min.js' + v)
      .then(function () { return loadScript(base + 'pdf.worker.min.js' + v); })
      .then(function () { return loadScript(base + 'cmaps.js' + v); })
      .then(function () {
        var lib = root.pdfjsLib;
        if (!lib) throw new Error('PDFを読む部品を準備できませんでした。');
        lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js' + v;
        return lib;
      });
    pdfReady.catch(function () { pdfReady = null; });
    return pdfReady;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function BundledCMapReaderFactory() {}
  BundledCMapReaderFactory.prototype.fetch = function (opts) {
    var name = opts && opts.name;
    var data = root.MK_PDF_CMAPS && root.MK_PDF_CMAPS[name];
    if (!data) return Promise.reject(new Error('文字の対応表 ' + name + ' がありません。'));
    return Promise.resolve({ cMapData: b64ToBytes(data), compressionType: 1 /* BINARY */ });
  };

  function parsePdf(buf, onProgress) {
    return ensurePdfjs().then(function (lib) {
      var task = lib.getDocument({
        data: new Uint8Array(buf),
        CMapReaderFactory: BundledCMapReaderFactory,
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
        verbosity: 0
      });
      return task.promise.then(function (pdf) {
        var lines = [];
        var total = pdf.numPages;
        var chain = Promise.resolve();
        var charCount = 0;
        for (var n = 1; n <= total; n++) {
          (function (pn) {
            chain = chain.then(function () {
              return pdf.getPage(pn).then(function (page) {
                return page.getTextContent().then(function (tc) {
                  var pageLines = pdfItemsToLines(tc.items);
                  pageLines.forEach(function (l) {
                    charCount += l.text.length;
                    lines.push({ text: l.text, page: pn, para: l.para });
                  });
                  lines.push({ text: '', page: pn });
                  if (onProgress) onProgress(pn, total);
                  page.cleanup();
                });
              });
            });
          })(n);
        }
        return chain.then(function () {
          pdf.destroy();
          if (charCount === 0) {
            throw new Error('文字を選べないPDF（画像だけのPDF）のため、本文を取り出せませんでした。');
          }
          var r = linesToBlocks(lines);
          r.pageCount = total;
          return r;
        });
      });
    });
  }

  /** PDF の文字の並びを行に直す。行の間が広いところを段落の切れ目とする。 */
  function pdfItemsToLines(items) {
    var lines = [];
    var cur = '';
    var lastY = null, lastH = 0, lastX = null, lineY = null;
    var gapBefore = false;
    function end() {
      if (cur.trim()) lines.push({ text: cur, para: gapBefore });
      cur = '';
    }
    items.forEach(function (it) {
      if (typeof it.str !== 'string') return;
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      var y = tr[5];
      var h = Math.abs(it.height || tr[3] || 10);
      if (lineY !== null && Math.abs(y - lineY) > Math.max(2, h * 0.5)) {
        var gap = lineY - y;
        end();
        gapBefore = gap > Math.max(lastH, h) * 1.9;
        lineY = y;
      } else if (lineY === null) {
        lineY = y;
      }
      cur += it.str;
      lastY = y; lastH = h; lastX = tr[4];
      if (it.hasEOL) {
        end();
        gapBefore = false;
        lineY = null;
      }
    });
    end();
    return lines;
  }

  function baseName(fileName) {
    return String(fileName || '').replace(/\.[^.]+$/, '');
  }

  /** ファイルを読み、文書のデータにする */
  function parseFile(file, onProgress) {
    var name = file.name || '';
    var ext = (/\.([^.]+)$/.exec(name) || [, ''])[1].toLowerCase();
    return MK.ui.readFileAsArrayBuffer(file).then(function (buf) {
      var type, p;
      if (ext === 'pdf' || file.type === 'application/pdf') {
        type = 'PDF';
        p = parsePdf(buf, onProgress);
      } else if (ext === 'html' || ext === 'htm' || file.type === 'text/html') {
        type = 'HTML';
        p = Promise.resolve(parseHtml(MK.ui.decodeText(buf, htmlCharset(buf))));
      } else if (ext === 'txt' || ext === 'text' || ext === 'md' || ext === 'csv' || (file.type || '').indexOf('text/') === 0) {
        type = 'テキスト';
        p = Promise.resolve(parsePlainText(MK.ui.decodeText(buf)));
      } else {
        return Promise.reject(new Error('取り込めるのは、テキスト（.txt）、HTML（.html）、PDF（.pdf）です。'));
      }
      return p.then(function (r) {
        if (!r.blocks.length) throw new Error('本文が見つかりませんでした。');
        return {
          id: MK.state.newId('D'),
          name: baseName(name) || r.title || '名称未設定の文書',
          fileName: name,
          type: type,
          importedAt: new Date().toISOString(),
          pageCount: r.pageCount,
          blocks: r.blocks,
          headings: r.headings
        };
      });
    });
  }

  MK.docparse = {
    parseFile: parseFile,
    parsePlainText: parsePlainText,
    parseHtml: parseHtml,
    parsePdf: parsePdf,
    linesToBlocks: linesToBlocks,
    pdfItemsToLines: pdfItemsToLines,
    ensurePdfjs: ensurePdfjs,
    fromText: function (name, text, type) {
      var r = type === 'HTML' ? parseHtml(text) : parsePlainText(text);
      return {
        id: MK.state.newId('D'), name: name, fileName: '', type: type || 'テキスト',
        importedAt: new Date().toISOString(), pageCount: r.pageCount, blocks: r.blocks, headings: r.headings
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
