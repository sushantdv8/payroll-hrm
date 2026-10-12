import {monthNo as monthNoOfDataset} from '@/lib/dataset-year';
import {ownerId,db,fail,RequestError,validDataset} from '@/lib/server-store';
import {readSourceTable,type SourceTable} from '@/lib/source-archive';
import {datasetKey} from '@/lib/full-import';
import {attendanceCodes,monthDays,type AttendanceMonth} from '@/lib/payroll';
export const dynamic='force-dynamic';

// The original software keeps a second attendance register (tbtimed / tbtimehd / tbmatdd) that its
// Muster Roll (FORM No. 12), Form 14 and Leave Detail reports print; it is separate from the daily
// attendance used for salary. This returns that register for one month in the app's attendance shape,
// with the months changed in Transaction › Times (saved as 'register' edits) in place of the original.
const rowsOf=(t:SourceTable|null)=>(t?.rows||[]).map(r=>Object.fromEntries(t!.columns.map((c,i)=>[c.name,(r[i]??'').trim()])));
const num=(v:string|undefined)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const known=new Set<string>(attendanceCodes);
const clock=(v:string|undefined)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')?v!:'';
const hours=(v:string|undefined)=>/^([01]?\d|2[0-3]):[0-5]\d$/.test(v||'')&&v!=='00:00'&&v!=='0:00'?v!:'';

export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);const dataset=datasetKey.parse(url.searchParams.get('dataset'));await validDataset(owner,dataset);
 const month=url.searchParams.get('month')||'';if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RequestError('Choose a valid month.');
 const monthNo=monthNoOfDataset(dataset,month);
 const edits=await db().prepare("SELECT m.record_key,m.data,m.revision FROM master_records m JOIN employees e ON e.id=substr(m.record_key,1,instr(m.record_key,'|')-1) AND e.owner=m.owner AND e.deleted=0 WHERE m.owner=? AND m.dataset=? AND m.table_name='register' AND m.deleted=0 AND m.record_key LIKE ?").bind(owner,dataset,'%|'+month).all<{record_key:string;data:string;revision:number}>();
 const edited=new Map(edits.results.map(r=>[r.record_key.split('|')[0],{...JSON.parse(r.data) as AttendanceMonth,revision:r.revision}]));
 const out:AttendanceMonth[]=[];let available=edited.size>0;
 const [time,timeh,matd,codes]=dataset==='manual'||monthNo<1?[null,null,null,null]:await Promise.all(['tbtimed','tbtimehd','tbmatdd','tbattd'].map(t=>readSourceTable(owner,dataset,t)));
 if(time){available=true;
  const mark=new Map(rowsOf(codes).map(c=>[c.at_code,c.at_name]));
  const employees=await db().prepare("SELECT id,json_extract(data,'$.sourceKey') k FROM employees WHERE owner=? AND dataset=? AND deleted=0").bind(owner,dataset).all<{id:string;k:string|null}>();
  const idOf=new Map(employees.results.filter(e=>e.k).map(e=>[String(e.k),e.id]));
  const key=(r:Record<string,string>)=>r.emp_code+'|'+r.month_no;
  const hMap=new Map(rowsOf(timeh).filter(r=>num(r.month_no)===monthNo).map(r=>[key(r),r]));const tMap=new Map(rowsOf(matd).filter(r=>num(r.month_no)===monthNo).map(r=>[key(r),r]));
  const n=monthDays(month);
  for(const r of rowsOf(time)){
   if(num(r.month_no)!==monthNo)continue;const employeeId=idOf.get(r.emp_code);if(!employeeId||edited.has(employeeId))continue;const h=hMap.get(key(r));const t=tMap.get(key(r));
   const code=(v:string)=>{const m=mark.get(v)||'';return known.has(m)?m as AttendanceMonth['days'][number]['first']:'';};
   const days=Array.from({length:n},(_,k)=>{const d=k+1;return {day:d,machineIn:clock(r['idt'+d]),machineOut:clock(r['odt'+d]),manualIn:clock(r['midt'+d]),manualOut:clock(r['modt'+d]),shift:h?.['s'+d]||'',first:code(r['at'+d]),second:code(r['ad'+d]),ot:hours(h?.['oth'+d]),late:hours(h?.['lth'+d]),sourceStatus:h?.['atp'+d]||undefined,sourceFirstCode:r['at'+d]||undefined,sourceSecondCode:r['ad'+d]||undefined,sourceLateHours:h?.['lth'+d]||undefined,workHours:h?.['thr'+d]||undefined};});
   const leave=['EL','PL','CL','SL','CO','SP','MT'].reduce((s,c)=>s+num(t?.[c]),0);
   out.push({employeeId,month,revision:0,sourceDataset:dataset,sourceKey:r.emp_code,days,totals:t?{worked:num(t.wd),weeklyOff:num(t.wo),holiday:num(t.hd),leave,payable:num(t.pd),absent:num(t.ab)}:{worked:'',weeklyOff:'',holiday:'',leave:'',payable:'',absent:''},leaveLedger:[]});
  }}
 out.push(...edited.values());
 return Response.json({attendance:out,available},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
