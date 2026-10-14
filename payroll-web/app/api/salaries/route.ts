import {saveSalary as saveOne,deleteSalary} from '@/lib/hr-salary-store';
import {salarySnapshotSchema,MANUAL_SALARY,type SalarySnapshot} from '@/lib/backup';
import {ownerId,db,checkOrigin,fail,readBounded,RequestError,ensureEmployee,validDataset,drained} from '@/lib/server-store';
import {datasetKey} from '@/lib/full-import';
import {hrIdentity} from '@/lib/hr-store';
import {needScreen,note} from '@/lib/guard';
import {employeeScope} from '@/lib/unit-scope';
export const dynamic='force-dynamic';

const monthRe=/^\d{4}-(0[1-9]|1[0-2])$/;
const sum=(items:{amount:number|null}[])=>Math.round(items.reduce((s,i)=>s+(i.amount||0),0)*100)/100;
const revisionOf=(data:SalarySnapshot)=>data.revision??1;

// Salary Prepairation / Salary Deletion. Imported snapshots may be modified (the original stays in the source archive)
// but keep their source identity and cannot be deleted; salary entered here can be edited and deleted.
async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');
 // Generate All and Save sends up to 200 salaries (each with its heads' rates and arrears) in one request.
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,600000)));if(!input||typeof input!=='object'||Array.isArray(input))throw new RequestError('Invalid request.');
 if(input.action==='salary-save'){const record=await saveOne(owner,input.data);await note(owner,(record.revision??1)<=1?'add':'edit',`Saved salary ${record.month}`,{screen:'transaction/salary',detail:{employeeId:record.employeeId}});return Response.json({record});}
 // Prepare-all: saves calculated salaries one by one and reports which employees could not be saved.
 if(input.action==='salary-save-many'){
  if(!Array.isArray(input.records)||input.records.length>200)throw new RequestError('Send at most 200 salaries at a time.');
  const saved:string[]=[];const failed:{employeeId:string;error:string}[]=[];
  for(const item of input.records){try{saved.push((await saveOne(owner,item)).employeeId);}catch(error){failed.push({employeeId:String((item as {employeeId?:string})?.employeeId||''),error:error instanceof RequestError?error.message:'Could not be saved.'});}}
  if(saved.length)await note(owner,'edit',`Saved salary of ${saved.length} employee${saved.length===1?'':'s'}${typeof input.records[0]?.month==='string'?' for '+input.records[0].month:''}`,{screen:'transaction/salary'});
  return Response.json({saved:saved.length,failed});
 }
 if(input.action==='salary-delete'){
  if(typeof input.employeeId!=='string'||typeof input.month!=='string'||!monthRe.test(input.month)||!Number.isInteger(input.revision))throw new RequestError('Invalid salary record.');
  await ensureEmployee(owner,input.employeeId);
  const stored=await db().prepare('SELECT id,data FROM salary_snapshots WHERE owner=? AND employee_id=? AND month=?').bind(owner,input.employeeId,input.month).first<{id:string;data:string}>();
  if(!stored)throw new RequestError('This salary is no longer available.',404);const data=JSON.parse(stored.data) as SalarySnapshot;
  if(data.sourceDataset!==MANUAL_SALARY)throw new RequestError('Imported salary history is kept. Use Modify to correct it.',409);
  if(revisionOf(data)!==input.revision)throw new RequestError('This salary changed in another window. Reload before deleting.',409);
  await deleteSalary(owner,input.employeeId,input.month,input.revision);
  await note(owner,'delete',`Deleted salary ${input.month}`,{screen:'transaction/salary-delete',detail:{employeeId:input.employeeId}});
  return Response.json({deleted:1});
 }
 if(input.action==='salary-delete-month'){
  const dataset=datasetKey.parse(input.dataset);if(typeof input.month!=='string'||!monthRe.test(input.month))throw new RequestError('Choose a valid month.');
  await validDataset(owner,dataset);const actor=await hrIdentity(owner);await needScreen(owner,actor,['transaction/salary-delete','transaction/salary'],'delete');
  const scope=await employeeScope(owner,dataset,actor);
  const found=await db().prepare("SELECT employee_id,data FROM salary_snapshots WHERE owner=? AND month=? AND import_id IS NULL AND json_extract(data,'$.sourceDataset')=? AND employee_id IN (SELECT id FROM employees WHERE owner=? AND dataset=?)").bind(owner,input.month,MANUAL_SALARY,owner,dataset).all<{employee_id:string;data:string}>();
  const result={results:found.results.filter(r=>!scope||scope.ids.has(r.employee_id))};let deleted=0;const failed:{employeeId:string;error:string}[]=[];for(const r of result.results){try{await deleteSalary(owner,r.employee_id,input.month,JSON.parse(r.data).revision??1);deleted++;}catch(e){failed.push({employeeId:r.employee_id,error:e instanceof Error?e.message:'Could not delete.'});}}if(deleted)await note(owner,'delete',`Deleted the salary of ${deleted} employee${deleted===1?'':'s'} for ${input.month}`,{screen:'transaction/salary-delete',dataset});return Response.json({deleted,failed});
 }
 throw new RequestError('Unknown action.');
}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(error);}}
export const POST=drained(postHandler);
