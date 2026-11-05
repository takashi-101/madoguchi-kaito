// 層6：標準回答集の印刷（A4、分類ごと、根拠と最終更新日）
'use strict';
const path = require('path');
const fs = require('fs');
const { startServer, launch, assert, ROOT } = require('./helpers');

async function scenario(browser, url, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.evaluate(() => window.MK.ready);
  await page.evaluate(async () => {
    const b = window.MK.sample.build();
    await window.MK.state.setDocs(b.docs);
    await window.MK.state.setLedger(b.ledger);
  });
  await page.click('#tab-print');
  const prev = await page.textContent('#print-preview');
  assert(/窓口対応 標準回答集/.test(prev), label + ' 表題');
  ['窓口共通', '証明書', '住所の異動', '電話対応', '手数料', 'ごみ'].forEach((g) => assert(prev.includes(g), label + ' 分類 ' + g));
  assert(/根拠見本町 住民窓口事務取扱マニュアル/.test(prev) && /最終更新日2026年4月1日/.test(prev), label + ' 根拠と最終更新日');
  assert(/［回答がばらついています］/.test(prev) && /［根拠がありません］/.test(prev), label + ' 確認の印');
  assert((await page.$$('#print-preview .sheet-entry')).length === 15, label + ' 件数');
  await page.selectOption('#print-major', 'ごみ');
  assert((await page.$$('#print-preview .sheet-entry')).length === 3, label + ' 大分類で絞る');
  await page.uncheck('#print-flags');
  assert(!/［根拠がありません］/.test(await page.textContent('#print-preview')), label + ' 印を載せない');
  await page.selectOption('#print-major', '');
  // 印刷の形（A4）を PDF にして確かめる
  await page.evaluate(() => {
    document.querySelector('#print-area').innerHTML = window.MK.print.build();
    document.body.classList.add('printing');
  });
  await page.emulateMedia({ media: 'print' });
  const vis = await page.evaluate(() => ({
    area: getComputedStyle(document.querySelector('#print-area')).display,
    tabs: getComputedStyle(document.querySelector('.tabs')).display,
    main: getComputedStyle(document.querySelector('main')).display
  }));
  assert(vis.area === 'block' && vis.tabs === 'none' && vis.main === 'none', label + ' 印刷のときの表示: ' + JSON.stringify(vis));
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const s = pdf.toString('latin1');
  const boxes = s.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g) || [];
  assert(boxes.length >= 2, label + ' 2ページ以上になるはず: ' + boxes.length);
  // A4 は 595.28 × 841.89 ポイント
  assert(boxes.every((b) => { const m = /0 0 ([\d.]+) ([\d.]+)/.exec(b); return Math.abs(m[1] - 595.3) < 1.5 && Math.abs(m[2] - 841.9) < 1.5; }), label + ' A4 でない: ' + boxes[0]);
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
