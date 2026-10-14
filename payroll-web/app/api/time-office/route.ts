import {monthNo} from '@/lib/dataset-year';
import {monthSchema,monthDays} from '@/lib/payroll';
import {ownerId,db,checkOrigin,fail,readBounded,ensureEmployee,RequestError,validDataset,drained} from '@/lib/server-store';
import {datasetKey} from '@/lib/full-import';
import {saveAttendance} from '@/lib/attendance-store';
import {monthPunches} from '@/lib/punch-index';
import {hrIdentity,assertHr} from '@/lib/hr-store';
import {needScreen,note} from '@/lib/guard';
import {employeeScope,onlyCodes} from '@/lib/unit-scope';
export const dynamic='force-dynamic';

const monthNoOf=(month:string,dataset:string)=>monthNo(dataset,month);
const LIMIT=1_500_000;

// GET: the machine punches of one month (imported datasets), keyed by the original employee code.
export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);const dataset=datasetKey.parse(url.searchParams.get('dataset'));await validDataset(owner,dataset);const actor=await hrIdentity(owner);assertHr(actor,dataset,'attendance');
 const month=url.searchParams.get('month')||'';if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RequestError('Choose a valid month.');
 const punches=dataset==='manual'?{}:onlyCodes(await employeeScope(owner,dataset,actor),await monthPunches(owner,dataset,monthNoOf(month,dataset)));
 return Response.json({punches},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}

// POST: saves many employee-months at once (Machine Download / Update All / Machine Data Copy for all employees),
// or the Times register months (kept as edits over the original register).
async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);if(Number(request.headers.get('content-length')||0)>LIMIT)throw new RequestError('Too many records in one request.');
 if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,LIMIT)));if(!input||typeof input!=='object'||!Array.isArray(input.rows)||input.rows.length>100)throw new RequestError('Invalid request.');
 const now=new Date().toISOString();const results:{employeeId:string;revision?:number;error?:string}[]=[];
 if(input.action==='attendance-save-many'){
  for(const row of input.rows){try{const saved=await saveAttendance(owner,row,now);results.push({employeeId:saved.employeeId,revision:saved.revision});}catch(error){results.push({employeeId:String(row?.employeeId||''),error:error instanceof RequestError?error.message:'Could not save this month.'});}}
  const saved=results.filter(r=>r.revision!==undefined).length;if(saved)await note(owner,'edit',`Saved attendance of ${saved} employee${saved===1?'':'s'}${typeof input.rows[0]?.month==='string'?' for '+input.rows[0].month:''}`,{screen:'transaction/time'});
  return Response.json({results});}
 if(input.action==='register-save-many'){
  const dataset=datasetKey.parse(input.dataset);await validDataset(owner,dataset);await needScreen(owner,await hrIdentity(owner),'transaction/times','edit');
  for(const row of input.rows){try{
   const value=monthSchema.parse(row);await ensureEmployee(owner,value.employeeId);
   const employee=await db().prepare('SELECT dataset FROM employees WHERE id=? AND owner=?').bind(value.employeeId,owner).first<{dataset:string}>();if(employee?.dataset!==dataset)throw new RequestError('This employee belongs to another company.');
   const count=monthDays(value.month);if(value.days.length!==count||new Set(value.days.map(d=>d.day)).size!==count||value.days.some(d=>d.day>count))throw new RequestError('Check the days for this month.');
   const key=value.employeeId+'|'+value.month;
   const stored=await db().prepare("SELECT id,revision FROM master_records WHERE owner=? AND dataset=? AND table_name='register' AND record_key=?").bind(owner,dataset,key).first<{id:string;revision:number}>();
   if((stored?.revision||0)!==value.revision)throw new RequestError('This register month changed in another window. Reload it before saving.',409);
   const revision=value.revision+1;const data=JSON.stringify({...value,revision});
   const result=stored?await db().prepare("UPDATE master_records SET data=?,revision=?,deleted=0,updated_at=? WHERE id=? AND owner=? AND revision=?").bind(data,revision,now,stored.id,owner,value.revision).run()
    :await db().prepare("INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,'register',?,?,'edited',?,0,?)").bind(crypto.randomUUID(),owner,dataset,key,data,revision,now).run();
   if(result.meta.changes!==1)throw new RequestError('This register month changed. Reload it before saving.',409);
   results.push({employeeId:value.employeeId,revision});
  }catch(error){results.push({employeeId:String(row?.employeeId||''),error:error instanceof RequestError?error.message:'Could not save this month.'});}}
  const saved=results.filter(r=>r.revision!==undefined).length;if(saved)await note(owner,'edit',`Saved the muster register of ${saved} employee${saved===1?'':'s'}`,{screen:'transaction/times',dataset});
  return Response.json({results});}
 throw new RequestError('Unknown action.');
}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(error);}}
export const POST=drained(postHandler);
