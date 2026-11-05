// test/ の中のテストをすべて実行する： node test/run-all.js
'use strict';
const path = require('path');
const fs = require('fs');
(async () => {
  const files = fs.readdirSync(__dirname).filter((f) => /^t\d+.*\.js$/.test(f)).sort();
  let failed = 0;
  for (const f of files) {
    const t0 = Date.now();
    try {
      await require(path.join(__dirname, f))();
      console.log('合格  ' + f + '  (' + (Date.now() - t0) + 'ms)');
    } catch (e) {
      failed++;
      console.log('不合格 ' + f + '\n  ' + (e && e.stack || e));
    }
  }
  console.log(failed ? '不合格 ' + failed + ' 件' : 'すべて合格（' + files.length + ' 件）');
  process.exit(failed ? 1 : 0);
})();
