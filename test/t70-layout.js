// 画面の崩れの確認：横幅375pxと1280px、ライトモードとダークモードで、横にはみ出さないこと、文字と背景の色が同じにならないこと
// SHOTS=保存先 を付けて実行すると、画面の写しを保存する
'use strict';
const path = require('path');
const { startServer, launch, assert } = require('./helpers');

module.exports = async function () {
  const browser = await launch();
  const { srv, base } = await startServer();
  try {
    for (const width of [375, 1280]) {
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
        const page = await ctx.newPage();
        await page.goto(base + 'index.html');
        await page.evaluate(() => window.MK.ready);
        await page.evaluate(async () => { const b = window.MK.sample.build(); await window.MK.state.setDocs(b.docs); await window.MK.state.setLedger(b.ledger); });
        const tabs = await page.$$eval('.tab', (ts) => ts.map((t) => t.getAttribute('data-tab')));
        for (const t of tabs) {
          await page.click('#tab-' + t);
          if (t === 'compose') {
            await page.fill('#compose-inquiry', '住民票の写しを代理人が取りたい。手数料はいくら');
            await page.click('#compose-form button[type=submit]');
            await page.waitForSelector('#compose-ledger .entry');
          }
          if (t === 'docs') {
            await page.fill('#search-q', '手数料');
            await page.click('#search-form button[type=submit]');
          }
          if (t === 'ledger') await page.click('#btn-entry-new');
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert(over <= 0, width + 'px ' + scheme + ' 「' + t + '」が横にはみ出す: ' + over + 'px');
          const c = await page.evaluate(() => { const s = getComputedStyle(document.body); return [s.color, s.backgroundColor]; });
          assert(c[0] !== c[1], scheme + ' 文字と背景が同じ色');
          if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, width + '-' + scheme + '-' + t + '.png'), fullPage: true });
          if (t === 'ledger') { page.once('dialog', (d) => d.accept()); await page.click('#btn-entry-cancel'); }
        }
        if (scheme === 'dark') {
          const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          assert(bg === 'rgb(18, 22, 28)', 'ダークモードの背景: ' + bg);
        }
        await ctx.close();
      }
    }
  } finally {
    srv.close();
    await browser.close();
  }
};
