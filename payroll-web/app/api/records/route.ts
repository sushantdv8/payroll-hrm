import {monthNo} from '@/lib/dataset-year';
import {hrIdentity,hrEmployees,assertHr,unitAllowed,hrRows} from '@/lib/hr-store';
import {employeeSchema,holidaySchema,type AttendanceMonth,type Employee,type Holiday} from '@/lib/payroll';
import {monthPunches} from '@/lib/punch-index';
import {ownerId,db,checkOrigin,fail,decoded,readBounded,ensureEmployee,RequestError,visibleImport,validDataset,imageKeyOk,drained} from '@/lib/server-store';
import {saveAttendance} from '@/lib/attendance-store';
import {datasetKey} from '@/lib/full-import';
import {needScreen,refuse,note} from '@/lib/guard';
import {redactEmployees,screenRight} from '@/lib/access';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);let dataset=url.searchParams.get('dataset');
 if(!dataset){const old=await db().prepare('SELECT data FROM backup_settings WHERE owner=?').bind(owner).first<{data:string}>();dataset=old?JSON.parse(old.data).sourceDataset:'manual';}dataset=datasetKey.parse(dataset);await validDataset(owner,dataset);const actor=await hrIdentity(owner);assertHr(actor,dataset,'employees');
 const month=url.searchParams.get('month');
 if(month){assertHr(actor,dataset,'attendance');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RequestError('Choose a valid month.');const employeeId=url.searchParams.get('employeeId');
 if(employeeId){await ensureEmployee(owner,employeeId);const row=await db().prepare(`SELECT data,revision FROM attendance WHERE owner=? AND employee_id=? AND month=? AND ${visibleImport}`).bind(owner,employeeId,month).first<{data:string;revision:number}>();return Response.json({attendance:row?decoded(row):null},{headers:{'Cache-Control':'no-store'}});}
 const rows=await db().prepare("SELECT a.data,a.revision FROM attendance a JOIN employees e ON e.id=a.employee_id AND e.owner=a.owner WHERE a.owner=? AND a.month=? AND e.dataset=? AND e.deleted=0 AND (a.import_id IS NULL OR a.import_id IN (SELECT id FROM source_datasets WHERE status='complete')) AND (e.import_id IS NULL OR e.import_id IN (SELECT id FROM source_datasets WHERE status='complete'))").bind(owner,month,dataset).all<{data:string;revision:number}>();
 const visible=new Set((await hrEmployees(owner,dataset,actor)).map(e=>e.id));const attendance=(rows.results.map(decoded) as AttendanceMonth[]).filter(r=>visible.has(r.employeeId));
 // Reports (?punches=1) also get the original machine punches of imported days that have not been saved here since.
 if(url.searchParams.get('punches')==='1'&&dataset!=='manual'){const punches=await monthPunches(owner,dataset,monthNo(dataset,month));
  for(const a of attendance){const p=a.sourceKey?punches[a.sourceKey]:undefined;if(p)a.days=a.days.map(d=>{if(d.machineIn!==undefined||d.machineOut!==undefined)return d;const [i='',o='']=(p[d.day-1]||'').split('|');return {...d,machineIn:i,machineOut:o};});}}
 return Response.json({attendance},{headers:{'Cache-Control':'no-store'}});}
 const [employees,holidays]=await Promise.all([db().prepare(`SELECT data,revision,dataset FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND ${visibleImport} ORDER BY paycode COLLATE NOCASE`).bind(owner,dataset).all<{data:string;revision:number;dataset:string}>(),db().prepare('SELECT data,revision,dataset FROM holidays WHERE owner=? AND dataset=? AND deleted=0').bind(owner,dataset).all<{data:string;revision:number;dataset:string}>()]);
 // The family, identity, address and bank details go only to the screens that work with them (lib/access.ts).
 return Response.json({employees:redactEmployees(actor,employees.results.map(decoded).filter(e=>unitAllowed(actor,e.location))),holidays:holidays.results.map(decoded).filter(h=>!h.locations.length||h.locations.some((u:string)=>unitAllowed(actor,u)))},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return fail(error);}}

