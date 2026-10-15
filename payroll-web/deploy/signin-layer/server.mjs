// Payroll Workspace - sign-in layer for a server (plain Node.js, no packages).
//
// The application has no login of its own: it trusts identity headers that a sign-in layer adds after a successful login and refuses
// every request without them (docs/DEPLOYMENT-GUIDE.md, section 4.6). This is that layer for a server; the Windows edition has its own
// (installer/launcher.mjs).
//
//   browser --HTTPS--> nginx --> this layer (127.0.0.1:8080) --> the application (127.0.0.1:3000) --> db-gateway --> PostgreSQL
//
// * Nothing of the application is served before a login: no session -> the sign-in page (for pages) or 401 (for everything else).
// * Sign-in: Login ID + password (admin01: a scrypt hash in the environment; every other login is checked by the application, which keeps
//   salted PBKDF2 hashes in its database), then the company/year (and location) to open. Rate limits per address and per login.
// * The session is a random token in a cookie (HttpOnly, SameSite=Strict, Secure, __Host- prefix) kept in this process's memory:
//   a restart signs everybody out. One session per browser: to work in two companies at the same time use two browsers.
// * Every request that reaches the application gets the identity headers, and never an identity header (or x-payroll-internal) a browser sent.
//   The path of the identity header and the path that is forwarded are the same normalized string.
// * Sign-ins, failed sign-ins and sign-outs go to the activity log (POST /api/activity with PAYROLL_INTERNAL_KEY).
// * Nothing the application answers may stop this process: every route answers 5xx instead of throwing, and stray errors are logged, not fatal.
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {createLink} from './link.mjs';

const USER={id:'local_seedy',email:'admin@payroll.local',name:'Admin'};   // the owner (tenant) of every record - not a person
const SUPER='admin01';
const TOKEN_RE=/^[A-Za-z0-9_-]{43}$/,ID_RE=/^[A-Za-z][A-Za-z0-9_.-]{2,39}$/,KEY_RE=/^[a-zA-Z0-9_-]{1,64}$/;
const HOP=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','proxy-connection','te','trailer','transfer-encoding','upgrade']);
const METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE']);
const RETRY_PAGE='The program is starting or not reachable. Refresh in a moment.';

// ---- password hashes (admin01) ----
const SCRYPT={N:32768,r:8,p:1,len:64};
const scrypt=(password,salt,len,N,r,p)=>new Promise((resolve,reject)=>crypto.scrypt(password,salt,len,{N,r,p,maxmem:256*1024*1024},(e,key)=>e?reject(e):resolve(key)));
export async function hashPassword(password,salt=crypto.randomBytes(16)){
 const key=await scrypt(password,salt,SCRYPT.len,SCRYPT.N,SCRYPT.r,SCRYPT.p);
 return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password,stored){
 const m=/^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored||'');if(!m)return false;
 const N=+m[1],r=+m[2],p=+m[3],salt=Buffer.from(m[4],'base64url'),want=Buffer.from(m[5],'base64url');
 // a wrong value in the environment must not be able to make a request use unbounded memory or time
 if(N<16384||N>262144||(N&(N-1))!==0||r<1||r>16||p<1||p>4||want.length<16||want.length>128)return false;
 const got=await scrypt(password,salt,want.length,N,r,p);
 return got.length===want.length&&crypto.timingSafeEqual(got,want);
}

// ---- configuration (environment variables) ----
export function readConfig(env=process.env){
 let publicOrigin;
 try{const u=new URL(env.PUBLIC_ORIGIN||'');if(!/^https?:$/.test(u.protocol)||u.pathname!=='/'||u.search||u.hash)throw new Error('x');publicOrigin=u.origin;}
 catch{throw new Error('PUBLIC_ORIGIN must be the address people type, for example https://hrm.example.com (no path).');}
 // UPSTREAM is the application: http://127.0.0.1:3000, or unix:<path of a unix socket> (a hosting that does not allow TCP between processes)
 const unixSocket=/^unix:(.+)$/.exec(env.UPSTREAM||'');
 const upstream=unixSocket?new URL('http://app.local'):new URL(env.UPSTREAM||'http://127.0.0.1:3000');
 if(upstream.protocol!=='http:')throw new Error('UPSTREAM must be an http:// address (the application, on this server) or unix:<socket path>.');
 const adminHash=env.ADMIN_PASSWORD_HASH||'';
 if(!/^scrypt\$/.test(adminHash))throw new Error('ADMIN_PASSWORD_HASH is missing. Create it with:  node make-admin-hash.mjs --write-to /etc/payroll/layer.env');
 // BIOMETRIC_LINK_KEY (optional): switches the office link on (link.mjs); the Server Link on the office computer needs the same key
 // A key of the wrong shape switches the link off and says so in the log; it does not stop the sign-in layer (payroll must stay reachable because of a typo in an optional setting).
 let linkKey=env.BIOMETRIC_LINK_KEY||'',linkProblem='';
 if(linkKey&&!/^[A-Za-z0-9_-]{32,128}$/.test(linkKey)){linkProblem='BIOMETRIC_LINK_KEY must be 32 to 128 characters (letters, digits, - and _). Make one with: node make-link-key.mjs --write-to <settings file>';linkKey='';}
 const num=(name,def,min,max)=>{const v=env[name]===undefined||env[name]===''?def:Number(env[name]);if(!Number.isFinite(v)||v<min||v>max)throw new Error(`${name} must be a number from ${min} to ${max}.`);return v;};
 return {
  host:env.HOST||'127.0.0.1',port:num('PORT',8080,1,65535),upstream,upstreamSocket:unixSocket?unixSocket[1]:'',publicOrigin,adminHash,internalKey:env.PAYROLL_INTERNAL_KEY||'',linkKey,linkProblem,
  cookieSecure:env.COOKIE_SECURE!==undefined&&env.COOKIE_SECURE!==''?env.COOKIE_SECURE!=='0':publicOrigin.startsWith('https:'),
  idleMs:num('IDLE_MINUTES',120,1,1440)*60000,absoluteMs:num('ABSOLUTE_HOURS',12,1,72)*3600000,chooseMs:15*60000,
  trustProxy:env.TRUST_PROXY!=='0',maxSessions:num('MAX_SESSIONS',500,10,5000),
 };
}

