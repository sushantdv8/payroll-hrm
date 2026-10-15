// Tests of the office link: the server side (link.mjs, also inside the sign-in layer) and the Server Link of the office computer (biometric-web/link/server-link.mjs).
//   node --test deploy/signin-layer/link.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import {createLink,allowedRequest,relayFetch,LinkError} from './link.mjs';
import {createLayer,hashPassword,makeLimiter,ipBucket} from './server.mjs';
import {allowedRequest as agentAllowed,startLink,checkKey,cleanServer,cleanKey,cleanApp,parseArgs,askHidden} from '../../../biometric-web/link/server-link.mjs';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const KEY='A1b2C3d4'.repeat(6),H={Authorization:'Bearer '+KEY};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(25);}return false;};
const listen=(srv,host='127.0.0.1')=>new Promise(r=>srv.listen(0,host,()=>r(`http://${host}:${srv.address().port}`)));
const closeServer=srv=>new Promise(r=>{srv.closeAllConnections?.();srv.close(r);});
// a request with a header fetch() will not let us set (Host)
const rawStatus=(base,path,headers)=>new Promise((resolve,reject)=>{const u=new URL(base);const q=http.request({host:u.hostname,port:u.port,path,headers},res=>{res.resume();resolve(res.statusCode);});q.on('error',reject);q.end();});

// a link server on its own (the same routes the layer gives it), with a clock the test can move
async function rig(opts={}){
 const clock={t:1_000_000};
 const link=createLink({key:KEY,limiter:makeLimiter(),ipBucket,now:()=>clock.t,pollMs:300,onlineMs:5000,...opts});
 const srv=http.createServer((req,res)=>link.route(req,res,new URL(req.url,'http://x'),req.headers['x-test-ip']||opts.ip||'10.0.0.1'));   // x-test-ip: another address for one call
 const base=await listen(srv);
 return {link,base,clock,close:async()=>{link.close();await closeServer(srv);}};
}
const reply=(base,id,{status=200,type='application/json',body='{}',gz=true,headers={}}={})=>fetch(`${base}/__link/reply/${id}`,{method:'POST',headers:{...H,...(gz?{'Content-Encoding':'gzip'}:{}),'X-Link-Status':String(status),'X-Link-Type':type,...headers},body:gz?zlib.gzipSync(body):body});
// the office computer's poll, answered by hand: waits for one job
const takeJob=async base=>{const r=await fetch(base+'/__link/next',{headers:H});assert.equal(r.status,200);return r.json();};

test('the requests the server may send to the office are the same list in the server and in the Server Link',()=>{
 const vectors=[
  ['GET','/api/state',null,true],['GET','/api/export/logs?from=2026-08-01&to=2026-08-31',null,true],['GET','/api/export/logs?from=2026-02-29&to=2026-03-31',null,false],
  ['GET','/api/export/logs?from=2026-13-01&to=2026-08-31',null,false],
  ['GET','/api/export/logs?from=2026-08-01&to=2026-10-10',null,true],['GET','/api/export/logs?from=2026-08-01&to=2026-10-11',null,false],['GET','/api/export/logs?from=2026-08-01&to=2026-08-01',null,true],   // 70 days at most
  ['GET','/api/export/logs?from=2026-08-31&to=2026-08-01',null,false],['GET','/api/export/logs?from=0100-01-01&to=9999-12-31',null,false],['GET','/api/export/logs?from=2026-08-01&to=2026-08-31',Buffer.from('x'),false],['GET','/api/export/logs?from=2026-08-01&to=2026-08-31&q=x',null,false],['GET','/api/export/logs?to=2026-08-31&from=2026-08-01',null,false],
  ['GET','/api/export/users',null,false],['GET','/api/export/daily?from=2026-08-01&to=2026-08-31',null,false],['GET','/api/logs',null,false],['GET','/',null,false],['GET','/api/state/../devices',null,false],
  ['GET','http://evil.example/api/state',null,false],['GET','//evil.example/api/state',null,false],['GET','/api/state',Buffer.from('x'),false],
  ['POST','/api/devices/3/download',null,true],['POST','/api/devices/0/download',null,false],['POST','/api/devices/03/download',null,false],['POST','/api/devices/3/test',null,false],['POST','/api/devices',Buffer.from('{}'),false],
  ['POST','/api/download-all',null,false],['DELETE','/api/devices/3',null,false],['PUT','/api/devices/3',Buffer.from('{}'),false],
  ['PUT','/api/settings',Buffer.from('{"autoMinutes":15}'),true],['PUT','/api/settings',Buffer.from('{"autoMinutes":0}'),true],['PUT','/api/settings',Buffer.from('{"autoMinutes":7}'),false],
  ['PUT','/api/settings',Buffer.from('{"autoMinutes":15,"x":1}'),false],['PUT','/api/settings',Buffer.from('[15]'),false],['PUT','/api/settings',Buffer.from('nope'),false],['PUT','/api/settings',null,false],
  ['get','/api/state',null,false],[undefined,'/api/state',null,false],['GET',undefined,null,false],
 ];
 for(const [m,p,b,want] of vectors){assert.equal(allowedRequest(m,p,b),want,`server: ${m} ${p}`);assert.equal(agentAllowed(m,p,b),want,`Server Link: ${m} ${p}`);}
});

test('the settings of the Server Link are checked: a server address has no path, a key has the right alphabet',()=>{
 assert.equal(cleanServer('https://hrm.example.com'),'https://hrm.example.com');assert.equal(cleanServer(' https://hrm.example.com/ '),'https://hrm.example.com');assert.equal(cleanServer('http://127.0.0.1:8080'),'http://127.0.0.1:8080');
 for(const bad of ['hrm.example.com','ftp://x.com','https://x.com/path','https://x.com/?a=1','https://user:pw@x.com','','javascript:alert(1)','http://hrm.example.com','http://192.168.11.5:8080'])assert.equal(cleanServer(bad),null,bad);   // the key must not travel in clear text over a network
 assert.equal(cleanKey(KEY),KEY);assert.equal(cleanKey('short'),null);assert.equal(cleanKey('a'.repeat(129)),null);assert.equal(cleanKey('a'.repeat(40)+' !'),null);
});