// A holiday that applies to no location in particular applies to all of them: only a login with every location may change it.
const holidayInScope=(actor:Awaited<ReturnType<typeof hrIdentity>>,locations:string[])=>locations.length?locations.every(l=>unitAllowed(actor,l)):unitAllowed(actor,'*');

async function postHandler(request:Request){try{const owner=await ownerId();checkOrigin(request);if(Number(request.headers.get('content-length')||0)>120000)throw new RequestError('This record is too large.');if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');const raw=new TextDecoder().decode(await readBounded(request,120000));if(raw.length>120000)throw new RequestError('This record is too large.');const input=JSON.parse(raw);if(!input||typeof input!=='object'||Array.isArray(input))throw new RequestError('Invalid request.');const now=new Date().toISOString();
if(input.action==='employee-save'||input.action==='holiday-save'){
 const isEmployee=input.action==='employee-save';const sent=isEmployee?employeeSchema.parse(input.data):holidaySchema.parse(input.data);
 if(isEmployee){const e=sent as Employee;if(!imageKeyOk(owner,e.photoKey)||!imageKeyOk(owner,e.signatureKey))throw new RequestError('Invalid image reference.');}
 const table=isEmployee?'employees':'holidays';const stored=await db().prepare(`SELECT revision,data,dataset FROM ${table} WHERE id=? AND owner=? AND deleted=0`).bind(sent.id,owner).first<{revision:number;data:string;dataset:string}>();await validDataset(owner,sent.dataset);
 if(stored&&sent.dataset!==stored.dataset)throw new RequestError('The dataset of a record cannot be changed.',409);
 const actor=await hrIdentity(owner),old=stored?JSON.parse(stored.data) as Employee&Holiday:undefined;
 // The record that is saved: what the login sent - or, for the screens that change only a few fields of an employee, the stored record with just those fields.
 let value:Employee|Holiday=sent;
 if(isEmployee){
  const mine=sent as Employee,before=old as Employee|undefined;
  if(!stored)await needScreen(owner,actor,'master/employee','add');
  else if(!screenRight(actor,'master/employee','edit')){
   // Resignation sets the leaving date (and its remarks); PF KYC UPLOAD / Form 19 set the PAN, Aadhaar and passport numbers. Nothing else changes through them.
   const fields:(keyof Employee)[]=[...(screenRight(actor,'transaction/resignation','edit')?['resignDate','remarks'] as const:[]),...(screenRight(actor,'reports/pf/kyc','edit')||screenRight(actor,'reports/pf/form19','edit')?['pan','aadhaar','passport'] as const:[])];
   if(!fields.length)await needScreen(owner,actor,['master/employee','transaction/resignation','reports/pf/kyc','reports/pf/form19'],'edit');
   value={...before!,...Object.fromEntries(fields.map(k=>[k,mine[k]])),revision:mine.revision} as Employee;
  }
  const next=value as Employee;
  if(!unitAllowed(actor,next.location)||(before&&!unitAllowed(actor,before.location)))await refuse(owner,actor,'This location is not assigned to your login.','master/employee');
  if(stored){if((next.doj!==before!.doj||next.resignDate!==before!.resignDate)&&(await hrRows(owner,stored.dataset,'exit')).some(r=>r.employeeId===next.id&&r.status==='settled'))throw new RequestError('Employment dates are locked after final settlement.',409);
   if(next.sourceDataset!==before!.sourceDataset||next.sourceKey!==before!.sourceKey)throw new RequestError('The source of an employee record cannot be changed.',409);}
  else if(next.sourceDataset!==undefined||next.sourceKey!==undefined)throw new RequestError('The source of an employee record cannot be changed.',409);
 }else{
  const mine=sent as Holiday;
  await needScreen(owner,actor,'master/holiday',stored?'edit':'add');
  if(!holidayInScope(actor,mine.locations)||(old&&!holidayInScope(actor,old.locations)))await refuse(owner,actor,'This holiday applies to a location that is not assigned to your login.','master/holiday');
 }
 if(stored&&stored.revision!==value.revision)throw new RequestError('This record changed in another window. Close and reopen it before saving.',409);if(!stored&&value.revision!==0)throw new RequestError('This record is no longer available.',409);
 const revision=(stored?.revision||0)+1;const data=JSON.stringify({...value,revision});let statement;
 if(stored)statement=isEmployee?db().prepare('UPDATE employees SET data=?,paycode=?,revision=?,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted=0').bind(data,(value as Employee).paycode,revision,now,value.id,owner,value.revision):db().prepare('UPDATE holidays SET data=?,revision=?,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted=0').bind(data,revision,now,value.id,owner,value.revision);
 else statement=isEmployee?db().prepare('INSERT INTO employees(id,owner,paycode,data,revision,updated_at,dataset) VALUES(?,?,?,?,?,?,?)').bind(value.id,owner,(value as Employee).paycode,data,revision,now,value.dataset):db().prepare('INSERT INTO holidays(id,owner,data,revision,updated_at,dataset) VALUES(?,?,?,?,?,?)').bind(value.id,owner,data,revision,now,value.dataset);
 const result=await statement.run();if(result.meta.changes!==1)throw new RequestError('Record changed. Reopen it and try again.',409);
 const what=isEmployee?`employee ${(value as Employee).paycode} ${(value as Employee).name}`:`holiday ${(value as Holiday).name} (${(value as Holiday).date})`;
 await note(owner,stored?'edit':'add',`${stored?'Changed':'Added'} ${what}`,{screen:isEmployee?'master/employee':'master/holiday',dataset:value.dataset});return Response.json({record:{...value,revision}});}
if(input.action==='attendance-save'){const record=await saveAttendance(owner,input.data,now);await note(owner,'edit',`Saved attendance ${record.month}`,{screen:'transaction/time',detail:{employeeId:record.employeeId}});return Response.json({record});}
if(input.action==='employee-delete'||input.action==='holiday-delete'){
 if(typeof input.id!=='string'||!Number.isInteger(input.revision))throw new RequestError('Invalid record.');const isEmp=input.action==='employee-delete';const actor=await hrIdentity(owner);await needScreen(owner,actor,isEmp?'master/employee':'master/holiday','delete');
 const table=isEmp?'employees':'holidays';const row=await db().prepare(`SELECT data,dataset FROM ${table} WHERE id=? AND owner=? AND revision=? AND deleted=0`).bind(input.id,owner,input.revision).first<{data:string;dataset:string}>();if(!row)throw new RequestError('Record changed. Refresh and try again.',409);
 await validDataset(owner,row.dataset);const shown=JSON.parse(row.data) as Employee&Holiday;
 if(isEmp?!unitAllowed(actor,shown.location):!holidayInScope(actor,shown.locations))await refuse(owner,actor,isEmp?'This employee is outside your assigned locations.':'This holiday applies to a location that is not assigned to your login.',isEmp?'master/employee':'master/holiday');
 const result=await db().prepare(`UPDATE ${table} SET deleted=1,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted=0`).bind(now,input.id,owner,input.revision).run();if(result.meta.changes!==1)throw new RequestError('Record changed. Refresh and try again.',409);
 await note(owner,'delete',isEmp?`Deleted employee ${shown.paycode} ${shown.name}`:`Deleted holiday ${shown.name} (${shown.date})`,{screen:isEmp?'master/employee':'master/holiday',dataset:row.dataset,detail:{id:input.id}});return Response.json({deleted:true});}
throw new RequestError('Unknown action.');}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(error);}}
export const POST=drained(postHandler);
