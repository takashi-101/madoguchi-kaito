// sample フォルダの見本ファイルを、js/sample-data.js の本文から作り直す：
//   node tools/make-samples.js && python3 tools/make-sample-pdf.py
'use strict';
const fs = require('fs');
const path = require('path');
globalThis.window = globalThis;
require('../js/sample-data.js');
const t = globalThis.MK.sample.texts;
const out = path.join(__dirname, '..', 'sample');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, '見本町住民窓口事務取扱マニュアル.txt'), t.manual);
fs.writeFileSync(path.join(out, '見本町手数料条例.html'), t.joreiHtml);
fs.writeFileSync(path.join(__dirname, 'yoko-for-pdf.txt'), t.yoko);
console.log('sample を作りました');
