// Payroll Workspace desktop launcher.
// Starts the local server (Cloudflare workerd via wrangler, data kept on this computer), puts a
// sign-in proxy in front of it that only accepts connections from this computer, and opens the browser.
import {spawn,execFile} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOGIN_ID_HASH,loginMode,loginHash} from './login-gate.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const appDir=process.env.PAYROLL_APP_DIR|| (fs.existsSync(path.join(root,'app'))?path.join(root,'app'):path.join(root,'..','payroll-web'));
const sourceCheckout=!fs.existsSync(path.join(root,'app'));
const dataRoot=process.env.PAYROLL_DATA||(sourceCheckout?path.join(root,'..','runtime-data'):path.join(process.env.LOCALAPPDATA||root,'PayrollWorkspace'));
const stateDir=path.join(dataRoot,'state');
const editableStateDir=path.join(dataRoot,'editable-state');
const logFile=path.join(dataRoot,'logs','server.log');
const configFile=path.join(dataRoot,'config','desktop.json');
let desktopConfig={};try{desktopConfig=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch{}
let PORT=Number(process.env.PAYROLL_PORT||(sourceCheckout?5782:desktopConfig.port||5780));
if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw new Error('Invalid Payroll port.');
const instanceId=crypto.createHash('sha256').update(path.resolve(appDir).toLowerCase()+'|'+path.resolve(dataRoot).toLowerCase()).digest('hex').slice(0,16);
const OPEN=process.env.PAYROLL_NO_BROWSER!=='1';
const SESSION_COOKIE='pw_session_'+instanceId;
const MAX_WINDOWS=30;
// The data imported on the original computer belongs to this local user id.
const USER={id:'local_seedy',email:'admin@payroll.local',name:'Admin'};

// Sign-in gate: nothing of the workspace is served before a login ID and a password are given. The login ID box comes
// first; the password box appears once the right ID has been typed. Sessions live in memory only, so every start of the
// program asks again. Only salted hashes are kept here.
//
// Every sign-in gets its own session AND its own address: the sign-in page (the program's main port) only signs in; the
// workspace of the chosen company then opens on a port of its own (the session's "window"), with a session cookie named
// after that port. So two companies (or two years) can be open at the same time in different tabs without one sign-in
// replacing the other, and Exit in one window signs out of that window only.
const GATE={id:LOGIN_ID_HASH};
// token -> {token, company: the company (key) chosen on the sign-in page, mode, username, port: the window's own port}
const sessions=new Map();let failures=0,lockedUntil=0;
const windows=new Map(); // port -> {server, session}
const cookieOf=(req,name)=>{const m=new RegExp('(?:^|;\\s*)'+name+'=([0-9a-f]{48})(?:;|$)').exec(req.headers.cookie||'');return m?m[1]:'';};
const loginPage=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payroll Workspace</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef2f6;font-family:Segoe UI,Tahoma,sans-serif;color:#10202f}
.card{width:min(380px,92vw);background:#fff;border:1px solid #cfd8e1;border-radius:10px;box-shadow:0 10px 30px rgba(16,32,47,.12);padding:26px 26px 22px}
h1{margin:0 0 4px;font-size:1.25rem}p.sub{margin:0 0 18px;color:#5a6b7b;font-size:.88rem}label{display:block;font-size:.82rem;font-weight:700;margin:12px 0 5px}
input,select{width:100%;padding:9px 10px;border:1px solid #9aa9b8;border-radius:6px;font-size:1rem;font-family:inherit;background:#fff}input:focus,select:focus{outline:2px solid #0a64d6;border-color:#0a64d6}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:6px;background:#0a64d6;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:default}
#pwbox{display:none}#msg{min-height:1.2em;margin:10px 0 0;color:#a40000;font-size:.86rem;font-weight:600}.hint{margin:12px 0 0;color:#5a6b7b;font-size:.78rem}</style></head><body>
<form class="card" id="f" autocomplete="off"><h1>Payroll Workspace</h1><p class="sub">Sign in to continue</p>
<label for="se">Session</label><select id="se"></select>
<label for="co">Company</label><select id="co"></select><label for="id">Login ID</label><input id="id" name="login-id" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus>
<div id="pwbox"><label for="pw">Password</label><input id="pw" name="login-pw" type="password" autocomplete="off"><button id="go" type="submit">Open</button></div>
<p id="msg" role="alert"></p><p class="hint">Each sign-in opens its own window for the company chosen here. Open this page again in another tab to work in another company at the same time.</p></form>
<script>
const idHash='${GATE.id}';const $=s=>document.getElementById(s);
async function sha(v){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pw-gate|'+v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
let idOk=false,seq=0;
async function checkId(){const v=$('id').value.trim(),n=++seq;let ok=false;if(/^[a-zA-Z][a-zA-Z0-9_.-]{2,39}$/.test(v)){try{const r=await fetch('/__id?id='+encodeURIComponent(v));ok=r.ok&&(await r.json()).ok===true;}catch{}}if(n!==seq)return idOk;if(ok===idOk)return ok;idOk=ok;$('pwbox').style.display=ok?'block':'none';$('msg').textContent='';if(ok)$('pw').focus();else $('pw').value='';return ok;}
$('id').addEventListener('input',checkId);
// The session (year) and the company to open are chosen here, with the login, not inside the program.
// Session lists the years (newest first, then records that belong to no year); Company lists the companies of that session.
let all=[];const fill=(sel,items)=>{sel.replaceChildren(...items.map(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;return o;}));};
const fillCompanies=()=>{const y=$('se').value;fill($('co'),all.filter(c=>String(c.year??'other')===y).map(c=>[c.key,c.place||c.label]));};
fetch('/__companies').then(r=>r.json()).then(j=>{all=j.companies||[];const years=[...new Set(all.map(c=>c.year??'other'))].sort((a,b)=>a==='other'?1:b==='other'?-1:b-a);
 fill($('se'),years.map(y=>[String(y),y==='other'?'Other records':y+'-'+String(y+1).slice(2)]));fillCompanies();$('se').addEventListener('change',fillCompanies);
 if(!all.length)$('msg').textContent='No company was found.';}).catch(()=>{$('msg').textContent='The companies could not be loaded. Refresh the page.';});
$('f').addEventListener('submit',async e=>{e.preventDefault();if(!$('co').value){$('msg').textContent='Choose the session and the company.';return;}if(!await checkId()){$('msg').textContent='Wrong login ID.';return;}
 $('go').disabled=true;$('msg').textContent='';
 try{const r=await fetch('/__login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:$('co').value,id:$('id').value.trim(),password:$('pw').value})});
  const j=await r.json().catch(()=>({}));if(r.ok&&j.url){$('pw').value='';location.href=j.url;return;}$('msg').textContent=j.error||'Could not sign in.';$('pw').value='';$('pw').focus();}
 catch{$('msg').textContent='The program is not reachable.';}$('go').disabled=false;});
</script></body></html>`;

fs.mkdirSync(path.dirname(logFile),{recursive:true});
const log=fs.createWriteStream(logFile,{flags:'a'});
const say=(msg)=>{const line=`[${new Date().toLocaleString()}] ${msg}`;console.log(line);log.write(line+'\n');};

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.unref();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});}
function portInUse(port){return new Promise(resolve=>{const s=net.createConnection({port,host:'127.0.0.1'});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});}
function openBrowser(url){if(OPEN)execFile('cmd.exe',['/c','start','',url],{windowsHide:true});}
async function waitFor(url,ms){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fetch(url,{signal:AbortSignal.timeout(3000)});if(r.status<500)return true;}catch{}await new Promise(r=>setTimeout(r,500));}return false;}

let url=`http://localhost:${PORT}/`;
if(await portInUse(PORT)){
 // Already running (second double-click): just show it.
 try{const r=await fetch(url+'__ping',{signal:AbortSignal.timeout(4000)});if(r.ok&&r.headers.get('x-payroll-instance')===instanceId&&(await r.text())==='payroll-workspace'){say('Payroll Workspace is already running.');openBrowser(url);process.exit(0);}}catch{}
 if(process.env.PAYROLL_PORT||sourceCheckout){say(`Port ${PORT} is used by another program. Close it or set PAYROLL_PORT to another number.`);process.exit(1);}
 let available=false;for(let candidate=5780;candidate<5800;candidate++){if(!await portInUse(candidate)){PORT=candidate;available=true;break;}}
 if(!available)PORT=await freePort();
 url=`http://localhost:${PORT}/`;
}
if(!sourceCheckout&&!process.env.PAYROLL_PORT){fs.mkdirSync(path.dirname(configFile),{recursive:true});fs.writeFileSync(configFile,JSON.stringify({port:PORT},null,2));}

const inner=await freePort();
const editableInner=await freePort();
// A consistent one-time snapshot. Later starts retain the editable workspace's own changes.
async function snapshot(src,dest){await new Promise((resolve,reject)=>execFile(process.execPath,[path.join(root,'snapshot-state.cjs'),src,dest],{windowsHide:true},error=>error?reject(error):resolve()));}
if(!fs.existsSync(stateDir)){
 const seed=sourceCheckout?path.join(appDir,'.wrangler','state'):path.join(root,'initial-data','state');
 if(!fs.existsSync(seed))throw new Error('Payroll data was not found. Please run Payroll Workspace Setup again.');
 await snapshot(seed,stateDir);
}
if(!fs.existsSync(editableStateDir)){
 const staging=editableStateDir+'.initializing-'+crypto.randomBytes(4).toString('hex');
 await snapshot(stateDir,staging);fs.renameSync(staging,editableStateDir);
}
const env={...process.env,CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',
 WRANGLER_LOG_PATH:path.join(dataRoot,'logs'),WRANGLER_REGISTRY_PATH:path.join(dataRoot,'registry'),MINIFLARE_REGISTRY_PATH:path.join(dataRoot,'mf-registry'),
 XDG_CONFIG_HOME:path.join(dataRoot,'config'),WRANGLER_HIDE_BANNER:'true',CI:'true',NO_COLOR:'1'};
say(`Starting Payroll Workspace (data: ${stateDir}) ...`);
function startBackend(port,state){const child=spawn(process.execPath,[path.join(appDir,'node_modules','wrangler','bin','wrangler.js'),'dev','--config',path.join(appDir,'dist','server','wrangler.json'),'--local','--persist-to',state,'--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--show-interactive-dev-session=false','--log-level','warn'],{cwd:appDir,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});return child;}
const server=startBackend(inner,stateDir),editableServer=startBackend(editableInner,editableStateDir);
let stopping=false;let biometric=null;
function stop(code=0){if(stopping)return;stopping=true;say('Stopping Payroll Workspace ...');for(const child of [server,editableServer,biometric])if(child)try{execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});}catch{}setTimeout(()=>process.exit(code),4000);}
server.on('exit',c=>{if(!stopping){say(`The server stopped unexpectedly (code ${c}). See ${logFile}`);stop(1);}});
editableServer.on('exit',c=>{if(!stopping){say(`The editable server stopped unexpectedly (code ${c}).`);stop(1);}});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());process.on('SIGHUP',()=>stop());

const innerOrigin=`http://127.0.0.1:${inner}`;
const editableOrigin=`http://127.0.0.1:${editableInner}`;
if(!await waitFor(innerOrigin+'/',180000)){say(`The server did not start. See ${logFile}`);stop(1);}
if(!await waitFor(editableOrigin+'/',180000)){say(`The editable server did not start. See ${logFile}`);stop(1);}

const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
// The companies offered at sign-in come from the program itself (the same list its company picker used to show).
async function companiesOffered(mode='normal'){
 const r=await fetch((mode==='editable'?editableOrigin:innerOrigin)+'/api/companies',{headers:{'oai-authenticated-user-id':USER.id,'oai-authenticated-user-email':USER.email,'oai-authenticated-user-full-name':encodeURIComponent(USER.name),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('companies '+r.status);return (await r.json()).companies;
}
// The locations (Master Entry › Location Entry) of one company/year, offered at sign-in as the Location choice.
async function locationsOf(key,mode='normal'){
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(key))return [];
 const r=await fetch((mode==='editable'?editableOrigin:innerOrigin)+'/api/masters?names=1&dataset='+encodeURIComponent(key),{headers:{'oai-authenticated-user-id':USER.id,'oai-authenticated-user-email':USER.email,'oai-authenticated-user-full-name':encodeURIComponent(USER.name),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('locations '+r.status);
 return ((await r.json()).names?.locations||[]).map(String).filter(Boolean).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}
const json=(res,code,body,extra={})=>res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...extra}).end(JSON.stringify(body));
// The address the browser used (localhost or 127.0.0.1), so cookies and links stay on the same host name.
const hostOf=req=>String(req.headers.host||'').replace(/:\d+$/,'')==='127.0.0.1'?'127.0.0.1':'localhost';
const wantsPage=(req,u)=>req.method==='GET'&&!u.pathname.startsWith('/api/')&&String(req.headers.accept||'').includes('text/html');

// A session's own window: a server on its own port that opens only with this session's cookie and forwards to the
// workspace server (original or editable copy) with the session's company and user.
async function openWindow(session){
 for(let attempt=0;attempt<6;attempt++){
  let port=0;for(let candidate=PORT+1;candidate<PORT+200&&candidate<65536;candidate++){if(!windows.has(candidate)&&!await portInUse(candidate)){port=candidate;break;}}
  if(!port)port=await freePort();
  const targetOrigin=session.mode==='editable'?editableOrigin:innerOrigin;
  const targetPort=session.mode==='editable'?editableInner:inner;
  const cookieName=SESSION_COOKIE+'_'+port;
  const mainUrl=req=>`http://${hostOf(req)}:${PORT}/`;
  const own=http.createServer((req,res)=>{
   if(!loopback.has(req.socket.remoteAddress||'')){res.writeHead(403).end('Only this computer can open Payroll Workspace.');return;}
   const u=new URL(req.url||'/',`http://localhost:${port}/`);
   if(u.pathname==='/__ping'){res.writeHead(200,{'Content-Type':'text/plain','X-Payroll-Instance':instanceId}).end('payroll-workspace-window');return;}
   // Not signed in to this window (cookie missing, or the window was signed out): back to the sign-in page.
   if(cookieOf(req,cookieName)!==session.token||!sessions.has(session.token)){
    if(wantsPage(req,u)){res.writeHead(302,{Location:mainUrl(req),'Cache-Control':'no-store'}).end();return;}
    json(res,401,{error:'Please sign in again.'});return;}
   if(u.pathname==='/signin-with-chatgpt'){res.writeHead(302,{Location:'/'}).end();return;}
   if(u.pathname==='/__workspace'){json(res,200,{company:session.company,location:session.location||'',mode:'editable',username:session.username||'admin01'});return;}
   // Exit in the menu signs out of this window only: its session ends, its address closes and the sign-in page comes back; the program and other windows keep running.
   if(u.pathname==='/signout-with-chatgpt'){closeWindow(port);res.writeHead(302,{Location:mainUrl(req),'Set-Cookie':`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,'Cache-Control':'no-store'}).end();return;}
   const headers={};for(const [k,v] of Object.entries(req.headers))if(!k.startsWith('oai-authenticated-user-'))headers[k]=v;
   if(headers.cookie){const rest=String(headers.cookie).split(/;\s*/).filter(c=>!/^pw_(session|workcopy_session|company|mode)/.test(c));if(rest.length)headers.cookie=rest.join('; ');else delete headers.cookie;}
   headers.host=`127.0.0.1:${targetPort}`;if(headers.origin===`http://localhost:${port}`||headers.origin===`http://127.0.0.1:${port}`)headers.origin=targetOrigin;
   if(headers.referer)headers.referer=String(headers.referer).replace(/^http:\/\/(localhost|127\.0\.0\.1):\d+/,targetOrigin);
   headers['oai-authenticated-user-id']=USER.id;headers['oai-authenticated-user-email']=USER.email;headers['oai-authenticated-user-full-name']=encodeURIComponent(USER.name);headers['oai-authenticated-user-full-name-encoding']='percent-encoded-utf-8';
   headers['oai-authenticated-user-mode']='editable';headers['oai-authenticated-user-username']=session.username||'admin01';headers['oai-authenticated-user-path']=u.pathname;headers['oai-authenticated-user-method']=req.method;
   const up=http.request({host:'127.0.0.1',port:targetPort,method:req.method,path:req.url,headers},r=>{const out={...r.headers};if(out.location)out.location=String(out.location).replace(targetOrigin,`http://${hostOf(req)}:${port}`);res.writeHead(r.statusCode||502,out);r.pipe(res);});
   up.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain'});res.end('Payroll Workspace is starting. Refresh in a moment.');});
   req.pipe(up);
  });
  const listening=await new Promise(resolve=>{own.once('error',e=>resolve(e));own.listen(port,'127.0.0.1',()=>resolve(null));});
  if(listening)continue; // the port was taken in the meantime: try another one
  own.on('error',()=>{});
  session.port=port;windows.set(port,{server:own,session});
  return port;
 }
 throw new Error('No free port for the company window.');
}
function closeWindow(port){
 const w=windows.get(port);if(!w)return;windows.delete(port);sessions.delete(w.session.token);
 // Lets the redirect that signs the window out reach the browser, then drops what is left of its connections.
 setTimeout(()=>{try{w.server.close();w.server.closeAllConnections?.();}catch{}},500).unref();
 say(`Signed out of ${w.session.company} (${w.session.username}) on port ${port}. ${windows.size} window(s) open.`);
}

// The sign-in page (main port): only signs in; the workspace itself is served by the session's own window.
const proxy=http.createServer((req,res)=>{
 if(!loopback.has(req.socket.remoteAddress||'')){res.writeHead(403).end('Only this computer can open Payroll Workspace.');return;}
 const u=new URL(req.url||'/',url);
 if(u.pathname==='/__ping'){res.writeHead(200,{'Content-Type':'text/plain','X-Payroll-Instance':instanceId}).end('payroll-workspace');return;}
 if(u.pathname==='/__login'&&req.method==='POST'){
  const origin=req.headers.origin;if(origin!==url.slice(0,-1)&&origin!==`http://127.0.0.1:${PORT}`){json(res,403,{error:'This request could not be verified.'});return;}
  const parts=[];let size=0;let tooBig=false;
  req.on('data',c=>{size+=c.length;if(size>4096)tooBig=true;else parts.push(c);});
  req.on('end',async()=>{
   const send=(code,body,extra={})=>json(res,code,body,extra);
   if(tooBig)return send(413,{error:'Invalid request.'});
   if(Date.now()<lockedUntil){say('Sign-in refused: locked for a minute after 5 wrong attempts.');return send(429,{error:`Too many wrong attempts. Try again in ${Math.ceil((lockedUntil-Date.now())/1000)} seconds.`});}   let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(400,{error:'Invalid request.'});}
   const id=typeof body?.id==='string'?body.id.trim():'',password=typeof body?.password==='string'?body.password:'';
   // Both hashes are always compared so the answer does not show which of the two was wrong.
   let mode=loginMode(id,password),username='admin01',permissions=null;
   if(!mode&&id.toLowerCase()!=='admin01'){try{const auth=await fetch(editableOrigin+'/api/hr-login',{method:'POST',headers:{'Content-Type':'application/json',Origin:editableOrigin,'oai-authenticated-user-id':USER.id,'oai-authenticated-user-email':USER.email,'oai-authenticated-user-username':'admin01'},body:JSON.stringify({username:id,password}),signal:AbortSignal.timeout(15000)});if(auth.ok){const result=await auth.json();mode='editable';username=result.username;permissions=result.permissions;}}catch{}}
   if(!mode){say(`Sign-in refused for "${id.slice(0,40)}": wrong ID or password (${failures+1} of 5 before a 1 minute lock).`);if(++failures>=5){failures=0;lockedUntil=Date.now()+60000;}return send(401,{error:'Wrong password.'});}
   const key=typeof body?.company==='string'?body.company:'';
   let companies;try{companies=await companiesOffered(mode);}catch{return send(503,{error:'The program is still starting. Try again in a moment.'});}
   if(permissions&&!permissions.datasets.includes('*')&&!permissions.datasets.includes(key))return send(403,{error:'This company is not assigned to your account.'});
   if(!companies.some(c=>c.key===key))return send(400,{error:'Choose the company.'});
   // Location: empty = every location; otherwise it must be one of the company's locations.
   const location=typeof body?.location==='string'?body.location.trim().slice(0,80):'';
   if(location){let places;try{places=await locationsOf(key,mode);}catch{return send(503,{error:'The program is still starting. Try again in a moment.'});}if(!places.includes(location))return send(400,{error:'Choose the location.'});}
   if(windows.size>=MAX_WINDOWS)return send(429,{error:`${MAX_WINDOWS} company windows are open. Use Exit in one of them first.`});
   failures=0;const token=crypto.randomBytes(24).toString('hex');const session={token,company:key,location,mode,username,port:0};sessions.set(token,session);
   let port;try{port=await openWindow(session);}catch(e){sessions.delete(token);say('Could not open a company window: '+e.message);return send(503,{error:'A window for this company could not be opened. Try again.'});}
   say(`Signed in to ${key}${location?' / '+location:''} (${username}${mode==='editable'?', editable copy':''}) on port ${port}. ${windows.size} window(s) open.`);
   send(200,{ok:true,url:`http://${hostOf(req)}:${port}/`},{'Set-Cookie':`${SESSION_COOKIE}_${port}=${token}; HttpOnly; SameSite=Strict; Path=/`});});
  return;}
 // The sign-in page asks here whether the typed login ID exists (admin01 or an active HR user); the password box opens only then.
 if(u.pathname==='/__id'){const id=(u.searchParams.get('id')||'').trim().slice(0,40);if(loginHash(id)===LOGIN_ID_HASH){json(res,200,{ok:true});return;}if(!/^[a-zA-Z][a-zA-Z0-9_.-]{2,39}$/.test(id)||id.toLowerCase()==='admin01'){json(res,200,{ok:false});return;}fetch(editableOrigin+'/api/hr-login?username='+encodeURIComponent(id),{headers:{Origin:editableOrigin,'oai-authenticated-user-id':USER.id,'oai-authenticated-user-email':USER.email,'oai-authenticated-user-username':'admin01'},signal:AbortSignal.timeout(8000)}).then(async r=>json(res,200,{ok:r.ok&&(await r.json()).exists===true}),()=>json(res,200,{ok:false}));return;}
 // The company list is shown on the sign-in page itself (names only; this program answers this computer only).
 if(u.pathname==='/__locations'){locationsOf(u.searchParams.get('company')||'').then(l=>json(res,200,{locations:l}),()=>json(res,503,{error:'The program is still starting.'}));return;}
 if(u.pathname==='/__companies'){companiesOffered().then(c=>json(res,200,{companies:c}),()=>json(res,503,{error:'The program is still starting.'}));return;}
 if(u.pathname==='/signout-with-chatgpt'||u.pathname==='/signin-with-chatgpt'){res.writeHead(302,{Location:'/','Cache-Control':'no-store'}).end();return;}
 if(wantsPage(req,u)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(loginPage);return;}
 json(res,401,{error:'Please sign in again.'});
});
proxy.listen(PORT,'127.0.0.1',()=>{say(`Payroll Workspace is running at ${url} - keep this window open; Exit in the menu only signs out of that company window, close this window to stop the program.`);openBrowser(url);void startBiometric();});
proxy.on('error',e=>{say('Could not open port '+PORT+': '+e.message);stop(1);});

// The Biometric Attendance app (it downloads the punches from the machines and keeps them) is part of this setup
// (the "biometric" folder next to this file, run with the same bundled Node.js) and is started together with the
// workspace, so "Biometric Fetch" always finds it. Its data (punches, machines) is kept in
// %LOCALAPPDATA%\BiometricAttendance, the same folder the separate Biometric Attendance setup used, so nothing is lost.
// An older separate install is used only when this setup has no copy. Set PAYROLL_NO_BIOMETRIC=1 to leave it alone.
async function startBiometric(){
 if(process.env.PAYROLL_NO_BIOMETRIC==='1'||sourceCheckout||!process.env.LOCALAPPDATA)return;
 const own=path.join(root,'biometric');const old=path.join(process.env.LOCALAPPDATA,'Programs','BiometricAttendance');
 const bundled=fs.existsSync(path.join(own,'server.mjs'));
 const exe=bundled?process.execPath:path.join(old,'node','node.exe'),script=bundled?path.join(own,'server.mjs'):path.join(old,'app','server.mjs');
 if(!fs.existsSync(exe)||!fs.existsSync(script))return;
 try{const r=await fetch('http://127.0.0.1:5180/api/state',{signal:AbortSignal.timeout(3000)});if(r.ok){say('The Biometric Attendance app is already running.');return;}}catch{}
 if(await portInUse(5180)){say('Port 5180 is used by another program, so the Biometric Attendance app was not started.');return;}
 const out=fs.openSync(path.join(dataRoot,'logs','biometric.out.log'),'a');
 biometric=spawn(exe,['--no-warnings','server.mjs','--data='+path.join(process.env.LOCALAPPDATA,'BiometricAttendance')],{cwd:path.dirname(script),windowsHide:true,stdio:['ignore',out,out]});
 biometric.on('exit',c=>{say(`The Biometric Attendance app stopped (code ${c}).`);biometric=null;});
 say('Started the Biometric Attendance app (punches are downloaded from the machines every 15 minutes).');
}
