/* 表記の揺れの吸収（全角・半角、ひらがな・カタカナ、送り仮名の一部）
 * 正規化した文字列と、正規化後の各文字が原文のどの位置から来たかの対応表を作る。
 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};

  function isKanji(c) {
    if (!c) return false;
    var code = c.charCodeAt(0);
    return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0xF900 && code <= 0xFAFF) || c === '々' || c === '〆' || c === 'ヶ';
  }
  function isHiragana(c) {
    if (!c) return false;
    var code = c.charCodeAt(0);
    return code >= 0x3041 && code <= 0x309F;
  }

  // 送り仮名として省かれやすい文字（漢字と漢字の間にあるとき省く）
  var OKURI = 'しりいえきけみちつっわせれびひ';
  // 漢字と漢字の間以外で揃える語（正規化後のひらがな表記で書く）
  var OKURI_WORDS = [
    ['合わせ', '合せ'],
    ['終わり', '終り'],
    ['変わり', '変り'],
    ['代わり', '代り'],
    ['当たり', '当り'],
    ['申込み', '申込'],
    ['取扱い', '取扱'],
    ['受付け', '受付'],
    ['手続き', '手続'],
    ['届出る', '届出る'],
    ['引越し', '引越'],
    ['振込み', '振込'],
    ['払込み', '払込'],
    ['取消し', '取消'],
    ['支払い', '支払'],
    ['払戻し', '払戻'],
    ['受取り', '受取'],
    ['引換え', '引換'],
    ['書換え', '書換'],
    ['切替え', '切替'],
    ['申立て', '申立'],
    ['貸付け', '貸付'],
    ['見積り', '見積'],
    ['割引き', '割引'],
    ['繰越し', '繰越'],
    ['差押え', '差押'],
    ['立替え', '立替'],
    ['呼出し', '呼出'],
    ['引渡し', '引渡'],
    ['売渡し', '売渡'],
    ['持込み', '持込'],
    ['取替え', '取替'],
    ['受渡し', '受渡']
  ];

  // 1文字ごとの基本正規化（NFKC、小文字化、カタカナ→ひらがな）
  function baseChar(c) {
    var s = c.normalize ? c.normalize('NFKC') : c;
    s = s.toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 0x30A1 && code <= 0x30F6) out += String.fromCharCode(code - 0x60);
      else out += s.charAt(i);
    }
    return out;
  }

  /** 正規化と原文位置の対応表を作る。
   * 戻り値: { norm: 文字列, map: [正規化後の各文字に対応する原文の位置] } */
  function normalizeWithMap(text) {
    text = String(text == null ? '' : text);
    var tokens = []; // {c, o}
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var code = text.charCodeAt(i);
      // サロゲートペア
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
        ch = text.substr(i, 2);
      }
      var b = baseChar(ch);
      for (var k = 0; k < b.length; k++) {
        var bc = b.charAt(k);
        var bcode = bc.charCodeAt(0);
        // 空白・改行は詰める
        if (/\s/.test(bc) || bcode === 0x3000) continue;
        // 濁点・半濁点の結合文字は直前の文字と合成する
        if ((bcode === 0x3099 || bcode === 0x309A) && tokens.length) {
          var prev = tokens[tokens.length - 1];
          var comp = (prev.c + bc).normalize('NFC');
          if (comp.length === 1) { prev.c = baseChar(comp); continue; }
        }
        if (bc === '゛' || bc === '゜') {
          if (tokens.length) {
            var p2 = tokens[tokens.length - 1];
            var comb = (p2.c + (bc === '゛' ? '゙' : '゚')).normalize('NFC');
            if (comb.length === 1) { p2.c = baseChar(comb); continue; }
          }
        }
        // 長音・ハイフン類をそろえる
        if ('‐‑‒–—―−ｰ'.indexOf(bc) >= 0) bc = '-';
        tokens.push({ c: bc, o: i });
      }
      if (ch.length === 2) i++;
    }
    // 漢字に挟まれた送り仮名を省く（申し込み→申込み、取り扱い→取扱い、引っ越し→引越し）
    var t2 = [];
    for (var j = 0; j < tokens.length; j++) {
      var cur = tokens[j];
      if (OKURI.indexOf(cur.c) >= 0 && j > 0 && j + 1 < tokens.length &&
          isKanji(tokens[j - 1].c) && isKanji(tokens[j + 1].c)) {
        continue;
      }
      t2.push(cur);
    }
    // 語ごとの送り仮名をそろえる
    var s = t2.map(function (t) { return t.c; }).join('');
    if (s.length && /[ぁ-ゟ]/.test(s)) {
      var t3 = [];
      var pos = 0;
      while (pos < t2.length) {
        var matched = false;
        for (var w = 0; w < OKURI_WORDS.length; w++) {
          var from = OKURI_WORDS[w][0];
          var to = OKURI_WORDS[w][1];
          if (from === to) continue;
          if (s.substr(pos, from.length) === from) {
            for (var q = 0; q < to.length; q++) {
              t3.push({ c: to.charAt(q), o: t2[pos + Math.min(q, from.length - 1)].o });
            }
            pos += from.length;
            matched = true;
            break;
          }
        }
        if (!matched) { t3.push(t2[pos]); pos++; }
      }
      t2 = t3;
    }
    return {
      norm: t2.map(function (t) { return t.c; }).join(''),
      map: t2.map(function (t) { return t.o; })
    };
  }

  function normalize(text) {
    return normalizeWithMap(text).norm;
  }

  /** 検索語の正規化。末尾の送り仮名1文字（漢字の直後）を落として、送り仮名の有無を吸収する。 */
  function normalizeQueryTerm(term) {
    var n = normalize(term);
    if (n.length >= 3) {
      var last = n.charAt(n.length - 1);
      var prev = n.charAt(n.length - 2);
      if (OKURI.indexOf(last) >= 0 && isKanji(prev)) n = n.slice(0, -1);
    }
    return n;
  }

  /** 検索語の分割（空白区切り。全角空白も区切りとして扱う） */
  function splitTerms(q) {
    return String(q || '').split(/[\s　]+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  // 漢数字を算用数字に置き換える（下書きと原文の数字の照合用）
  var KDIGIT = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var KUNIT = { '十': 10, '百': 100, '千': 1000 };
  function kanjiNumToArabic(text) {
    return String(text).replace(/[〇零一二三四五六七八九十百千万]+/g, function (m) {
      // 「一部」「一般」などの語中の「一」は数字として扱わない（単独の一は残す）
      if (m === '一' || m === '千' || m === '万' || m === '百') return m;
      var total = 0, section = 0, num = -1;
      var allDigits = /^[〇零一二三四五六七八九]+$/.test(m);
      if (allDigits) {
        return m.split('').map(function (c) { return KDIGIT[c]; }).join('');
      }
      for (var i = 0; i < m.length; i++) {
        var c = m.charAt(i);
        if (c in KDIGIT) { num = KDIGIT[c]; }
        else if (c in KUNIT) { section += (num < 0 ? 1 : num) * KUNIT[c]; num = -1; }
        else if (c === '万') { section += (num < 0 ? 0 : num); total += (section || 1) * 10000; section = 0; num = -1; }
      }
      if (num >= 0) section += num;
      return String(total + section);
    });
  }

  /** 照合用の強い正規化（漢数字→数字、桁区切りのカンマを除く） */
  function normalizeForFacts(text) {
    var s = String(text || '').normalize('NFKC');
    s = kanjiNumToArabic(s);
    s = s.replace(/(\d),(?=\d{3})/g, '$1');
    return normalize(s);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  MK.norm = {
    normalize: normalize,
    normalizeWithMap: normalizeWithMap,
    normalizeQueryTerm: normalizeQueryTerm,
    normalizeForFacts: normalizeForFacts,
    kanjiNumToArabic: kanjiNumToArabic,
    splitTerms: splitTerms,
    isKanji: isKanji,
    isHiragana: isHiragana,
    escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
