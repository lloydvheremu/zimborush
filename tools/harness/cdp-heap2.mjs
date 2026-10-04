import { spawn } from 'node:child_process';
const URL_TO_OPEN = process.argv[2] ?? 'http://localhost:5173/';
const PORT = 9336;
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-precise-memory-info',`--remote-debugging-port=${PORT}`,'--window-size=1280,720','--user-data-dir=/tmp/cdp-profile-heap2','about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try { const res = await fetch(`http://127.0.0.1:${PORT}/json/list`); const list = await res.json();
      const page = list.find((t) => t.type === 'page'); if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('CDP never came up');
}
const ws = new WebSocket(await getTarget());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const myId = ++id; pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { returnByValue: true, expression: expr }))?.result?.value;
await send('Runtime.enable'); await send('HeapProfiler.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_TO_OPEN });
await sleep(8000); // long warm-up: all one-time lazy init settles
await evalJs("window.__f=0; const t=()=>{window.__f++;requestAnimationFrame(t)}; requestAnimationFrame(t); 'ok'");
const sample = async () => { await send('HeapProfiler.collectGarbage'); return await evalJs("({heap: performance.memory.usedJSHeapSize, frames: window.__f, t: performance.now()})"); };
const windows = [];
let prev = await sample();
for (let w = 1; w <= 4; w++) {
  await sleep(5000);
  const cur = await sample();
  const frames = cur.frames - prev.frames, secs = (cur.t - prev.t) / 1000, growth = cur.heap - prev.heap;
  windows.push({ window: w, frames, seconds: +secs.toFixed(2), fps: +(frames/secs).toFixed(1), heapMB: +(cur.heap/1048576).toFixed(2), growthBytes: growth, bytesPerFrame: frames ? +(growth/frames).toFixed(2) : null });
  prev = cur;
}
console.log(JSON.stringify(windows, null, 2));
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
