import { createRequire } from 'module';
import fs from 'fs';
import http from 'http';
import path from 'path';
import url from 'url';

// playwright only drives the page to read the sfx/event log; nothing else from launch-video/ is used
const require = createRequire('C:/Users/Lemmuel Alinea/Desktop/Collabify/launch-video/');
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.addInitScript(() => { window.__timelines = {}; });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
p.on('console', (m) => console.log('LOG', m.type(), m.text().slice(0, 300)));
await p.goto(`http://localhost:${port}/index.html`);
await p.waitForTimeout(4000);
console.log('state', await p.evaluate(() => [typeof window.TL, window.EV && window.EV.length, Object.keys(window.__timelines)]));
const ev = await p.evaluate(() => window.EV);
fs.writeFileSync(path.join(root, 'audio', 'events.json'), JSON.stringify(ev.sort((a, b) => a[0] - b[0])));
console.log(ev.length, 'events');
await b.close();
srv.close();