// ---- who is asking: an IPv6 address counts as its /64 (one customer owns a whole /64, so it must not hand out millions of "addresses") ----
export function ipBucket(ip){
 if(!ip.includes(':'))return ip;
 let s=ip.toLowerCase();const zone=s.indexOf('%');if(zone>=0)s=s.slice(0,zone);
 const halves=s.split('::');if(halves.length>2)return ip;
 const head=halves[0]?halves[0].split(':'):[],tail=halves.length===2&&halves[1]?halves[1].split(':'):[];
 const fill=halves.length===2?8-head.length-tail.length:0;if(fill<0||(halves.length===1&&head.length!==8))return ip;
 const full=[...head,...new Array(fill).fill('0'),...tail];
 if(full.length!==8||full.some(h=>!/^[0-9a-f]{1,4}$/.test(h)))return ip;
 return full.slice(0,4).map(h=>h.replace(/^0+(?=.)/,'')).join(':')+'::/64';
}

// ---- sign-in limits: per address+login (5 wrong -> 1 minute, doubling up to 15) and per address (25 wrong in 15 minutes -> 10 minutes, up to an hour) ----
// A lock is never evicted to make room: when the maps are full only idle entries (nothing locked, quiet for a while) are dropped.
export function makeLimiter({maxEntries=20000}={}){
 const byPair=new Map(),byIp=new Map();let lastTrim=0;
 const trim=map=>{
  const t=Date.now();if(map.size<=maxEntries||(t-lastTrim<250&&map.size<=maxEntries*1.5))return;lastTrim=t;
  const idle=[...map.entries()].filter(([,e])=>e.lockedUntil<t).sort((a,b)=>a[1].touched-b[1].touched);
  for(const [k] of idle){if(map.size<=Math.floor(maxEntries*0.75))break;map.delete(k);}
 };
 const bump=(map,key,limit,baseLock,maxLock)=>{
  const t=Date.now();let e=map.get(key);
  if(!e||(t-e.first>15*60000&&e.lockedUntil<t))e={n:0,first:t,lockedUntil:0,locks:e?e.locks:0,touched:t};
  e.n++;e.touched=t;
  if(e.n>=limit){e.locks++;e.lockedUntil=t+Math.min(maxLock,baseLock*2**(e.locks-1));e.n=0;e.first=t;}
  map.set(key,e);trim(map);
 };
 const wait=(map,key)=>{const e=map.get(key);return e&&e.lockedUntil>Date.now()?Math.ceil((e.lockedUntil-Date.now())/1000):0;};
 return {
  checkIp:ip=>wait(byIp,ip),
  check:(ip,pair)=>Math.max(wait(byIp,ip),wait(byPair,pair)),
  fail:(ip,pair)=>{bump(byPair,pair,5,60000,15*60000);bump(byIp,ip,25,10*60000,60*60000);},
  ok:pair=>{byPair.delete(pair);},
  sweep:()=>{const t=Date.now();for(const map of [byPair,byIp])for(const [k,e] of map)if(e.lockedUntil<t&&t-e.touched>60*60000)map.delete(k);},
  size:()=>byPair.size+byIp.size,
 };
}

