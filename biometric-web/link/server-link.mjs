// Server Link: connects the Biometric Attendance app of THIS computer (the one that is on the machines' network) to a Payroll Workspace on a server.
//
// The server cannot reach the machines (they are on the office network), so this program calls the server over HTTPS (outgoing calls only: nothing has to be
// opened in the office router) and waits for work. When the server's Biometric Machine Setup / Biometric Fetch needs something, this program does it against the
// local Biometric Attendance app (http://127.0.0.1:5180) and sends the answer back.
//
//   node --no-warnings server-link.mjs                      start (the first time it asks for the server address and the key)
//   node --no-warnings server-link.mjs --server https://hrm.example.com --key <key>     save these and start
//   node --no-warnings server-link.mjs --status             show the saved settings (the key is not shown)
//   node --no-warnings server-link.mjs --test               ask the server once whether it is reachable and accepts the key (nothing is saved)
//   node --no-warnings server-link.mjs --install-startup    start it by itself when this Windows user signs in (--remove-startup undoes it)
//   --app http://127.0.0.1:5180  the local Biometric Attendance app (default)      --data <folder>  where server-link.json is kept      --quiet  no output
//
// Safety: only four requests are ever carried out (allowedRequest below): the machine list, the punches of a date range, the download of one machine and the automatic
// download interval - whatever the server asks, nothing else on this computer or network is touched. A redirect is never followed (neither of the server nor of the local
// app), what the server sends is checked and size-limited, and it is never written to the log as it is. The key is the shared secret of BIOMETRIC_LINK_KEY on the server.
// No packages: Node.js 22.13 or newer (the Node of Payroll Workspace is fine).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import {execFile} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const VERSION='1.2';
const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const dayNumber=s=>{const m=DATE.exec(s);if(!m)return NaN;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?d.getTime()/864e5:NaN;};
export const MAX_SPAN_DAYS=70;
// What the server may ask the local app (the same list the server keeps: deploy/signin-layer/link.mjs allowedRequest).
export function allowedRequest(method,path,body=null){
 if(typeof method!=='string'||typeof path!=='string')return false;
 const empty=!body||!body.length;
 if(method==='GET'&&path==='/api/state')return empty;
 if(method==='GET'){const m=/^\/api\/export\/logs\?from=([0-9-]{10})&to=([0-9-]{10})$/.exec(path);if(!m||!empty)return false;const a=dayNumber(m[1]),b=dayNumber(m[2]);return b>=a&&b-a<=MAX_SPAN_DAYS;}   // NaN (not a day) fails both comparisons
 if(method==='POST'&&/^\/api\/devices\/[1-9]\d{0,5}\/download$/.test(path))return empty;
 if(method==='PUT'&&path==='/api/settings'){try{const j=JSON.parse(Buffer.from(body||'').toString('utf8'));return !!j&&typeof j==='object'&&!Array.isArray(j)&&Object.keys(j).length===1&&[0,15,30,60,120].includes(j.autoMinutes);}catch{return false;}}
 return false;
}

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultData=()=>process.env.BIOMETRIC_DATA||(process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'BiometricAttendance'):path.join(os.homedir(),'.biometric-attendance'));
const stamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;};
const sleep=(ms,signal)=>new Promise(resolve=>{const done=()=>{clearTimeout(t);signal?.removeEventListener('abort',done);resolve();};const t=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});});
const clean=s=>String(s).replace(/[^\x20-\x7e]/g,'?').slice(0,120);                         // what a server sends is never written to the log as it is (no forged lines)
const reason=e=>(e&&e.cause&&(e.cause.code||e.cause.message))||(e&&e.message)||e;
const drain=r=>{try{return r.body?r.body.cancel().catch(()=>{}):undefined;}catch{return undefined;}};

