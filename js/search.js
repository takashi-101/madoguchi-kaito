/* 層2：全文検索（AIを使わない）。当てはまる箇所をすべて返す。 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var cache = null; // [{doc, blocks:[{b, norm}]}]

  function index() {
    if (cache) return cache;
    cache = MK.state.docs.map(function (d) {
      return {
        doc: d,
        nname: MK.norm.normalize(d.name),
        blocks: (d.blocks || []).map(function (b, i) {
          return { b: b, i: i, norm: MK.norm.normalize(b.t), nh: MK.norm.normalize(b.h || '') };
        })
      };
    });
    return cache;
  }
  function invalidate() { cache = null; }

  /** 語句で全文を検索する。
   * opts.mode: 'all'（すべての語を含む箇所）| 'any'（いずれかを含む箇所）
   * opts.docId: 文書を絞るとき
   * 戻り値: [{ doc, block, index, matched: [当たった語] }]（文書の並び順・本文の順） */
  function search(terms, opts) {
    opts = opts || {};
    var qs = terms.map(function (t) { return { raw: t, q: MK.norm.normalizeQueryTerm(t) }; })
      .filter(function (x) { return x.q.length > 0; });
    if (!qs.length) return [];
    var mode = opts.mode === 'any' ? 'any' : 'all';
    var out = [];
    index().forEach(function (entry) {
      if (opts.docId && entry.doc.id !== opts.docId) return;
      entry.blocks.forEach(function (bk) {
        var matched = qs.filter(function (x) { return bk.norm.indexOf(x.q) >= 0; }).map(function (x) { return x.raw; });
        if (mode === 'all' ? matched.length === qs.length : matched.length > 0) {
          out.push({ doc: entry.doc, block: bk.b, index: bk.i, matched: matched });
        }
      });
    });
    return out;
  }

  /** 文書名で取り込み済みの文書を探す（正規化して、どちらかがどちらかを含めば当たり） */
  function findDocsByName(name) {
    var n = MK.norm.normalize(name);
    if (!n) return [];
    return index().filter(function (e) {
      return e.nname === n || e.nname.indexOf(n) >= 0 || n.indexOf(e.nname) >= 0;
    });
  }

  /** 根拠（文書名・章・ページ・該当文言）に当たる箇所を探す */
  function findBasis(entry) {
    var res = { docFound: false, sectionFound: null, pageFound: null, quoteFound: null, blocks: [], docs: [] };
    if (!entry.basisDoc) return res;
    var docs = findDocsByName(entry.basisDoc);
    if (!docs.length) return res;
    res.docFound = true;
    res.docs = docs.map(function (d) { return d.doc; });
    var sec = MK.norm.normalize(entry.basisSection || '');
    var page = String(entry.basisPage || '').normalize('NFKC').replace(/[^0-9\-–〜~]/g, '');
    var pageFrom = null, pageTo = null;
    if (page) {
      var pm = /^(\d+)(?:[\-–〜~](\d+))?/.exec(page);
      if (pm) { pageFrom = Number(pm[1]); pageTo = pm[2] ? Number(pm[2]) : pageFrom; }
    }
    var quote = MK.norm.normalize(entry.basisQuote || '');
    var secHit = false, pageHit = false, quoteHit = false;
    var candidate = [];
    docs.forEach(function (d) {
      d.blocks.forEach(function (bk) {
        var okSec = !sec || bk.nh.indexOf(sec) >= 0 || (bk.b.head && bk.norm.indexOf(sec) >= 0);
        var okPage = pageFrom == null || bk.b.p == null || (bk.b.p >= pageFrom && bk.b.p <= pageTo);
        var inPage = pageFrom != null && bk.b.p != null && bk.b.p >= pageFrom && bk.b.p <= pageTo;
        if (sec && okSec) secHit = true;
        if (inPage) pageHit = true;
        if (quote && bk.norm.indexOf(quote) >= 0) quoteHit = true;
        if (okSec && okPage && (!quote || bk.norm.indexOf(quote) >= 0)) candidate.push({ doc: d.doc, block: bk.b, index: bk.i });
      });
    });
    // ページを持たない文書（テキスト・HTML）のときは、ページの照合はしない
    var docsHavePages = docs.some(function (d) { return d.doc.pageCount; });
    res.sectionFound = sec ? secHit : null;
    res.pageFound = pageFrom != null && docsHavePages ? pageHit : null;
    res.quoteFound = quote ? quoteHit : null;
    res.blocks = candidate.filter(function (c) { return !c.block.head || candidate.length === 1; });
    if (!res.blocks.length) res.blocks = candidate;
    return res;
  }

  MK.state && MK.state.on && MK.state.on('docs', invalidate);
  MK.search = { search: search, findDocsByName: findDocsByName, findBasis: findBasis, invalidate: invalidate };
})(typeof window !== 'undefined' ? window : globalThis);
