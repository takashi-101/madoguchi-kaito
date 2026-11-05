// 表記の揺れの吸収（全角・半角、ひらがな・カタカナ、送り仮名の一部）
'use strict';
const { assert } = require('./helpers');
module.exports = async function () {
  require('../js/normalize.js');
  const n = globalThis.MK.norm;
  const same = (a, b) => assert(n.normalize(a) === n.normalize(b), a + ' と ' + b + ' が同じにならない: ' + n.normalize(a) + ' / ' + n.normalize(b));
  same('ｼﾞｭｳﾐﾝﾋｮｳ', 'じゅうみんひょう');
  same('ジュウミンヒョウ', 'じゅうみんひょう');
  same('ＡＢＣ１２３', 'abc123');
  same('申し込み', '申込み');
  same('取り扱い', '取扱い');
  same('取扱', '取扱い');
  same('引っ越し', '引越');
  same('受け付け', '受付');
  same('問い合わせ', '問合せ');
  same('住民票 の 写し', '住民票の写し');
  // 検索語の末尾の送り仮名
  const q = n.normalizeQueryTerm('申し込み');
  assert(n.normalize('申込は窓口で').indexOf(q) >= 0, '申し込み で 申込は が当たらない');
  // 位置の対応
  const r = n.normalizeWithMap('窓口で申し込み してください');
  const i = r.norm.indexOf(n.normalizeQueryTerm('申込'));
  assert(r.map[i] === 3, '位置の対応がずれている');
  // 数字の照合用
  assert(n.normalizeForFacts('三百円') === n.normalizeForFacts('300円'), '漢数字');
  assert(n.normalizeForFacts('1,000円') === n.normalizeForFacts('１０００円'), '桁区切り');
};
