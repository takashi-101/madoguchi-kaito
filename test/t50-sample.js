// 層5：見本データ。ボタン1つで読み込め、ばらつき1件・根拠なし1件の印だけが出ること。
// sample フォルダのファイル（テキスト・HTML・PDF）を取り込んでも、同じ結果になること。
'use strict';
const path = require('path');
const fs = require('fs');
const { startServer, launch, watchRequests, assert, ROOT } = require('./helpers');

function flagSummary() {
  const MK = window.MK;
  const out = {};
  MK.state.ledger.forEach((e) => {
    const f = MK.analysis.flagsFor(e).map((x) => x.label);
    if (f.length) out[e.minor + '｜' + e.answer.slice(0, 8)] = f;
  });
  return out;
}

async function check(page, label) {
  const flags = await page.evaluate(flagSummary);
  const keys = Object.keys(flags);
  const vary = keys.filter((k) => flags[k].includes('回答がばらついています'));
  const nob = keys.filter((k) => flags[k].some((l) => /根拠/.test(l)));
  assert(vary.length === 2 && vary.every((k) => /^住民票の写し 手数料/.test(k)), label + ' ばらつきの印: ' + JSON.stringify(flags));
  assert(nob.length === 1 && /^粗大ごみ 家電/.test(nob[0]) && flags[nob[0]].includes('根拠がありません'), label + ' 根拠の印: ' + JSON.stringify(flags));
  assert(keys.length === 3, label + ' 想定外の印: ' + JSON.stringify(flags));
}

async function scenario(browser, url, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ext = watchRequests(page, [url.replace(/index\.html.*$/, '')]);
  await page.goto(url);
  await page.evaluate(() => window.MK.ready);
  await page.click('#tab-data');
  await page.click('#btn-load-sample');
  await page.waitForFunction(() => window.MK.state.ledger.length === 15 && window.MK.state.docs.length === 3);
  await check(page, label + '（ボタン）');
  // 実在の団体名・個人名を使わない（見本町は架空）
  const all = await page.evaluate(() => JSON.stringify([window.MK.state.ledger, window.MK.state.docs]));
  assert(!/[都道府県]知事|市長/.test(all), label + ' 見本に実在を思わせる語');
  // 回答の作成で試す
  await page.click('#tab-compose');
  await page.fill('#compose-inquiry', '住民票の写しはいくらですか');
  await page.click('#compose-form button[type=submit]');
  await page.waitForSelector('#compose-ledger .entry');
  const t = await page.textContent('#compose-ledger');
  assert(/回答がばらついています/.test(t) && /1通300円です/.test(t) && /1通200円です/.test(t), label + ' 作成画面でばらつきが見える');
  const p = await page.textContent('#compose-passages');
  assert(/1通につき300円/.test(p), label + ' 原文の該当箇所');

  // sample フォルダのファイルを取り込む
  await page.evaluate(async () => { await window.MK.state.setDocs([]); });
  await page.click('#tab-docs');
  const dir = path.join(ROOT, 'sample');
  // 日本語のファイル名は、中身とファイル名を渡す形で選ぶ（テスト用の操作部品の都合）
  const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.pdf': 'application/pdf' };
  page.once('filechooser', (fc) => fc.setFiles(fs.readdirSync(dir).map((f) => ({ name: f, mimeType: MIME[path.extname(f)], buffer: fs.readFileSync(path.join(dir, f)) }))));
  await page.click('#btn-pick-docs');
  await page.waitForFunction(() => window.MK.state.docs.length === 3 || /取り込めません/.test(document.querySelector('#import-status').textContent), null, { timeout: 30000 }).catch(() => {});
  assert(await page.evaluate(() => window.MK.state.docs.length) === 3, label + ' sample の取り込み: ' + await page.textContent('#import-status'));
  const types = await page.evaluate(() => window.MK.state.docs.map((d) => d.type + ':' + d.pageCount).sort());
  assert(JSON.stringify(types) === JSON.stringify(['HTML:null', 'PDF:2', 'テキスト:4']), label + ' 取り込んだ文書: ' + types);
  await check(page, label + '（sample のファイル）');
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
