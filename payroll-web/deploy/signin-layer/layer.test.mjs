// Tests of the sign-in layer against a stand-in for the application.   node --test deploy/signin-layer/layer.test.mjs
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLayer,hashPassword,verifyPassword,readConfig,makeLimiter,ipBucket} from './server.mjs';

const KEY='k'.repeat(48),ADMIN_PW='correct-horse-battery',HERE=path.dirname(fileURLToPath(import.meta.url));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
let stub,stubPort,stubOrigin,seen=[],activity=[],layer,port,BASE,ORIGIN,adminHash;
// what the stand-in misbehaves with (reset after each test that sets it)
const mode={companies:'ok',masters:'ok',hrLoginDelay:0};

// ---- a stand-in for the application: it checks what the real one checks (origin, identity headers, internal key) ----
function startStub(){
 return new Promise(resolve=>{
  stub=http.createServer((req,res)=>{
   const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
    const body=Buffer.concat(chunks),url=new URL(req.url,'http://x'),send=(code,obj,extra={})=>{res.writeHead(code,{'Content-Type':'application/json',...extra});res.end(JSON.stringify(obj));};
    seen.push({method:req.method,url:req.url,headers:req.headers});
    const fromLayer=req.headers['oai-authenticated-user-id']==='local_seedy'&&req.headers['oai-authenticated-user-mode']==='editable';
    if(!fromLayer)return send(401,{error:'no identity'});
    if(url.pathname==='/api/hr-login'){
     if(req.headers.origin!==stubOrigin||req.headers['oai-authenticated-user-username']!=='admin01')return send(403,{error:'only the sign-in program'});
     if(req.method==='GET')return send(200,{exists:['bob','ann'].includes(url.searchParams.get('username'))});
     const v=JSON.parse(body.toString());
     const answer=()=>{
      if(v.username==='bob'&&v.password==='bob-pass-1')return send(200,{username:'bob',name:'Bob',role:'user',permissions:{datasets:['c1'],units:['North'],modules:{}}});
      if(v.username==='ann'&&v.password==='ann-pass-1')return send(200,{username:'ann',name:'Ann',role:'admin',permissions:{datasets:['*'],units:['*'],modules:{}}});
      return send(401,{error:'Wrong username or password.'});
     };
     return mode.hrLoginDelay?setTimeout(answer,mode.hrLoginDelay):answer();
    }
    if(url.pathname==='/api/companies'){
     if(mode.companies==='object')return send(200,{companies:{}});
     if(mode.companies==='nulls')return send(200,{companies:[null,5,{key:7},{key:'../x'},{key:'c1',label:'ONE [Alpha]',year:2026,place:'Alpha'}]});
     if(mode.companies==='badjson'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('not json {');}
     if(mode.companies==='error')return send(500,{error:'boom'});
     return send(200,{companies:[{key:'c1',label:'ONE [Alpha]',year:2026,place:'Alpha'},{key:'c2',label:'TWO [Beta]',year:2025,place:'Beta'}]});
    }
    if(url.pathname==='/api/masters'){
     if(mode.masters==='string')return send(200,{names:'x'});
     if(mode.masters==='none')return send(200,{});
     return send(200,{names:{locations:['South','North','East']}});
    }
    if(url.pathname==='/weird-status'){req.socket.write('HTTP/1.1 099 Weird\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');req.socket.end();return;}
    if(url.pathname==='/redirect-foreign')return send(302,{},{Location:'https://evil.example/x'});
    if(url.pathname==='/redirect-relative')return send(302,{},{Location:'/relative?next='+encodeURIComponent(stubOrigin+'/x')});
    if(url.pathname==='/redirect-protocol-relative')return send(302,{},{Location:'//evil.example/x'});
    if(url.pathname==='/api/activity'){
     if(req.headers['x-payroll-internal']!==KEY||req.headers.origin!==stubOrigin)return send(403,{error:'not allowed'});
     activity.push(JSON.parse(body.toString()));return send(200,{ok:true});
    }
    if(url.pathname==='/api/echo')return send(200,{method:req.method,url:req.url,headers:req.headers,body:body.toString().slice(0,200)});
    if(url.pathname==='/api/upload')return send(200,{bytes:body.length});
    if(url.pathname==='/redirect')return send(302,{},{Location:stubOrigin+'/x?y=1'});
    if(url.pathname==='/')return (res.writeHead(200,{'Content-Type':'text/html'}),res.end('<html>APP</html>'));
    send(404,{error:'nope'});
   });
  });
  stub.listen(0,'127.0.0.1',()=>{stubPort=stub.address().port;stubOrigin=`http://127.0.0.1:${stubPort}`;resolve();});
 });
}
const config=(p,extra={})=>({host:'127.0.0.1',port:p,upstream:new URL(stubOrigin),publicOrigin:`http://127.0.0.1:${p}`,adminHash,internalKey:KEY,cookieSecure:false,idleMs:7200000,absoluteMs:43200000,chooseMs:900000,trustProxy:true,maxSessions:500,...extra});
async function startLayer(extra={}){const p=await freePort(),l=createLayer(config(p,extra),()=>{});await new Promise(r=>l.server.listen(p,'127.0.0.1',r));return {layer:l,port:p};}

