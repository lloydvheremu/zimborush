// Sample Image A (the art target) by eyedropper through a real canvas, so the
// palette work uses measured hexes rather than guessed ones (P3 requirement).
// usage: node tools/harness/sample-image.mjs <png|jpeg> <outPngDir>
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const file = process.argv[2];
const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;

const PORT = 9600 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${PORT}`,'--window-size=1200,700',`--user-data-dir=/tmp/cdp-i-${PORT}`,'about:blank'], { stdio: 'ignore' });
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
  const hex = (x, y) => {
    const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const region = (x0, y0, x1, y1) => {
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return '#' + [r / n, gg / n, b / n].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const W = img.naturalWidth, H = img.naturalHeight;
  const rel = (fx, fy) => region(Math.round(fx * W), Math.round(fy * H), Math.round(fx * W) + 12, Math.round(fy * H) + 12);
  return JSON.stringify({
    size: [W, H],
    skyTop: region(0, 0, W, 20),
    skyTopRel: rel(0.5, 0.02),
    skyMid: region(Math.round(W * 0.05), Math.round(H * 0.10), Math.round(W * 0.25), Math.round(H * 0.16)),
    skyHorizonLeft: region(Math.round(W * 0.02), Math.round(H * 0.28), Math.round(W * 0.12), Math.round(H * 0.33)),
    sunGlow: region(Math.round(W * 0.44), Math.round(H * 0.24), Math.round(W * 0.52), Math.round(H * 0.30)),
    farHillsLeft: region(Math.round(W * 0.02), Math.round(H * 0.22), Math.round(W * 0.16), Math.round(H * 0.26)),
    farHillsRight: region(Math.round(W * 0.84), Math.round(H * 0.24), Math.round(W * 0.98), Math.round(H * 0.28)),
    midHillsLeft: region(Math.round(W * 0.06), Math.round(H * 0.30), Math.round(W * 0.20), Math.round(H * 0.36)),
    grassLitLeft: region(Math.round(W * 0.02), Math.round(H * 0.40), Math.round(W * 0.10), Math.round(H * 0.46)),
    grassLitRight: region(Math.round(W * 0.90), Math.round(H * 0.36), Math.round(W * 0.99), Math.round(H * 0.42)),
    grassShade: region(Math.round(W * 0.24), Math.round(H * 0.42), Math.round(W * 0.30), Math.round(H * 0.46)),
    roadNear: region(Math.round(W * 0.44), Math.round(H * 0.86), Math.round(W * 0.56), Math.round(H * 0.92)),
    roadMid: region(Math.round(W * 0.47), Math.round(H * 0.60), Math.round(W * 0.55), Math.round(H * 0.64)),
    roadFar: region(Math.round(W * 0.48), Math.round(H * 0.52), Math.round(W * 0.53), Math.round(H * 0.55)),
    rockLit: region(Math.round(W * 0.88), Math.round(H * 0.54), Math.round(W * 0.94), Math.round(H * 0.58)),
    rockShade: region(Math.round(W * 0.09), Math.round(H * 0.60), Math.round(W * 0.13), Math.round(H * 0.64)),
    treeLit: region(Math.round(W * 0.20), Math.round(H * 0.36), Math.round(W * 0.23), Math.round(H * 0.42)),
    treeDark: region(Math.round(W * 0.055), Math.round(H * 0.34), Math.round(W * 0.075), Math.round(H * 0.40)),
    accentRed: region(Math.round(W * 0.44), Math.round(H * 0.72), Math.round(W * 0.50), Math.round(H * 0.76)),
    accentRed2: region(Math.round(W * 0.40), Math.round(H * 0.62), Math.round(W * 0.46), Math.round(H * 0.66)),
    barsPale: region(Math.round(W * 0.40), Math.round(H * 0.66), Math.round(W * 0.44), Math.round(H * 0.70)),
    gripBlack: region(Math.round(W * 0.13), Math.round(H * 0.70), Math.round(W * 0.18), Math.round(H * 0.74)),
  });
})()`;
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (res?.exceptionDetails) console.log('ERR', JSON.stringify(res.exceptionDetails).slice(0, 1500));
else console.log(JSON.stringify(JSON.parse(res.result.value), null, 2));
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