test('every call needs the key: no key, a wrong key, a browser (Origin) and the lock after many wrong keys',async()=>{
 const r=await rig();
 try{
  assert.equal((await fetch(r.base+'/__link/hello')).status,401);
  assert.equal((await fetch(r.base+'/__link/hello',{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(r.base+'/__link/hello',{headers:{Authorization:'Basic '+KEY}})).status,401);
  assert.equal((await fetch(r.base+'/__link/hello',{headers:{Authorization:'Bearer '+KEY+'x'}})).status,401);
  const body=await (await fetch(r.base+'/__link/hello',{headers:{Authorization:'Bearer wrong'}})).json();assert.deepEqual(body,{error:'Not allowed.'},'the refusal says nothing about why');
  assert.equal((await fetch(r.base+'/__link/hello',{headers:{...H,Origin:'https://evil.example'}})).status,403,'a browser is refused even with the key');
  const ok=await fetch(r.base+'/__link/hello',{headers:H});assert.equal(ok.status,200);assert.equal((await ok.json()).ok,true);
  assert.equal(r.link.online(),true,'a call with the key makes the office computer "online"');
  // a path that does not exist is refused only after the key was checked
  assert.equal((await fetch(r.base+'/__link/nothing',{headers:{Authorization:'Bearer wrong'}})).status,401);assert.equal((await fetch(r.base+'/__link/nothing',{headers:H})).status,404);
  assert.equal((await fetch(r.base+'/__link/next',{method:'POST',headers:H})).status,404,'wrong method');
 }finally{await r.close();}
 const s=await rig();let last=0;
 try{for(let i=0;i<40&&last!==429;i++)last=(await fetch(s.base+'/__link/hello',{headers:{Authorization:'Bearer wrong-'+i}})).status;
  assert.equal(last,429,'the address is locked after many wrong keys');assert.equal((await fetch(s.base+'/__link/hello',{headers:{Authorization:'Bearer wrong-again'}})).status,429,'wrong keys stay locked out');
  assert.equal((await fetch(s.base+'/__link/hello',{headers:H})).status,200,'the right key is never held back by wrong keys from the same address (a shared address cannot lock the office out)');
 }finally{await s.close();}
});

test('a request travels: the application calls, the office computer takes it, answers (gzip) and the call gets the answer',async()=>{
 const r=await rig();
 try{
  const waiting=fetch(r.base+'/__link/next',{headers:{...H,'X-Link-Agent':'Server Link 1.0 on TESTPC'}});await sleep(50);          // the office computer waits
  const call=r.link.call({method:'GET',path:'/api/export/logs?from=2026-08-01&to=2026-08-02'});
  const got=await waiting;assert.equal(got.status,200);const job=await got.json();
  assert.equal(job.method,'GET');assert.equal(job.path,'/api/export/logs?from=2026-08-01&to=2026-08-02');assert.equal(job.body,null);assert.match(job.id,/^[0-9a-f]{32}$/);
  assert.equal(r.link.status().agent,'Server Link 1.0 on TESTPC');
  const csv='﻿User ID,Name,Date Time,Machine,Verify Mode,Punch\r\n7,Ann,2026-08-01 09:00:00,KE1,Fingerprint,Check-In\r\n';
  assert.equal((await reply(r.base,job.id,{type:'text/csv; charset=utf-8',body:csv})).status,200);
  const out=await call;assert.equal(out.status,200);assert.equal(out.type,'text/csv');assert.equal(out.body.toString('utf8'),csv);
  // a request that was queued before the office computer asked is handed over at once
  const call2=r.link.call({method:'PUT',path:'/api/settings',body:'{"autoMinutes":30}'});
  const job2=await takeJob(r.base);assert.equal(job2.method,'PUT');assert.equal(Buffer.from(job2.body,'base64').toString(),'{"autoMinutes":30}');
  await reply(r.base,job2.id,{body:'{"ok":true}',gz:false});assert.deepEqual(JSON.parse((await call2).body),{ok:true});
  // an error of the office app comes through with its status and text; an unknown content type is not passed on
  const call3=r.link.call({method:'GET',path:'/api/state'});const job3=await takeJob(r.base);
  await reply(r.base,job3.id,{status:502,type:'text/html',body:'{"error":"The Biometric Attendance app is not running"}'});
  const out3=await call3;assert.equal(out3.status,502);assert.equal(out3.type,'application/octet-stream');assert.match(out3.body.toString(),/not running/);
 }finally{await r.close();}
});

test('the office computer is "online" only while it keeps calling; a call while it is away fails with a clear message',async()=>{
 const r=await rig();
 try{
  await assert.rejects(r.link.call({method:'GET',path:'/api/state'}),e=>e instanceof LinkError&&e.status===503&&/not connected/.test(e.message));
  assert.equal(r.link.status().online,false);
  await fetch(r.base+'/__link/hello',{headers:H});assert.equal(r.link.status().online,true);
  r.clock.t+=4000;assert.equal(r.link.online(),true);r.clock.t+=2000;assert.equal(r.link.online(),false,'60 seconds in production, 5 in this test');
  await assert.rejects(r.link.call({method:'GET',path:'/api/state'}),e=>e.status===503);
 }finally{await r.close();}
});

test('requests that are not answered fail in time, and a late answer is dropped',async()=>{
 const r=await rig();
 try{
  await fetch(r.base+'/__link/hello',{headers:H});
  await assert.rejects(r.link.call({method:'GET',path:'/api/state',timeoutMs:150}),e=>e.status===504&&/did not pick up/.test(e.message));   // nobody asked for it
  const call=r.link.call({method:'GET',path:'/api/state',timeoutMs:200});const caught=call.catch(e=>e);
  const job=await takeJob(r.base);                                                                                                     // taken, but never answered
  const err=await caught;assert.equal(err.status,504);assert.match(err.message,/did not answer in time/);
  assert.equal((await reply(r.base,job.id)).status,404,'the answer came too late');
  const call2=r.link.call({method:'GET',path:'/api/state'});const job2=await takeJob(r.base);
  assert.equal((await reply(r.base,job2.id,{body:'{"a":1}'})).status,200);await call2;assert.equal((await reply(r.base,job2.id)).status,404,'one answer per request');
  assert.equal((await reply(r.base,'0'.repeat(32))).status,404,'an unknown id');assert.equal((await reply(r.base,'../etc')).status,404);
  const abort=new AbortController();const call3=r.link.call({method:'GET',path:'/api/state',signal:abort.signal}).catch(e=>e);abort.abort();assert.equal((await call3).status,499);
 }finally{await r.close();}
});

test("the application's fetch of the relay address: answers come back as responses, failures as answers with the reason, and a caller that gives up gets an abort",async()=>{
 const r=await rig();
 try{
  const rf=(path,init)=>relayFetch(r.link,new URL('http://relay.local'+path),init);
  assert.equal((await relayFetch(null,new URL('http://relay.local/api/state'))).status,503,'no office link on this server');
  assert.equal((await (await rf('/__status')).json()).online,false);
  let res=await rf('/api/state');assert.equal(res.status,503);assert.match((await res.json()).error,/not connected/,'away: an answer with the reason, not an exception');
  await fetch(r.base+'/__link/hello',{headers:H});assert.equal((await (await rf('/__status')).json()).online,true);
  const call=rf('/api/state');const job=await takeJob(r.base);await reply(r.base,job.id,{body:'{"devices":[],"totals":{}}'});
  res=await call;assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'application/json');assert.deepEqual(await res.json(),{devices:[],totals:{}});
  const put=rf('/api/settings',{method:'put',body:new Blob(['{"autoMinutes":15}'])});const job2=await takeJob(r.base);                // a body that is not a string is carried as bytes
  assert.equal(job2.method,'PUT');assert.equal(Buffer.from(job2.body,'base64').toString(),'{"autoMinutes":15}');await reply(r.base,job2.id,{body:'{"ok":true}'});assert.equal((await put).status,200);
  res=await rf('/api/devices');assert.equal(res.status,400);assert.match((await res.json()).error,/cannot be sent/,'a request that is not on the list is an answer too');
  const hurt=rf('/api/state');const job3=await takeJob(r.base);await reply(r.base,job3.id,{status:502,body:'{"error":"The Biometric Attendance app is not running at http://127.0.0.1:5180."}'});
  res=await hurt;assert.equal(res.status,502);assert.match((await res.json()).error,/not running/,"the office app's own error text is passed on");
  const slow=rf('/api/state',{signal:AbortSignal.timeout(150)});await takeJob(r.base);                                              // taken, never answered: the caller's time runs out first
  await assert.rejects(slow,e=>e.name==='TimeoutError','like fetch: a timeout is a TimeoutError, so the screen can say "did not answer in time"');
  const gone=new AbortController();gone.abort();await assert.rejects(rf('/api/state',{signal:gone.signal}),e=>e.name==='AbortError');
 }finally{await r.close();}
});

test('a reply is checked: status, size, gzip bombs; and only the four requests are ever queued, at most a few at once',async()=>{
 const r=await rig({maxReply:2000,maxOut:5000,maxQueue:3});
 try{
  await fetch(r.base+'/__link/hello',{headers:H});
  const c1=r.link.call({method:'GET',path:'/api/state',timeoutMs:500}).catch(e=>e);const j1=await takeJob(r.base);
  assert.equal((await reply(r.base,j1.id,{status:'abc'})).status,400);assert.equal((await reply(r.base,j1.id,{status:99})).status,400,'a status outside 200-599');assert.equal((await reply(r.base,j1.id,{status:101})).status,400,'an informational status is not an answer');
  assert.equal((await reply(r.base,j1.id,{body:'x'.repeat(3000),gz:false})).status,413,'too large');
  assert.equal((await reply(r.base,j1.id,{body:'0'.repeat(200000)})).status,400,'a gzip bomb: 200000 bytes in 2000 of gzip is refused by maxOut');
  assert.equal((await reply(r.base,j1.id,{body:'not gzip',gz:false,headers:{'Content-Encoding':'gzip'}})).status,400);
  await c1;
  for(const [m,p] of [['DELETE','/api/devices/1'],['GET','/api/devices'],['POST','/api/devices/1/test'],['GET','/etc/passwd'],['GET','http://evil.example/']])await assert.rejects(r.link.call({method:m,path:p}),e=>e instanceof LinkError&&e.status===400,`${m} ${p}`);
  const many=[1,2,3].map(()=>r.link.call({method:'GET',path:'/api/state',timeoutMs:400}).catch(e=>e));
  await assert.rejects(r.link.call({method:'GET',path:'/api/state'}),e=>e.status===503&&/too many/.test(e.message),'a full queue');
  await Promise.all(many);
 }finally{await r.close();}
});

test('one answer at a time per request (nothing is read for the others); a login that keeps asking cannot fill the queue',async()=>{
 const r=await rig();
 try{
  await fetch(r.base+'/__link/hello',{headers:H});
  // an answer is being received slowly: a second answer to the same request is refused at once, the first one still counts
  const call=r.link.call({method:'GET',path:'/api/state'});const job=await takeJob(r.base);const u=new URL(r.base);
  const slow=http.request({host:u.hostname,port:u.port,path:'/__link/reply/'+job.id,method:'POST',headers:{...H,'X-Link-Status':'200','X-Link-Type':'application/json','Content-Length':'10'}});
  const slowDone=new Promise((resolve,reject)=>{slow.on('response',res=>{res.resume();resolve(res.statusCode);});slow.on('error',reject);});
  slow.write('{"a"');await sleep(100);
  assert.equal((await reply(r.base,job.id,{body:'{"b":2}',gz:false})).status,404,'a second answer while the first is arriving');
  slow.end(':1234}');assert.equal(await slowDone,200);assert.deepEqual(JSON.parse((await call).body),{a:1234});
  // a failed answer does not use the request up: a good one can still follow
  const call2=r.link.call({method:'GET',path:'/api/state'});const job2=await takeJob(r.base);
  assert.equal((await reply(r.base,job2.id,{body:'not gzip',gz:false,headers:{'Content-Encoding':'gzip'}})).status,400);
  assert.equal((await reply(r.base,job2.id,{body:'{"ok":1}'})).status,200);assert.deepEqual(JSON.parse((await call2).body),{ok:1});
  // at most 4 machine lists, 3 punch exports, 2 settings and 1 download per machine wait at the same time; the others are told to try again
  const states=[1,2,3,4].map(()=>r.link.call({method:'GET',path:'/api/state',timeoutMs:300}).catch(e=>e));
  await assert.rejects(r.link.call({method:'GET',path:'/api/state'}),e=>e.status===503&&/already working/.test(e.message),'a fifth machine list');
  const logs=[1,2,3].map(i=>r.link.call({method:'GET',path:`/api/export/logs?from=2026-08-0${i}&to=2026-08-31`,timeoutMs:300}).catch(e=>e));
  await assert.rejects(r.link.call({method:'GET',path:'/api/export/logs?from=2026-08-09&to=2026-08-31'}),e=>e.status===503,'a fourth export');
  const d3=r.link.call({method:'POST',path:'/api/devices/3/download',timeoutMs:300}).catch(e=>e);
  await assert.rejects(r.link.call({method:'POST',path:'/api/devices/3/download'}),e=>e.status===503,'the same machine twice');
  const d4=r.link.call({method:'POST',path:'/api/devices/4/download',timeoutMs:300}).catch(e=>e);   // another machine is fine
  await Promise.all([...states,...logs,d3,d4]);
 }finally{await r.close();}
});

test('the log says who the office computer is, and shows a return or another address that uses the key',async()=>{
 const logs=[];const r=await rig({log:m=>logs.push(m)});
 try{
  await fetch(r.base+'/__link/hello',{headers:{...H,'X-Link-Agent':'Server Link 1.0 on OFFICE-PC'}});
  assert.ok(logs.some(l=>/connected from 10\.0\.0\.1 \(Server Link 1\.0 on OFFICE-PC\)/.test(l)),JSON.stringify(logs));
  const n=logs.length;await fetch(r.base+'/__link/hello',{headers:H});assert.equal(logs.length,n,'the same computer calling again is not logged');
  r.clock.t+=6000;await fetch(r.base+'/__link/hello',{headers:H});assert.ok(/back from 10\.0\.0\.1/.test(logs.at(-1)),'after a pause: back');
  r.clock.t+=6000;await fetch(r.base+'/__link/hello',{headers:{...H,'X-Test-Ip':'203.0.113.9','X-Link-Agent':'Server Link 1.0 on OTHER-PC'}});
  assert.ok(/now connected from 203\.0\.113\.9 \(Server Link 1\.0 on OTHER-PC\) - before: 10\.0\.0\.1 \(Server Link 1\.0 on OFFICE-PC\)/.test(logs.at(-1)),'a copy of the key used from another address shows: '+logs.at(-1));
  assert.ok(!logs.some(l=>l.includes(KEY)),'the key is never logged');
 }finally{await r.close();}
});

test('a call that is turned away is remembered for the screen (who, from where, how long a key) until a good call comes; the key itself is never logged',async()=>{
 const logs=[];const r=await rig({log:m=>logs.push(m)});
 try{
  assert.equal(r.link.status().turnedAway,null);
  const sent='x'.repeat(42);
  await fetch(r.base+'/__link/hello',{headers:{Authorization:'Bearer '+sent,'X-Link-Agent':'Server Link 1.1 on OFFICE-PC','X-Test-Ip':'203.0.113.7'}});
  const t=r.link.status().turnedAway;assert.deepEqual({ip:t.ip,agent:t.agent,keyLength:t.keyLength,secondsAgo:t.secondsAgo},{ip:'203.0.113.7',agent:'Server Link 1.1 on OFFICE-PC',keyLength:42,secondsAgo:0});
  assert.ok(logs.some(l=>/a call from 203\.0\.113\.7 \(Server Link 1\.1 on OFFICE-PC\) was turned away: a wrong key \(42 characters\)/.test(l)),JSON.stringify(logs));
  assert.ok(!logs.some(l=>l.includes(sent)),'the key that was sent is not logged');
  await fetch(r.base+'/__link/hello');assert.equal(r.link.status().turnedAway.keyLength,0,'no key at all is remembered as length 0');assert.ok(logs.some(l=>/a call from 10\.0\.0\.1 was turned away: no key/.test(l)));
  r.clock.t+=3600001;assert.equal(r.link.status().turnedAway,null,'after an hour it is forgotten');
  await fetch(r.base+'/__link/hello',{headers:{Authorization:'Bearer '+'y'.repeat(30)}});assert.ok(r.link.status().turnedAway);
  await fetch(r.base+'/__link/hello',{headers:H});assert.equal(r.link.status().turnedAway,null,'a good call clears it');
  // a locked address (many wrong keys) is still remembered, so the screen shows the latest try
  for(let i=0;i<40;i++)await fetch(r.base+'/__link/hello',{headers:{Authorization:'Bearer wrong-'+i+'z'.repeat(20)}});
  assert.ok(r.link.status().turnedAway&&r.link.status().turnedAway.secondsAgo===0);
 }finally{await r.close();}
});

test('a poll with no work answers 204 after a while; a newer poll takes over from an older one',async()=>{
 const r=await rig();
 try{
  const t0=Date.now();const quiet=await fetch(r.base+'/__link/next',{headers:H});assert.equal(quiet.status,204);assert.ok(Date.now()-t0>=250,'it waited');
  const first=fetch(r.base+'/__link/next',{headers:H});await sleep(60);const second=fetch(r.base+'/__link/next',{headers:H});
  assert.equal((await first).status,204,'the older poll is ended at once');await sleep(40);
  const call=r.link.call({method:'GET',path:'/api/state'});const got=await second;assert.equal(got.status,200);const job=await got.json();await reply(r.base,job.id);await call;
  // a poll that was dropped by the office computer does not hold a request
  const ac=new AbortController();const dropped=fetch(r.base+'/__link/next',{headers:H,signal:ac.signal}).catch(()=>null);await sleep(60);ac.abort();await dropped;await sleep(60);
  const call2=r.link.call({method:'GET',path:'/api/state',timeoutMs:300}).catch(e=>e);const job2=await takeJob(r.base);await reply(r.base,job2.id);assert.equal((await call2).status,200);
 }finally{await r.close();}
});

// ---- inside the sign-in layer: the link has no cookie but its own key; everything else still needs a login ----
test('in the layer /__link needs the key, never reaches the application, and the application is still closed without a login',async()=>{
 const seen=[];const stub=http.createServer((req,res)=>{seen.push(req.url);res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});const stubBase=await listen(stub);
 const adminHash=await hashPassword('correct-horse-battery');
 const start=async extra=>{const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const layer=createLayer({host:'127.0.0.1',port,upstream:new URL(stubBase),publicOrigin:`http://127.0.0.1:${port}`,adminHash,internalKey:'',cookieSecure:false,idleMs:7200000,absoluteMs:43200000,chooseMs:900000,trustProxy:true,maxSessions:50,...extra},()=>{});
  await new Promise(r=>layer.server.listen(port,'127.0.0.1',r));return {layer,base:`http://127.0.0.1:${port}`};};
 const on=await start({linkKey:KEY}),off=await start({});
 try{
  assert.equal((await fetch(on.base+'/__link/hello')).status,401);assert.equal((await fetch(on.base+'/__link/hello',{headers:H})).status,200);
  assert.equal((await fetch(on.base+'/__link/hello',{headers:H,method:'POST'})).status,404);
  assert.equal((await fetch(off.base+'/__link/hello',{headers:H})).status,404,'no BIOMETRIC_LINK_KEY: the link does not exist');
  assert.equal((await fetch(on.base+'/api/records?dataset=x')).status,401);assert.equal((await fetch(on.base+'/__companies')).status,401);
  assert.equal(await rawStatus(on.base,'/__link/hello',{...H,Host:'evil.example'}),421,'only the public host name');
  assert.deepEqual(seen,[],'nothing reached the application');
  // the call of the application goes through layer.link
  const wait=fetch(on.base+'/__link/next',{headers:H});await sleep(50);const call=on.layer.link.call({method:'GET',path:'/api/state'});
  const job=await (await wait).json();await reply(on.base,job.id,{body:'{"devices":[]}'});assert.deepEqual(JSON.parse((await call).body),{devices:[]});
  assert.equal(off.layer.link,null);
  // a wrong key does not lock the sign-in of the same address
  for(let i=0;i<30;i++)await fetch(on.base+'/__link/hello',{headers:{Authorization:'Bearer wrong-'+i}});
  assert.equal((await fetch(on.base+'/__link/hello',{headers:{Authorization:'Bearer wrong-x'}})).status,429);assert.equal((await fetch(on.base+'/__link/hello',{headers:H})).status,200);
  const login=await fetch(on.base+'/__login',{method:'POST',headers:{'Content-Type':'application/json',Origin:on.base},body:JSON.stringify({id:'admin01',password:'wrong-password-1'})});
  assert.equal(login.status,401,'the sign-in limiter is separate: a wrong password is answered, not locked');
 }finally{await on.layer.close();await off.layer.close();await closeServer(stub);}
});
test('a key of the wrong shape switches the link off and says so; it does not stop the sign-in layer',async()=>{
 const {readConfig}=await import('./server.mjs');const env={PUBLIC_ORIGIN:'https://hrm.example.com',ADMIN_PASSWORD_HASH:'scrypt$1$2$3$a$b'};
 for(const bad of ['short','a'.repeat(40)+' ']){const c=readConfig({...env,BIOMETRIC_LINK_KEY:bad});assert.equal(c.linkKey,'');assert.match(c.linkProblem,/BIOMETRIC_LINK_KEY/);}
 assert.equal(readConfig({...env,BIOMETRIC_LINK_KEY:KEY}).linkKey,KEY);assert.equal(readConfig(env).linkKey,'');assert.equal(readConfig(env).linkProblem,'');
 const logs=[];const layer=createLayer({host:'127.0.0.1',port:1,upstream:new URL('http://127.0.0.1:1'),publicOrigin:'http://127.0.0.1:1',adminHash:'scrypt$x',internalKey:'',cookieSecure:false,idleMs:7200000,absoluteMs:43200000,chooseMs:900000,trustProxy:true,maxSessions:50,
  ...readConfig({...env,BIOMETRIC_LINK_KEY:'short'})},m=>logs.push(m));
 try{assert.equal(layer.link,null);assert.ok(logs.some(l=>/office link is NOT switched on: BIOMETRIC_LINK_KEY must be/.test(l)),JSON.stringify(logs));}finally{await layer.close();}
});

// ---- the Server Link of the office computer against a stand-in for the Biometric Attendance app ----
function localApp(opts={}){
 const seen=[];
 const srv=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
  const body=Buffer.concat(chunks).toString(),send=(code,text,type='application/json')=>{res.writeHead(code,{'Content-Type':type});res.end(text);};
  seen.push(`${req.method} ${req.url}${body?' '+body:''}`);
  if(opts.redirectState&&req.method==='GET'&&req.url==='/api/state'){res.writeHead(302,{Location:'/api/devices/1/download'});return res.end();}
  if(req.method==='GET'&&req.url==='/api/state')return send(200,JSON.stringify({devices:[{id:1,name:'KE1',ip:'192.168.11.180',port:4370}],totals:{logs:5}}));
  if(req.method==='GET'&&req.url.startsWith('/api/export/logs?'))return send(200,'﻿User ID,Name\r\n1,Ann\r\n','text/csv; charset=utf-8');
  if(req.method==='POST'&&req.url==='/api/devices/1/download')return setTimeout(()=>send(200,JSON.stringify({users:3,logs:10,newLogs:2,seconds:0.2})),200);
  if(req.method==='PUT'&&req.url==='/api/settings')return send(200,'{"ok":true}');
  send(404,'{"error":"Not found"}');});});
 return {srv,seen};
}
test('the Server Link carries out the four requests against the local app and returns the answers',async()=>{
 const r=await rig({pollMs:200}),app=localApp(),appBase=await listen(app.srv);
 const logs=[];const agent=startLink({server:r.base,key:KEY,app:appBase,log:m=>logs.push(m),pollTimeoutMs:3000,minPollMs:20,minRetryMs:50,maxRetryMs:200});
 try{
  assert.ok(await until(()=>r.link.online()),'the Server Link connected');assert.match(r.link.status().agent,/^Server Link /);
  const state=await r.link.call({method:'GET',path:'/api/state'});assert.equal(state.status,200);assert.equal(JSON.parse(state.body).devices[0].name,'KE1');
  const csv=await r.link.call({method:'GET',path:'/api/export/logs?from=2026-08-01&to=2026-08-31'});assert.equal(csv.type,'text/csv');assert.match(csv.body.toString('utf8'),/User ID,Name/);
  const dl=await r.link.call({method:'POST',path:'/api/devices/1/download',timeoutMs:5000});assert.equal(JSON.parse(dl.body).newLogs,2);
  const auto=await r.link.call({method:'PUT',path:'/api/settings',body:'{"autoMinutes":60}'});assert.equal(auto.status,200);
  assert.deepEqual(app.seen,['GET /api/state','GET /api/export/logs?from=2026-08-01&to=2026-08-31','POST /api/devices/1/download','PUT /api/settings {"autoMinutes":60}']);
  // two at the same time (a download takes a while, the state answers meanwhile)
  const [a,b]=await Promise.all([r.link.call({method:'POST',path:'/api/devices/1/download',timeoutMs:5000}),r.link.call({method:'GET',path:'/api/state'})]);assert.equal(a.status,200);assert.equal(b.status,200);
  assert.ok(logs.some(l=>/Connected to/.test(l)));
 }finally{agent.stop();await r.close();await closeServer(app.srv);}
});
test('the Server Link refuses what it must not do even when the server asks: it is a stand-in for a hacked server here',async()=>{
 const app=localApp(),appBase=await listen(app.srv);const answers=[];
 const jobs=[{id:'a'.repeat(32),method:'DELETE',path:'/api/devices/1'},{id:'b'.repeat(32),method:'GET',path:'/api/devices'},{id:'c'.repeat(32),method:'POST',path:'/api/devices/1/test'},
  {id:'d'.repeat(32),method:'GET',path:'http://169.254.169.254/latest/meta-data'},{id:'e'.repeat(32),method:'PUT',path:'/api/settings',body:Buffer.from('{"autoMinutes":1}').toString('base64')},{id:'f'.repeat(32),method:'GET',path:'/api/state'}];
 const evil=http.createServer(async(req,res)=>{
  if(req.url==='/__link/next'){const j=jobs.shift();if(!j){res.writeHead(204);return res.end();}res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(j));}
  const m=/^\/__link\/reply\/(\w+)$/.exec(req.url);if(m){const parts=[];for await(const c of req)parts.push(c);answers.push({id:m[1][0],status:Number(req.headers['x-link-status']),body:zlib.gunzipSync(Buffer.concat(parts)).toString()});res.writeHead(200);return res.end('{"ok":true}');}
  res.writeHead(404);res.end();});
 const evilBase=await listen(evil);const agent=startLink({server:evilBase,key:KEY,app:appBase,log:()=>{},pollTimeoutMs:1000,minPollMs:10});
 try{
  assert.ok(await until(()=>answers.length===6),'all six jobs were answered');
  const by=Object.fromEntries(answers.map(a=>[a.id,a]));
  for(const id of 'abcde')assert.equal(by[id].status,400,'job '+id+' was refused');assert.equal(by.f.status,200);
  assert.deepEqual(app.seen,['GET /api/state'],'only the allowed request reached the local app');
 }finally{agent.stop();await closeServer(evil);await closeServer(app.srv);}
});
test('the Server Link says so when the local app is not running, and when the key is wrong',async()=>{
 const r=await rig({pollMs:200});const dead=net.createServer();await new Promise(x=>dead.listen(0,'127.0.0.1',x));const deadPort=dead.address().port;await new Promise(x=>dead.close(x));
 const agent=startLink({server:r.base,key:KEY,app:`http://127.0.0.1:${deadPort}`,log:()=>{},pollTimeoutMs:2000,minPollMs:20,minRetryMs:30,maxRetryMs:100});
 const wrong=startLink({server:r.base,key:'Z9y8X7w6'.repeat(6),app:`http://127.0.0.1:${deadPort}`,log:()=>{},pollTimeoutMs:2000,minPollMs:20,minRetryMs:30,maxRetryMs:100});
 try{
  assert.ok(await until(()=>r.link.online()));
  const out=await r.link.call({method:'GET',path:'/api/state'});assert.equal(out.status,502);assert.match(JSON.parse(out.body).error,/not running at http:\/\/127\.0\.0\.1:\d+/);
  assert.ok(await until(()=>/refused the key/.test(wrong.state.lastError)),'the wrong key is reported to the person at the office');
 }finally{agent.stop();wrong.stop();await r.close();}
});
test('the Server Link keeps trying while the server is away and connects when it comes back',async()=>{
 const r1=await rig({pollMs:150});const port=Number(new URL(r1.base).port);await r1.close();
 const logs=[];const agent=startLink({server:`http://127.0.0.1:${port}`,key:KEY,app:'http://127.0.0.1:1',log:m=>logs.push(m),pollTimeoutMs:1000,minPollMs:20,minRetryMs:30,maxRetryMs:80});
 try{
  assert.ok(await until(()=>/Cannot reach the server/.test(agent.state.lastError)),'it notices the server is away');
  const link=createLink({key:KEY,limiter:makeLimiter(),ipBucket,pollMs:150});const srv=http.createServer((req,res)=>link.route(req,res,new URL(req.url,'http://x'),'10.0.0.1'));
  await new Promise((resolve,reject)=>{srv.once('error',reject);srv.listen(port,'127.0.0.1',resolve);});
  try{assert.ok(await until(()=>link.online(),8000),'it connected by itself');assert.ok(await until(()=>agent.state.connected,3000),'and it knows it is connected (the first quiet answer of the server)');}finally{link.close();await closeServer(srv);}
 }finally{agent.stop();}
});