// the server address: https (a key travels in every call), or http to this very computer (tests); no path
export function cleanServer(value){
 let u;try{u=new URL(String(value||'').trim());}catch{return null;}
 if(!/^https?:$/.test(u.protocol)||u.pathname.replace(/\/+$/,'')!==''||u.search||u.hash||u.username||u.password)return null;
 if(u.protocol==='http:'&&!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))return null;
 return u.origin;
}
// the local Biometric Attendance app: http(s) address without path
export function cleanApp(value){
 let u;try{u=new URL(String(value||'').trim());}catch{return null;}
 if(!/^https?:$/.test(u.protocol)||u.pathname.replace(/\/+$/,'')!==''||u.search||u.hash||u.username||u.password)return null;
 return u.origin;
}
export const cleanKey=v=>/^[A-Za-z0-9_-]{32,128}$/.test(String(v||'').trim())?String(v).trim():null;
// the job of the server is tiny; a server that sends more is not listened to
async function readCapped(r,limit){
 if(!r.body)return '';
 const chunks=[];let size=0;
 for await(const c of r.body){size+=c.length;if(size>limit)throw new Error('The server sent too much.');chunks.push(c);}
 return Buffer.concat(chunks).toString('utf8');
}

const agentHeader=()=>`Server Link ${VERSION} on ${os.hostname()}`.replace(/[^A-Za-z0-9 ._/()-]/g,'').slice(0,60);
const refusedKey=key=>`The server refused the key (the one given has ${key.length} characters; a key made by the server has 43).`;
const startAgain='Close this window and start again with the key of the server:  Start Server Link.cmd --key <the key>';
// Asks the server once - GET /__link/hello - whether it is reachable and accepts the key. {ok, kind: 'key' | 'wait' | 'off' | 'status' | 'network', message}
export async function checkKey({server,key,fetchImpl=fetch,timeoutMs=20000}){
 try{
  const r=await fetchImpl(`${server}/__link/hello`,{headers:{Authorization:`Bearer ${key}`,'X-Link-Agent':agentHeader()},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  await drain(r);
  if(r.ok)return {ok:true,kind:'ok',message:'The server accepted the key.'};
  if(r.status===401)return {ok:false,kind:'key',message:refusedKey(key)};
  if(r.status===429)return {ok:false,kind:'wait',message:'The server asks to wait (too many wrong keys came from this address). Try again in a few minutes.'};
  if(r.status===404)return {ok:false,kind:'off',message:'The server does not have the office link switched on (BIOMETRIC_LINK_KEY is not set there).'};
  return {ok:false,kind:'status',message:`The server answered ${r.status}.`};
 }catch(e){return {ok:false,kind:'network',message:`Cannot reach ${server} (${clean(reason(e))}). Check the internet connection of this computer, and the server address.`};}
}

// ---- the link: one long poll after the other; each request is carried out at once (several may run at the same time: a download takes minutes) ----
export function startLink({server,key,app='http://127.0.0.1:5180',log=console.log,fetchImpl=fetch,pollTimeoutMs=40000,minPollMs=1000,minRetryMs=2000,maxRetryMs=60000,maxParallel=6,beatMs=15000}){
 const ctl=new AbortController();const state={connected:false,lastOk:0,lastError:'',stopped:false,handled:0};
 const headers={Authorization:`Bearer ${key}`,'X-Link-Agent':agentHeader()};
 let running=0,retry=minRetryMs,wasConnected=false,quick=0,lastBeat=0;
 const backoff=()=>{retry=Math.min(maxRetryMs,retry*2);return retry;};
 const note=(ok,message='')=>{
  if(ok){if(!wasConnected)log(`Connected to ${server}`);wasConnected=true;state.connected=true;state.lastOk=Date.now();state.lastError='';retry=minRetryMs;}
  else{if(wasConnected||state.lastError!==message)log(message);wasConnected=false;state.connected=false;state.lastError=message;}
 };
 // The server is never followed anywhere else: a redirect is an error (a hostile server could otherwise point this computer at its own network).
 const toServer=(p,init)=>fetchImpl(server+p,{redirect:'error',...init});

 async function local(method,pathAndQuery,body){
  if(!allowedRequest(method,pathAndQuery,body))return {status:400,type:'application/json',body:Buffer.from(JSON.stringify({error:'This request is not allowed on the office computer.'}))};
  try{
   const r=await fetchImpl(app+pathAndQuery,{method,headers:body&&body.length?{'Content-Type':'application/json'}:{},body:body&&body.length?body:undefined,redirect:'manual',signal:AbortSignal.timeout(method==='POST'?600000:120000)});
   if(r.status>=300&&r.status<400){await drain(r);return {status:502,type:'application/json',body:Buffer.from(JSON.stringify({error:'The Biometric Attendance app answered with a redirect.'}))};}
   return {status:r.status,type:(r.headers.get('content-type')||'application/json').split(';')[0],body:Buffer.from(await r.arrayBuffer())};
  }catch(e){
   const msg=e&&e.name==='TimeoutError'?'The Biometric Attendance app did not answer in time.':`The Biometric Attendance app is not running at ${app}. Start it on this computer (keep its window open).`;
   return {status:502,type:'application/json',body:Buffer.from(JSON.stringify({error:msg}))};
  }
 }
 async function handle(job){
  running++;
  try{
   const method=String(job.method||''),p=String(job.path||'');
   const body=job.body?Buffer.from(String(job.body),'base64'):null;
   const t0=Date.now(),out=await local(method,p,body);
   log(`${clean(method)} ${clean(p.split('?')[0])} -> ${out.status} (${out.body.length} bytes, ${((Date.now()-t0)/1000).toFixed(1)} s)`);
   const gz=zlib.gzipSync(out.body);
   const r=await toServer(`/__link/reply/${job.id}`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Encoding':'gzip','X-Link-Status':String(out.status),'X-Link-Type':out.type},body:gz,signal:AbortSignal.timeout(120000)});
   if(!r.ok&&r.status!==404)log(`The server did not accept the answer (${r.status}).`);
   await drain(r);state.handled++;
  }catch(e){log('Could not send an answer to the server: '+clean(reason(e)));}
  finally{running--;}
 }

 (async()=>{
  while(!ctl.signal.aborted){
   if(running>=maxParallel){   // busy with long downloads: take nothing new, but say now and then that this computer is still here
    if(Date.now()-lastBeat>beatMs){lastBeat=Date.now();try{await drain(await toServer('/__link/hello',{headers,signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(15000)])}));}catch{/* the next poll tells */}}
    await sleep(500,ctl.signal);continue;
   }
   try{
    const t0=Date.now();
    const r=await toServer('/__link/next',{headers,signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(pollTimeoutMs)])});
    if(r.status===204){
     note(true);const took=Date.now()-t0;quick=took<minPollMs?quick+1:0;
     if(quick===3)log('Another Server Link seems to use the same key (the polls come back at once). Run one Server Link per key.');
     if(took<minPollMs)await sleep(minPollMs-took,ctl.signal);   // a poll that came back at once (two links with one key) must not spin
     continue;
    }
    if(r.status===401){await drain(r);note(false,`${refusedKey(key)} ${startAgain}`);await sleep(backoff(),ctl.signal);continue;}
    if(r.status===429){await drain(r);note(false,'The server asks to wait (too many wrong keys from this address).');await sleep(backoff(),ctl.signal);continue;}
    if(r.status===404){await drain(r);note(false,'The server does not have the office link switched on (BIOMETRIC_LINK_KEY is not set there).');await sleep(backoff(),ctl.signal);continue;}
    if(!r.ok){await drain(r);note(false,`The server answered ${r.status}.`);await sleep(backoff(),ctl.signal);continue;}
    note(true);
    let job;try{job=JSON.parse(await readCapped(r,65536));}catch{note(false,'The server sent something that is not a job.');await sleep(backoff(),ctl.signal);continue;}
    if(job&&typeof job==='object'&&typeof job.id==='string'&&/^[0-9a-f]{32}$/.test(job.id))void handle(job);
   }catch(e){
    if(ctl.signal.aborted)break;
    if(e&&(e.name==='TimeoutError'||e.name==='AbortError'))continue;   // a quiet poll that ran out of time: ask again
    note(false,`Cannot reach the server (${clean(reason(e))}). Trying again.`);
    await sleep(backoff(),ctl.signal);
   }
  }
  state.stopped=true;
 })();
 return {state,stop:()=>ctl.abort()};
}

