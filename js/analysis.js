/* 層3：ばらつきと根拠の確認
 * ・同じ大分類・小分類に、内容の違う標準回答が複数あるとき「回答がばらついています」
 * ・根拠の欄が空、または原文の中に見つからないとき「根拠がありません」「根拠が原文に見つかりません」 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var stale = true;
  var flagsById = {};
  var groupsById = {};

  function groupKey(e) {
    return MK.norm.normalize(e.major) + '\u0001' + MK.norm.normalize(e.minor);
  }
  function answerKey(e) {
    // 句読点・記号の違いは同じ内容として扱う
    return MK.norm.normalizeForFacts(e.answer).replace(/[、。,.．，・「」『』（）()\[\]【】!！?？:：;；]/g, '');
  }

  function refresh() {
    if (!stale) return;
    stale = false;
    flagsById = {};
    groupsById = {};
    var groups = {};
    MK.state.ledger.forEach(function (e) {
      var k = groupKey(e);
      (groups[k] = groups[k] || []).push(e);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var distinct = {};
      g.forEach(function (e) { distinct[answerKey(e)] = 1; });
      var n = Object.keys(distinct).length;
      g.forEach(function (e) {
        groupsById[e.id] = g;
        flagsById[e.id] = [];
        if (n >= 2) {
          flagsById[e.id].push({
            kind: 'vary', label: '回答がばらついています',
            detail: '同じ小分類「' + e.minor + '」に、内容の違う標準回答が ' + n + ' 通りあります。'
          });
        }
      });
    });
    MK.state.ledger.forEach(function (e) {
      var f = basisFlag(e);
      if (f) flagsById[e.id].push(f);
    });
  }

  function basisFlag(e) {
    if (!e.basisDoc && !e.basisSection && !e.basisPage) {
      return { kind: 'nobasis', label: '根拠がありません', detail: '根拠（マニュアル・例規の名前と章・ページ）が記入されていません。' };
    }
    if (!e.basisDoc) {
      return { kind: 'nobasis', label: '根拠がありません', detail: '根拠の文書名が記入されていません。' };
    }
    var r = MK.search.findBasis(e);
    if (!r.docFound) {
      return { kind: 'unchecked', label: '根拠の文書が未取り込み', detail: '「' + e.basisDoc + '」が取り込まれていないため、原文の中にあるかを確かめられません。「マニュアル・例規の検索」で取り込んでください。' };
    }
    var miss = [];
    if (r.sectionFound === false) miss.push('章・条・見出し「' + e.basisSection + '」');
    if (r.pageFound === false) miss.push('ページ「' + e.basisPage + '」');
    if (r.quoteFound === false) miss.push('該当文言「' + e.basisQuote + '」');
    if (miss.length || !r.blocks.length) {
      return { kind: 'nobasis', label: '根拠が原文に見つかりません', detail: '「' + e.basisDoc + '」の中に ' + (miss.join('、') || '指定の箇所') + ' が見つかりません。' };
    }
    return null;
  }

  function flagsFor(e) {
    refresh();
    return flagsById[e.id] || [];
  }

  /** 同じ小分類の、内容の違う回答（自分以外） */
  function variants(e) {
    refresh();
    var g = groupsById[e.id] || [];
    var mine = answerKey(e);
    return g.filter(function (x) { return x.id !== e.id && answerKey(x) !== mine; });
  }

  function markStale() { stale = true; }
  MK.state.on('ledger', markStale);
  MK.state.on('docs', markStale);

  MK.analysis = { refresh: refresh, flagsFor: flagsFor, variants: variants, markStale: markStale };
})(typeof window !== 'undefined' ? window : globalThis);
