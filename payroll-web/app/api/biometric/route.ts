import {env} from 'cloudflare:workers';
import {ownerId,db,checkOrigin,fail,readBounded,RequestError,validDataset,drained} from '@/lib/server-store';
import {datasetKey} from '@/lib/full-import';
import {DEFAULT_BIO_URL,RELAY_URL,cleanBioUrl,matchAll,parseLogsCsv,type BioConfig,type BioHistoryEntry,type BioLinkState,type BioMap,type BioPunches,type BioSettings,type BioState,type BioUser} from '@/lib/biometric';
import {hrIdentity,hrEmployees} from '@/lib/hr-store';
import {anyView} from '@/lib/access';
import {needScreen,refuse,note} from '@/lib/guard';
import {unitLimited,allEmployees} from '@/lib/unit-scope';
export const dynamic='force-dynamic';

// Utilities › Biometric Machine Setup and Time Updation › Biometric Fetch.
// The punches come from the Biometric Attendance app (it downloads the machines); this route only reads them from it,
// asks it to download a machine, and keeps this company's settings (master_records, table 'biometric'):
//   config  {url, devices}   map  {machine user ID: employee id | '-'}   history  [last 100 fetches]
const TABLE='biometric';
const day=/^\d{4}-\d{2}-\d{2}$/;
const companyWide='Biometric Machine Setup covers the machines and machine users of the whole company, so it needs a login that has All locations.';
type Stored<T>={value:T;revision:number};

async function read<T>(owner:string,dataset:string,key:string,fallback:T):Promise<Stored<T>>{
 const row=await db().prepare('SELECT data,revision FROM master_records WHERE owner=? AND dataset=? AND table_name=? AND record_key=? AND deleted=0').bind(owner,dataset,TABLE,key).first<{data:string;revision:number}>();
 return row?{value:JSON.parse(row.data) as T,revision:row.revision}:{value:fallback,revision:0};
}
async function write(owner:string,dataset:string,key:string,value:unknown,revision:number){
 const now=new Date().toISOString();const data=JSON.stringify(value);
 const result=revision?await db().prepare('UPDATE master_records SET data=?,revision=revision+1,updated_at=? WHERE owner=? AND dataset=? AND table_name=? AND record_key=? AND revision=?').bind(data,now,owner,dataset,TABLE,key,revision).run()
  :await db().prepare("INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,?,?,?,'manual',1,0,?) ON CONFLICT(owner,dataset,table_name,record_key) DO NOTHING").bind(crypto.randomUUID(),owner,dataset,TABLE,key,data,now).run();
 if(result.meta.changes!==1)throw new RequestError('These settings were changed in another window. Reload the screen and try again.',409);
 return revision+1;
}
const settingsOf=async(owner:string,dataset:string):Promise<BioSettings>=>{
 const [config,map,history]=await Promise.all([read<BioConfig>(owner,dataset,'config',{url:DEFAULT_BIO_URL,devices:[]}),read<BioMap>(owner,dataset,'map',{}),read<BioHistoryEntry[]>(owner,dataset,'history',[])]);
 const devices=Array.isArray(config.value.devices)?(config.value.devices as unknown[]).map(Number).filter(n=>Number.isInteger(n)&&n>0):[];
 return {config:{url:config.value.url||DEFAULT_BIO_URL,devices},map:map.value,history:history.value,revisions:{config:config.revision,map:map.revision}};
};