before(async()=>{adminHash=await hashPassword(ADMIN_PW);await startStub();({layer,port}=await startLayer());BASE=`http://127.0.0.1:${port}`;ORIGIN=BASE;});
after(async()=>{await layer.close();await new Promise(r=>{stub.close(r);stub.closeAllConnections?.();});});

async function call(path,{method='GET',headers={},body,cookie,json,origin=true,base=BASE,originValue}={}){
 const h={...headers};if(cookie)h.Cookie=cookie;
 if(origin&&!['GET','HEAD'].includes(method))h.Origin=originValue??base;
 if(json!==undefined){h['Content-Type']='application/json';body=JSON.stringify(json);}
 const r=await fetch(base+path,{method,headers:h,body,redirect:'manual'}),text=await r.text();let parsed;try{parsed=JSON.parse(text);}catch{/* not json */}
 return {status:r.status,headers:r.headers,text,json:parsed,cookies:r.headers.getSetCookie?.()||[]};
}
const cookieOf=r=>{const c=r.cookies.find(x=>x.startsWith('pw_sid='));return c?c.split(';')[0]:'';};
async function signIn(id,password,ip,base=BASE){return call('/__login',{method:'POST',json:{id,password},headers:ip?{'X-Real-IP':ip}:{},base});}
async function openAs(id,password,company='c1',location='',ip){const r=await signIn(id,password,ip);assert.equal(r.status,200,r.text);const cookie=cookieOf(r);const o=await call('/__open',{method:'POST',json:{company,location},cookie});assert.equal(o.status,200,o.text);return cookie;}

