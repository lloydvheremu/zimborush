/**
 * Orchestrator measurement harness (uncommitted, like the other tools/harness
 * scripts). Loads the game in headless Chrome over CDP, then runs an arbitrary
 * JS expression inside the page with Runtime.evaluate and prints the result.
 *
 * Why the page and not Node: source imports are extensionless and only Vite can
 * resolve them (see Handover.md §6). The page exports the live world objects on
 * `window` for exactly this purpose.
 *
 * usage: node tools/harness/cdp-eval.mjs "<url>" <waitMs> <js-expression-file>
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const URL_TO_OPEN = process.argv[2];
const WAIT = Number(process.argv[3] ?? 8000);
const EXPR = readFileSync(process.argv[4], 'utf8');
const PORT = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--remote-debugging-port=${PORT}`,'--window-size=1280,720',`--user-data-dir=/tmp/cdp-e-${PORT}`,'about:blank'], { stdio: 'ignore' });
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
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args ?? []).map((a) => (a.value !== undefined ? String(a.value) : a.description ?? '?')).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_TO_OPEN });
await sleep(WAIT);
const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
if (res?.exceptionDetails) {
  console.log('EVAL ERROR:', JSON.stringify(res.exceptionDetails).slice(0, 2000));
} else {
  console.log(typeof res?.result?.value === 'string' ? res.result.value : JSON.stringify(res?.result?.value, null, 2));
}
if (process.env.SHOW_LOGS === '1') console.log('--- console ---\n' + logs.join('\n'));
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
