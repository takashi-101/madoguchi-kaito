// 層2：テキスト（シフトJIS）、HTML、PDF（日本語・埋め込みなしのCIDフォント）の取り込みと全文検索
'use strict';
const path = require('path');
const { startServer, launch, watchRequests, assert, ROOT } = require('./helpers');
const FX = path.join(__dirname, 'fixtures');

async function scenario(browser, url, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ext = watchRequests(page, [url.replace(/index\.html.*$/, '')]);
  await page.goto(url);
  await page.evaluate(() => window.MK.ready);
  await page.click('#tab-docs');
  page.once('filechooser', (fc) => fc.setFiles([path.join(FX, 'test-yoko-sjis.txt'), path.join(FX, 'test-guide.html'), path.join(FX, 'test-manual.pdf')]));
  await page.click('#btn-pick-docs');
  await page.waitForFunction(() => window.MK.state.docs.length === 3 && /test-manual/.test(document.querySelector('#import-status').textContent), null, { timeout: 30000 });
  const status = await page.textContent('#import-status');
  assert(!/取り込めませんでした/.test(status), label + ' 取り込み失敗: ' + status);
  const pdfDoc = await page.evaluate(() => window.MK.state.docs.find((d) => d.type === 'PDF'));
  assert(pdfDoc.pageCount === 2, label + ' PDF のページ数');
  // 半角・全角、カタカナ・ひらがな：「住民票」はPDFでは「ジュウミンヒョウ」。ひらがなで探す
  const doSearch = async (q, mode) => {
    await page.fill('#search-q', q);
    if (mode) await page.selectOption('#search-mode', mode);
    await page.click('#search-form button[type=submit]');
    return page.evaluate(() => ({ sum: document.querySelector('#search-summary').textContent, hits: Array.from(document.querySelectorAll('#search-results .hit')).map((h) => h.textContent) }));
  };
  let r = await doSearch('じゅうみんひょう');
  assert(r.hits.length === 1 && /test-manual/.test(r.hits[0]) && /第2章 証明書の交付/.test(r.hits[0]) && /ページ\s*2/.test(r.hits[0]), label + ' PDF の検索と章・ページ: ' + JSON.stringify(r));
  assert(/300円/.test(r.hits[0]), label + ' PDF の原文');
  // 送り仮名：「申し込み」で「申込み」（テキスト）と「申し込み」（PDF）の両方が出る
  r = await doSearch('申し込み');
  assert(r.hits.length === 2, label + ' 送り仮名の吸収: ' + JSON.stringify(r.hits));
  assert(r.hits.some((h) => /第[2２]条（申込）/.test(h)), label + ' 条の見出し');
  // 全角数字で半角の金額を探す
  r = await doSearch('５００円');
  assert(r.hits.length === 1 && /test-guide/.test(r.hits[0]), label + ' 全角・半角');
  // すべての語を含む
  r = await doSearch('粗大ごみ 予約制', 'all');
  assert(r.hits.length === 1, label + ' すべての語');
  r = await doSearch('予約制 窓口', 'any');
  assert(r.hits.length >= 3, label + ' いずれかの語: ' + r.hits.length);
  // 再読み込みしても文書が残る
  await page.reload();
  await page.evaluate(() => window.MK.ready);
  assert(await page.evaluate(() => window.MK.state.docs.length) === 3, label + ' 再読み込みで文書が消えた');
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