// A server that has no Biometric Attendance app of its own (a hosting: the machines are in the office) reaches it through the office link: the server's
// fetch of RELAY_URL is queued for the Server Link of the office computer (deploy/signin-layer/link.mjs). Then the saved address is not used.
const linked=()=>env.PAYROLL_BIO_LINK==='1';
// A hosted server (the single-process edition) that has no office link cannot reach any Biometric Attendance app, and must not be told to call addresses that people type in.
const hostedWithoutLink=()=>env.PAYROLL_HOSTED==='1'&&!linked();
const NO_MACHINES='This server has no Biometric Attendance app and the office link is not switched on, so the machines cannot be reached. Set up the office link (docs/BIOMETRIC-LINK.md).';
async function linkState():Promise<BioLinkState>{
 try{const r=await fetch(RELAY_URL+'/__status',{signal:AbortSignal.timeout(5000)});const j=await r.json() as Partial<BioLinkState>;const seen=typeof j.lastSeen==='number'?j.lastSeen:null;
  return {enabled:true,online:!!j.online,lastSeen:seen,secondsAgo:seen===null?null:Math.max(0,Math.round((Date.now()-seen)/1000)),agent:String(j.agent||''),waiting:Number(j.waiting)||0};}
 catch{return {enabled:true,online:false,lastSeen:null,secondsAgo:null,agent:''};}
}
// Calls the Biometric Attendance app. Its own error text is passed on; "not running" or "something else answers at
// that address" get clear messages.
async function app<T>(base:string,path:string,init?:RequestInit&{timeout?:number},as:'json'|'text'='json'):Promise<T>{
 let r:Response;
 try{r=await fetch(base+path,{...init,signal:AbortSignal.timeout(init?.timeout||15000)});}
 catch(error){const e=error as Error;if(e.name==='TimeoutError')throw new RequestError(base===RELAY_URL?'The office computer did not answer in time. Try again.':`The Biometric Attendance app at ${base} did not answer in time. Try again.`,504);
  if(base===RELAY_URL)throw new RequestError('The office link is not available on this server.',502);
  throw new RequestError(`The Biometric Attendance app is not running at ${base}. Start it from its desktop icon (keep its window open), or correct the address in Biometric Machine Setup.`,502);}
 if(!r.ok){let message=`The Biometric Attendance app answered with error ${r.status}.`;try{const j=await r.json() as {error?:string};if(j.error)message=j.error;}catch{}throw new RequestError(message,r.status===504?504:502);}
 const notApp=new RequestError(`${base} is not the Biometric Attendance app. Correct the address in Biometric Machine Setup.`,502);
 if(as==='text'){const text=await r.text();if(!/^﻿?User ID,/.test(text))throw notApp;return text as T;}
 try{return await r.json() as T;}catch{throw notApp;}
}
// Only the fields the screen shows are passed on (the app's own answer also holds each machine's Comm Key and the network cards of its computer), each of the expected type.
const str=(v:unknown)=>typeof v==='string'?v.slice(0,300):'',strOrNull=(v:unknown)=>typeof v==='string'?v.slice(0,300):null,num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const cleanState=(s:BioState):BioState=>({
 devices:s.devices.slice(0,200).map(d=>({id:num(d.id),name:str(d.name),ip:str(d.ip),port:num(d.port),status:str(d.status),message:strOrNull(d.message),syncedAt:strOrNull(d.syncedAt),checkedAt:strOrNull(d.checkedAt),storedLogs:num(d.storedLogs),lastPunch:strOrNull(d.lastPunch),storedUsers:num(d.storedUsers),busy:strOrNull(d.busy),sameNetwork:!!d.sameNetwork})),
 autoMinutes:num(s.autoMinutes),totals:{logs:num(s.totals.logs),people:num(s.totals.people),first:strOrNull(s.totals.first),last:strOrNull(s.totals.last)}});
