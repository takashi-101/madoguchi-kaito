// 層3：回答の作成、ばらつき・根拠の印、問い合わせの内容を保存しないこと
'use strict';
const path = require('path');
const { startServer, launch, watchRequests, assert, ROOT } = require('./helpers');

const MANUAL = '第1章　証明書\n\n1．住民票の写し\n\n住民票の写しの交付手数料は、1通300円とする。\n代理人が請求するときは、委任状が必要である。\n\f第2章　税\n\n1．納税証明書\n\n納税証明書の手数料は、1件300円とする。\n';

async function scenario(browser, url, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ext = watchRequests(page, [url.replace(/index\.html.*$/, '')]);
  await page.goto(url);
  await page.evaluate(() => window.MK.ready);
  await page.evaluate(async (manual) => {
    const MK = window.MK;
    await MK.state.setDocs([MK.docparse.fromText('テスト手引', manual)]);
    await MK.state.setLedger([
      { id: 'a', major: '証明', minor: '住民票の写し 手数料', question: '住民票の写しはいくらですか', answer: '1通300円です。', basisDoc: 'テスト手引', basisSection: '住民票の写し', basisPage: '1', kakari: '住民係' },
      { id: 'b', major: '証明', minor: '住民票の写し 手数料', question: '住民票の値段', answer: '1通200円です。', basisDoc: 'テスト手引', basisSection: '住民票の写し', kakari: '住民係' },
      { id: 'c', major: '証明', minor: '住民票の写し 代理人', question: '代理人が取るとき', answer: '委任状が必要です。', basisDoc: '', kakari: '住民係' },
      { id: 'd', major: '税', minor: '納税証明書 手数料', question: '納税証明書はいくら', answer: '1件300円です。', basisDoc: 'テスト手引', basisSection: '第2章', basisPage: '2', kakari: '税務係' },
      { id: 'e', major: '税', minor: '納税証明書 手数料', question: '納税証明書の手数料', answer: '1件 300円です', basisDoc: 'テスト手引', basisSection: '第9章', kakari: '税務係' },
      { id: 'f', major: '税', minor: '課税証明書', question: '課税証明書', answer: '300円です。', basisDoc: '未取り込みの手引', kakari: '税務係' }
    ]);
  }, MANUAL);
  const flags = await page.evaluate(() => Object.fromEntries(window.MK.state.ledger.map((e) => [e.id, window.MK.analysis.flagsFor(e).map((f) => f.label)])));
  assert(flags.a.includes('回答がばらついています') && flags.b.includes('回答がばらついています'), label + ' ばらつきの印: ' + JSON.stringify(flags));
  assert(!flags.d.includes('回答がばらついています'), label + ' 句読点・空白だけの違いはばらつきにしない: ' + JSON.stringify(flags.d));
  assert(flags.c.includes('根拠がありません'), label + ' 根拠の欄が空');
  assert(flags.e.includes('根拠が原文に見つかりません'), label + ' 原文にない章');
  assert(flags.f.includes('根拠の文書が未取り込み'), label + ' 未取り込みの文書');
  assert(!flags.a.some((l) => /根拠/.test(l)) && !flags.d.some((l) => /根拠/.test(l)), label + ' 根拠のあるものに印が付いた: ' + JSON.stringify(flags));
  // 台帳の画面にも印が出る
  await page.click('#tab-ledger');
  const ltext = await page.textContent('#ledger-list');
  assert(/回答がばらついています/.test(ltext) && /根拠がありません/.test(ltext), label + ' 台帳の画面の印');
  // 回答の作成
  await page.click('#tab-compose');
  const SECRET = '見本花子さんの件で、住民票の写しを代理人が取りたい。委任状は要りますか';
  await page.fill('#compose-inquiry', SECRET);
  await page.click('#compose-form button[type=submit]');
  await page.waitForSelector('#compose-ledger .entry');
  const terms = await page.inputValue('#compose-terms');
  assert(/住民票/.test(terms) && /代理人/.test(terms) && /委任状/.test(terms), label + ' 検索語: ' + terms);
  const ledgerText = await page.textContent('#compose-ledger');
  assert(/委任状が必要です/.test(ledgerText), label + ' 台帳の該当');
  assert(/同じ小分類に、次の回答も/.test(ledgerText), label + ' 作成画面のばらつき表示');
  const pass = await page.$$eval('#compose-passages .hit', (hs) => hs.map((h) => h.textContent));
  assert(pass.some((t) => /委任状が必要である/.test(t) && /テスト手引/.test(t) && /第1章/.test(t) && /ページ\s*1/.test(t)), label + ' 原文の該当箇所と章・ページ: ' + JSON.stringify(pass));
  await page.click('#compose-ledger .entry [data-act=use]');
  await page.click('#compose-passages [data-act=quote]');
  const ans = await page.inputValue('#compose-answer');
  assert(/根拠：テスト手引/.test(ans), label + ' 引用: ' + ans);
  // 保存していないこと（IndexedDB と Web Storage に問い合わせの文がない）
  const stored = await page.evaluate(async () => {
    const all = JSON.stringify([await window.MK.storage.get('ledger'), await window.MK.storage.get('docs')]);
    let ws = '';
    try { ws = JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)); } catch (e) {}
    return all + ws;
  });
  assert(!stored.includes('見本花子') && !stored.includes('取りたい'), label + ' 問い合わせの内容が保存されている');
  // 閉じる前の確認
  let beforeunload = false;
  page.on('dialog', async (d) => { if (d.type() === 'beforeunload') beforeunload = true; await d.dismiss(); });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 500));
  assert(beforeunload, label + ' 閉じる前の確認が出ない');
  // 開き直すと問い合わせ欄は空
  const p2 = await ctx.newPage();
  await p2.goto(url);
  await p2.evaluate(() => window.MK.ready);
  assert((await p2.inputValue('#compose-inquiry')) === '', label + ' 開き直すと問い合わせが残っている');
  // 台帳に登録の流れ
  await p2.click('#tab-compose');
  await p2.fill('#compose-inquiry', '納税証明書の手数料');
  await p2.click('#compose-form button[type=submit]');
  await p2.waitForSelector('#compose-ledger .entry');
  await p2.click('#compose-ledger .entry [data-act=use]');
  p2.once('dialog', (d) => d.accept());
  await p2.click('#btn-compose-register');
  await p2.waitForSelector('#ledger-form:not([hidden])');
  assert((await p2.inputValue('#f-answer')).length > 0 && (await p2.inputValue('#f-question')) === '', label + ' 登録欄への移し方');
  assert(!errors.length, label + ' 画面のエラー: ' + errors.join(' / '));
  assert(!ext.length, label + ' 外部への通信: ' + ext.join(' '));
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