// ---- a small waiting line for the expensive part of a sign-in: at most `max` run at once, up to `maxQueue` wait (at most `waitMs`), the rest are told to try again ----
function semaphore(max,maxQueue,waitMs){
 let running=0;const queue=[];
 const grant=()=>{let done=false;return ()=>{if(done)return;done=true;running--;const next=queue.shift();if(next){clearTimeout(next.timer);running++;next.resolve(grant());}};};
 return {acquire:()=>{
  if(running<max){running++;return Promise.resolve(grant());}
  if(queue.length>=maxQueue)return Promise.resolve(null);
  return new Promise(resolve=>{const item={resolve,timer:setTimeout(()=>{const i=queue.indexOf(item);if(i>=0)queue.splice(i,1);resolve(null);},waitMs)};queue.push(item);});
 }};
}

// ---- the sign-in page (one file, no external resource) ----
const page=nonce=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Payroll Workspace</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef2f6;font-family:Segoe UI,Tahoma,sans-serif;color:#10202f}
.card{width:min(380px,92vw);background:#fff;border:1px solid #cfd8e1;border-radius:10px;box-shadow:0 10px 30px rgba(16,32,47,.12);padding:26px 26px 22px}
h1{margin:0 0 4px;font-size:1.25rem}p.sub{margin:0 0 18px;color:#5a6b7b;font-size:.88rem}label{display:block;font-size:.82rem;font-weight:700;margin:12px 0 5px}
input,select{width:100%;padding:9px 10px;border:1px solid #9aa9b8;border-radius:6px;font-size:1rem;font-family:inherit;background:#fff}input:focus,select:focus{outline:2px solid #0a64d6;border-color:#0a64d6}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:6px;background:#0a64d6;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:default}
[hidden]{display:none!important}a.out{display:block;margin-top:12px;text-align:center;color:#5a6b7b;font-size:.86rem}#msg{min-height:1.2em;margin:10px 0 0;color:#a40000;font-size:.86rem;font-weight:600}.hint{margin:12px 0 0;color:#5a6b7b;font-size:.78rem}</style></head><body>
<main class="card"><h1>Payroll Workspace</h1><p class="sub" id="sub">Sign in to continue</p>
<form id="f1"><label for="id">Login ID</label><input id="id" name="username" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="40" required autofocus>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" maxlength="200" required><button id="go" type="submit">Sign in</button></form>
<form id="f2" hidden><label for="se">Session</label><select id="se"></select><label for="co">Company</label><select id="co"></select><label for="lo">Location</label><select id="lo"><option value="">All locations</option></select>
<button id="open" type="submit">Open</button><a class="out" href="/signout-with-chatgpt">Sign out</a></form>
<p id="msg" role="alert"></p><p class="hint">Each browser keeps one sign-in. To work in another company at the same time, use another browser or a private window.</p></main>
<script nonce="${nonce}">
(()=>{const $=id=>document.getElementById(id);let all=[];
const call=async(path,body)=>{try{const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let j={};try{j=await r.json();}catch{}return {ok:r.ok,status:r.status,j};}catch{return {ok:false,status:0,j:{error:'The program is not reachable.'}};}};
const fill=(sel,items)=>sel.replaceChildren(...items.map(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;return o;}));
const last=()=>{try{return JSON.parse(localStorage.getItem('pw-last')||'{}')||{};}catch{return {};}};
const say=t=>{$('msg').textContent=t||'';};
function fillCompanies(pick){const y=$('se').value;const list=all.filter(c=>String(c.year??'other')===y);fill($('co'),list.map(c=>[c.key,c.place||c.label]));if(pick&&list.some(c=>c.key===pick))$('co').value=pick;}
async function fillLocations(pick){fill($('lo'),[['','All locations']]);const key=$('co').value;if(!key)return;const r=await call('/__locations?company='+encodeURIComponent(key));if(!r.ok)return;fill($('lo'),[['','All locations'],...(r.j.locations||[]).map(l=>[l,l])]);if(pick&&(r.j.locations||[]).includes(pick))$('lo').value=pick;}
async function showChoose(){const r=await call('/__companies');if(r.status===401){showLogin();return;}if(!r.ok){say(r.j.error||'The companies could not be loaded. Refresh the page.');return;}
 all=r.j.companies||[];$('f1').hidden=true;$('f2').hidden=false;$('sub').textContent='Choose the company to open';
 const years=[...new Set(all.map(c=>c.year??'other'))].sort((a,b)=>a==='other'?1:b==='other'?-1:b-a);fill($('se'),years.map(y=>[String(y),y==='other'?'Other records':y+'-'+String(y+1).slice(2)]));
 const l=last(),mine=all.find(c=>c.key===l.company);if(mine)$('se').value=String(mine.year??'other');fillCompanies(l.company);await fillLocations(l.company===$('co').value?l.location:'');
 if(!all.length)say('No company has been given to this login.');$('co').focus();}
function showLogin(){$('f2').hidden=true;$('f1').hidden=false;$('sub').textContent='Sign in to continue';$('id').focus();}
$('se').addEventListener('change',()=>{fillCompanies();void fillLocations();});$('co').addEventListener('change',()=>void fillLocations());
$('f1').addEventListener('submit',async e=>{e.preventDefault();say('');$('go').disabled=true;const r=await call('/__login',{id:$('id').value.trim(),password:$('pw').value});$('pw').value='';$('go').disabled=false;
 if(r.ok){await showChoose();return;}say(r.j.error||'Could not sign in.');$('pw').focus();});
$('f2').addEventListener('submit',async e=>{e.preventDefault();say('');if(!$('co').value){say('Choose the company.');return;}$('open').disabled=true;const r=await call('/__open',{company:$('co').value,location:$('lo').value});
 if(r.ok){try{localStorage.setItem('pw-last',JSON.stringify({company:$('co').value,location:$('lo').value}));}catch{}location.replace('/');return;}$('open').disabled=false;say(r.j.error||'Could not open the company.');if(r.status===401)showLogin();});
call('/__session').then(r=>{if(r.ok&&r.j.state==='choose')void showChoose();else if(r.ok&&r.j.state==='open')location.replace('/');});
})();
</script></body></html>`;

export function createLayer(cfg,log=m=>console.log(m)){
 const upstreamOrigin=cfg.upstream.origin,cookieName=(cfg.cookieSecure?'__Host-':'')+'pw_sid',https=cfg.publicOrigin.startsWith('https:');
 const sessions=new Map(),limiter=makeLimiter(),agent=new http.Agent({keepAlive:true,maxSockets:128,keepAliveMsecs:30000});
 const publicHost=new URL(cfg.publicOrigin).host;
 // the office link (link.mjs): its own limiter, so wrong keys never lock a sign-in
 const link=cfg.linkKey?createLink({key:cfg.linkKey,log:m=>log(m),limiter:makeLimiter({maxEntries:2000}),ipBucket}):null;
 if(cfg.linkProblem)log('office link is NOT switched on: '+cfg.linkProblem);
 // the expensive part of a sign-in: admin01 (scrypt, CPU and 32 MiB each) and the other logins (a call to the application) wait in separate lines, so a flood of guesses at one cannot block the other
 const lines={admin:semaphore(3,16,8000),named:semaphore(8,64,8000)},busyByIp=new Map();
 const budgets={ok:{start:0,n:0,max:300},fail:{start:0,n:0,max:30}},failReported=new Map();
 let errorLog={start:0,n:0};

 // ---- helpers ----
 const json=(res,code,body,extra={})=>{if(res.headersSent)return;res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(body));};
 // answer and close the connection without reading the rest of the request (an unwanted body is not worth reading)
 const refuse=(req,res,code,body,extra={})=>{if(res.headersSent){req.socket.destroy();return;}res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Connection:'close',...extra});res.end(JSON.stringify(body),()=>req.socket.destroy());};
 const logError=e=>{const t=Date.now();if(t-errorLog.start>60000)errorLog={start:t,n:0};if(++errorLog.n<=20)log('error: '+String(e&&e.message||e));};
 // a handler that fails must answer, never throw into the void
 const run=(res,fn)=>{Promise.resolve().then(fn).catch(e=>{logError(e);if(!res.headersSent)json(res,500,{error:'Something went wrong.'});else res.destroy();});};
 const clientIp=req=>{const peer=req.socket.remoteAddress||'';if(cfg.trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)){const real=String(req.headers['x-real-ip']||'').trim();if(net.isIP(real))return real;}return peer.replace(/^::ffff:/,'');};
 const cookieOf=req=>{for(const part of String(req.headers.cookie||'').split(/;\s*/)){const i=part.indexOf('=');if(i>0&&part.slice(0,i)===cookieName){const v=part.slice(i+1);return TOKEN_RE.test(v)?v:'';}}return '';};
 const setCookie=token=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${cfg.cookieSecure?'; Secure':''}`;
 const clearCookie=()=>`${cookieName}=; Path=/; HttpOnly; SameSite=Strict${cfg.cookieSecure?'; Secure':''}; Max-Age=0`;
 const secure=extra=>({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin',...(https?{'Strict-Transport-Security':'max-age=31536000'}:{}),...extra});
 const originOk=req=>req.headers.origin===cfg.publicOrigin;
 // a redirect of the application must stay on this site: the application's own address becomes the public one, anything foreign becomes "/"
 const publicLocation=value=>{
  const v=String(value);
  if(/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(v)){for(const stop of ['','/','?','#'])if(v===upstreamOrigin||(stop&&v.startsWith(upstreamOrigin+stop)))return cfg.publicOrigin+v.slice(upstreamOrigin.length);return '/';}
  return v;
 };
 // the request body of a sign-in step: small, JSON, and read within a few seconds (the caller closes the connection on 408 / 413)
 const readJson=(req,limit,timeoutMs=cfg.bodyTimeoutMs||10000)=>new Promise((resolve,reject)=>{
  const fail=(status,message)=>reject(Object.assign(new Error(message||'Invalid request.'),{status}));
  if(!/^application\/json/i.test(String(req.headers['content-type']||'')))return fail(400);
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>limit))return fail(413);
  const parts=[];let size=0;const timer=setTimeout(()=>fail(408),timeoutMs);
  req.on('data',c=>{size+=c.length;if(size>limit){clearTimeout(timer);fail(413);}else parts.push(c);});
  req.on('end',()=>{clearTimeout(timer);try{const v=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('x');resolve(v);}catch{fail(400);}});
  req.on('error',()=>{clearTimeout(timer);fail(400);});
  req.on('close',()=>clearTimeout(timer));
 });
 const bodyError=(req,res,e)=>e.status===413||e.status===408?refuse(req,res,e.status,{error:'Invalid request.'}):json(res,e.status||400,{error:'Invalid request.'});
 const getSession=req=>{
  const token=cookieOf(req);if(!token)return null;const s=sessions.get(token);if(!s)return null;const t=Date.now();
  if(t-s.created>cfg.absoluteMs||t-s.last>cfg.idleMs||(s.state==='choose'&&t-s.created>cfg.chooseMs)){sessions.delete(token);return null;}
  s.last=t;return s;
 };
 const endSession=(s,why)=>{sessions.delete(s.token);log(`session ended (${why}) user=${s.username}`);};
 const idHeaders=(username,path,method)=>({'oai-authenticated-user-id':USER.id,'oai-authenticated-user-email':USER.email,'oai-authenticated-user-full-name':encodeURIComponent(USER.name),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8',
  'oai-authenticated-user-mode':'editable','oai-authenticated-user-username':username,'oai-authenticated-user-path':path,'oai-authenticated-user-method':method});

 // ---- the application, asked as the sign-in program (the Super Admin); whatever it answers is checked before it is used ----
 // (plain http.request on the same connection pool as the proxy, so it also works over a unix socket)
 const dialOptions=cfg.upstreamSocket?{socketPath:cfg.upstreamSocket}:{host:cfg.upstream.hostname,port:Number(cfg.upstream.port||80)};
 function internal(method,path,{body,key=false,timeout=15000}={}){
  const u=new URL(path,upstreamOrigin);
  const headers={...idHeaders(SUPER,u.pathname,method),Origin:upstreamOrigin,Host:cfg.upstream.host};
  const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
  if(payload){headers['Content-Type']='application/json';headers['Content-Length']=String(payload.length);}
  if(key)headers['x-payroll-internal']=cfg.internalKey;
  return new Promise((resolve,reject)=>{
   const req=http.request({agent,...dialOptions,method,path:u.pathname+u.search,headers,timeout},res=>{
    const parts=[];res.on('data',c=>parts.push(c));res.on('error',reject);
    res.on('end',()=>{const text=Buffer.concat(parts).toString('utf8');resolve({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,text:()=>text,json:()=>JSON.parse(text)});});
   });
   req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);req.end(payload);
  });
 }
 const strings=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'):[];
 async function appLogin(id,password){
  const r=await internal('POST','/api/hr-login',{body:{username:id,password},timeout:10000});
  if(r.status===401||r.status===403)return null;if(!r.ok)throw new Error('hr-login '+r.status);
  const j=await r.json();if(!j||typeof j!=='object')throw new Error('hr-login: unexpected answer');
  return {username:String(j.username||id).slice(0,60),name:String(j.name||id).slice(0,80),role:j.role==='admin'?'admin':'user',permissions:{datasets:strings(j.permissions?.datasets),units:strings(j.permissions?.units)}};
 }
 async function loginExists(id){try{const r=await internal('GET','/api/hr-login?username='+encodeURIComponent(id),{timeout:8000});return r.ok&&(await r.json()).exists===true;}catch{return false;}}
 async function companiesOf(s){
  const r=await internal('GET','/api/companies');if(!r.ok)throw new Error('companies '+r.status);
  const j=await r.json();if(!j||!Array.isArray(j.companies))throw new Error('companies: unexpected answer');
  const list=j.companies.filter(c=>c&&typeof c==='object'&&typeof c.key==='string'&&KEY_RE.test(c.key))
   .map(c=>({key:c.key,label:String(c.label??c.key).slice(0,120),year:Number.isInteger(c.year)?c.year:null,place:String(c.place??'').slice(0,80)}));
  if(!s.permissions)return list;const d=s.permissions.datasets;
  return list.filter(c=>d.includes('*')||d.includes(c.key));
 }
 async function locationsOf(s,key){
  if(!KEY_RE.test(key))return [];
  const r=await internal('GET','/api/masters?names=1&dataset='+encodeURIComponent(key));if(!r.ok)throw new Error('locations '+r.status);
  const j=await r.json();if(!j||!j.names||!Array.isArray(j.names.locations))throw new Error('locations: unexpected answer');
  const places=j.names.locations.filter(x=>typeof x==='string'&&x).map(x=>x.slice(0,80)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  return !s.permissions||s.permissions.units.includes('*')?places:places.filter(p=>s.permissions.units.includes(p));
 }
 // The activity log hears of sign-ins, failed sign-ins and sign-outs. A problem with the log never stops a sign-in. Failed attempts have a budget of their own
 // (300 real events a minute are kept whatever the noise of wrong guesses is), and one failed login is reported once a minute per address.
 const spend=kind=>{const b=budgets[kind],t=Date.now();if(t-b.start>60000){b.start=t;b.n=0;}return ++b.n<=b.max;};
 async function report(event,username,company='',summary=''){
  if(!cfg.internalKey||!spend(event==='login-failed'?'fail':'ok'))return;
  try{await internal('POST','/api/activity',{key:true,timeout:8000,body:{internal:true,event,username:String(username||'').slice(0,60),dataset:KEY_RE.test(company)?company:'',summary:String(summary).slice(0,200)}});}catch{/* ignored */}
 }

 // ---- layer routes ----
 async function login(req,res,ip){
  if(!originOk(req))return json(res,403,{error:'This request could not be verified. Reload the page.'});
  const bucket=ipBucket(ip),lockedIp=limiter.checkIp(bucket);
  if(lockedIp)return refuse(req,res,429,{error:`Too many attempts. Try again in ${lockedIp} second${lockedIp===1?'':'s'}.`},{'Retry-After':String(lockedIp)});   // before the body is read
  let body;try{body=await readJson(req,4096);}catch(e){return bodyError(req,res,e);}
  const id=typeof body.id==='string'?body.id.trim():'',password=typeof body.password==='string'?body.password:'';
  const pair=bucket+'|'+id.toLowerCase().slice(0,40);
  const wait=limiter.check(bucket,pair);
  if(wait)return json(res,429,{error:`Too many attempts. Try again in ${wait} second${wait===1?'':'s'}.`},{'Retry-After':String(wait)});
  if(!ID_RE.test(id)||!password||password.length>200){limiter.fail(bucket,pair);return json(res,401,{error:'Wrong ID or password.'});}
  // two attempts at a time per address; the rest wait in line (a flood from many addresses delays sign-ins, it does not make them fail at once)
  const busy=busyByIp.get(bucket)||0;
  if(busy>=2)return json(res,429,{error:'Too many attempts at the same time. Try again in a moment.'},{'Retry-After':'2'});
  busyByIp.set(bucket,busy+1);
  const admin=id.toLowerCase()===SUPER,release=await lines[admin?'admin':'named'].acquire();
  const done=()=>{if(release)release();const n=(busyByIp.get(bucket)||1)-1;if(n<=0)busyByIp.delete(bucket);else busyByIp.set(bucket,n);};
  if(!release){done();return json(res,503,{error:'Busy. Try again in a moment.'},{'Retry-After':'5'});}
  try{
   let who=null;
   if(admin){if(id===SUPER&&await verifyPassword(password,cfg.adminHash))who={username:SUPER,name:'Super Admin',role:'superadmin',permissions:null};}
   else{try{who=await appLogin(id,password);}catch(e){log('sign-in: the application did not answer: '+e.message);return json(res,503,{error:RETRY_PAGE});}}
   if(!who){
    limiter.fail(bucket,pair);
    const known=admin||await loginExists(id);
    log(`sign-in failed ${known?'login='+id:'(unknown ID)'} ip=${ip}`);
    const last=failReported.get(pair)||0;
    if(known&&Date.now()-last>60000){failReported.set(pair,Date.now());if(failReported.size>5000)failReported.clear();void report('login-failed',admin?SUPER:id,'','Sign-in failed (wrong password)');}
    return json(res,401,{error:'Wrong ID or password.'});
   }
   limiter.ok(pair);
   // a new session for every sign-in (no session fixation); at most 10 per login, the oldest ones go first
   const old=getSession(req);if(old)endSession(old,'replaced');
   const mine=[...sessions.values()].filter(s=>s.username===who.username).sort((a,b)=>a.created-b.created);
   for(const s of mine.slice(0,Math.max(0,mine.length-9)))sessions.delete(s.token);
   if(sessions.size>=cfg.maxSessions){const oldest=[...sessions.values()].sort((a,b)=>a.last-b.last)[0];if(oldest)sessions.delete(oldest.token);}
   const token=crypto.randomBytes(32).toString('base64url'),t=Date.now();
   sessions.set(token,{token,username:who.username,name:who.name,role:who.role,permissions:who.permissions,company:'',location:'',state:'choose',created:t,last:t,ip});
   log(`signed in login=${who.username} ip=${ip}`);void report('login',who.username,'','Signed in');
   return json(res,200,{ok:true,username:who.username,name:who.name,role:who.role},{'Set-Cookie':setCookie(token)});
  }finally{done();}
 }
 async function openCompany(req,res,s){
  if(!originOk(req))return json(res,403,{error:'This request could not be verified. Reload the page.'});
  if(s.state!=='choose')return json(res,409,{error:'A company is already open in this browser. Sign out first.'});
  let body;try{body=await readJson(req,2048);}catch(e){return bodyError(req,res,e);}
  const company=typeof body.company==='string'?body.company:'',location=typeof body.location==='string'?body.location.trim().slice(0,80):'';
  let list;try{list=await companiesOf(s);}catch(e){logError(e);return json(res,503,{error:RETRY_PAGE});}
  if(!KEY_RE.test(company)||!list.some(c=>c.key===company))return json(res,403,{error:'This company is not assigned to your login.'});
  if(location){let places;try{places=await locationsOf(s,company);}catch(e){logError(e);return json(res,503,{error:RETRY_PAGE});}if(!places.includes(location))return json(res,400,{error:'Choose the location.'});}
  if(s.state!=='choose')return json(res,409,{error:'A company is already open in this browser. Sign out first.'});   // another request opened one meanwhile
  s.company=company;s.location=location;s.state='open';log(`opened company=${company}${location?' location='+location:''} login=${s.username}`);
  return json(res,200,{ok:true});
 }
 function signOut(req,res){
  const s=getSession(req)||sessions.get(cookieOf(req));
  if(s){endSession(s,'signed out');void report('logout',s.username,s.company,'Signed out');}
  res.writeHead(302,{Location:'/','Set-Cookie':clearCookie(),'Cache-Control':'no-store',...secure()});res.end();
 }

 // ---- the application, for a signed-in session that has opened a company ----
 function proxy(req,res,s,url){
  const origin=req.headers.origin;
  if(origin!==undefined&&origin!==cfg.publicOrigin)return json(res,403,{error:'This request could not be verified. Refresh the page and try again.'});
  if(!['GET','HEAD'].includes(req.method)&&origin===undefined)return json(res,403,{error:'This request could not be verified. Refresh the page and try again.'});
  // the path the application is told about in the identity header and the path that is forwarded are one and the same normalized string
  const outPath=url.pathname+url.search;
  const headers={};
  for(const [k,v] of Object.entries(req.headers)){
   if(HOP.has(k)||k==='cookie'||k==='host'||k==='x-payroll-internal'||k==='x-real-ip'||k==='forwarded'||k.startsWith('x-forwarded-')||k.startsWith('oai-authenticated-user-'))continue;
   headers[k]=v;
  }
  const rest=String(req.headers.cookie||'').split(/;\s*/).filter(c=>c&&!c.startsWith(cookieName+'='));if(rest.length)headers.cookie=rest.join('; ');
  headers.host=cfg.upstream.host;
  if(headers.origin)headers.origin=upstreamOrigin;   // checked above: it is the public address, which the application sees as its own
  if(headers.referer)headers.referer=String(headers.referer).replace(cfg.publicOrigin,upstreamOrigin);
  Object.assign(headers,idHeaders(s.username,url.pathname,req.method));
  const up=http.request({agent,...dialOptions,method:req.method,path:outPath,headers,timeout:330000});
  up.on('response',r=>{
   try{
    const out={};for(const [k,v] of Object.entries(r.headers))if(!HOP.has(k))out[k]=v;
    if(out.location)out.location=publicLocation(out.location);
    for(const [k,v] of Object.entries(secure()))if(out[k.toLowerCase()]===undefined)out[k]=v;
    // nothing signed-in is ever kept by a shared cache (a CDN, LiteSpeed's cache): what the application does not mark as cacheable is "no-store"
    if(out['cache-control']===undefined)out['cache-control']='no-store';
    if(!/immutable|public/i.test(String(out['cache-control'])))out['x-litespeed-cache-control']='no-cache';
    res.writeHead(r.statusCode>=100&&r.statusCode<=599?r.statusCode:502,out);
    r.on('error',()=>res.destroy());r.pipe(res);
   }catch(e){logError(e);r.destroy();if(!res.headersSent)json(res,502,{error:RETRY_PAGE});else res.destroy();}
  });
  up.on('timeout',()=>up.destroy(new Error('timeout')));
  up.on('error',()=>{if(!res.headersSent){const wants=req.method==='GET'&&String(req.headers.accept||'').includes('text/html');if(wants){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(RETRY_PAGE);}else json(res,502,{error:RETRY_PAGE});}else res.destroy();});
  res.on('close',()=>{if(!res.writableEnded)up.destroy();});
  req.on('aborted',()=>up.destroy());
  req.pipe(up);
 }

 const server=http.createServer((req,res)=>{
  try{handle(req,res);}catch(e){logError(e);json(res,500,{error:'Something went wrong.'});}
 });
 function handle(req,res){
  const target=req.url||'/';
  if(!target.startsWith('/')||target.startsWith('//')||target.includes('\\')||target.length>8192)return json(res,400,{error:'Invalid request.'});
  if(String(req.headers.host||'').toLowerCase()!==publicHost.toLowerCase())return json(res,421,{error:'Wrong address.'});
  if(!METHODS.has(req.method))return json(res,405,{error:'Method not allowed.'},{Allow:[...METHODS].join(', ')});
  let url;try{url=new URL(target,'http://layer.local');}catch{return json(res,400,{error:'Invalid request.'});}
  if(url.host!=='layer.local')return json(res,400,{error:'Invalid request.'});
  const path=url.pathname,ip=clientIp(req);
  if(path==='/__ping'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('ok');return;}
  if(path==='/__login'&&req.method==='POST'){run(res,()=>login(req,res,ip));return;}
  if(path.startsWith('/__link/')){if(!link)return json(res,404,{error:'Not found.'});link.route(req,res,url,ip);return;}   // the Server Link of the office: its own key, no cookie
  if(path==='/signin-with-chatgpt'){res.writeHead(302,{Location:'/','Cache-Control':'no-store'});res.end();return;}
  if(path==='/signout-with-chatgpt'){signOut(req,res);return;}
  const s=getSession(req);
  const wantsPage=(req.method==='GET'||req.method==='HEAD')&&!path.startsWith('/api/')&&String(req.headers.accept||'').includes('text/html');
  if(path==='/__session'){json(res,200,{state:s?s.state:'none'});return;}
  if(path.startsWith('/__')){
   // the layer's own routes need a session; every other /__ path never reaches the application
   if(!s)return json(res,401,{error:'Please sign in again.'});
   if(path==='/__companies'&&req.method==='GET'){run(res,async()=>{let list;try{list=await companiesOf(s);}catch(e){logError(e);return json(res,503,{error:RETRY_PAGE});}json(res,200,{companies:list});});return;}
   if(path==='/__locations'&&req.method==='GET'){run(res,async()=>{const key=url.searchParams.get('company')||'';let places=[];try{if((await companiesOf(s)).some(c=>c.key===key))places=await locationsOf(s,key);}catch(e){logError(e);return json(res,503,{error:RETRY_PAGE});}json(res,200,{locations:places});});return;}
   if(path==='/__open'&&req.method==='POST'){run(res,()=>openCompany(req,res,s));return;}
   if(path==='/__workspace'&&req.method==='GET'){if(s.state!=='open')return json(res,401,{error:'Please sign in again.'});json(res,200,{company:s.company,location:s.location,mode:'editable',username:s.username});return;}
   return json(res,404,{error:'Not found.'});
  }
  if(!s||s.state!=='open'){
   if(wantsPage){const nonce=crypto.randomBytes(16).toString('base64');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
     'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,...secure()});
    res.end(req.method==='HEAD'?undefined:page(nonce));return;}
   return json(res,401,{error:'Please sign in again.'});
  }
  proxy(req,res,s,url);
 }
 server.headersTimeout=30000;server.keepAliveTimeout=65000;server.requestTimeout=0;
 server.on('clientError',(e,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
 const sweeper=setInterval(()=>{const t=Date.now();for(const [k,s] of sessions)if(t-s.created>cfg.absoluteMs||t-s.last>cfg.idleMs||(s.state==='choose'&&t-s.created>cfg.chooseMs))sessions.delete(k);for(const [k,v] of failReported)if(t-v>60000)failReported.delete(k);limiter.sweep();},60000);sweeper.unref();
 return {server,sessions,limiter,link,logError,close:()=>new Promise(resolve=>{clearInterval(sweeper);link?.close();agent.destroy();server.close(()=>resolve());server.closeAllConnections?.();})};
}

// ---- run ----
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let cfg;try{cfg=readConfig();}catch(e){console.error('Cannot start: '+e.message);process.exit(1);}
 if(!cfg.internalKey)console.log('Note: PAYROLL_INTERNAL_KEY is not set, so sign-ins and sign-outs are not written to the activity log.');
 const layer=createLayer(cfg);
 // a stray error is logged and the layer keeps serving (a restart would sign everybody out); a storm of them (more than 50 in a minute) ends the process, systemd starts it again
 let strays={start:0,n:0};
 const stray=(kind,e)=>{const t=Date.now();if(t-strays.start>60000)strays={start:t,n:0};strays.n++;console.error(`${kind}: ${e&&e.stack||e}`);if(strays.n>50){console.error('Too many unexpected errors - stopping.');process.exit(1);}};
 process.on('unhandledRejection',e=>stray('unhandled rejection',e));process.on('uncaughtException',e=>stray('uncaught exception',e));
 layer.server.listen(cfg.port,cfg.host,()=>console.log(`Sign-in layer on http://${cfg.host}:${cfg.port} for ${cfg.publicOrigin}, application at ${cfg.upstream.origin}`));
 layer.server.on('error',e=>{console.error('Cannot listen: '+e.message);process.exit(1);});
 for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{console.log('Stopping.');void layer.close().then(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();});
}