// ---- the Server Link against a server that is hostile (a stand-in for a hacked server): it must stay inside its four requests ----
test('the Server Link never follows a redirect: not of the server (the poll, the answer) and not of the local app',async()=>{
 const app=localApp({redirectState:true}),appBase=await listen(app.srv);const logs=[],answered=[];let polls=0;
 const evil=http.createServer(async(req,res)=>{
  if(req.url==='/__link/next'){polls++;
   if(polls===1){res.writeHead(302,{Location:appBase+'/api/devices/1/download'});return res.end();}                                  // the poll is sent to the local app
   if(polls===2){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({id:'a'.repeat(32),method:'GET',path:'/api/state'}));}
   res.writeHead(204);return res.end();}
  if(/^\/__link\/reply\/\w+$/.test(req.url)){const parts=[];for await(const c of req)parts.push(c);answered.push(JSON.parse(zlib.gunzipSync(Buffer.concat(parts)).toString()));
   res.writeHead(307,{Location:appBase+'/api/devices/1/download'});return res.end();}                                                // the answer is sent to the local app (a 307 keeps the method and the body)
  res.writeHead(404);res.end();});
 const evilBase=await listen(evil);const agent=startLink({server:evilBase,key:KEY,app:appBase,log:m=>logs.push(m),pollTimeoutMs:1000,minPollMs:10,minRetryMs:20,maxRetryMs:40});
 try{
  assert.ok(await until(()=>answered.length===1),'the job was done and answered');await sleep(300);
  assert.deepEqual(app.seen,['GET /api/state'],'no redirect was followed: the local app saw only the one allowed request (its own redirect was not followed either)');
  assert.match(answered[0].error,/answered with a redirect/,'the redirect of the local app is reported as an error');
  assert.ok(logs.some(l=>/Cannot reach the server \(unexpected redirect\)/.test(l)),'the redirect of the poll is reported: '+JSON.stringify(logs));
  assert.ok(logs.some(l=>/Could not send an answer to the server: unexpected redirect/.test(l)),'the redirect of the answer is reported: '+JSON.stringify(logs));
 }finally{agent.stop();await closeServer(evil);await closeServer(app.srv);}
});
test('what a hostile server sends is checked: a huge job, an id this server never makes, forged log lines',async()=>{
 const app=localApp(),appBase=await listen(app.srv);const logs=[];let n=0;
 const evil=http.createServer(async(req,res)=>{
  if(req.url==='/__link/next'){n++;res.writeHead(n<=3?200:204,{'Content-Type':'application/json'});
   if(n===1)return res.end(JSON.stringify({id:'a'.repeat(32),method:'GET',path:'/api/state',pad:'x'.repeat(100000)}));                    // far more than a job is
   if(n===2)return res.end(JSON.stringify({id:'../../x',method:'GET',path:'/api/state'}));                                                // not an id the server makes
   if(n===3)return res.end(JSON.stringify({id:'c'.repeat(32),method:'GET\r\n[2026-01-01 00:00:00] FORGED',path:'/x\u001b[31m'}));      // control characters
   return res.end();}
  if(/^\/__link\/reply\//.test(req.url)){for await(const c of req);res.writeHead(200);return res.end('{"ok":true}');}
  res.writeHead(404);res.end();});
 const evilBase=await listen(evil);const agent=startLink({server:evilBase,key:KEY,app:appBase,log:m=>logs.push(m),pollTimeoutMs:1000,minPollMs:10,minRetryMs:20,maxRetryMs:40});
 try{
  assert.ok(await until(()=>logs.some(l=>/FORGED/.test(l))),'the odd job was looked at: '+JSON.stringify(logs.map(l=>l.slice(0,90))));
  assert.ok(logs.some(l=>/something that is not a job/.test(l)),'the huge job was not accepted');
  assert.deepEqual(app.seen,[],'nothing reached the local app');
  for(const l of logs)assert.ok(!/[\r\n\u001b]/.test(l),'no control characters in the log: '+JSON.stringify(l));
  assert.ok(logs.some(l=>/^GET\?\?\[2026-01-01 00:00:00\] FORGED \/x\?\[31m -> 400/.test(l)),'the odd method and path are shown with ? instead of the control characters: '+JSON.stringify(logs.at(-1)));
 }finally{agent.stop();await closeServer(evil);await closeServer(app.srv);}
});
test('while it is busy with long downloads the Server Link still says it is there, and takes work again afterwards',async()=>{
 const r=await rig({pollMs:200}),app=localApp(),appBase=await listen(app.srv);let beats=0;
 const agent=startLink({server:r.base,key:KEY,app:appBase,log:()=>{},pollTimeoutMs:3000,minPollMs:20,minRetryMs:50,maxRetryMs:200,maxParallel:1,beatMs:30,fetchImpl:(u,i)=>{if(String(u).endsWith('/__link/hello'))beats++;return fetch(u,i);}});
 try{
  assert.ok(await until(()=>r.link.online()));
  const dl=await r.link.call({method:'POST',path:'/api/devices/1/download',timeoutMs:5000});assert.equal(dl.status,200);assert.ok(beats>=1,'it called hello while its one place was taken');
  const st=await r.link.call({method:'GET',path:'/api/state'});assert.equal(st.status,200,'and it takes work again');
 }finally{agent.stop();await r.close();await closeServer(app.srv);}
});
test('two Server Links with one key: the one that keeps being taken over says so, once',async()=>{
 const quiet=http.createServer((req,res)=>{res.writeHead(204);res.end();});const base=await listen(quiet);const logs=[];
 const agent=startLink({server:base,key:KEY,app:'http://127.0.0.1:1',log:m=>logs.push(m),pollTimeoutMs:1000,minPollMs:30});
 try{assert.ok(await until(()=>logs.some(l=>/Another Server Link/.test(l)),3000));await sleep(300);assert.equal(logs.filter(l=>/Another Server Link/.test(l)).length,1);}
 finally{agent.stop();await closeServer(quiet);}
});
test('the Server Link can ask the server once (reachable? key accepted?) and says in words what is wrong; --test does it from the command line',async()=>{
 const r=await rig({pollMs:200});
 try{
  assert.deepEqual(await checkKey({server:r.base,key:KEY}),{ok:true,kind:'ok',message:'The server accepted the key.'});
  const bad=await checkKey({server:r.base,key:'Z9y8X7w6'.repeat(6)});assert.equal(bad.kind,'key');assert.match(bad.message,/refused the key \(the one given has 48 characters; a key made by the server has 43\)/);
  const gone=await checkKey({server:'http://127.0.0.1:1',key:KEY,timeoutMs:3000});assert.equal(gone.kind,'network');assert.match(gone.message,/Cannot reach http:\/\/127\.0\.0\.1:1 \(/);
  const redir=http.createServer((req,res)=>{res.writeHead(302,{Location:'http://127.0.0.1:1/x'});res.end();});const rb=await listen(redir);
  try{const c=await checkKey({server:rb,key:KEY});assert.equal(c.kind,'network');assert.match(c.message,/unexpected redirect/,'a redirect is not followed');}finally{await closeServer(redir);}
  for(const [code,kind] of [[429,'wait'],[404,'off'],[503,'status']]){const s=http.createServer((req,res)=>{res.writeHead(code);res.end();});const b=await listen(s);try{assert.equal((await checkKey({server:b,key:KEY})).kind,kind,String(code));}finally{await closeServer(s);}}
  // the command line: --test needs nothing saved, keeps nothing running and sets the exit code
  const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..','..','biometric-web','link','server-link.mjs'),data=fs.mkdtempSync(path.join(os.tmpdir(),'sl-test-'));
  const run=args=>new Promise(resolve=>execFile(process.execPath,['--no-warnings',script,'--test','--data',data,...args],{timeout:30000},(err,stdout,stderr)=>resolve({code:err?err.code:0,out:stdout+stderr})));
  try{
   const ok=await run(['--server',r.base,'--key',KEY]);assert.equal(ok.code,0,ok.out);assert.match(ok.out,/^OK: http:\/\/127\.0\.0\.1:\d+ accepts the key \(48 characters\)\./);
   const no=await run(['--server',r.base,'--key','Z9y8X7w6'.repeat(6)]);assert.equal(no.code,1);assert.match(no.out,/refused the key/);assert.match(no.out,/Start Server Link\.cmd --key <the key>/);
   assert.deepEqual(fs.readdirSync(data),[],'--test saves nothing');
  }finally{fs.rmSync(data,{recursive:true,force:true});}
 }finally{await r.close();}
});
test('the command line: a value is the next word whatever it starts with; the key prompt shows nothing and understands backspace and paste',async()=>{
 const a=parseArgs(['--server','https://hrm.example.com','--key','--abcDEF','--quiet']);
 assert.equal(a.value('key'),'--abcDEF');assert.equal(a.value('server'),'https://hrm.example.com');assert.equal(a.has('quiet'),true);assert.equal(a.has('status'),false);assert.equal(a.value('data'),undefined);
 assert.throws(()=>parseArgs(['--key']).value('key'),/needs a value/);
 assert.equal(cleanApp('http://127.0.0.1:5180'),'http://127.0.0.1:5180');assert.equal(cleanApp('http://192.168.1.5:5180/'),'http://192.168.1.5:5180');
 for(const bad of ['127.0.0.1:5180','http://127.0.0.1:5180/api','ftp://x','http://u:p@127.0.0.1:5180'])assert.equal(cleanApp(bad),null,bad);
 const out=[];const stdin=Object.assign(new EventEmitter(),{isTTY:true,raw:null,setRawMode(v){this.raw=v;},resume(){},pause(){},setEncoding(){}});
 const p=askHidden('Key: ',stdin,{write:s=>out.push(s)});
 stdin.emit('data','ab');stdin.emit('data','x\u007fc');stdin.emit('data','\r');
 assert.equal(await p,'abc');assert.equal(stdin.raw,false);assert.deepEqual(out,['Key: ','\n'],'nothing but the question and a line break was written');assert.equal(stdin.listenerCount('data'),0);
 const p2=askHidden('Key: ',stdin,{write(){}});stdin.emit('data','  '+KEY+'\r\n');assert.equal(await p2,KEY);
});