async function stateOf(base:string){const s=await app<BioState>(base,'/api/state');if(!s||!Array.isArray(s.devices)||!s.totals||typeof s.totals!=='object')throw new RequestError(`${base} is not the Biometric Attendance app. Correct the address in Biometric Machine Setup.`,502);return cleanState(s);}
// The punches export names the machine, so the chosen machine ids are turned into the names they have now. A chosen
// machine that is gone, or a name shared with a machine that is not chosen, stops the fetch instead of losing punches.
async function machineFilter(base:string,ids:number[]){
 if(!ids.length)return ()=>true;
 const {devices}=await stateOf(base);const chosen=devices.filter(d=>ids.includes(d.id));
 if(chosen.length!==ids.length)throw new RequestError('A machine ticked for this company is no longer in the Biometric Attendance app. Check the ticks on Biometric Machine Setup and press Save.',409);
 const names=new Set(chosen.map(d=>d.name));const clash=devices.find(d=>!ids.includes(d.id)&&names.has(d.name));
 if(clash)throw new RequestError(`Two machines are named "${clash.name}" in the Biometric Attendance app. Give each machine its own name there (Edit), then fetch again.`,409);
 return (name:string)=>names.has(name);
}
const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*864e5).toISOString().slice(0,10);
const today=()=>new Date().toISOString().slice(0,10);
const real=(s:string)=>day.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&shift(s,0)===s;   // a day that exists (2026-02-30 and 2026-13-40 do not)

export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);const q=url.searchParams;
 // Machine Setup, Time Updation's Biometric Fetch and the Multi Punch report read from here.
 const actor=await hrIdentity(owner);if(!anyView(actor,k=>k==='utilities/biometric'||k.startsWith('transaction/time')||k.startsWith('reports/')))await refuse(owner,actor,'You do not have permission to read the biometric machines.','utilities/biometric');
 const dataset=datasetKey.parse(q.get('dataset'));await validDataset(owner,dataset);
 const settings=await settingsOf(owner,dataset);const view=q.get('view')||'settings';
 if(view==='settings'){
  // A login limited to some locations gets the machine-user matches of its own employees only.
  if(unitLimited(actor)){const own=new Set((await hrEmployees(owner,dataset,actor)).map(e=>e.id));settings.map=Object.fromEntries(Object.entries(settings.map).filter(([,employee])=>employee==='-'||own.has(employee)));}
  return Response.json(linked()?{...settings,link:await linkState()}:settings,{headers:{'Cache-Control':'no-store'}});}
 // The machine list, the machine users and Test (which makes this server call the address it is given) belong to Machine Setup.
 if(q.get('url')!==null)await needScreen(owner,actor,'utilities/biometric','edit');else if(view==='state'||view==='users')await needScreen(owner,actor,'utilities/biometric','view');
 if((q.get('url')!==null||view==='state'||view==='users')&&unitLimited(actor))await refuse(owner,actor,companyWide,'utilities/biometric');
 if(hostedWithoutLink())throw new RequestError(NO_MACHINES,503);
 // 'url' lets Test check an address before it is saved.
 const base=linked()?RELAY_URL:q.get('url')!==null?cleanBioUrl(q.get('url')||''):settings.config.url;if(!base)throw new RequestError('Enter the address as http://127.0.0.1:5180 (or http://<computer>:<port>).');
 if(view==='state'){const s=await stateOf(base);return Response.json({...s,url:base},{headers:{'Cache-Control':'no-store'}});}
 // Machine users = the user IDs in the last two months' punches (with the name the app shows and the machines used).
 // The app's own user list is not used: it looks up each user's last punch separately, which is far too slow on a
 // database with years of punches and would block the app meanwhile.
 if(view==='users'){
  const used=await machineFilter(base,settings.config.devices);
  const csv=await app<string>(base,'/api/export/logs?'+new URLSearchParams({from:shift(today(),-61),to:today()}),{timeout:120000},'text');const users=new Map<string,BioUser>();
  for(const p of parseLogsCsv(csv)){if(!used(p.machine))continue;const u=users.get(p.userId)||{userId:p.userId,name:'',devices:[],lastPunch:null,punches:0};if(!u.name&&p.name)u.name=p.name;if(!u.devices.includes(p.machine))u.devices.push(p.machine);if(!u.lastPunch||p.ts>u.lastPunch)u.lastPunch=p.ts;u.punches++;users.set(p.userId,u);}
  return Response.json({users:[...users.values()]},{headers:{'Cache-Control':'no-store'}});}
 if(view==='punches'){
  const from=q.get('from')||'',to=q.get('to')||'';if(!real(from)||!real(to)||from>to)throw new RequestError('Choose a valid date range.');
  if(Date.parse(to)-Date.parse(from)>62*864e5)throw new RequestError('Fetch at most two months at a time.');
  // One day either side, so night duties that cross midnight are complete.
  const lo=shift(from,-1),hi=shift(to,1);const used=await machineFilter(base,settings.config.devices);
  const csv=await app<string>(base,'/api/export/logs?'+new URLSearchParams({from:lo,to:hi}),{timeout:120000},'text');
  const users:BioPunches['users']=Object.create(null);let punches=0;   // no prototype: a machine user ID such as __proto__ is only a key (and such an ID is skipped)
  for(const p of parseLogsCsv(csv)){if(!used(p.machine)||p.userId==='__proto__'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(p.ts))continue;const u=users[p.userId]||(users[p.userId]={name:'',t:[]});if(!u.name&&p.name)u.name=p.name;u.t.push(p.ts.slice(0,16));punches++;}
  for(const u of Object.values(users))u.t.sort();
  // A login limited to some locations gets only the punches of machine users that belong to employees of those locations (matched as the screens match them).
  // A machine ID that an employee of another location carries as card number or paycode too is left out unless a saved match names the own employee:
  // otherwise a login could give a new employee of its own the card number of somebody elsewhere and read that person's punches.
  if(unitLimited(actor)){
   const own=await hrEmployees(owner,dataset,actor),ownIds=new Set(own.map(e=>e.id)),bare=(v:string)=>v.trim().toLowerCase().replace(/^0+(?=.)/,'');
   const foreign=new Set<string>();for(const e of await allEmployees(owner,dataset))if(!ownIds.has(e.id)){if(e.cardNo)foreign.add(bare(e.cardNo));if(e.paycode)foreign.add(bare(e.paycode));}
   const match=matchAll(own,settings.map,Object.keys(users));punches=0;
   for(const [id,u] of Object.entries(users)){const m=match.get(id);if(m?.employeeId&&(m.how==='manual'||!foreign.has(bare(id))))punches+=u.t.length;else delete users[id];}
  }
  return Response.json({users,punches,from,to} satisfies BioPunches,{headers:{'Cache-Control':'no-store'}});}
 throw new RequestError('Unknown view.');
}catch(error){return fail(error);}}

