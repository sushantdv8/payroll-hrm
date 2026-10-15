// The office link of a hosted Payroll Workspace (plain Node.js, no packages).
//
// The Biometric Attendance app has to run on a computer in the office: the machines are on that network and a hosting cannot reach them. That computer's
// "Server Link" calls THIS server over HTTPS (it only makes outgoing calls, nothing has to be opened in the office router) and waits for work:
//
//   application --(call)--> queue here <--(GET /__link/next, long poll)-- Server Link --> Biometric Attendance app (127.0.0.1:5180) --> machines
//                                       <--(POST /__link/reply/<id>)------
//
// * Only four requests can be sent to the office (allowedRequest): the machine list, the punches of a date range (at most MAX_SPAN_DAYS), the download of one machine and
//   the automatic download interval. The Server Link checks the same list again and never follows a redirect, so a hacked server cannot make it call anything else.
// * Every call of the link needs the key (BIOMETRIC_LINK_KEY, Authorization: Bearer ...), compared in constant time. The key is checked first: a call with the right
//   key is never held back by wrong keys that came from the same address; wrong keys are counted per address and locked out like wrong passwords, and answered without
//   reading their body. A call with an Origin header (a browser) is refused.
// * The queue is in memory and small (a few requests of one kind at a time, 20 in all); a request that is not answered in time fails with a clear message, an answer of an
//   unknown, finished or already-being-answered request is dropped, answers have a size limit before and after unpacking.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
// the day number of a real calendar day (NaN for 2026-02-30 and the like)
const dayNumber=s=>{const m=DATE.exec(s);if(!m)return NaN;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?d.getTime()/864e5:NaN;};
export const INTERVALS=[0,15,30,60,120];
export const MAX_SPAN_DAYS=70;   // the screens ask for 64 days at most (two months and a day either side); a wider range would make the office app read its whole database
// What the application may ask the Biometric Attendance app (body: a Buffer or null). The Server Link keeps the same list (biometric-web/link/server-link.mjs).
export function allowedRequest(method,path,body=null){
 if(typeof method!=='string'||typeof path!=='string')return false;
 const empty=!body||!body.length;
 if(method==='GET'&&path==='/api/state')return empty;
 if(method==='GET'){const m=/^\/api\/export\/logs\?from=([0-9-]{10})&to=([0-9-]{10})$/.exec(path);if(!m||!empty)return false;const a=dayNumber(m[1]),b=dayNumber(m[2]);return b>=a&&b-a<=MAX_SPAN_DAYS;}   // NaN (not a day) fails both comparisons
 if(method==='POST'&&/^\/api\/devices\/[1-9]\d{0,5}\/download$/.test(path))return empty;
 if(method==='PUT'&&path==='/api/settings'){try{const j=JSON.parse(Buffer.from(body||'').toString('utf8'));return !!j&&typeof j==='object'&&!Array.isArray(j)&&Object.keys(j).length===1&&INTERVALS.includes(j.autoMinutes);}catch{return false;}}
 return false;
}

export class LinkError extends Error{constructor(message,status=502){super(message);this.status=status;}}
const OFFLINE='The office computer is not connected to this server. On the office computer start "Server Link" (its window must stay open), then try again.';
const TYPES=new Set(['application/json','text/csv']);
// how many requests of one kind may wait for the office at the same time (a download: one per machine): a login that keeps asking cannot fill the queue or hammer the office app
const kindOf=(method,path)=>method==='POST'?'download '+/^\/api\/devices\/(\d+)\//.exec(path)[1]:method==='PUT'?'settings':path==='/api/state'?'state':'logs';
const KIND_MAX={state:4,logs:3,settings:2};

// What the application's fetch('http://relay.local/<path>') does (the entry process routes those calls here): the request is queued for the office computer and its answer
// comes back as the Response of the Biometric Attendance app. A failure of the link is a Response too (an error text and a status, like the app's own errors); only a caller
// that gave up (an AbortSignal, for example its time ran out) gets what fetch would give: the reason of the signal.
export async function relayFetch(link,url,init){
 if(!link)return Response.json({error:'The office link is not switched on on this server.'},{status:503});
 if(url.pathname==='/__status')return Response.json(link.status());
 const method=String(init?.method||'GET').toUpperCase();
 let body=init?.body??null;
 if(body!==null&&typeof body!=='string'&&!(body instanceof Uint8Array))body=Buffer.from(await new Response(body).arrayBuffer());
 try{
  const r=await link.call({method,path:url.pathname+url.search,body,signal:init?.signal});
  return new Response([204,205,304].includes(r.status)?null:r.body,{status:r.status,headers:{'content-type':r.type}});
 }catch(e){
  if(e instanceof LinkError&&e.status===499)throw init?.signal?.reason??new DOMException('This operation was aborted','AbortError');
  const known=e instanceof LinkError;
  return Response.json({error:known?e.message:'The office link failed.'},{status:known&&e.status>=400&&e.status<=599?e.status:502});
 }
}

