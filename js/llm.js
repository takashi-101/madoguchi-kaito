/* 層4：ローカルLLM（Ollama）による回答の下書き候補
 * ・材料は「回答の作成」で並べた原文のうち、職員が選んだ箇所だけ
 * ・下書きの横に材料の原文を並べ、原文にない語句（金額・日付・窓口名・電話番号など）に印を付ける
 * ・下書きは候補。職員が直して確定する */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var ui, esc;
  var settings = { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: '', extUrl: '', extModel: '' };
  var extKey = ''; // 外部APIの鍵は保存しない（画面を閉じると消える）
  var lastMaterials = [];
  var controller = null;
  var MAX_MATERIAL_CHARS = 8000;

  // ---- 原文にない語句の確認 ----
  var NUMK = '[0-9０-９,，．.〇一二三四五六七八九十百千万]';
  var PATTERNS = [
    { kind: '電話番号', re: /(?:0\d{1,4}[-－‐ー(（]\d{1,4}[-－‐ー)）]\d{3,4}|\d{2,4}[-－‐]\d{2,4}[-－‐]\d{3,4})/g },
    { kind: '金額', re: new RegExp(NUMK + '+[円]', 'g') },
    { kind: '日付', re: /(?:令和|平成|昭和)?[0-9０-９元〇一二三四五六七八九十]+年(?:[0-9０-９一二三四五六七八九十]+月)?(?:[0-9０-９一二三四五六七八九十]+日)?|[0-9０-９一二三四五六七八九十]+月[0-9０-９一二三四五六七八九十]+日/g },
    { kind: '時刻', re: /(?:午前|午後)?[0-9０-９]{1,2}(?:時|:|：)(?:[0-9０-９]{1,2}分?)?/g },
    { kind: '数量・期間', re: new RegExp(NUMK + '+(?:通|件|枚|部|か月|ヶ月|カ月|箇月|週間|日以内|日前|日間|日|年間|年|歳|%|％|時間|分|回|人|個|点|kg|キロ|リットル|L)', 'g') },
    { kind: '窓口・部署', re: /[一-龠々ァ-ヴー]{2,12}(?:課|係|室|センター|窓口|支所|出張所|事務所|庁舎|担当)/g },
    { kind: 'URL・メール', re: /(?:https?:\/\/[^\s）)」]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g }
  ];

  function extractFactTerms(text) {
    var s = String(text || '').normalize('NFKC');
    var found = [];
    PATTERNS.forEach(function (p) {
      var m;
      p.re.lastIndex = 0;
      while ((m = p.re.exec(s))) {
        var t = m[0].replace(/[,，.．]+$/, '');
        if (!t) continue;
        if (p.kind === '時刻' && !/時|:|：/.test(t)) continue;
        found.push({ kind: p.kind, term: t, start: m.index, end: m.index + t.length });
      }
    });
    // 他の語の範囲に含まれる語は外す（「5月3日」の中の「3日」など）
    found = found.filter(function (x) {
      return !found.some(function (y) {
        return y !== x && y.start <= x.start && y.end >= x.end && (y.end - y.start) > (x.end - x.start);
      });
    });
    var seen = {};
    return found.filter(function (x) {
      if (seen[x.term]) return false;
      seen[x.term] = 1;
      return true;
    }).map(function (x) { return { kind: x.kind, term: x.term }; });
  }

  /** 下書きの語句のうち、材料の原文にないものを返す */
  function unsupportedTerms(draft, materialsText) {
    var hay = MK.norm.normalizeForFacts(materialsText);
    return extractFactTerms(draft).filter(function (x) {
      var n = MK.norm.normalizeForFacts(x.term);
      if (!n || hay.indexOf(n) >= 0) return false;
      if (x.kind === '窓口・部署') {
        var core = MK.norm.normalizeForFacts(x.term.replace(/(?:の)?(?:窓口|担当)$/, ''));
        if (core && hay.indexOf(core) >= 0) return false;
      }
      return true;
    });
  }

  // ---- 材料と指示 ----
  function materialsText(mats) {
    return mats.map(function (p) { return p.doc.name + '\n' + (p.block.h || '') + '\n' + p.block.t; }).join('\n');
  }

  function buildMessages(inquiry, mats) {
    var sys = [
      'あなたは自治体の窓口・電話・庁内問い合わせに答える職員の、回答の下書きを作る補助者です。次の決まりを必ず守ってください。',
      '1. 回答は【資料】に書かれていることだけを根拠にする。一般的な知識や推測で補わない。',
      '2. 【資料】にない金額・日付・期限・時間・窓口名・電話番号・持ち物・手続を書かない。',
      '3. 【資料】で答えられない点は「資料に記載がないため、担当の係に確認します。」と書く。',
      '4. です・ます調で、窓口や電話でそのまま読み上げられる長さ（おおむね300字以内）にする。',
      '5. 根拠にした資料の番号を、文の終わりに［資料1］のように示す。',
      '6. 回答の本文だけを書く。前置きや説明は書かない。'
    ].join('\n');
    var mat = mats.map(function (p, i) {
      return '［資料' + (i + 1) + '］' + p.doc.name + (p.block.h ? '／' + p.block.h : '') + (p.block.p != null ? '／' + p.block.p + 'ページ' : '') + '\n' + p.block.t;
    }).join('\n\n');
    var user = '【問い合わせ】\n' + inquiry.trim() + '\n\n【資料】\n' + mat;
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  // ---- 接続 ----
  function trimSlash(u) { return String(u || '').trim().replace(/\/+$/, ''); }

  function fetchJson(url, opts, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
    if (opts && opts.signal) {
      opts.signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    var o = Object.assign({}, opts || {}, { signal: ctrl.signal });
    return fetch(url, o).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) {
        return r.text().then(function (t) { throw new Error('応答の状態 ' + r.status + (t ? '：' + t.slice(0, 200) : '')); });
      }
      return r.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function checkConnection() {
    if (settings.provider === 'none') return Promise.reject(new Error('AIを使わない設定になっています。'));
    if (settings.provider === 'ollama') {
      return fetchJson(trimSlash(settings.ollamaUrl) + '/api/tags', { method: 'GET' }, 5000).then(function (j) {
        var models = (j && j.models || []).map(function (m) { return m.name || m.model; }).filter(Boolean);
        if (!models.length) throw new Error('Ollama にモデルが入っていません。「ollama pull モデル名」で入れてください。');
        return { models: models };
      }, function (err) {
        throw new Error('Ollama（' + settings.ollamaUrl + '）につながりません。Ollama が起動しているか、OLLAMA_ORIGINS の設定を確かめてください（README 参照）。' + (err && err.name === 'AbortError' ? '' : ''));
      });
    }
    if (!settings.extUrl || !settings.extModel) return Promise.reject(new Error('外部のAPIの接続先とモデル名を入れてください。'));
    if (!extKey) return Promise.reject(new Error('外部のAPIの鍵を入れてください（鍵は保存しません）。'));
    return Promise.resolve({ models: [settings.extModel] });
  }

  function generate(messages, signal) {
    if (settings.provider === 'ollama') {
      var model = settings.ollamaModel;
      return fetchJson(trimSlash(settings.ollamaUrl) + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model, messages: messages, stream: false, options: { temperature: 0.1 } }),
        signal: signal
      }, 600000).then(function (j) {
        var c = j && j.message && j.message.content;
        if (typeof c !== 'string') throw new Error('Ollama の応答の形が想定と違います。');
        return c;
      });
    }
    return fetchJson(trimSlash(settings.extUrl) + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + extKey },
      body: JSON.stringify({ model: settings.extModel, messages: messages, temperature: 0.1 }),
      signal: signal
    }, 180000).then(function (j) {
      var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (typeof c !== 'string') throw new Error('外部のAPIの応答の形が想定と違います。');
      return c;
    });
  }

  function cleanDraft(s) {
    // 考える過程を出すモデルの <think> 部分を除く
    return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  // ---- 画面 ----
  function setStatus(msg, kind) {
    var el = ui.$('#llm-status');
    el.textContent = msg;
    el.className = 'result ' + (kind || '');
  }

  function updateMaterialInfo() {
    var el = ui.$('#llm-material-info');
    if (!el || !MK.compose) return;
    var mats = MK.compose.getMaterials();
    var chars = mats.reduce(function (n, p) { return n + p.block.t.length; }, 0);
    el.textContent = '材料にする原文：' + mats.length + ' 箇所（約' + chars.toLocaleString() + '字）。「原文の該当箇所」のチェックで選べます。' +
      (chars > MAX_MATERIAL_CHARS ? '　材料が多いため、時間がかかるか、モデルが読み切れないことがあります。' : '');
  }

  function renderCheck() {
    var draft = ui.$('#llm-draft').value;
    var view = ui.$('#llm-draft-view');
    var list = ui.$('#llm-terms');
    if (!draft.trim()) { view.innerHTML = ''; list.innerHTML = ''; ui.$('#llm-terms-head').textContent = ''; return; }
    var miss = unsupportedTerms(draft, materialsText(lastMaterials));
    // 印を付けた表示
    var html = esc(draft.normalize('NFKC'));
    var terms = miss.map(function (m) { return m.term; }).sort(function (a, b) { return b.length - a.length; });
    if (terms.length) {
      var re = new RegExp(terms.map(function (t) { return esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
      html = html.replace(re, function (m) { return '<mark class="term-missing" title="材料の原文にない語句">' + m + '</mark>'; });
    }
    view.innerHTML = html;
    ui.$('#llm-terms-head').textContent = miss.length
      ? '材料の原文にない語句 ' + miss.length + ' 件（原文で確かめ、根拠がなければ削ってください）'
      : '金額・日付・窓口名・電話番号などで、材料の原文にない語句は見つかりませんでした（文の意味までは確かめていません）。';
    ui.$('#llm-terms-head').className = miss.length ? 'flag flag-nobasis' : 'flag flag-ok';
    list.innerHTML = miss.map(function (m) { return '<li>' + esc(m.kind) + '：' + esc(m.term) + '</li>'; }).join('');
  }

  function renderMaterials() {
    ui.$('#llm-materials').innerHTML = lastMaterials.map(function (p, i) {
      return '<div class="hit material"><div class="hit-src"><span><b>［資料' + (i + 1) + '］</b></span><span>文書 <b>' + esc(p.doc.name) + '</b></span>' +
        '<span>章・見出し <b>' + esc(p.block.h || '（見出しなし）') + '</b></span><span>ページ <b>' + (p.block.p != null ? esc(p.block.p) : '—') + '</b></span></div>' +
        '<p class="hit-text">' + esc(p.block.t) + '</p></div>';
    }).join('');
  }

  function run() {
    var inquiry = MK.compose.getInquiry();
    var mats = MK.compose.getMaterials();
    if (!inquiry.trim()) { setStatus('問い合わせの内容を入れてください。', 'error'); return; }
    if (!mats.length) { setStatus('材料にする原文がありません。「台帳と原文を探す」のあと、「原文の該当箇所」で材料を選んでください。', 'error'); return; }
    if (settings.provider === 'external') {
      var host = '';
      try { host = new URL(settings.extUrl).host; } catch (e) { host = settings.extUrl; }
      if (!root.confirm('問い合わせの内容と材料の原文を、外部のAPI（' + host + '）に送ります。\n個人を特定できる情報が含まれていないことを確かめましたか。')) return;
    }
    var btn = ui.$('#btn-llm-run');
    btn.disabled = true;
    ui.$('#btn-llm-cancel').hidden = false;
    setStatus('AIへの接続を確かめています…');
    checkConnection().then(function (info) {
      if (settings.provider === 'ollama') {
        if (!settings.ollamaModel || info.models.indexOf(settings.ollamaModel) < 0) {
          if (settings.ollamaModel) throw new Error('モデル「' + settings.ollamaModel + '」が Ollama に入っていません。入っているモデル：' + info.models.join('、'));
          settings.ollamaModel = info.models[0];
          fillModels(info.models);
        }
      }
      setStatus('下書き候補を作っています（' + (settings.provider === 'ollama' ? 'Ollama：' + settings.ollamaModel : '外部のAPI：' + settings.extModel) + '）。事務用PCでは数分かかることがあります…');
      controller = new AbortController();
      lastMaterials = mats.slice();
      return generate(buildMessages(inquiry, mats), controller.signal);
    }).then(function (text) {
      ui.$('#llm-output').hidden = false;
      ui.$('#llm-draft').value = cleanDraft(text);
      renderMaterials();
      renderCheck();
      setStatus('下書き候補ができました。これは候補です。原文と照らして直し、「回答欄に採用」してから確定してください。', 'ok');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') setStatus('中止しました（または時間がかかりすぎたため打ち切りました）。', 'error');
      else setStatus(err.message || String(err), 'error');
    }).then(function () {
      btn.disabled = false;
      ui.$('#btn-llm-cancel').hidden = true;
      controller = null;
    });
  }

  // ---- 設定 ----
  function saveSettings() {
    return MK.storage.set('settings', Object.assign({}, settings));
  }
  function readSettingsForm() {
    settings.provider = ui.$('#ai-provider').value;
    settings.ollamaUrl = ui.$('#ai-ollama-url').value.trim() || 'http://localhost:11434';
    settings.ollamaModel = ui.$('#ai-ollama-model').value.trim();
    settings.extUrl = ui.$('#ai-ext-url').value.trim();
    settings.extModel = ui.$('#ai-ext-model').value.trim();
    extKey = ui.$('#ai-ext-key').value.trim();
  }
  function writeSettingsForm() {
    ui.$('#ai-provider').value = settings.provider;
    ui.$('#ai-ollama-url').value = settings.ollamaUrl;
    ui.$('#ai-ollama-model').value = settings.ollamaModel;
    ui.$('#ai-ext-url').value = settings.extUrl;
    ui.$('#ai-ext-model').value = settings.extModel;
    showProviderFields();
  }
  function showProviderFields() {
    var p = ui.$('#ai-provider').value;
    ui.$('#ai-ollama-fields').hidden = p !== 'ollama';
    ui.$('#ai-ext-fields').hidden = p !== 'external';
    var card = ui.$('#llm-card');
    if (card) card.hidden = p === 'none';
  }
  function fillModels(models) {
    var dl = ui.$('#dl-ollama-models');
    dl.innerHTML = models.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('');
    if (!ui.$('#ai-ollama-model').value && settings.ollamaModel) ui.$('#ai-ollama-model').value = settings.ollamaModel;
  }

  function init() {
    ui = MK.ui; esc = ui.esc;
    MK.storage.get('settings').then(function (s) {
      if (s && typeof s === 'object') Object.assign(settings, s);
      writeSettingsForm();
    });
    ui.$('#ai-settings').addEventListener('input', function () { readSettingsForm(); showProviderFields(); saveSettings(); });
    ui.$('#ai-settings').addEventListener('change', function () { readSettingsForm(); showProviderFields(); saveSettings(); });
    ui.$('#btn-ai-check').addEventListener('click', function () {
      readSettingsForm();
      var out = ui.$('#ai-check-result');
      out.textContent = '確かめています…';
      checkConnection().then(function (info) {
        if (settings.provider === 'ollama') {
          fillModels(info.models);
          if (!settings.ollamaModel) { settings.ollamaModel = info.models[0]; ui.$('#ai-ollama-model').value = info.models[0]; saveSettings(); }
          out.textContent = 'つながりました。入っているモデル：' + info.models.join('、');
        } else {
          out.textContent = '設定は入っています（外部のAPIは、下書きを作るときに初めて通信します）。';
        }
      }).catch(function (err) { out.textContent = err.message; });
    });
    ui.$('#btn-llm-run').addEventListener('click', run);
    ui.$('#btn-llm-cancel').addEventListener('click', function () { if (controller) controller.abort(); });
    ui.$('#llm-draft').addEventListener('input', renderCheck);
    ui.$('#btn-llm-adopt').addEventListener('click', function () {
      var t = ui.$('#llm-draft').value.trim();
      if (!t) return;
      var cur = ui.$('#compose-answer').value.trim();
      if (cur && !root.confirm('回答欄に入っている文を、下書きで置き換えます。よろしいですか。')) return;
      MK.compose.setAnswer(t);
      ui.notice('下書きを回答欄に入れました。原文と照らして直し、確定してください。');
      ui.$('#compose-answer').focus();
    });
    ui.$('#btn-llm-discard').addEventListener('click', function () {
      ui.$('#llm-draft').value = '';
      ui.$('#llm-output').hidden = true;
      lastMaterials = [];
      renderCheck();
    });
    MK.state.on('compose-collected', updateMaterialInfo);
    MK.state.on('compose-cleared', function () {
      ui.$('#llm-draft').value = '';
      ui.$('#llm-output').hidden = true;
      lastMaterials = [];
      setStatus('');
      updateMaterialInfo();
    });
    updateMaterialInfo();
  }

  MK.llm = {
    init: init,
    extractFactTerms: extractFactTerms,
    unsupportedTerms: unsupportedTerms,
    buildMessages: buildMessages,
    settings: function () { return Object.assign({}, settings); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