async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);
 if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,400000)));if(!input||typeof input!=='object'||Array.isArray(input))throw new RequestError('Invalid request.');
 const dataset=datasetKey.parse(input.dataset);await validDataset(owner,dataset);const revision=Number(input.revision)||0;
 // Settings, the employee match and machine downloads belong to Machine Setup; the fetch history is also written by Time Updation.
 const actor=await hrIdentity(owner);await needScreen(owner,actor,input.action==='add-history'?['utilities/biometric','transaction/time']:'utilities/biometric','edit');
 if(input.action!=='add-history'&&unitLimited(actor))await refuse(owner,actor,companyWide,'utilities/biometric');
 if(input.action==='save-config'){
  // on a server with the office link the address is not used: whatever was saved stays
  const url=linked()?(await read<BioConfig>(owner,dataset,'config',{url:DEFAULT_BIO_URL,devices:[]})).value.url||DEFAULT_BIO_URL:cleanBioUrl(String(input.config?.url||''));if(!url)throw new RequestError('Enter the address as http://127.0.0.1:5180 (or http://<computer>:<port>).');
  const devices=Array.isArray(input.config?.devices)?[...new Set((input.config.devices as unknown[]).map(Number).filter(n=>Number.isInteger(n)&&n>0))].slice(0,50):[];
  const saved=await write(owner,dataset,'config',{url,devices},revision);await note(owner,'edit',`Saved the biometric machine settings (${devices.length} machine${devices.length===1?'':'s'} ticked)`,{screen:'utilities/biometric',dataset});
  return Response.json({revision:saved});}
 if(input.action==='save-map'){
  const raw=input.map&&typeof input.map==='object'&&!Array.isArray(input.map)?input.map as Record<string,unknown>:null;if(!raw)throw new RequestError('Invalid request.');
  const map:BioMap={};for(const [k,v] of Object.entries(raw)){const key=k.trim(),value=String(v??'').trim();if(!key||key.length>40||!value||value.length>80||key==='__proto__')continue;map[key]=value;}
  if(Object.keys(map).length>20000)throw new RequestError('Too many entries.');
  // Choices pointing at an employee who is no longer in this company (deleted since) are dropped, so they never block a save.
  if(Object.values(map).some(v=>v!=='-')){const ids=[...new Set(Object.values(map).filter(v=>v!=='-'))];const found=new Set<string>();
   for(let i=0;i<ids.length;i+=90){const part=ids.slice(i,i+90);const rows=await db().prepare(`SELECT id FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND id IN (${part.map(()=>'?').join(',')})`).bind(owner,dataset,...part).all<{id:string}>();for(const r of rows.results)found.add(r.id);}
   for(const [k,v] of Object.entries(map))if(v!=='-'&&!found.has(v))delete map[k];}
  const saved=await write(owner,dataset,'map',map,revision);await note(owner,'edit','Saved the machine user to employee match',{screen:'utilities/biometric',dataset});
  return Response.json({revision:saved});}
 if(input.action==='add-history'){
  const e=input.entry||{};const entry:BioHistoryEntry={at:new Date().toISOString(),month:/^\d{4}-\d{2}$/.test(e.month)?e.month:'',from:Number(e.from)||0,to:Number(e.to)||0,employees:Number(e.employees)||0,days:Number(e.days)||0,unmatched:Number(e.unmatched)||0,calculated:!!e.calculated};
  for(let attempt=0;attempt<3;attempt++){const h=await read<BioHistoryEntry[]>(owner,dataset,'history',[]);try{await write(owner,dataset,'history',[entry,...h.value].slice(0,100),h.revision);return Response.json({ok:true});}catch(error){if(!(error instanceof RequestError)||error.status!==409)throw error;}}
  throw new RequestError('The fetch history could not be saved.',409);}
 // Asks the app to download one machine (it reads the machine; the machine's own data is never changed).
 if(input.action==='download'||input.action==='auto'){
  if(hostedWithoutLink())throw new RequestError(NO_MACHINES,503);
  const settings=await settingsOf(owner,dataset);const base=linked()?RELAY_URL:settings.config.url;
  if(input.action==='auto'){const minutes=Number(input.minutes);if(![0,15,30,60,120].includes(minutes))throw new RequestError('Choose 0, 15, 30, 60 or 120 minutes.');
   await app(base,'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({autoMinutes:minutes})});await note(owner,'edit',`Set the automatic machine download to ${minutes?'every '+minutes+' minutes':'off'}`,{screen:'utilities/biometric',dataset});return Response.json({ok:true});}
  const id=Number(input.deviceId);if(!Number.isInteger(id)||id<1)throw new RequestError('Choose a machine.');
  // Through the office link the answer may take longer than a hosting waits for one request (about a minute): the download goes on at the office, the screen asks again
  let result:{users:number;logs:number;newLogs:number;seconds:number};
  try{const raw=await app<Record<string,unknown>>(base,`/api/devices/${id}/download`,{method:'POST',timeout:300000});result={users:num(raw.users),logs:num(raw.logs),newLogs:num(raw.newLogs),seconds:num(raw.seconds)};}
  catch(error){if(linked()&&error instanceof RequestError&&error.status===504){await note(owner,'edit',`Asked the office computer to download machine ${id} (still running)`,{screen:'utilities/biometric',dataset});return Response.json({pending:true,logs:0,newLogs:0,users:0,seconds:0});}throw error;}
  await note(owner,'edit',`Downloaded the punches of machine ${id} (${result.newLogs} new)`,{screen:'utilities/biometric',dataset});
  return Response.json(result);}
 throw new RequestError('Unknown action.');
}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(error);}}
export const POST=drained(postHandler);
