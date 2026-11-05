// テスト用の共通部品：GitHub Pages と同じ形（/madoguchi-kaito/ の下に静的配信）のサーバーと、ブラウザの起動
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = '/madoguchi-kaito/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (!u.pathname.startsWith(PREFIX)) { res.writeHead(404); res.end('not found'); return; }
      let rel = decodeURIComponent(u.pathname.slice(PREFIX.length)) || 'index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port + PREFIX }));
  });
}

async function launch() {
  return chromium.launch();
}

// 外部への通信が起きていないかを記録する
function watchRequests(page, allowedPrefixes) {
  const external = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('file:')) return;
    if (allowedPrefixes.some((p) => url.startsWith(p))) return;
    external.push(url);
  });
  return external;
}

function assert(cond, msg) {
  if (!cond) throw new Error('確認失敗: ' + msg);
}

module.exports = { ROOT, PREFIX, startServer, launch, watchRequests, assert };
