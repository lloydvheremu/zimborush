/**
 * Screenshot harness. Drives headless Chrome over CDP, forces a fixed viewport
 * (default 1024x559 — the same aspect and size as the art reference image A, so
 * region sampling is comparable between the two), navigates, waits, captures a
 * PNG, and echoes the page's console log.
 *
 * usage: node tools/harness/cdp-shot.mjs "<url>" <out.png> [waitMs] [w] [h]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const URL_TO_OPEN = process.argv[2];
const OUT = process.argv[3];
const WAIT = Number(process.argv[4] ?? 9000);
const WIDTH = Number(process.argv[5] ?? 1024);
const HEIGHT = Number(process.argv[6] ?? 559);
const PORT = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--remote-debugging-port=${PORT}`,'--window-size=1200,800',`--user-data-dir=/tmp/cdp-s-${PORT}`,'about:blank'], { stdio:'ignore' });
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
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pend=new Map(); const logs=[];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args ?? []).map((a) => (a.value !== undefined ? String(a.value) : a.description ?? '?')).join(' '));
};
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable');
await send('Page.enable');
// Force the viewport to the reference image's exact size before navigating, so
// the canvas and the projection agree with the art target.
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: URL_TO_OPEN });
await sleep(WAIT);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log(logs.filter((l) => !/vite/.test(l)).join('\n'));
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
