// 層4：下書き候補（Ollama と外部APIは、応答の形をまねた仮の応答で確かめる）
'use strict';
const path = require('path');
const { startServer, launch, assert, ROOT } = require('./helpers');

const MANUAL = '第1章　証明書\n\n1．住民票の写し\n\n住民票の写しの交付手数料は、1通につき三百円とする。\n代理人が請求するときは、委任状が必要である。受付は住民課で行う。\n\n2．印鑑登録\n\n印鑑登録は本人が申請する。\n';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const JSONH = Object.assign({ 'Content-Type': 'application/json' }, CORS);

async function setup(page, url) {
  await page.goto(url);
  await page.evaluate(() => window.MK.ready);
  await page.evaluate(async (manual) => {
    const MK = window.MK;
    await MK.state.setDocs([MK.docparse.fromText('テスト手引', manual)]);
    await MK.state.setLedger([{ id: 'a', major: '証明', minor: '住民票の写し 代理人', question: '代理人', answer: '委任状が必要です。', basisDoc: 'テスト手引', basisSection: '住民票の写し' }]);
  }, MANUAL);
  await page.click('#tab-compose');
  await page.fill('#compose-inquiry', '住民票の写しを代理人が取るとき、委任状は必要ですか。手数料と印鑑登録も知りたい。');
  await page.click('#compose-form button[type=submit]');
  await page.waitForSelector('#compose-passages .hit');
}

async function scenario(browser, url, label) {
  const errors = [];
  // 1) Ollama につながらないとき
  let ctx = await browser.newContext();
  let page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('http://localhost:11434/**', (r) => r.abort('connectionrefused'));
  await setup(page, url);
  await page.click('#btn-llm-run');
  await page.waitForFunction(() => /つながりません/.test(document.querySelector('#llm-status').textContent));
  assert(await page.isHidden('#llm-output'), label + ' つながらないのに下書きが出た');
  assert((await page.$$('#compose-ledger .entry')).length === 1, label + ' つながらないときの台帳');
  await ctx.close();

  // 2) Ollama の仮の応答
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  let chatBody = null;
  await page.route('http://localhost:11434/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/api/tags')) return r.fulfill({ status: 200, headers: JSONH, body: JSON.stringify({ models: [{ name: 'test-model:1b' }] }) });
    if (req.url().endsWith('/api/chat')) {
      chatBody = JSON.parse(req.postData());
      const content = '<think>考え中</think>代理人が請求するときは委任状が必要です。手数料は1通300円です［資料1］。詳しくは総合窓口課（電話 0120-999-999）へ。令和9年4月1日から変わります。';
      return r.fulfill({ status: 200, headers: JSONH, body: JSON.stringify({ model: 'test-model:1b', message: { role: 'assistant', content: content }, done: true }) });
    }
    return r.fulfill({ status: 404, headers: CORS });
  });
  await setup(page, url);
  const boxes = await page.$$('#compose-passages input[type=checkbox]');
  assert(boxes.length >= 2, label + ' 材料の候補が少ない');
  // 「印鑑登録」の箇所を材料から外す
  const unchecked = await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll('#compose-passages .hit')).find((h) => /本人が申請する/.test(h.textContent));
    const cb = hit.querySelector('input[type=checkbox]');
    if (cb.checked) cb.click();
    return hit.querySelector('.hit-text').textContent;
  });
  await page.click('#btn-llm-run');
  await page.waitForSelector('#llm-output:not([hidden])');
  assert(chatBody && chatBody.model === 'test-model:1b' && chatBody.stream === false, label + ' Ollama への要求の形');
  const userMsg = chatBody.messages.find((m) => m.role === 'user').content;
  assert(userMsg.includes('委任状が必要である'), label + ' 材料が渡っていない');
  assert(!userMsg.includes(unchecked.trim()), label + ' 外した材料が渡っている');
  const draft = await page.inputValue('#llm-draft');
  assert(!/think|考え中/.test(draft), label + ' 考える過程が残っている');
  const terms = await page.$$eval('#llm-terms li', (ls) => ls.map((l) => l.textContent));
  assert(terms.some((t) => /0120-999-999/.test(t)), label + ' 電話番号の印: ' + terms);
  assert(terms.some((t) => /総合窓口課/.test(t)), label + ' 窓口名の印: ' + terms);
  assert(terms.some((t) => /令和9年4月1日/.test(t)), label + ' 日付の印: ' + terms);
  assert(!terms.some((t) => /300円/.test(t)), label + ' 原文にある金額（三百円）に印が付いた: ' + terms);
  assert((await page.$$('#llm-draft-view mark.term-missing')).length >= 3, label + ' 下書きの中の印');
  const mats = await page.textContent('#llm-materials');
  assert(/テスト手引/.test(mats) && /委任状が必要である/.test(mats), label + ' 下書きの横の原文');
  await page.fill('#llm-draft', '代理人が請求するときは委任状が必要です。手数料は1通300円です。');
  assert((await page.$$('#llm-terms li')).length === 0, label + ' 直したあとの確かめ直し');
  await page.click('#btn-llm-adopt');
  assert(/1通300円/.test(await page.inputValue('#compose-answer')), label + ' 回答欄に採用');
  await ctx.close();

  // 3) 外部のAPI（使う人が選んだときだけ。送る前に確認が出る）
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  let auth = null;
  let ollamaCalled = false;
  await page.route('http://localhost:11434/**', (r) => { ollamaCalled = true; r.abort(); });
  await page.route('https://api.example.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    auth = req.headers()['authorization'];
    return r.fulfill({ status: 200, headers: JSONH, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '委任状が必要です［資料1］。' } }] }) });
  });
  await setup(page, url);
  await page.click('#tab-data');
  await page.selectOption('#ai-provider', 'external');
  await page.fill('#ai-ext-url', 'https://api.example.test/v1');
  await page.fill('#ai-ext-model', 'test-ext');
  await page.fill('#ai-ext-key', 'sk-test');
  await page.click('#tab-compose');
  let confirmMsg = '';
  page.once('dialog', (d) => { confirmMsg = d.message(); d.accept(); });
  await page.click('#btn-llm-run');
  await page.waitForSelector('#llm-output:not([hidden])');
  assert(/外部のAPI（api\.example\.test）/.test(confirmMsg), label + ' 外部に送る前の確認: ' + confirmMsg);
  assert(auth === 'Bearer sk-test', label + ' 鍵');
  assert(!ollamaCalled, label + ' 外部を選んだのに Ollama に通信した');
  const saved = await page.evaluate(async () => JSON.stringify(await window.MK.storage.get('settings')));
  assert(!saved.includes('sk-test'), label + ' 鍵が保存されている');
  assert(!errors.length, label + ' 画面のエラー: ' + errors.join(' / '));
  await ctx.close();
}

module.exports = async function () {
  const browser = await launch();
  const { srv, base } = await startServer();
  try {
    await scenario(browser, base + 'index.html', 'サブフォルダ配信');
    await scenario(browser, 'file://' + path.join(ROOT, 'index.html'), 'ファイル直接');
  } finally {
    srv.close();
    await browser.close();
  }
};