test('ping needs no session; a wrong host, a // path and unknown methods are refused',async()=>{
 assert.equal((await call('/__ping')).text,'ok');
 const raw=(path,headers,method='GET')=>new Promise(resolve=>{const q=http.request({host:'127.0.0.1',port,path,method,headers},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.end();});
 assert.equal(await raw('/__ping',{host:'evil.example'}),421);
 assert.equal(await raw('//evil.example/x',{host:`127.0.0.1:${port}`}),400);
 assert.equal(await raw('/',{host:`127.0.0.1:${port}`},'TRACE'),405);
});

test('before sign-in: the sign-in page for pages, 401 for everything else, nothing reaches the application',async()=>{
 seen.length=0;
 const p=await call('/',{headers:{Accept:'text/html'}});
 assert.equal(p.status,200);assert.match(p.text,/Payroll Workspace/);assert.match(p.headers.get('content-security-policy'),/script-src 'nonce-/);
 assert.equal(p.headers.get('cache-control'),'no-store');assert.equal(p.headers.get('x-frame-options'),'DENY');assert.equal(p.headers.get('x-content-type-options'),'nosniff');
 const deep=await call('/some/deep/link',{headers:{Accept:'text/html'}});assert.equal(deep.status,200);
 for(const path of ['/api/echo','/__companies','/__workspace','/__open','/api/hr-login?username=bob','/assets/app.js'])assert.equal((await call(path)).status,path==='/__open'?401:401,path);
 assert.equal((await call('/api/echo',{method:'POST',json:{a:1}})).status,401);
 assert.deepEqual((await call('/__session')).json,{state:'none'});
 assert.equal(seen.length,0,'nothing may reach the application before a sign-in');
});

test('wrong ID or password: one message for every kind of mistake; a wrong ID does not show up as such',async()=>{
 const msgs=new Set();
 for(const [id,pw] of [['admin01','wrong-password-12'],['nobody1','whatever-12345'],['Admin01',ADMIN_PW],['ab','x'],['bob','wrong-pass-123']]){const r=await signIn(id,pw,'10.9.0.1');assert.equal(r.status,401,id);msgs.add(r.json.error);assert.equal(cookieOf(r),'');}
 assert.deepEqual([...msgs],['Wrong ID or password.']);
});

test('admin01: cookie flags, company choice, locations, and the workspace answer',async()=>{
 const r=await signIn('admin01',ADMIN_PW,'10.9.0.2');assert.equal(r.status,200);assert.equal(r.json.role,'superadmin');
 const raw=r.cookies.find(x=>x.startsWith('pw_sid='));assert.match(raw,/^pw_sid=[A-Za-z0-9_-]{43};/);assert.match(raw,/HttpOnly/);assert.match(raw,/SameSite=Strict/);assert.match(raw,/Path=\//);assert.doesNotMatch(raw,/Domain/);
 const cookie=cookieOf(r);
 assert.deepEqual((await call('/__session',{cookie})).json,{state:'choose'});
 // not open yet: the application is closed, pages show the chooser (the sign-in page)
 assert.equal((await call('/api/echo',{cookie})).status,401);
 assert.match((await call('/',{cookie,headers:{Accept:'text/html'}})).text,/Choose the company|id="f2"/);
 assert.equal((await call('/__workspace',{cookie})).status,401);
 const list=await call('/__companies',{cookie});assert.deepEqual(list.json.companies.map(c=>c.key),['c1','c2']);
 assert.deepEqual((await call('/__locations?company=c1',{cookie})).json.locations,['East','North','South']);
 assert.deepEqual((await call('/__locations?company=zz',{cookie})).json.locations,[]);
 assert.equal((await call('/__open',{method:'POST',json:{company:'nope'},cookie})).status,403);
 assert.equal((await call('/__open',{method:'POST',json:{company:'c1'},cookie,origin:false})).status,403,'no Origin');
 assert.equal((await call('/__open',{method:'POST',json:{company:'c1'},cookie,originValue:'https://evil.example'})).status,403,'foreign Origin');
 assert.equal((await call('/__open',{method:'POST',json:{company:'c1',location:'Nowhere'},cookie})).status,400);
 assert.equal((await call('/__open',{method:'POST',json:{company:'c1',location:'North'},cookie})).status,200);
 assert.deepEqual((await call('/__workspace',{cookie})).json,{company:'c1',location:'North',mode:'editable',username:'admin01'});
 assert.equal((await call('/__open',{method:'POST',json:{company:'c2'},cookie})).status,409,'a company is already open');
});

test('the application gets the identity headers and never one a browser sent',async()=>{
 const cookie=await openAs('admin01',ADMIN_PW,'c1','','10.9.0.3');seen.length=0;
 const r=await call('/api/echo?x=1',{cookie:`a=1; pw_sid=${cookie.split('=')[1]}; b=2`,headers:{
  'oai-authenticated-user-username':'evil','oai-authenticated-user-path':'/spoof','oai-authenticated-user-mode':'original','x-payroll-internal':KEY,'X-Forwarded-For':'1.2.3.4','X-Real-IP':'9.9.9.9','Forwarded':'for=1.2.3.4','Referer':`${BASE}/page`}});
 assert.equal(r.status,200);const h=r.json.headers;
 assert.equal(h['oai-authenticated-user-id'],'local_seedy');assert.equal(h['oai-authenticated-user-username'],'admin01');assert.equal(h['oai-authenticated-user-mode'],'editable');
 assert.equal(h['oai-authenticated-user-path'],'/api/echo');assert.equal(h['oai-authenticated-user-method'],'GET');assert.equal(h['oai-authenticated-user-full-name-encoding'],'percent-encoded-utf-8');
 assert.equal(h['x-payroll-internal'],undefined);assert.equal(h['x-forwarded-for'],undefined);assert.equal(h['x-real-ip'],undefined);assert.equal(h.forwarded,undefined);
 assert.equal(h.cookie,'a=1; b=2','our session cookie is not passed on, the others are');assert.equal(h.host,`127.0.0.1:${stubPort}`);assert.equal(h.referer,`${stubOrigin}/page`);
 assert.equal(r.json.url,'/api/echo?x=1');
 const home=await call('/',{cookie,headers:{Accept:'text/html'}});assert.equal(home.status,200);assert.equal(home.text,'<html>APP</html>','the application page itself, not the sign-in page');
});

test('changing requests need the public address as Origin; the application sees its own',async()=>{
 const cookie=await openAs('admin01',ADMIN_PW,'c1','','10.9.0.4');
 assert.equal((await call('/api/echo',{method:'POST',json:{a:1},cookie,origin:false})).status,403);
 assert.equal((await call('/api/echo',{method:'POST',json:{a:1},cookie,originValue:'https://evil.example'})).status,403);
 for(const m of ['POST','PUT','PATCH','DELETE']){const r=await call('/api/echo',{method:m,json:{a:1},cookie});assert.equal(r.status,200,m);assert.equal(r.json.headers.origin,stubOrigin);assert.equal(r.json.headers['oai-authenticated-user-method'],m);}
 assert.equal((await call('/api/echo',{method:'POST',json:{hello:'world'},cookie})).json.body,'{"hello":"world"}');
});

test('a large upload passes through, and a redirect of the application points to the public address',async()=>{
 const cookie=await openAs('admin01',ADMIN_PW,'c1','','10.9.0.5');
 const big=Buffer.alloc(6*1024*1024,7);
 assert.equal((await call('/api/upload',{method:'POST',body:big,headers:{'Content-Type':'application/octet-stream'},cookie})).json.bytes,big.length);
 const r=await call('/redirect',{cookie});assert.equal(r.status,302);assert.equal(r.headers.get('location'),`${BASE}/x?y=1`);
});

test('a named login: only its companies and locations; the application sees its username',async()=>{
 const r=await signIn('bob','bob-pass-1','10.9.0.6');assert.equal(r.status,200);assert.equal(r.json.role,'user');const cookie=cookieOf(r);
 assert.deepEqual((await call('/__companies',{cookie})).json.companies.map(c=>c.key),['c1']);
 assert.equal((await call('/__open',{method:'POST',json:{company:'c2'},cookie})).status,403);
 assert.deepEqual((await call('/__locations?company=c1',{cookie})).json.locations,['North']);
 assert.deepEqual((await call('/__locations?company=c2',{cookie})).json.locations,[]);
 assert.equal((await call('/__open',{method:'POST',json:{company:'c1',location:'South'},cookie})).status,400);
 assert.equal((await call('/__open',{method:'POST',json:{company:'c1',location:'North'},cookie})).status,200);
 assert.equal((await call('/api/echo',{cookie})).json.headers['oai-authenticated-user-username'],'bob');
 const a=await signIn('ann','ann-pass-1','10.9.0.7');assert.deepEqual((await call('/__companies',{cookie:cookieOf(a)})).json.companies.map(c=>c.key),['c1','c2']);
});

test('sign-in limits: 5 wrong attempts lock that address+login; 25 lock the address; other addresses are not affected',async()=>{
 for(let i=0;i<5;i++)assert.equal((await signIn('bob','wrong-pass-'+i,'10.8.0.1')).status,401);
 const locked=await signIn('bob','bob-pass-1','10.8.0.1');assert.equal(locked.status,429);assert.match(locked.json.error,/Try again in \d+ second/);assert.ok(Number(locked.headers.get('retry-after'))>0);
 assert.equal((await signIn('bob','bob-pass-1','10.8.0.2')).status,200,'the same login from another address');
 assert.equal((await signIn('ann','ann-pass-1','10.8.0.1')).status,200,'another login from the locked address');
 for(let i=0;i<25;i++)await signIn('user'+String(i).padStart(3,'0'),'wrong-pass-123','10.8.0.3');
 assert.equal((await signIn('ann','ann-pass-1','10.8.0.3')).status,429,'25 wrong attempts lock the address');
 assert.equal((await signIn('ann','ann-pass-1','10.8.0.4')).status,200);
});

test('sign-out ends the session; sign-ins, failures and sign-outs reach the activity log (failures only for logins that exist)',async()=>{
 activity.length=0;
 const cookie=await openAs('bob','bob-pass-1','c1','North','10.7.0.1');
 await signIn('bob','nope-nope-123','10.7.0.2');await signIn('nobody2','nope-nope-123','10.7.0.2');await signIn('admin01','nope-nope-123','10.7.0.2');
 const out=await call('/signout-with-chatgpt?return_to=/',{cookie});
 assert.equal(out.status,302);assert.equal(out.headers.get('location'),'/');assert.match(out.cookies.join(' '),/pw_sid=;.*Max-Age=0/);
 assert.equal((await call('/api/echo',{cookie})).status,401,'the old cookie is dead');
 await new Promise(r=>setTimeout(r,300));
 const kinds=activity.map(a=>`${a.event}:${a.username}`);
 assert.ok(kinds.includes('login:bob'),kinds.join());assert.ok(kinds.includes('logout:bob'));assert.ok(kinds.includes('login-failed:bob'));assert.ok(kinds.includes('login-failed:admin01'));
 assert.ok(!kinds.some(k=>k.includes('nobody2')),'unknown IDs are not written to the database');
 const logout=activity.find(a=>a.event==='logout');assert.equal(logout.dataset,'c1');assert.equal(logout.internal,true);
});

test('sessions end: idle time, one new session per sign-in, at most 10 per login',async()=>{
 const {layer:short,port:p}=await startLayer({idleMs:300});const base=`http://127.0.0.1:${p}`;
 try{
  const r=await signIn('admin01',ADMIN_PW,'10.6.0.1',base);const cookie=cookieOf(r);
  assert.equal((await call('/__open',{method:'POST',json:{company:'c1'},cookie,base})).status,200);assert.equal((await call('/api/echo',{cookie,base})).status,200);
  await new Promise(x=>setTimeout(x,450));assert.equal((await call('/api/echo',{cookie,base})).status,401,'idle for too long');
 }finally{await short.close();}
 const {layer:many,port:p2}=await startLayer();const base2=`http://127.0.0.1:${p2}`;
 try{
  const first=cookieOf(await signIn('ann','ann-pass-1','10.6.0.2',base2));
  for(let i=0;i<12;i++)await signIn('ann','ann-pass-1','10.6.0.'+(10+i),base2);
  assert.equal([...many.sessions.values()].filter(s=>s.username==='ann').length,10);
  assert.equal((await call('/__session',{cookie:first,base:base2})).json.state,'none','the oldest session was dropped');
 }finally{await many.close();}
});

test('password hashes and configuration',async()=>{
 const h=await hashPassword('another-long-secret');assert.match(h,/^scrypt\$32768\$8\$1\$/);
 assert.equal(await verifyPassword('another-long-secret',h),true);assert.equal(await verifyPassword('another-long-secrex',h),false);assert.equal(await verifyPassword('x','plain'),false);assert.equal(await verifyPassword('x',''),false);
 assert.equal(await verifyPassword('x',h.replace('$32768$','$1048576$')),false,'a cost outside the allowed range is refused');
 const base={PUBLIC_ORIGIN:'https://hrm.example.com',ADMIN_PASSWORD_HASH:h};
 const c=readConfig(base);assert.equal(c.cookieSecure,true);assert.equal(c.publicOrigin,'https://hrm.example.com');assert.equal(c.port,8080);assert.equal(c.host,'127.0.0.1');
 assert.equal(readConfig({...base,PUBLIC_ORIGIN:'http://127.0.0.1:9'}).cookieSecure,false);
 assert.throws(()=>readConfig({ADMIN_PASSWORD_HASH:h}),/PUBLIC_ORIGIN/);assert.throws(()=>readConfig({...base,PUBLIC_ORIGIN:'https://hrm.example.com/app'}),/PUBLIC_ORIGIN/);
 assert.throws(()=>readConfig({PUBLIC_ORIGIN:base.PUBLIC_ORIGIN}),/ADMIN_PASSWORD_HASH/);assert.throws(()=>readConfig({...base,UPSTREAM:'https://x'}),/UPSTREAM/);assert.throws(()=>readConfig({...base,PORT:'abc'}),/PORT/);
});

test('the application is down: a clear answer, not a hang',async()=>{
 const cookie=await openAs('admin01',ADMIN_PW,'c1','','10.5.0.1');
 const dead=await freePort();
 const {layer:l2,port:p}=await (async()=>{const pp=await freePort(),ll=createLayer({...config(pp),upstream:new URL(`http://127.0.0.1:${dead}`)},()=>{});await new Promise(r=>ll.server.listen(pp,'127.0.0.1',r));return {layer:ll,port:pp};})();
 try{
  const base=`http://127.0.0.1:${p}`;const r=await signIn('bob','bob-pass-1','10.5.0.2',base);assert.equal(r.status,503);assert.match(r.json.error,/not reachable|starting/);
  const admin=await signIn('admin01',ADMIN_PW,'10.5.0.3',base);assert.equal(admin.status,200,'admin01 does not need the application to sign in');
  const c=cookieOf(admin);assert.equal((await call('/__companies',{cookie:c,base})).status,503);
 }finally{await l2.close();}
 assert.ok(cookie);
});

// ---- hardening that the independent review asked for ----

test('a malformed answer of the application never stops the layer: 503 / 502 instead of a crash',async()=>{
 const cookie=cookieOf(await signIn('admin01',ADMIN_PW,'10.4.0.1'));
 try{
  for(const m of ['object','badjson','error']){
   mode.companies=m;
   assert.equal((await call('/__companies',{cookie})).status,503,m);
   assert.equal((await call('/__open',{method:'POST',json:{company:'c1'},cookie})).status,503,m);
   assert.equal((await call('/__locations?company=c1',{cookie})).status,503,m);
  }
  mode.companies='nulls';
  assert.deepEqual((await call('/__companies',{cookie})).json.companies.map(c=>c.key),['c1'],'junk entries are dropped, the valid one stays');
  mode.companies='ok';
  for(const m of ['string','none']){
   mode.masters=m;
   assert.equal((await call('/__locations?company=c1',{cookie})).status,503,m);
   assert.equal((await call('/__open',{method:'POST',json:{company:'c1',location:'North'},cookie})).status,503,m);
  }
 }finally{mode.companies='ok';mode.masters='ok';}
 assert.equal((await call('/__ping')).text,'ok');
 assert.equal((await call('/__open',{method:'POST',json:{company:'c1'},cookie})).status,200,'the session still works afterwards');
 assert.equal((await call('/weird-status',{cookie})).status,502,'an out-of-range status code of the application');
 assert.equal((await call('/api/echo',{cookie})).status,200);
});

test('the real process survives a malformed answer of the application',async()=>{
 const p=await freePort();
 const child=spawn(process.execPath,[path.join(HERE,'server.mjs')],{env:{...process.env,PUBLIC_ORIGIN:`http://127.0.0.1:${p}`,UPSTREAM:stubOrigin,PORT:String(p),HOST:'127.0.0.1',ADMIN_PASSWORD_HASH:adminHash,PAYROLL_INTERNAL_KEY:KEY,COOKIE_SECURE:'0'},stdio:['ignore','pipe','pipe']});
 let out='';child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{out+=c;});
 try{
  const base=`http://127.0.0.1:${p}`;
  for(let i=0;i<60&&!out.includes('Sign-in layer on');i++)await new Promise(r=>setTimeout(r,100));
  const cookie=cookieOf(await signIn('admin01',ADMIN_PW,'10.0.7.1',base));
  mode.companies='object';
  assert.equal((await call('/__companies',{cookie,base})).status,503);
  assert.equal((await call('/__open',{method:'POST',json:{company:'c1'},cookie,base})).status,503);
  mode.companies='ok';
  assert.equal((await call('/__ping',{base})).text,'ok');assert.equal(child.exitCode,null,'the process is still running: '+out);
 }finally{mode.companies='ok';child.kill();}
});

test('sign-in bodies: a huge declared body is refused at once; a locked address is refused before its body is read',async()=>{
 const raw=(headers,first)=>new Promise(resolve=>{
  const q=http.request({host:'127.0.0.1',port,path:'/__login',method:'POST',headers:{host:`127.0.0.1:${port}`,...headers}},r=>{let t='';r.on('data',c=>{t+=c;});r.on('end',()=>resolve({status:r.statusCode,text:t,connection:r.headers.connection}));});
  q.on('error',()=>resolve({status:0}));q.write(first);   // the rest of the body never comes
 });
 const t0=Date.now();
 const big=await raw({'content-type':'application/json','content-length':'1000000',origin:ORIGIN,'x-real-ip':'10.3.0.1'},'{"id":');
 assert.equal(big.status,413);assert.equal(big.connection,'close');assert.ok(Date.now()-t0<2000);
 for(let i=0;i<25;i++)await signIn('lock'+String(i).padStart(3,'0'),'wrong-pass-123','10.3.0.2');
 const locked=await raw({'content-type':'application/json','content-length':'5000000',origin:ORIGIN,'x-real-ip':'10.3.0.2'},'{"id":');
 assert.equal(locked.status,429,'refused before the body');
});

test('a sign-in body that never finishes is given up after the read time',async()=>{
 const {layer:quick,port:p}=await startLayer({bodyTimeoutMs:400});
 try{
  const slow=await new Promise(resolve=>{
   const q=http.request({host:'127.0.0.1',port:p,path:'/__login',method:'POST',headers:{host:`127.0.0.1:${p}`,'content-type':'application/json','content-length':'3000',origin:`http://127.0.0.1:${p}`}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});
   q.on('error',()=>resolve(0));q.write('{"id":"bob"');
  });
  assert.ok([408,0].includes(slow),'status '+slow);
 }finally{await quick.close();}
});

test('sign-in capacity: 2 attempts at a time per address, a waiting line for bursts, admin01 and the other logins do not block each other',async()=>{
 mode.hrLoginDelay=300;
 try{
  const same=await Promise.all([1,2,3,4].map(()=>signIn('bob','bob-pass-1','10.2.0.1')));
  assert.ok(same.some(r=>r.status===429),'attempts 3 and 4 of one address at the same time are told to wait: '+same.map(r=>r.status));
  assert.ok(same.filter(r=>r.status===200).length>=1);
  const many=await Promise.all(Array.from({length:12},(_,i)=>signIn('bob','bob-pass-1','10.2.1.'+(i+1))));
  assert.deepEqual([...new Set(many.map(r=>r.status))],[200],'twelve addresses at once all get through');
 }finally{mode.hrLoginDelay=0;}
 const flood=Array.from({length:24},(_,i)=>signIn('admin01','wrong-password-'+i,'10.2.2.'+(i+1)));   // every guess costs a scrypt
 await new Promise(r=>setTimeout(r,100));
 const t0=Date.now(),named=await signIn('ann','ann-pass-1','10.2.3.1');
 assert.equal(named.status,200);assert.ok(Date.now()-t0<2500,'a named login took '+(Date.now()-t0)+' ms during the flood');
 const done=await Promise.all(flood);assert.ok(done.every(r=>[401,503].includes(r.status)),done.map(r=>r.status).join());
});

test('the limiter never drops a lock to make room, stays bounded, and IPv6 addresses count as their /64',()=>{
 const l=makeLimiter({maxEntries:100});
 for(let i=0;i<5;i++)l.fail('9.9.9.9','9.9.9.9|bob');
 assert.ok(l.check('9.9.9.9','9.9.9.9|bob')>0);
 for(let i=0;i<3000;i++)l.fail('8.8.'+(i>>8)+'.'+(i&255),'8.8.'+(i>>8)+'.'+(i&255)+'|x'+i);
 assert.ok(l.check('9.9.9.9','9.9.9.9|bob')>0,'the lock survived the flood');
 assert.ok(l.size()<=2*150+5,'size '+l.size());
 assert.equal(ipBucket('1.2.3.4'),'1.2.3.4');
 assert.equal(ipBucket('2001:db8:1:2:3:4:5:6'),'2001:db8:1:2::/64');
 assert.equal(ipBucket('2001:DB8:1:2:ffff:ffff:ffff:ffff'),ipBucket('2001:db8:1:2::1'));
 assert.equal(ipBucket('2001:db8::1'),'2001:db8:0:0::/64');assert.equal(ipBucket('::1'),'0:0:0:0::/64');assert.equal(ipBucket('fe80::1%eth0'),'fe80:0:0:0::/64');
 for(const odd of ['1:2:3','::::','1:2:3:4:5:6:7:8:9','zz::1','1::2::3'])assert.equal(ipBucket(odd),odd);
});

test('the activity log keeps real sign-ins and sign-outs when wrong guesses flood it',async()=>{
 activity.length=0;
 await Promise.all(Array.from({length:45},(_,i)=>signIn('bob','nope-nope-'+i,'10.1.0.'+(i+1))));
 const real=await openAs('ann','ann-pass-1','c1','','10.1.1.1');await call('/signout-with-chatgpt',{cookie:real});
 await new Promise(r=>setTimeout(r,500));
 const kinds=activity.map(a=>`${a.event}:${a.username}`);
 assert.ok(kinds.filter(k=>k==='login-failed:bob').length<=30,'failed attempts have a budget of their own');
 assert.ok(kinds.includes('login:ann')&&kinds.includes('logout:ann'),kinds.slice(-6).join());
});

test('the path in the identity header and the path forwarded are the same normalized string; backslashes are refused',async()=>{
 const cookie=await openAs('admin01',ADMIN_PW,'c1','','10.0.9.1');
 const raw=target=>new Promise(resolve=>{const q=http.request({host:'127.0.0.1',port,path:target,method:'GET',headers:{host:`127.0.0.1:${port}`,cookie}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',()=>resolve(0));q.end();});
 assert.equal(await raw('/\\evil.example/api/echo'),400);assert.equal(await raw('/\\x/__session'),400);assert.equal(await raw('/api/echo?x=\\y'),400);
 for(const [asked,url,header] of [['/api/%2e%2e/api/echo','/api/echo','/api/echo'],['/api/./echo?x=1','/api/echo?x=1','/api/echo'],['/a/./b/../c?q=a%20b&r=%27','/a/c?q=a%20b&r=%27','/a/c']]){
  seen.length=0;await raw(asked);
  const last=seen.at(-1);assert.ok(last,asked);assert.equal(last.url,url,asked);assert.equal(last.headers['oai-authenticated-user-path'],header,asked);
 }
});

test('a foreign Origin is refused on every method; redirects of the application stay on this site',async()=>{
 const cookie=await openAs('admin01',ADMIN_PW,'c1','','10.0.8.1');
 assert.equal((await call('/api/echo',{cookie,headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await call('/api/echo',{cookie,headers:{Origin:BASE}})).status,200);
 assert.equal((await call('/api/echo',{cookie})).status,200);
 const where=async p=>(await call(p,{cookie})).headers.get('location');
 assert.equal(await where('/redirect'),`${BASE}/x?y=1`);
 assert.equal(await where('/redirect-foreign'),'/');
 assert.equal(await where('/redirect-protocol-relative'),'/');
 assert.equal(await where('/redirect-relative'),'/relative?next='+encodeURIComponent(stubOrigin+'/x'));
});

test('make-admin-hash writes only the hash: new file, an old line replaced, other lines kept, short passwords refused',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'layer-hash-')),file=path.join(dir,'layer.env');
 const run=(args,input)=>new Promise(resolve=>{const c=spawn(process.execPath,[path.join(HERE,'make-admin-hash.mjs'),...args],{stdio:['pipe','pipe','pipe']});let o='',e='';c.stdout.on('data',d=>{o+=d;});c.stderr.on('data',d=>{e+=d;});c.on('close',code=>resolve({code,o,e}));c.stdin.end(input);});
 try{
  const first=await run(['--write-to',file],'a-long-secret-12345\n');assert.equal(first.code,0,first.e);
  assert.ok(!first.o.includes('a-long-secret-12345')&&!first.o.includes('scrypt$'),'neither the password nor the hash is shown');
  let text=fs.readFileSync(file,'utf8');assert.match(text,/^ADMIN_PASSWORD_HASH=scrypt\$32768\$8\$1\$/m);assert.ok(!text.includes('a-long-secret-12345'));
  assert.equal(await verifyPassword('a-long-secret-12345',/^ADMIN_PASSWORD_HASH=(.*)$/m.exec(text)[1]),true);
  fs.writeFileSync(file,'PORT=8080\nADMIN_PASSWORD_HASH=old\nHOST=127.0.0.1\n');
  const second=await run(['--write-to',file],'another-secret-67890\n');assert.equal(second.code,0,second.e);
  text=fs.readFileSync(file,'utf8');assert.match(text,/^PORT=8080\n/);assert.match(text,/HOST=127\.0\.0\.1\n$/);assert.equal((text.match(/ADMIN_PASSWORD_HASH=/g)||[]).length,1);
  assert.equal(await verifyPassword('another-secret-67890',/^ADMIN_PASSWORD_HASH=(.*)$/m.exec(text)[1]),true);
  assert.equal((await run(['--write-to',file],'short\n')).code,1);
  assert.equal(fs.readFileSync(file,'utf8'),text,'a refused password leaves the file alone');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('the application can be reached over a unix socket (a named pipe on Windows) - for hosts that do not allow TCP between processes',async()=>{
 const sock=process.platform==='win32'?`\\\\.\\pipe\\layer-test-${process.pid}-${Date.now()}`:path.join(os.tmpdir(),`layer-test-${process.pid}-${Date.now()}.sock`);
 const seenHere=[];
 const app=http.createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const u=new URL(req.url,'http://x');seenHere.push({url:req.url,headers:req.headers});
   const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
   if(u.pathname==='/api/companies')return send(200,{companies:[{key:'c1',label:'ONE',year:2026,place:'A'}]});
   if(u.pathname==='/api/masters')return send(200,{names:{locations:['A']}});
   if(u.pathname==='/api/echo')return send(200,{headers:req.headers,body:Buffer.concat(chunks).toString()});
   if(u.pathname==='/api/activity')return send(200,{ok:true});
   send(404,{});
  });
 });
 await new Promise(r=>app.listen(sock,r));
 const {layer:viaSocket,port:p}=await startLayer({upstream:new URL('http://app.local'),upstreamSocket:sock});const base=`http://127.0.0.1:${p}`;
 try{
  const cookie=cookieOf(await signIn('admin01',ADMIN_PW,'10.0.6.1',base));
  assert.deepEqual((await call('/__companies',{cookie,base})).json.companies.map(c=>c.key),['c1']);
  assert.equal((await call('/__open',{method:'POST',json:{company:'c1'},cookie,base})).status,200);
  const r=await call('/api/echo',{method:'POST',json:{hello:1},cookie,base});
  assert.equal(r.status,200);assert.equal(r.json.headers['oai-authenticated-user-username'],'admin01');assert.equal(r.json.headers.host,'app.local');assert.equal(r.json.headers.origin,'http://app.local');assert.equal(r.json.body,'{"hello":1}');
  assert.equal(r.headers.get('cache-control'),'no-store','a response without cache rules is never cached');assert.equal(r.headers.get('x-litespeed-cache-control'),'no-cache');
 }finally{await viaSocket.close();await new Promise(r=>{app.close(r);app.closeAllConnections?.();});}
 assert.ok(seenHere.length>=3);
});

test('UPSTREAM=unix:<path> is read by the configuration',()=>{
 const h='scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$'+'A'.repeat(86);
 const c=readConfig({PUBLIC_ORIGIN:'https://hrm.example.com',ADMIN_PASSWORD_HASH:h,UPSTREAM:'unix:/tmp/app.sock'});
 assert.equal(c.upstreamSocket,'/tmp/app.sock');assert.equal(c.upstream.host,'app.local');
 assert.equal(readConfig({PUBLIC_ORIGIN:'https://hrm.example.com',ADMIN_PASSWORD_HASH:h}).upstreamSocket,'');
});