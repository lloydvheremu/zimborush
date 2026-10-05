// Draw a labelled coordinate grid over an image so sample points can be chosen
// from what is actually on screen rather than guessed (P3 eyedropper step).
// usage: node tools/harness/grid-overlay.mjs <in> <out.png>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const file = process.argv[2];
const outFile = process.argv[3];
const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;

const PORT = 9500 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${PORT}`,'--window-size=1200,700',`--user-data-dir=/tmp/cdp-g-${PORT}`,'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tgt() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const l = await r.json();
      const p = l.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP');
}
const ws = new WebSocket(await tgt());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.navigate', { url: 'about:blank' });
await sleep(400);

const expr = `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const W = c.width, H = c.height;
  g.font = '11px monospace';
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += Math.round(W / 16)) {
    g.strokeStyle = 'rgba(0,255,255,0.75)';
    g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke();
    g.fillStyle = 'cyan'; g.fillText(String(x), x + 2, 12);
  }
  for (let y = 0; y <= H; y += Math.round(H / 14)) {
    g.strokeStyle = 'rgba(0,255,255,0.75)';
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
    g.fillStyle = 'cyan'; g.fillText(String(y), 2, y - 2);
  }
  return c.toDataURL('image/png');
})()`;
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (res?.exceptionDetails) console.log('ERR', JSON.stringify(res.exceptionDetails).slice(0, 1500));
else writeFileSync(outFile, Buffer.from(res.result.value.split(',')[1], 'base64'));
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