// ---- settings and the command line ----
const fileOf=data=>path.join(data,'server-link.json');
export function loadSettings(data){try{const j=JSON.parse(fs.readFileSync(fileOf(data),'utf8'));return j&&typeof j==='object'?j:{};}catch{return {};}}
export function saveSettings(data,s){fs.mkdirSync(data,{recursive:true});fs.writeFileSync(fileOf(data),JSON.stringify(s,null,1),{mode:0o600});}
// an option that takes a value uses the next word as it is (a key can start with - or --); a flag has no value
export function parseArgs(argv){
 const has=n=>argv.includes('--'+n);
 const value=n=>{const i=argv.indexOf('--'+n);if(i<0)return undefined;if(i+1>=argv.length)throw new Error(`--${n} needs a value.`);return argv[i+1];};
 return {has,value};
}
const ask=(question,stdin=process.stdin,stdout=process.stdout)=>new Promise(resolve=>{const rl=readline.createInterface({input:stdin,output:stdout});rl.question(question,a=>{rl.close();resolve(a.trim());});});
// the key is a secret: nothing is shown while it is typed or pasted
export const askHidden=(question,stdin=process.stdin,stdout=process.stdout)=>new Promise(resolve=>{
 if(!stdin.isTTY||!stdin.setRawMode){void ask(question,stdin,stdout).then(resolve);return;}
 stdout.write(question);stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');let value='';
 const done=v=>{stdin.setRawMode(false);stdin.pause();stdin.removeListener('data',onData);stdout.write('\n');resolve(v);};
 const onData=chunk=>{for(const c of chunk){if(c==='\r'||c==='\n')return done(value.trim());if(c==='\u0003'){stdin.setRawMode(false);stdout.write('\n');process.exit(130);}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}};
 stdin.on('data',onData);
});

