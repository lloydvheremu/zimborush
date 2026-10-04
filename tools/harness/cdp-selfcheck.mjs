import { spawn } from 'node:child_process';
const PORT = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--remote-debugging-port=${PORT}`,'--window-size=1280,720',`--user-data-dir=/tmp/cdp-sc-${PORT}`,'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(`http://127.0.0.1:${PORT}/json/list`); const list = await res.json();
      const p = list.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('CDP never came up');
}
const ws = new WebSocket(await getTarget());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args??[]).map(a=>a.value!==undefined?String(a.value):a.description??'?').join(' '));
};
const send = (method, params={}) => new Promise((res)=>{ const i=++id; pending.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(7000);
// Stop the game loop's rAF churn so the synthetic probe has a stable clock.
const res = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression:
  `(async () => {
     const m = await import('/src/core/cadence.probe.ts');
     const rows = await m.runCadenceSelfCheck();
     return rows;
   })()` });
console.log('=== SELF-CHECK OUTPUT ===');
console.log(logs.filter(l => /PASS|FAIL|cadence self-check/.test(l)).join('\n') || '(no output)');
console.log('=== RESULT ARRAY ===');
console.log(JSON.stringify(res?.result?.value ?? res, null, 2));
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
