/* 層3：回答の作成。問い合わせの内容から、台帳の標準回答と原文の該当箇所を並べる。
 * 問い合わせの入力欄と回答欄の中身は保存しない（画面を閉じると消える）。 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var ui, esc;
  var lastTerms = [];
  var passages = []; // 並べた原文 [{key, doc, block, index, source, matched, checked}]

  // 語として拾わない漢字の語
  var STOP = ['場合', '必要', '方法', '可能', '自分', '今日', '明日', '昨日', '今回', '以下', '以上', '教示', '教え', '確認',
    '質問', '問合', '問い合わせ', '問合せ', '連絡', '大丈夫', '本人', '何時', '何処', '一番', '全部', '最近', '先日', '具体的'];

  /** 問い合わせの文から検索語を拾う（漢字の語、カタカナの語、英数字の語） */
  function extractTerms(text) {
    var re = /[一-龠々〆ヶ]+(?:[しりいえきけみちつっわせれびひ][一-龠々〆ヶ]+)*|[ァ-ヴーｦ-ﾟ]{2,}|[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]{2,}/g;
    var found = String(text || '').match(re) || [];
    var seen = {};
    var stopN = STOP.map(MK.norm.normalize);
    var out = [];
    found.forEach(function (w) {
      if (w.length < 2) return;
      var n = MK.norm.normalize(w);
      if (seen[n] || stopN.indexOf(n) >= 0) return;
      seen[n] = 1;
      out.push(w);
    });
    return out;
  }

  /** 台帳の標準回答を、問い合わせとの近さで並べる（当たりのあるものはすべて） */
  function matchLedger(inquiry, terms) {
    var nq = MK.norm.normalize(inquiry);
    var grams = bigrams(nq);
    var qterms = terms.map(MK.norm.normalizeQueryTerm).filter(Boolean);
    var res = [];
    MK.state.ledger.forEach(function (e) {
      var head = MK.norm.normalize([e.major, e.minor, e.question].join(' '));
      var body = MK.norm.normalize(e.answer);
      var score = 0;
      var hitTerms = [];
      qterms.forEach(function (t, i) {
        if (head.indexOf(t) >= 0) { score += 3; hitTerms.push(terms[i]); }
        else if (body.indexOf(t) >= 0) { score += 1; hitTerms.push(terms[i]); }
      });
      var hg = bigrams(head);
      var qKeys = Object.keys(grams), hKeys = Object.keys(hg);
      var common = qKeys.filter(function (g) { return hg[g]; }).length;
      var dice = qKeys.length && hKeys.length ? (2 * common) / (qKeys.length + hKeys.length) : 0;
      score += dice * 4;
      if (hitTerms.length || dice >= 0.18) res.push({ entry: e, score: score, terms: hitTerms });
    });
    res.sort(function (a, b) { return b.score - a.score; });
    return res;
  }
  function bigrams(s) {
    var o = {};
    for (var i = 0; i < s.length - 1; i++) o[s.substr(i, 2)] = 1;
    return o;
  }

  function passageKey(doc, index) { return doc.id + '#' + index; }

  function collect() {
    var inquiry = ui.$('#compose-inquiry').value;
    var termField = ui.$('#compose-terms');
    var terms = MK.norm.splitTerms(termField.value);
    if (!terms.length) {
      terms = extractTerms(inquiry);
      termField.value = terms.join(' ');
    }
    lastTerms = terms;
    var ledgerHits = inquiry.trim() || terms.length ? matchLedger(inquiry, terms) : [];
    // 原文：台帳の根拠の箇所 → 検索語の当たる箇所
    var map = {};
    passages = [];
    ledgerHits.forEach(function (lh) {
      var fb = MK.search.findBasis(lh.entry);
      fb.blocks.forEach(function (b) {
        var k = passageKey(b.doc, b.index);
        if (map[k]) { map[k].fromEntries.push(lh.entry); return; }
        var p = { key: k, doc: b.doc, block: b.block, index: b.index, source: 'basis', matched: [], fromEntries: [lh.entry], checked: false };
        map[k] = p;
        passages.push(p);
      });
    });
    var hits = terms.length ? MK.search.search(terms, { mode: 'any' }) : [];
    hits.sort(function (a, b) { return b.matched.length - a.matched.length; });
    hits.forEach(function (h) {
      var k = passageKey(h.doc, h.index);
      if (map[k]) { map[k].matched = h.matched; return; }
      var p = { key: k, doc: h.doc, block: h.block, index: h.index, source: 'search', matched: h.matched, fromEntries: [], checked: false };
      map[k] = p;
      passages.push(p);
    });
    // 下書きの材料に最初から選んでおくもの：台帳の根拠の箇所と、検索語に最も多く当たる箇所（合わせて8箇所まで）
    var maxMatched = passages.reduce(function (m, p) { return Math.max(m, p.matched.length); }, 0);
    var n = 0;
    passages.forEach(function (p) {
      if (n >= 8) return;
      if (p.source === 'basis' || (maxMatched > 0 && p.matched.length === maxMatched && !p.block.head)) { p.checked = true; n++; }
    });
    renderLedger(ledgerHits);
    renderPassages();
    ui.$('#compose-results').hidden = false;
    MK.state.emit('compose-collected');
  }

  function renderLedger(hits) {
    var el = ui.$('#compose-ledger');
    ui.$('#compose-ledger-count').textContent = hits.length ? '（' + hits.length + '件）' : '';
    if (!MK.state.ledger.length) {
      el.innerHTML = '<p class="empty">台帳に標準回答がありません。</p>';
      return;
    }
    if (!hits.length) {
      el.innerHTML = '<p class="empty">当てはまる標準回答は見つかりませんでした。原文から回答を組み立て、台帳への登録を検討してください。</p>';
      return;
    }
    el.innerHTML = hits.map(function (h, i) {
      var e = h.entry;
      var flags = MK.analysis.flagsFor(e);
      var vars = MK.analysis.variants(e);
      return '<article class="entry' + (flags.length ? ' has-flag' : '') + '" data-id="' + esc(e.id) + '"' + (i >= 8 ? ' data-more="1" hidden' : '') + '>' +
        '<div class="entry-head"><span class="entry-minor">' + esc(e.major ? e.major + '／' : '') + esc(e.minor) + '</span>' + MK.ledger.flagHtml(flags) + '</div>' +
        (e.question ? '<p class="entry-q"><span class="lbl">問</span>' + ui.highlight(e.question, lastTerms) + '</p>' : '') +
        '<p class="entry-a"><span class="lbl">答</span>' + ui.highlight(e.answer, lastTerms) + '</p>' +
        '<dl class="entry-meta"><div><dt>根拠</dt><dd>' + (MK.ledger.basisText(e) ? esc(MK.ledger.basisText(e)) : '<span class="muted">（未記入）</span>') + '</dd></div>' +
        '<div><dt>担当の係</dt><dd>' + esc(e.kakari || '—') + '</dd></div><div><dt>最終更新日</dt><dd>' + esc(ui.fmtDate(e.updated) || '—') + '</dd></div></dl>' +
        (vars.length ? '<div class="variants"><p class="help">同じ小分類に、次の回答も登録されています。どちらが正しいか、原文と照らして担当の係に確認してください。</p>' +
          vars.map(function (x) { return '<div class="basis-quote">' + esc(x.answer) + '<br><span class="muted">根拠：' + esc(MK.ledger.basisText(x) || '（未記入）') + '</span></div>'; }).join('') + '</div>' : '') +
        '<div class="entry-actions"><button type="button" class="btn-small" data-act="use">回答欄に入れる</button></div>' +
        '</article>';
    }).join('') + (hits.length > 8 ? '<button type="button" id="btn-ledger-more" class="btn-small">ほかの候補 ' + (hits.length - 8) + ' 件も表示</button>' : '');
  }

  function renderPassages() {
    var el = ui.$('#compose-passages');
    ui.$('#compose-passage-count').textContent = passages.length ? '（' + passages.length + '箇所）' : '';
    if (!MK.state.docs.length) {
      el.innerHTML = '<p class="empty">マニュアル・例規が取り込まれていません。「マニュアル・例規の検索」で取り込むと、ここに原文の該当箇所が並びます。</p>';
      return;
    }
    if (!passages.length) {
      el.innerHTML = '<p class="empty">原文に当てはまる箇所は見つかりませんでした。検索語を変えて「探し直す」を押してください。</p>';
      return;
    }
    el.innerHTML = passages.map(function (p) {
      var label = p.source === 'basis' ? '<span class="flag flag-ok">台帳の根拠</span> ' : '';
      var extra = '<div class="hit-actions">' + label +
        '<label class="sel-check"><input type="checkbox" data-key="' + esc(p.key) + '"' + (p.checked ? ' checked' : '') + '> 下書きの材料にする</label>' +
        '<button type="button" class="btn-small" data-act="quote" data-key="' + esc(p.key) + '">回答欄に引用</button></div>';
      return MK.docs.renderHit({ doc: p.doc, block: p.block, index: p.index }, lastTerms, extra);
    }).join('');
  }

  function basisLine(p) {
    return '（根拠：' + p.doc.name + (p.block.h ? '　' + p.block.h : '') + (p.block.p != null ? '　' + p.block.p + 'ページ' : '') + '）';
  }

  function appendAnswer(text) {
    var ta = ui.$('#compose-answer');
    ta.value = ta.value ? ta.value.replace(/\s+$/, '') + '\n' + text : text;
    ta.dispatchEvent(new Event('input'));
  }

  function onLedgerClick(ev) {
    if (ev.target.id === 'btn-ledger-more') {
      ui.$all('#compose-ledger [data-more]').forEach(function (a) { a.hidden = false; });
      ev.target.remove();
      return;
    }
    var btn = ev.target.closest('button[data-act=use]');
    if (!btn) return;
    var e = MK.state.findEntry(btn.closest('.entry').getAttribute('data-id'));
    if (e) appendAnswer(e.answer);
    ui.notice('標準回答を回答欄に入れました。');
  }

  function onPassageClick(ev) {
    var cb = ev.target.closest('input[type=checkbox][data-key]');
    if (cb) {
      var p = findPassage(cb.getAttribute('data-key'));
      if (p) p.checked = cb.checked;
      MK.state.emit('compose-collected');
      return;
    }
    var btn = ev.target.closest('button[data-act=quote]');
    if (!btn) return;
    var p2 = findPassage(btn.getAttribute('data-key'));
    if (!p2) return;
    appendAnswer(p2.block.t + '\n' + basisLine(p2));
    ui.notice('原文を回答欄に引用しました。');
  }
  function findPassage(key) {
    return passages.find(function (p) { return p.key === key; }) || null;
  }

  function registerToLedger() {
    var answer = ui.$('#compose-answer').value.trim();
    if (!answer) { ui.notice('回答欄が空です。', 'error'); return; }
    if (!root.confirm('回答欄の文を、台帳の新規登録の欄に移します。\n個人を特定できる情報（氏名、住所、生年月日など）が含まれていないか確かめてから登録してください。')) return;
    var first = passages.find(function (p) { return p.checked; });
    var top = ui.$('#compose-ledger .entry');
    var topEntry = top ? MK.state.findEntry(top.getAttribute('data-id')) : null;
    var prefill = {
      major: topEntry ? topEntry.major : '',
      minor: topEntry ? topEntry.minor : '',
      question: '',
      answer: answer,
      basisDoc: first ? first.doc.name : '',
      basisSection: first ? (first.block.h || '').split(' ＞ ').pop() : '',
      basisPage: first && first.block.p != null ? String(first.block.p) : '',
      kakari: topEntry ? topEntry.kakari : '',
      updated: MK.state.today()
    };
    MK.app.showTab('ledger');
    MK.ledger.openNew(prefill);
  }

  function clearAll() {
    if (hasContent() && !root.confirm('問い合わせの内容と回答欄を消去します。よろしいですか。')) return;
    ui.$('#compose-inquiry').value = '';
    ui.$('#compose-terms').value = '';
    ui.$('#compose-answer').value = '';
    passages = [];
    lastTerms = [];
    ui.$('#compose-results').hidden = true;
    MK.state.emit('compose-cleared');
  }

  function hasContent() {
    return !!(ui.$('#compose-inquiry').value.trim() || ui.$('#compose-answer').value.trim() ||
      (ui.$('#llm-draft') && ui.$('#llm-draft').value.trim()));
  }

  function copyAnswer() {
    var ta = ui.$('#compose-answer');
    if (!ta.value) return;
    var done = function () { ui.notice('回答をコピーしました。'); };
    if (navigator.clipboard && root.isSecureContext) {
      navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
    } else { ta.select(); document.execCommand('copy'); done(); }
  }

  function init() {
    ui = MK.ui; esc = ui.esc;
    ui.$('#compose-form').addEventListener('submit', function (ev) { ev.preventDefault(); ui.$('#compose-terms').value = ''; collect(); });
    ui.$('#btn-compose-research').addEventListener('click', collect);
    ui.$('#compose-ledger').addEventListener('click', onLedgerClick);
    ui.$('#compose-passages').addEventListener('click', onPassageClick);
    ui.$('#btn-compose-register').addEventListener('click', registerToLedger);
    ui.$('#btn-compose-clear').addEventListener('click', clearAll);
    ui.$('#btn-compose-copy').addEventListener('click', copyAnswer);
    var rerender = function () { if (!ui.$('#compose-results').hidden) collect(); };
    MK.state.on('ledger', rerender);
    MK.state.on('docs', rerender);
  }

  MK.compose = {
    init: init,
    hasContent: hasContent,
    extractTerms: extractTerms,
    matchLedger: matchLedger,
    getInquiry: function () { return ui.$('#compose-inquiry').value; },
    getMaterials: function () { return passages.filter(function (p) { return p.checked; }); },
    getTerms: function () { return lastTerms.slice(); },
    appendAnswer: appendAnswer,
    setAnswer: function (t) { var ta = ui.$('#compose-answer'); ta.value = t; ta.dispatchEvent(new Event('input')); },
    basisLine: basisLine
  };
})(typeof window !== 'undefined' ? window : globalThis);