const STARTUP_NAME='Biometric Server Link.lnk';
const startupFolder=()=>path.join(process.env.APPDATA||'','Microsoft','Windows','Start Menu','Programs','Startup');
function startupShortcut(on){
 if(process.platform!=='win32'){console.log('--install-startup works on Windows only.');return Promise.resolve();}
 const link=path.join(startupFolder(),STARTUP_NAME),cmd=path.join(here,'Start Server Link.cmd');
 if(!on){try{fs.unlinkSync(link);console.log('Removed the shortcut from the Startup folder.');}catch{console.log('There was no shortcut in the Startup folder.');}return Promise.resolve();}
 const ps=`$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${link.replace(/'/g,"''")}');$s.TargetPath='${cmd.replace(/'/g,"''")}';$s.Arguments='--quiet';$s.WorkingDirectory='${here.replace(/'/g,"''")}';$s.WindowStyle=7;$s.Description='Biometric Server Link';$s.Save()`;
 return new Promise(resolve=>execFile('powershell',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,timeout:20000},err=>{console.log(err?'Could not make the shortcut: '+err.message:`Done: Server Link starts by itself when you sign in to Windows (${link}).`);resolve();}));
}

async function main(){
 // an old Node would fail later with a message nobody can read: say it now (AbortSignal.any needs Node 20.3; the documented minimum is 22.13)
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<20||(major===20&&minor<3)||typeof fetch!=='function'||typeof AbortSignal.any!=='function'){console.error(`This Node.js is too old (${process.versions.node}). Install Node.js 22.13 or newer from https://nodejs.org (LTS), then start Server Link again.`);process.exit(1);}
 const {has,value}=parseArgs(process.argv.slice(2));
 let dataArg,serverArg,keyArg,appArg;
 try{dataArg=value('data');serverArg=value('server');keyArg=value('key');appArg=value('app');}catch(e){console.error(e.message);process.exit(2);}
 const data=path.resolve(dataArg??defaultData());
 if(has('install-startup')){await startupShortcut(true);return;}
 if(has('remove-startup')){await startupShortcut(false);return;}
 const s=loadSettings(data);
 if(has('status')){console.log(s.server?`Server: ${s.server}\nKey: ${s.key?'saved ('+s.key.length+' characters)':'not set'}\nLocal app: ${s.app||'http://127.0.0.1:5180'}\nSettings file: ${fileOf(data)}`:`Not set up yet (settings file: ${fileOf(data)}).`);return;}
 const quiet=has('quiet');
 let server=serverArg!==undefined?cleanServer(serverArg):cleanServer(s.server),key=keyArg!==undefined?cleanKey(keyArg):cleanKey(s.key);
 const app=appArg!==undefined?cleanApp(appArg):(cleanApp(s.app)||'http://127.0.0.1:5180');
 if(serverArg!==undefined&&!server){console.error('The server address must look like https://hrm.example.com (https, no path).');process.exit(2);}
 if(keyArg!==undefined&&!key){console.error('That is not a link key (32 to 128 letters, digits, - and _).');process.exit(2);}
 if(appArg!==undefined&&!app){console.error('The address of the local app must look like http://127.0.0.1:5180 (no path).');process.exit(2);}
 if(!server||!key){
  if(quiet||!process.stdin.isTTY){console.error('Server Link is not set up yet: run it once without --quiet and enter the server address and the key.');process.exit(2);}
  console.log('Server Link connects the Biometric Attendance app of this computer to your Payroll Workspace server.\n');
  while(!server){server=cleanServer(await ask('Server address (for example https://hrm.example.com): '));if(!server)console.log('That does not look like an address. Use https://... with no path.');}
  while(!key){key=cleanKey(await askHidden('Link key (the BIOMETRIC_LINK_KEY of the server - paste it here, nothing is shown): '));if(!key)console.log('That is not a link key (32 to 128 letters, digits, - and _).');}
 }
 // --test: only asks the server whether it accepts the key (nothing is saved, nothing keeps running)
 if(has('test')){
  const c=await checkKey({server,key});
  console.log(c.ok?`OK: ${server} accepts the key (${key.length} characters).`:c.message+(c.kind==='key'?'\n'+startAgain:''));
  process.exitCode=c.ok?0:1;return;
 }
 // The key is tried once before the long-running part: a wrong key is the usual first mistake, so it is better to hear it now and type the key again.
 if(!quiet&&process.stdin.isTTY){
  for(let attempt=1;;attempt++){
   const c=await checkKey({server,key});
   console.log(c.message);
   if(c.ok||c.kind!=='key'||attempt>=3)break;                 // accepted; or not a key problem (the link below keeps trying and says what it sees); or enough tries
   const again=cleanKey(await askHidden('Type or paste the key again (nothing is shown; just Enter goes on with this one): '));
   if(!again)break;
   key=again;
  }
 }
 if(server!==s.server||key!==s.key||(appArg!==undefined&&app!==s.app)){saveSettings(data,{...s,server,key,...(appArg!==undefined?{app}:{})});console.log(`Saved in ${fileOf(data)}`);}
 const logFile=path.join(data,'server-link.log');
 const log=m=>{const line=`[${stamp()}] ${m}`;if(!quiet)console.log(line);try{fs.mkdirSync(data,{recursive:true});if(fs.existsSync(logFile)&&fs.statSync(logFile).size>1024*1024)fs.renameSync(logFile,logFile+'.old');fs.appendFileSync(logFile,line+'\r\n');}catch{/* the log must never stop the link */}};
 log(`Server Link ${VERSION}: ${server} <-> Biometric Attendance app at ${app}`);
 if(!quiet)console.log('Keep this window open. Close it to stop.\n');
 const link=startLink({server,key,app,log});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{link.stop();process.exit(0);});
 await new Promise(()=>{});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e&&e.message||e);process.exit(1);});
