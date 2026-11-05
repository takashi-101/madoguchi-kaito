// 層1：台帳の登録・修正・書き出し・読み込み・追加の取り込み・CSV・未保存の確認
'use strict';
const fs = require('fs');
const path = require('path');
const { startServer, launch, watchRequests, assert, ROOT } = require('./helpers');

async function scenario(browser, url, label) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ext = watchRequests(page, [url.replace(/index\.html.*$/, '')]);
  await page.goto(url);
  await page.evaluate(() => window.MK.ready);
  await page.click('#tab-ledger');
  await page.click('#btn-entry-new');
  await page.fill('#f-major', '住民記録・証明');
  await page.fill('#f-minor', '住民票の写し 手数料');
  await page.fill('#f-question', '住民票の写しは1通いくらですか。');
  await page.fill('#f-answer', '1通300円です。');
  await page.fill('#f-basis-doc', '見本マニュアル');
  await page.fill('#f-kakari', '住民課 住民記録係');
  // 未保存のまま画面を移ると確認が出る
  let dialogs = [];
  page.once('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.click('#tab-data');
  assert(dialogs.length === 1 && /保存されていません/.test(dialogs[0]), label + ' 未保存の確認が出ない');
  assert(await page.isVisible('#panel-ledger'), label + ' 取消したのに画面が移った');
  await page.click('#ledger-form button[type=submit]');
  await page.waitForSelector('.entry');
  assert((await page.textContent('#ledger-list')).includes('1通300円です。'), label + ' 登録が一覧に出ない');
  // 修正
  await page.click('.entry [data-act=edit]');
  await page.fill('#f-answer', '1通300円です。窓口でお支払いください。');
  await page.click('#ledger-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#ledger-list').textContent.includes('窓口でお支払いください'));
  // 再読み込みしても残る
  await page.reload();
  await page.evaluate(() => window.MK.ready);
  await page.click('#tab-ledger');
  assert((await page.textContent('#ledger-list')).includes('窓口でお支払いください'), label + ' 再読み込みで台帳が消えた');
  // JSON 書き出し
  await page.click('#tab-data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-json')]);
  const jsonPath = await dl.path();
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert(json.format === 'madoguchi-kaito' && json.ledger.length === 1, label + ' JSON の形');
  // CSV 書き出し（BOM と CRLF）
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
  const csv = fs.readFileSync(await dl2.path());
  assert(csv[0] === 0xEF && csv[1] === 0xBB && csv[2] === 0xBF, label + ' CSV に BOM がない');
  assert(csv.toString('utf8').includes('\r\n') && csv.toString('utf8').includes('大分類,小分類'), label + ' CSV の見出し・改行');
  // 追加の取り込み：同じファイルは重なりとして 0 件追加
  page.once('filechooser', (fc) => fc.setFiles(jsonPath));
  await page.click('#btn-import-merge');
  await page.waitForFunction(() => /追加 0 件、重なりのため取り込まなかったもの 1 件/.test(document.querySelector('#data-result').textContent));
  // 別の1件を含むファイルの追加
  const extra = JSON.parse(JSON.stringify(json));
  extra.ledger.push({ major: '税', minor: '納税証明書 手数料', answer: '1件300円です。' });
  const extraPath = path.join(path.dirname(jsonPath), 'extra.json');
  fs.writeFileSync(extraPath, JSON.stringify(extra));
  page.once('filechooser', (fc) => fc.setFiles(extraPath));
  await page.click('#btn-import-merge');
  await page.waitForFunction(() => /追加 1 件、重なりのため取り込まなかったもの 1 件/.test(document.querySelector('#data-result').textContent));
  // 置き換え（確認に同意）
  page.once('dialog', (d) => d.accept());
  page.once('filechooser', (fc) => fc.setFiles(jsonPath));
  await page.click('#btn-import-replace');
  await page.waitForFunction(() => /置き換え/.test(document.querySelector('#data-result').textContent));
  assert(await page.evaluate(() => window.MK.state.ledger.length) === 1, label + ' 置き換え後の件数');
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
