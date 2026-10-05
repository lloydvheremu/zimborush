// Band-wise colour quantisation of Image A. Instead of trusting single pixels,
// this buckets every pixel into 5-bit-per-channel bins per horizontal band and
// reports the dominant colours with their share. More defensible than an
// eyeballed point when the reference has soft gradients.
// usage: node tools/harness/band-histogram.mjs <image> <bandsJson>
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const file = process.argv[2];
const bands = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;

const PORT = 9200 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${PORT}`,'--window-size=1200,700',`--user-data-dir=/tmp/cdp-h-${PORT}`,'about:blank'], { stdio: 'ignore' });
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
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const W = c.width, H = c.height;
  const BANDS = ${JSON.stringify(bands)};
  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  const out = {};
  for (const [name, [x0f, y0f, x1f, y1f]] of Object.entries(BANDS)) {
    const x0 = Math.round(x0f * W), y0 = Math.round(y0f * H);
    const w = Math.max(1, Math.round(x1f * W) - x0), h = Math.max(1, Math.round(y1f * H) - y0);
    const d = g.getImageData(x0, y0, w, h).data;
    const bins = new Map();
    let total = 0;
    for (let i = 0; i < d.length; i += 4) {
      // 5 bits per channel => 32768 bins, fine enough to keep banding, coarse
      // enough that compression noise collapses into one bucket.
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      const b = bins.get(k);
      if (b) { b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; }
      else bins.set(k, [d[i], d[i + 1], d[i + 2], 1]);
      total++;
    }
    const top = [...bins.values()].sort((a, b) => b[3] - a[3]).slice(0, 5)
      .map((b) => ({ hex: '#' + hx(b[0] / b[3]) + hx(b[1] / b[3]) + hx(b[2] / b[3]), share: +(b[3] / total).toFixed(3) }));
    // mean of the whole band, for a single headline number
    let R = 0, G = 0, B = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    const n = d.length / 4;
    out[name] = { mean: '#' + hx(R / n) + hx(G / n) + hx(B / n), top };
  }
  return JSON.stringify(out, null, 1);
})()`;
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (res?.exceptionDetails) console.log('ERR', JSON.stringify(res.exceptionDetails).slice(0, 1500));
else console.log(res.result.value);
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
