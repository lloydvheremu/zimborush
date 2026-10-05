// Render sample points back onto an image as markers with hex labels, so the
// point placement can be visually confirmed before the hexes are used.
// usage: node tools/harness/mark-points.mjs <image> <pointsJson> <out.png>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const file = process.argv[2];
const points = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const outFile = process.argv[4];
const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;

const PORT = 9300 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${PORT}`,'--window-size=1200,700',`--user-data-dir=/tmp/cdp-m-${PORT}`,'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tgt() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); const l = await r.json();
      const p = l.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
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
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth * scale; c.height = img.naturalHeight * scale;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, c.width, c.height);
  const PTS = ${JSON.stringify(points)};
  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  g.font = 'bold 13px monospace';
  for (const [name, [x, y, r]] of Object.entries(PTS)) {
    const rad = r || 4;
    const d = g.getImageData(x - rad, y - rad, rad * 2 + 1, rad * 2 + 1).data;
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    const hex = '#' + hx(R / n) + hx(G / n) + hx(B / n);
    const X = x * scale, Y = y * scale;
    g.strokeStyle = '#00FFFF'; g.lineWidth = 2;
    g.strokeRect(x - rad, y - rad, rad * 2, rad * 2);
    g.beginPath(); g.arc(X, Y, 4, 0, 6.284); g.stroke();
    const label = name + ' ' + hex;
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(X + 6, Y - 16, g.measureText(label).width + 8, 18);
    g.fillStyle = '#00FFFF';
    g.fillText(label, X + 10, Y - 3);
  }
  return c.toDataURL('image/png');
})()`;
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (res?.exceptionDetails) console.log('ERR', JSON.stringify(res.exceptionDetails).slice(0, 1500));
else writeFileSync(outFile, Buffer.from(res.result.value.split(',')[1], 'base64'));
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