// limiter / ipBucket come from the sign-in layer (a limiter of its own, so wrong keys never lock a sign-in)
export function createLink({key,log=()=>{},limiter,ipBucket,now=Date.now,pollMs=20000,onlineMs=60000,maxQueue=20,maxReply=16*1024*1024,maxOut=64*1024*1024}){
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(key||''))throw new Error('BIOMETRIC_LINK_KEY must be 32 to 128 characters (letters, digits, - and _).');
 const secret=crypto.randomBytes(32),keyMac=crypto.createHmac('sha256',secret).update(key).digest();
 const keyOk=v=>crypto.timingSafeEqual(crypto.createHmac('sha256',secret).update(String(v)).digest(),keyMac);   // equal length whatever was sent
 const queue=[],byId=new Map();let waiter=null,lastSeen=0,agent='',who='',lastLogged=0,refused=null;const wrongLogged=new Map();   // refused: the last call that was turned away {at, ip, agent, keyLength}
 const online=()=>lastSeen>0&&now()-lastSeen<=onlineMs;
 const send=(res,code,body,extra={})=>{if(res.headersSent)return;res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(code===204?undefined:JSON.stringify(body));};
 // an unwanted request is answered and its connection closed: its body is not worth reading
 const refuse=(req,res,code,body,extra={})=>{if(res.headersSent){req.socket.destroy();return;}res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Connection:'close',...extra});res.end(JSON.stringify(body),()=>req.socket.destroy());};
 const drop=item=>{clearTimeout(item.timer);byId.delete(item.id);const i=queue.indexOf(item);if(i>=0)queue.splice(i,1);};
 const deliver=(res,item)=>{item.claimed=true;send(res,200,{id:item.id,method:item.method,path:item.path,body:item.body?item.body.toString('base64'):null});};

 // ---- the application's side ----
 function call({method,path,body=null,timeoutMs=40000,signal}){
  const buf=body==null?null:Buffer.from(body);
  if(!allowedRequest(method,path,buf))return Promise.reject(new LinkError('This request cannot be sent to the office computer.',400));
  if(!online())return Promise.reject(new LinkError(OFFLINE,503));
  if(queue.length>=maxQueue)return Promise.reject(new LinkError('The office computer has too many requests waiting. Try again in a moment.',503));
  const kind=kindOf(method,path);let same=0;for(const i of byId.values())if(i.kind===kind)same++;
  if(same>=(kind.startsWith('download')?1:KIND_MAX[kind]))return Promise.reject(new LinkError('The office computer is already working on this request. Try again in a moment.',503));
  return new Promise((resolve,reject)=>{
   const item={id:crypto.randomBytes(16).toString('hex'),method,path,body:buf,kind,claimed:false,done:false,replying:false,resolve,reject,timer:null};
   item.timer=setTimeout(()=>{item.done=true;drop(item);reject(new LinkError(item.claimed?'The office computer did not answer in time (a machine can still be downloading - press Refresh in a minute).':'The office computer did not pick up the request in time. Try again.',504));},timeoutMs);
   if(signal){const abort=()=>{if(!item.done){item.done=true;drop(item);reject(new LinkError('Cancelled.',499));}};if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}
   queue.push(item);byId.set(item.id,item);
   if(waiter){const w=waiter;waiter=null;clearTimeout(w.timer);deliver(w.res,item);}
  });
 }
 // turnedAway: a call that was refused after the last good call (a good call clears it), within the last hour - so the screen can say "a Server Link tried, but its key is wrong"
 const status=()=>{const t=now(),r=refused&&t-refused.at<3600000?refused:null;
  return {enabled:true,online:online(),lastSeen:lastSeen||null,agent,waiting:queue.filter(i=>!i.claimed).length,turnedAway:r?{secondsAgo:Math.max(0,Math.round((t-r.at)/1000)),ip:r.ip,agent:r.agent,keyLength:r.keyLength}:null};};

 // ---- the office computer's side ----
 const readBody=(req,limit,ms=120000)=>new Promise((resolve,reject)=>{
  const fail=(status,message)=>reject(Object.assign(new Error(message),{status}));
  const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>limit))return fail(413,'Too large.');
  const parts=[];let size=0;const timer=setTimeout(()=>fail(408,'Too slow.'),ms);
  req.on('data',c=>{size+=c.length;if(size>limit){clearTimeout(timer);fail(413,'Too large.');req.destroy();}else parts.push(c);});
  req.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(parts));});req.on('error',()=>{clearTimeout(timer);fail(400,'Invalid request.');});req.on('close',()=>clearTimeout(timer));
 });
 const gunzip=buf=>new Promise((resolve,reject)=>zlib.gunzip(buf,{maxOutputLength:maxOut},(e,out)=>e?reject(Object.assign(new Error('Invalid request.'),{status:400})):resolve(out)));
 const agentName=req=>String(req.headers['x-link-agent']||'').replace(/[^A-Za-z0-9 ._/()-]/g,'').slice(0,60);
 // a call that is turned away: remembered (the screen shows it) and logged at most once a minute per address - with the name the Server Link gave itself and the length of the key it sent (never the key)
 const turnedAway=(req,ip,keyLength)=>{
  const t=now(),name=agentName(req);refused={at:t,ip:ip||'',agent:name,keyLength};
  const last=wrongLogged.get(ip)||0;
  if(t-last>60000){wrongLogged.set(ip,t);if(wrongLogged.size>1000)wrongLogged.clear();log(`office link: a call from ${ip||'an unknown address'}${name?` (${name})`:''} was turned away: ${keyLength?`a wrong key (${keyLength} characters)`:'no key'}`);}
 };
 // a successful call: who is the office computer (a copy of the key used from another address shows up in the log)
 const seen=(req,ip)=>{
  const t=now(),gap=lastSeen?t-lastSeen:Infinity;lastSeen=t;refused=null;
  agent=agentName(req)||agent;
  const here=`${ip||'an unknown address'}${agent?` (${agent})`:''}`;
  if((here!==who||gap>onlineMs)&&t-lastLogged>5000){log(who&&here!==who?`office link: now connected from ${here} - before: ${who}`:`office link: ${gap>onlineMs&&who?'back':'connected'} from ${here}`);lastLogged=t;}
  who=here;
 };

 function next(req,res){
  if(waiter){const w=waiter;waiter=null;clearTimeout(w.timer);send(w.res,204);}   // the link restarted: the newest poll takes over
  const item=queue.find(i=>!i.claimed);
  if(item)return deliver(res,item);
  const mine={res,timer:setTimeout(()=>{if(waiter===mine)waiter=null;send(res,204);},pollMs)};waiter=mine;
  res.on('close',()=>{if(waiter===mine){clearTimeout(mine.timer);waiter=null;}});
 }
 async function reply(req,res,id){
  const item=byId.get(id);
  if(!item||!item.claimed||item.done||item.replying){req.resume();return send(res,404,{error:'Unknown request.'});}   // one answer at a time per request, and nothing is read for the others
  const code=Number(req.headers['x-link-status']);
  if(!Number.isInteger(code)||code<200||code>599){req.resume();return send(res,400,{error:'Invalid request.'});}
  const type=String(req.headers['x-link-type']||'').split(';')[0].trim().toLowerCase();
  item.replying=true;
  try{
   let buf=await readBody(req,maxReply);
   if(/^gzip$/i.test(String(req.headers['content-encoding']||'')))buf=await gunzip(buf);
   if(item.done)return send(res,404,{error:'Unknown request.'});
   item.done=true;drop(item);item.resolve({status:code,type:TYPES.has(type)?type:'application/octet-stream',body:buf});
   send(res,200,{ok:true});
  }finally{item.replying=false;}
 }
 // One entry for the layer: /__link/next (GET), /__link/reply/<id> (POST), /__link/hello (GET). Never throws.
 function route(req,res,url,ip){
  const fail=(e)=>{if(e&&e.status&&e.status<500)return send(res,e.status,{error:e.status===413?'Too large.':'Invalid request.'},e.status===413||e.status===408?{Connection:'close'}:{});log('office link: '+String(e&&e.message||e));return send(res,500,{error:'Something went wrong.'});};
  try{
   if(req.headers.origin!==undefined)return refuse(req,res,403,{error:'Not allowed.'});
   const bucket=ipBucket(ip);
   const auth=/^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(String(req.headers.authorization||''));
   if(!auth||!keyOk(auth[1])){
    const locked=limiter.checkIp(bucket),length=auth?auth[1].length:0;
    if(locked){turnedAway(req,ip,length);return refuse(req,res,429,{error:'Too many attempts.'},{'Retry-After':String(locked)});}
    limiter.fail(bucket,bucket+'|link');turnedAway(req,ip,length);return refuse(req,res,401,{error:'Not allowed.'});
   }
   limiter.ok(bucket+'|link');
   seen(req,ip);
   const p=url.pathname;
   if(p==='/__link/hello'&&req.method==='GET')return send(res,200,{ok:true,time:now()});
   if(p==='/__link/next'&&req.method==='GET')return next(req,res);
   const m=/^\/__link\/reply\/([0-9a-f]{32})$/.exec(p);
   if(m&&req.method==='POST'){reply(req,res,m[1]).catch(fail);return;}
   req.resume();return send(res,404,{error:'Not found.'});
  }catch(e){fail(e);}
 }
 return {call,status,route,online,close:()=>{if(waiter){clearTimeout(waiter.timer);send(waiter.res,204);waiter=null;}for(const item of [...queue]){drop(item);item.reject(new LinkError('The server is stopping.',503));}}};
}
