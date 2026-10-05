// Find the dominant colours of specific *material classes* in Image A by
// scoring every pixel, rather than guessing rectangles. For the target art this
// matters: the grass is olive-green but small in area and easy to miss by eye,
// and the olive reads as "brown" in a naive mean.
// usage: node tools/harness/class-histogram.mjs <image>
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const file = process.argv[2];
const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;

const PORT = 9100 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${PORT}`,'--window-size=1200,700',`--user-data-dir=/tmp/cdp-c-${PORT}`,'about:blank'], { stdio: 'ignore' });
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
  const d = g.getImageData(0, 0, W, H).data;
  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  const px = [];
  for (let i = 0; i < d.length; i += 4) {
    const idx = i / 4;
    px.push({ r: d[i], g: d[i + 1], b: d[i + 2], x: idx % W, y: (idx / W) | 0 });
  }
  const mean = (arr) => {
    if (!arr.length) return null;
    let R = 0, G = 0, B = 0;
    for (const p of arr) { R += p.r; G += p.g; B += p.b; }
    const n = arr.length;
    return { hex: '#' + hx(R / n) + hx(G / n) + hx(B / n), n };
  };
  const quantile = (arr, score, q) => {
    const s = arr.slice().sort((a, b) => score(b) - score(a));
    return s.slice(0, Math.max(1, Math.round(s.length * q)));
  };
  const res = {};

  // --- grass: greenest pixels (green over the red/blue mean), mid-band only
  const mid = px.filter((p) => p.y > H * 0.25 && p.y < H * 0.85);
  const greenScore = (p) => p.g - (p.r + p.b) / 2;
  res.grassGreenest2pct = mean(quantile(mid, greenScore, 0.02));
  res.grassGreenest05pct = mean(quantile(mid, greenScore, 0.005));
  res.grassGreenest10pct = mean(quantile(mid, greenScore, 0.10));

  // --- lit ground: brightest mid-band pixels (sun-facing facets)
  const bright = (p) => p.r + p.g + p.b;
  res.groundBrightest2pct = mean(quantile(mid, bright, 0.02));

  // --- sky: per-band means over full width, sky region only
  const bandMean = (y0f, y1f) => {
    const sel = px.filter((p) => p.y >= H * y0f && p.y < H * y1f);
    const m = mean(sel);
    // also the modal-ish: brightest and darkest decile
    return { mean: m.hex, brightest: mean(quantile(sel, bright, 0.05)).hex, darkest: mean(quantile(sel, bright, 0.05).map ? sel.slice().sort((a,b)=>bright(a)-bright(b)).slice(0, Math.max(1,Math.round(sel.length*0.05))) : []).hex };
  };
  res.skyTop = bandMean(0.00, 0.05);
  res.skyUpper = bandMean(0.05, 0.15);
  res.skyMid = bandMean(0.15, 0.24);
  res.skyLower = bandMean(0.24, 0.29);

  // --- purple far ridges: pixels that are purple (B > G) in the ridge band
  const ridge = px.filter((p) => p.y > H * 0.18 && p.y < H * 0.42 && p.b > p.g);
  res.purpleRidge_all = mean(ridge);
  res.purpleRidge_darkest10 = mean(quantile(ridge, (p) => -(p.r + p.g + p.b), 0.10));
  res.purpleRidge_lightest10 = mean(quantile(ridge, bright, 0.10));

  // --- road: the visible road corridor, centre band, warm and light
  const roadBand = px.filter((p) => p.y > H * 0.55 && p.y < H * 0.80 && p.x > W * 0.42 && p.x < W * 0.58);
  res.roadMean = mean(roadBand);
  res.roadBrightest10 = mean(quantile(roadBand, bright, 0.10));
  res.roadDarkest10 = mean(quantile(roadBand, (p) => -bright(p), 0.10));

  return JSON.stringify(res, null, 2);
})()`;
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (res?.exceptionDetails) console.log('ERR', JSON.stringify(res.exceptionDetails).slice(0, 2000));
else console.log(res.result.value);
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
