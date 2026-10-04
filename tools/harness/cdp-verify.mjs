import { spawn } from 'node:child_process';
const URL_TO_OPEN = process.argv[2];
const PORT = 9800 + Math.floor(Math.random()*90);
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--remote-debugging-port=${PORT}`,'--window-size=800,600',`--user-data-dir=/tmp/cdp-v-${PORT}`,'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function tgt(){ for(let i=0;i<60;i++){ try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); const l=await r.json(); const p=l.find(t=>t.type==='page'); if(p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; }catch{} await sleep(250);} throw new Error('no CDP'); }
const ws = new WebSocket(await tgt());
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pend=new Map(); const logs=[];
ws.onmessage = e => { const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);return;}
  if(m.method==='Runtime.consoleAPICalled') logs.push((m.params.args??[]).map(a=>a.value!==undefined?String(a.value):a.description??'?').join(' ')); };
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate',{url:URL_TO_OPEN});
await sleep(Number(process.argv[3]??7000));
console.log(logs.join('\n')||'(no console output)');
ws.close(); chrome.kill('SIGTERM'); process.exit(0);
