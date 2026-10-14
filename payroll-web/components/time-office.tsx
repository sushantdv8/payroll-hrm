import {type Punch} from '@/lib/multi-punch';
'use client';
import './time-office.css';
import './biometric.css';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {attendanceCodes,emptyMonth,monthDays,type AttendanceDay,type AttendanceMonth,type Employee,type Holiday} from '@/lib/payroll';
import {requestJson,saveRecord} from '@/lib/client-api';
import {pickMonths,monthLabel,realResignDate,type Extra} from '@/lib/report-utils';
import type {MasterRow} from '@/lib/masters';
import {defaultHrSettings,type HrSettings,type HrRecord} from '@/lib/hrm';
import {unitShifts,shiftFromHr} from '@/lib/hr-shifts';
import {punchText,parsePunchText,analysePunches} from '@/lib/multi-punch';
import {calcPunchDay,defaultShift,generateRegister,hhmm,impliedDeduct,monthFigures,processMonth,registerFromDaily,resolveWeeklyOffs,shiftRulesFrom,withTotals,type Employment,type Mark,type ShiftRule} from '@/lib/time-calc';
import {readPunchFile,type PunchCopy} from '@/lib/punch-file';
import {dutyDays,matchAll,type BioPunches,type BioSettings} from '@/lib/biometric';
import {EmployeePick,pickLabel as listLabel,sortEmployees} from './employee-pick';
import {useCanOpen} from './access-context';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';

// Transaction › Time Updation (mode 'daily': machine punches → attendance used for salary) and
// Transaction › Times (mode 'register': the separate muster register printed by Muster Roll / Form 14 / Leave Detail).
type Mode='daily'|'register';
type Punches=Record<string,string[]>;
type Ask={title:string;text:string;yes:()=>void;no?:()=>void};
type SaveResult={results:{employeeId:string;revision?:number;error?:string}[]};
type Mismatch={e:Employee;day:number;in:string;out:string};
// Biometric Fetch: the punches of the chosen days, read from the Biometric Attendance app and matched to employees.
type BioPreview={byEmployee:Map<string,Map<number,{in:string;out:string;punches?:Punch[]}>>;days:number;punches:number;unmatched:{userId:string;name:string;n:number}[];ignored:number;skipped:number};
type BioDialog={from:string;to:string;calc:boolean;loading:boolean;error:string;preview:BioPreview|null};
const LEAVE_ROWS=[['16','EL'],['17','PL'],['18','CL'],['19','SL'],['20','CO'],['21','MT']] as const;
const ENTRY_CODES=['EL','PL','CL','SL','CO','MT','SP','OD','WO','WO*','HD','P','A','LWP'] as const;
const kept=new Set(['EL','PL','CL','SL','CO','MT','SP','OD','LWP']);
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad=(n:number)=>String(n).padStart(2,'0');
const dojText=(v:string)=>/^\d{4}-\d{2}-\d{2}/.test(v)?`${v.slice(8,10)}/${MON[Number(v.slice(5,7))-1]}/${v.slice(0,4)}`:'';
const markClass=(m:string)=>m==='WO*'?'mk-WOs':m?'mk-'+m:'';
const num=(v:number)=>Number.isInteger(v)?String(v):v.toFixed(1);
const count=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
// Accepts 9:5, 0905 or 09:05 and returns HH:MM ('' for blank, null when invalid).
function normalTime(value:string){const s=value.trim();if(!s)return '';const m=/^(\d{1,2})[:.](\d{1,2})$/.exec(s)||/^(\d{2})(\d{2})$/.exec(s);if(!m)return null;const h=Number(m[1]),mi=Number(m[2]);return h>23||mi>59?null:pad(h)+':'+pad(mi);}

export function TimeOffice({mode,dataset,employees,holidays,month,setMonth,onDirty,onOpen}:{mode:Mode;dataset:string;employees:Employee[];holidays:Holiday[];month:string;setMonth:(m:string)=>void;onDirty:(v:boolean)=>void;onOpen?:(screen:string)=>void}){
 const client=useQueryClient();const canOpen=useCanOpen();
 const [employeeId,setEmployeeId]=useState('');const [edit,setEdit]=useState<{key:string;month:AttendanceMonth}|null>(null);
 const [busy,setBusy]=useState(false);const [status,setStatus]=useState('');const [ask,setAsk]=useState<Ask|null>(null);const [mismatch,setMismatch]=useState<Mismatch[]|null>(null);
 const [bio,setBio]=useState<BioDialog|null>(null);
 const [location,setLocation]=useState('');
 const [leave,setLeave]=useState<{code:string;from:string;to:string;half:'full'|'first'|'second';clear:boolean}>({code:'EL',from:'',to:'',half:'full',clear:false});
 const [gen,setGen]=useState({pd:'',el:'',cl:'',sl:'',hr:''});
 const fileRef=useRef<HTMLInputElement>(null);
 const key=`${mode}|${dataset}|${employeeId}|${month}`;const dirty=!!edit&&edit.key===key;
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);

 const masters=(table:string)=>({queryKey:['masters',dataset,table],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset,table}),{signal}),staleTime:600000});
 const hrQ=useQuery({queryKey:['hr-payroll',dataset],queryFn:()=>requestJson<{settings:HrSettings;records:HrRecord[]}>('/api/hr-payroll?'+new URLSearchParams({dataset})),refetchOnWindowFocus:false});const holidayLocationsQ=useQuery(masters('tbhol_loc')),monthlyShiftQ=useQuery(masters('tbshiftm')),employeeShiftQ=useQuery(masters('tbeshift'));const shiftsQ=useQuery(masters('tbshift'));const settingsQ=useQuery(masters('tbshiftset'));const holiQ=useQuery(masters('tbholi'));
 const extrasQ=useQuery({queryKey:['employee-extras',dataset],queryFn:({signal})=>requestJson<{extras:Record<string,Extra>}>('/api/employee-extras?'+new URLSearchParams({dataset}),{signal}),staleTime:600000});
 const punchesFetch={queryKey:['punches',dataset,month],queryFn:({signal}:{signal:AbortSignal})=>dataset==='manual'?Promise.resolve({punches:{} as Punches}):requestJson<{punches:Punches}>('/api/time-office?'+new URLSearchParams({dataset,month}),{signal}),staleTime:600000};
 const punchesQ=useQuery({...punchesFetch,enabled:mode==='daily'});
 const recordQ=useQuery({queryKey:['attendance',dataset,employeeId,month],queryFn:({signal})=>requestJson<{attendance:AttendanceMonth|null}>('/api/records?'+new URLSearchParams({employeeId,month,dataset}),{signal}),enabled:mode==='daily'&&!!employeeId});
 const registerFetch={queryKey:['register',dataset,month],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{attendance:AttendanceMonth[];available:boolean}>('/api/register?'+new URLSearchParams({dataset,month}),{signal}),staleTime:60000};
 const registerQ=useQuery({...registerFetch,enabled:mode==='register'});

 const hrSettings=hrQ.data?.settings||defaultHrSettings,hrRows=hrQ.data?.records||[];const shifts=shiftRulesFrom(shiftsQ.data?.rows||[],settingsQ.data?.rows||[]).map(s=>({...s,breakPolicy:hrSettings.breakPolicy,requiredMinutes:s.requiredMinutes??hrSettings.requiredDayHours*60}));
 const shiftOf=(name:string):ShiftRule=>[...shifts,...hrRows.filter(r=>r.module==='shifts').map(r=>({...shiftFromHr(r),breakPolicy:hrSettings.breakPolicy}))].find(s=>s.name===name)||shifts[0]||defaultShift;
 const n=monthDays(month);
 const extras=extrasQ.data?.extras||{};
 function jobOf(e:Employee):Employment{
  const profile=hrRows.find(r=>r.module==='salary-profile'&&r.employeeId===e.id)?.data;const x=extras[String(e.sourceKey||e.id)];const wk=Number(x?.wkOff||0);const off=Number.isInteger(wk)&&wk>=0&&wk<=6?wk:0;
  const offDays=new Set(Array.from({length:n},(_,k)=>k+1).filter(d=>new Date(`${month}-${pad(d)}T12:00:00`).getDay()===off));
  const ownShifts=unitShifts(shifts,hrRows,e.location);const holidayDays=new Set<number>();for(const r of hrRows.filter(r=>r.module==='holidays'&&(!r.unit||r.unit===e.location)))if(String(r.data.date).startsWith(month))holidayDays.add(Number(String(r.data.date).slice(8)));for(const h of holidays)if(h.date.startsWith(month)&&(!h.locations.length||h.locations.includes(e.location)))holidayDays.add(Number(h.date.slice(8,10)));for(const r of holiQ.data?.rows||[]){const date=(r.values.h_date||'').slice(0,10),locs=(holidayLocationsQ.data?.rows||[]).filter(l=>l.values.h_code===r.values.h_code);if(date.startsWith(month)&&(!locs.length||locs.some(l=>l.values.loc_code===x?.loc)))holidayDays.add(Number(date.slice(8,10)));}
  return {doj:(e.doj||'').slice(0,10),dol:realResignDate(e).slice(0,10),daily:profile?profile.salaryMode==='Daily':!!x?.salMode&&x.salMode!=='0',otAllowed:profile?!!profile.ot:x?.otAlw==='1',weeklyOffMinimum:hrSettings.paidWeeklyOffMinimum,shiftName:ownShifts.find(s=>s.code===(profile?.shiftCode||employeeShiftQ.data?.rows.find(r=>r.values.emp_code===String(e.sourceKey||e.id))?.values.sft_code||x?.sft))?.name||shifts[0]?.name||defaultShift.name,offDays,holidays:holidayDays};
 }
 const punchesOf=(e:Employee,all=punchesQ.data?.punches)=>e.sourceKey?all?.[String(e.sourceKey)]:undefined;
 function buildDaily(e:Employee,rec:AttendanceMonth|null,p:string[]|undefined):AttendanceMonth{
  const base=rec||emptyMonth(e.id,month);const job=jobOf(e);
  const monthly=monthlyShiftQ.data?.rows.find(r=>r.values.emp_code===String(e.sourceKey||e.id)&&Number(r.values.month_no)===(Number(month.slice(0,4))-2026)*12+Number(month.slice(5)));const days=base.days.map(original=>{const date=month+'-'+pad(original.day),roster=hrRows.find(r=>r.module==='roster'&&r.employeeId===e.id&&String(r.data.from)<=date&&String(r.data.to)>=date),code=String(roster?.data.shiftCode||monthly?.values['d'+original.day]||''),assigned=unitShifts(shifts,hrRows,e.location).find(s=>s.code===code);const d=assigned?{...original,shift:assigned.name}:original;if(d.machineIn!==undefined||d.machineOut!==undefined)return d;const [a='',b='']=(p?.[d.day-1]||'').split('|');
   const deduct=a&&b&&d.workHours?impliedDeduct(a,b,d.workHours,shiftOf(d.shift||job.shiftName)):0;return {...d,machineIn:a,machineOut:b,...(deduct?{deduct}:{})};});
  return {...base,days,leaveLedger:base.leaveLedger.length?base.leaveLedger:emptyMonth(e.id,month).leaveLedger};
 }
 // A month not yet in the register starts absent, with unpaid weekly offs (as the original shows it).
 function buildRegister(e:Employee,rows=registerQ.data?.attendance):AttendanceMonth{
  const saved=rows?.find(a=>a.employeeId===e.id);if(saved)return {...saved,leaveLedger:saved.leaveLedger.length?saved.leaveLedger:emptyMonth(e.id,month).leaveLedger};
  const job=jobOf(e);const blank=emptyMonth(e.id,month);
  return {...blank,days:blank.days.map(d=>{const date=`${month}-${pad(d.day)}`;const m:Mark=job.doj&&date<job.doj?'NJ':job.dol&&date>job.dol?'LF':job.offDays.has(d.day)?'WO*':'A';return {...d,machineIn:'',machineOut:'',shift:job.shiftName,first:m,second:m};})};
 }
 const activeIn=(e:Employee)=>{const dol=realResignDate(e);return !(dol&&dol<month+'-01')&&!(e.doj&&e.doj.slice(0,10)>`${month}-${pad(n)}`);};

 const employee=employees.find(e=>e.id===employeeId);
 const punchesReady=mode!=='daily'||!punchesQ.isPending;
 const loaded=!employee?null:mode==='daily'?(recordQ.data&&punchesReady?buildDaily(employee,recordQ.data.attendance,punchesOf(employee)):null):(registerQ.data?buildRegister(employee):null);
 const draft=dirty?edit!.month:loaded;
 const job=employee?jobOf(employee):null;

 const listed=sortEmployees(employees.filter(e=>!location||e.location===location),'paycode');
 const locations=Array.from(new Set(employees.map(e=>e.location).filter(Boolean))).sort();

 function select(e:Employee){if(busy)return false;if(e.id===employeeId)return true;if(dirty){toast.error('Save the changes (or press Cancel) before opening another employee.');return false;}setEmployeeId(e.id);setStatus('');return true;}
 function changeMonth(value:string){if(value===month||busy)return;if(dirty){toast.error('Save the changes (or press Cancel) before changing the month.');return;}setMonth(value);setLeave(l=>({...l,from:'',to:''}));setStatus('');}
 const change=(next:AttendanceMonth)=>setEdit({key,month:next});
 function recalcDays(m:AttendanceMonth,from:number,to:number,dropEntered=false):AttendanceMonth{
  if(mode!=='daily'||!employee||!job)return m;
  const days=m.days.map(d=>{if(d.day<from||d.day>to)return d;const r=calcPunchDay({in:d.manualIn||d.machineIn||'',out:d.manualOut||d.machineOut||'',shift:shiftOf(d.shift||job.shiftName),off:job.offDays.has(d.day),holiday:job.holidays.has(d.day),otAllowed:job.otAllowed,deduct:d.deduct||0,punches:d.manualIn||d.manualOut?undefined:d.punches});
   const kf=!dropEntered&&kept.has(d.first),ks=!dropEntered&&kept.has(d.second);return {...d,first:kf?d.first:r.first,second:ks?d.second:r.second,late:kf?d.late:r.late,ot:r.ot,workHours:r.workHours||undefined,earlyHours:r.earlyHours,shortHours:r.shortHours,outsideHours:r.outsideHours,extraHours:r.extraHours,punchIssues:r.punchIssues,sourceStatus:undefined,sourceFirstCode:undefined,sourceSecondCode:undefined,sourceLateHours:undefined};});
  return {...m,days:resolveWeeklyOffs(days,job.offDays,job.daily,job.weeklyOffMinimum)};
 }
 function setDay(day:number,patch:Partial<AttendanceDay>,recalc=false){if(!draft)return;let m={...draft,days:draft.days.map(d=>d.day===day?{...d,...patch}:d)};if(recalc)m=recalcDays(m,day,day);change(m);}
 function range(){const from=Number(leave.from),to=Number(leave.to||leave.from);if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>n){toast.error(`Enter From and To days between 1 and ${n}.`);return null;}return [from,to] as const;}
 function applyLeave(){if(!draft)return;const r=range();if(!r)return;const [from,to]=r;
  if(leave.clear){const m={...draft,days:draft.days.map(d=>d.day<from||d.day>to?d:{...d,first:leave.half==='second'?d.first:'' as Mark,second:leave.half==='first'?d.second:'' as Mark})};change(mode==='daily'?recalcDays(m,from,to,true):m);return;}
  const code=leave.code as Mark;change({...draft,days:draft.days.map(d=>d.day<from||d.day>to?d:{...d,first:leave.half==='second'?d.first:code,second:leave.half==='first'?d.second:code,late:leave.half==='second'?d.late:''})});
 }
 function deletePunches(){if(!draft)return;const r=range();if(!r)return;const [from,to]=r;
  setAsk({title:'Del.Punch',text:`Delete the punches of day ${from}${to>from?' to '+to:''} for ${employee?.name}? Press Save afterwards to keep the change.`,yes:()=>{const m={...draft,days:draft.days.map(d=>d.day<from||d.day>to?d:{...d,machineIn:'',machineOut:'',manualIn:'',manualOut:'',punches:undefined,punchIssues:[],approvedOt:false,deduct:undefined})};change(recalcDays(m,from,to));}});}

 const post=(action:string,rows:AttendanceMonth[])=>requestJson<SaveResult>('/api/time-office',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,dataset,rows})});
 function afterSave(){void client.invalidateQueries({queryKey:['report']});void client.invalidateQueries({queryKey:['time-office','month',dataset,month]});}
 async function saveMonth(m:AttendanceMonth,e=employee){
  if(!e)return;setBusy(true);
  try{const value=withTotals(m);
   if(mode==='daily'){const saved=await saveRecord<AttendanceMonth>('attendance-save',value);client.setQueryData(['attendance',dataset,e.id,month],{attendance:saved});}
   else{const result=(await post('register-save-many',[value])).results[0];if(!result||result.error)throw new Error(result?.error||'Could not save this month.');
    client.setQueryData<{attendance:AttendanceMonth[];available:boolean}>(['register',dataset,month],old=>({available:true,attendance:[...(old?.attendance||[]).filter(a=>a.employeeId!==e.id),{...value,revision:result.revision!}]}));}
   setEdit(null);afterSave();setStatus(`${listLabel(e)} Saved Successfully`);toast.success('Saved successfully');
  }catch(error){toast.error((error as Error).message);}finally{setBusy(false);}
 }
 async function saveMany(action:'attendance-save-many'|'register-save-many',rows:AttendanceMonth[],title:string){
  let done=0,failed=0;const errors:string[]=[];
  for(let i=0;i<rows.length;i+=40){const r=await post(action,rows.slice(i,i+40));for(const x of r.results){if(x.error){failed++;if(errors.length<3)errors.push(x.error);}else done++;}setStatus(`${title}: ${Math.min(i+40,rows.length)} / ${rows.length}`);}
  void client.invalidateQueries({queryKey:mode==='daily'?['attendance',dataset]:['register',dataset,month]});afterSave();
  const text=`${title} completed: ${count(done,'employee')} saved${failed?`, ${failed} not saved (${errors.join('; ')})`:''}.`;setStatus(text);(failed?toast.error:toast.success)(text);
 }
 const monthRecords=async()=>(await client.fetchQuery({queryKey:['time-office','month',dataset,month],queryFn:({signal})=>requestJson<{attendance:AttendanceMonth[]}>('/api/records?'+new URLSearchParams({month,dataset}),{signal}),staleTime:0})).attendance;
 async function bulk(work:()=>Promise<void>){if(dirty){toast.error('Save the open employee (or press Cancel) first.');return;}setBusy(true);try{await work();}catch(error){toast.error((error as Error).message);}finally{setBusy(false);}}
 const allOrOne=(title:string,text:string,all:()=>Promise<void>,one?:()=>Promise<void>)=>setAsk({title,text:text+(one?' Choose No for the selected employee only.':''),yes:()=>void bulk(all),no:one?()=>void one():undefined});

 // Time Updation
 function machineDownload(){allOrOne('All Employee',`Calculate ${monthLabel(month)} attendance from the machine punches for all employees?`,async()=>{
   const [records,all]=await Promise.all([monthRecords(),client.fetchQuery(punchesFetch)]);const byId=new Map(records.map(r=>[r.employeeId,r]));const rows:AttendanceMonth[]=[];
   for(const e of employees){const rec=byId.get(e.id)||null;const p=punchesOf(e,all.punches);if((!rec&&!p)||!activeIn(e))continue;const base=buildDaily(e,rec,p);rows.push(withTotals({...base,days:processMonth(month,base.days,jobOf(e),shiftOf)}));}
   await saveMany('attendance-save-many',rows,'Machine Download');},
  draft&&employee?async()=>{await saveMonth({...draft,days:processMonth(month,draft.days,job!,shiftOf)});}:undefined);}
 function updateAll(){setAsk({title:'Update All',text:`Recalculate the ${monthLabel(month)} totals (W.Day, WO, HD, LV, P.Day, AB) of every employee from the day marks and save them?`,yes:()=>void bulk(async()=>{
   const source=mode==='daily'?await monthRecords():(await client.fetchQuery({...registerFetch,staleTime:0})).attendance;
   const rows=source.map(withTotals).filter((m,i)=>JSON.stringify(m.totals)!==JSON.stringify(source[i].totals)||JSON.stringify(m.leaveLedger)!==JSON.stringify(source[i].leaveLedger));
   if(!rows.length){setStatus('All totals are already up to date.');toast.success('All totals are already up to date.');return;}
   await saveMany(mode==='daily'?'attendance-save-many':'register-save-many',rows,'Update All');})});}
 async function chooseFile(file:File){
  const copy=readPunchFile(await file.text(),month,employees);
  if(!copy.days){toast.error(`No ${monthLabel(month)} punches of known employees were found in ${file.name}.`);return;}
  setAsk({title:'Machine Data Copy',text:`${file.name}: ${count(copy.days,'punch day')} for ${count(copy.byEmployee.size,'employee')}${copy.unmatched?` (${count(copy.unmatched,'line')} with an unknown card number skipped)`:''}. Copy them into ${monthLabel(month)}? Machine punches already saved for those days are replaced.`,yes:()=>void bulk(()=>copyPunches(copy))});
 }
 async function copyPunches(copy:PunchCopy){
  const [records,all]=await Promise.all([monthRecords(),client.fetchQuery(punchesFetch)]);const byId=new Map(records.map(r=>[r.employeeId,r]));const rows:AttendanceMonth[]=[];
  for(const [id,days] of copy.byEmployee){const e=employees.find(x=>x.id===id);if(!e)continue;const base=buildDaily(e,byId.get(id)||null,punchesOf(e,all.punches));rows.push(withTotals({...base,days:base.days.map(d=>{const p=days.get(d.day);return p?{...d,machineIn:p.in,machineOut:p.out,punches:p.punches,manualIn:'',manualOut:'',deduct:undefined}:d;})}));}
  await saveMany('attendance-save-many',rows,'Machine Data Copy');setStatus('Data copy Completed. Press Machine Download to calculate the attendance.');
 }
 // Biometric Fetch: reads the chosen days' punches from the Biometric Attendance app (Utilities › Biometric Machine
 // Setup), pairs them into one in / out per duty day by each employee's shift (night shifts end on the next morning),
 // copies them into Time Updation as machine punches and, when ticked, works the attendance out as Machine Download does.
 function openBio(){if(dirty){toast.error('Save the open employee (or press Cancel) first.');return;}const now=new Date();const current=`${now.getFullYear()}-${pad(now.getMonth()+1)}`===month;
  setBio({from:'1',to:String(current?now.getDate():n),calc:true,loading:false,error:'',preview:null});}
 async function bioRead(){if(!bio)return;const from=Number(bio.from),to=Number(bio.to);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>n){setBio({...bio,error:`Enter From and To days between 1 and ${n}.`,preview:null});return;}
  setBio({...bio,loading:true,error:'',preview:null});
  try{
   const q=(view:string,extra:Record<string,string>={})=>'/api/biometric?'+new URLSearchParams({dataset,view,...extra});
   const [settings,data,records]=await Promise.all([requestJson<BioSettings>(q('settings')),requestJson<BioPunches>(q('punches',{from:`${month}-${pad(from)}`,to:`${month}-${pad(to)}`})),monthRecords()]);
   const matches=matchAll(employees,settings.map,Object.keys(data.users));const times=new Map<string,string[]>();const unmatched:BioPreview['unmatched']=[];let ignored=0;
   for(const [userId,u] of Object.entries(data.users)){const m=matches.get(userId)!;if(!m.employeeId){if(m.how==='ignored')ignored++;else unmatched.push({userId,name:u.name,n:u.t.length});continue;}times.set(m.employeeId,[...(times.get(m.employeeId)||[]),...u.t]);}
   const byEmployee=new Map<string,Map<number,{in:string;out:string;punches?:Punch[]}>>();let days=0,skipped=0;const recOf=new Map(records.map(r=>[r.employeeId,r]));
   for(const [id,list] of times){const e=employees.find(x=>x.id===id);if(!e)continue;if(!activeIn(e)){skipped++;continue;}
    // The shift of each day (Monthly Shift Change / the day's own shift), else the employee's shift.
    const normal=jobOf(e).shiftName;const rec=recOf.get(id);const shiftFor=(date:string)=>shiftOf((date.startsWith(month+'-')&&rec?.days.find(d=>d.day===Number(date.slice(8,10)))?.shift)||normal);
    const out=new Map<number,{in:string;out:string;punches?:Punch[]}>();
    for(const [date,p] of dutyDays(list,shiftFor)){if(!date.startsWith(month+'-'))continue;const d=Number(date.slice(8,10));if(d<from||d>to)continue;out.set(d,{in:p.in,out:p.out,punches:p.punches});days++;}
    if(out.size)byEmployee.set(id,out);}
   unmatched.sort((a,b)=>b.n-a.n);
   setBio(b=>b&&{...b,loading:false,preview:{byEmployee,days,punches:data.punches,unmatched,ignored,skipped}});
  }catch(error){setBio(b=>b&&{...b,loading:false,error:(error as Error).message});}}
 function bioCopy(){if(!bio?.preview)return;const {preview,calc}=bio;const from=Number(bio.from),to=Number(bio.to);setBio(null);
  void bulk(async()=>{
   const [records,all]=await Promise.all([monthRecords(),client.fetchQuery(punchesFetch)]);const byId=new Map(records.map(r=>[r.employeeId,r]));const rows:AttendanceMonth[]=[];
   for(const [id,days] of preview.byEmployee){const e=employees.find(x=>x.id===id);if(!e)continue;const base=buildDaily(e,byId.get(id)||null,punchesOf(e,all.punches));
    let list=base.days.map(d=>{const p=days.get(d.day);return p?{...d,machineIn:p.in,machineOut:p.out,punches:p.punches,manualIn:'',manualOut:'',deduct:undefined}:d;});if(calc)list=processMonth(month,list,jobOf(e),shiftOf);
    rows.push(withTotals({...base,days:list}));}
   await saveMany('attendance-save-many',rows,'Biometric Fetch');
   if(!calc)setStatus(s=>s+' Press Machine Download to calculate the attendance.');
   void requestJson('/api/biometric',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add-history',dataset,entry:{month,from,to,employees:rows.length,days:preview.days,unmatched:preview.unmatched.length,calculated:calc}})}).catch(()=>{});
  });}
 function showMismatch(){void bulk(async()=>{
  const [records,all]=await Promise.all([monthRecords(),client.fetchQuery(punchesFetch)]);const byId=new Map(records.map(r=>[r.employeeId,r]));const rows:Mismatch[]=[];
  for(const e of listed){const rec=byId.get(e.id)||null;const p=punchesOf(e,all.punches);if(!rec&&!p)continue;for(const d of buildDaily(e,rec,p).days){const i=d.manualIn||d.machineIn||'',o=d.manualOut||d.machineOut||'';if(!!i!==!!o)rows.push({e,day:d.day,in:i,out:o});}}
  setMismatch(rows);});}

 // Times
 function tDownload(){allOrOne('All Employee',`Copy the ${monthLabel(month)} Time Updation attendance into the Times register for all employees?`,async()=>{
   const [records,reg]=await Promise.all([monthRecords(),client.fetchQuery({...registerFetch,staleTime:0})]);const rows:AttendanceMonth[]=[];
   for(const rec of records){const e=employees.find(x=>x.id===rec.employeeId);if(!e)continue;rows.push(withTotals({...buildRegister(e,reg.attendance),days:registerFromDaily(month,rec.days,jobOf(e),shiftOf,e.id)}));}
   await saveMany('register-save-many',rows,'T.Download');},
  draft&&employee?async()=>{const rec=(await requestJson<{attendance:AttendanceMonth|null}>('/api/records?'+new URLSearchParams({employeeId:employee.id,month,dataset}))).attendance;
   if(!rec){toast.error(`${employee.name} has no Time Updation attendance for ${monthLabel(month)}.`);return;}await saveMonth({...draft,days:registerFromDaily(month,rec.days,job!,shiftOf,employee.id)});}:undefined);}
 function dayGenerate(){const t={pd:Number(gen.pd),el:Number(gen.el)||0,cl:Number(gen.cl)||0,sl:Number(gen.sl)||0,hr:Number(gen.hr)||0};
  if(!Number.isFinite(t.pd)||t.pd<1||t.pd>n){toast.error(`Enter Pd (paid days) between 1 and ${n}.`);return;}
  allOrOne('All Employee',`Make the ${monthLabel(month)} register with ${t.pd} paid days${t.el+t.cl+t.sl?` (EL ${t.el}, CL ${t.cl}, SL ${t.sl})`:''}${t.hr?` and ${t.hr} OT hours`:''} for all employees in the list?`,async()=>{
   const reg=await client.fetchQuery({...registerFetch,staleTime:0});
   const rows=listed.filter(activeIn).map(e=>withTotals({...buildRegister(e,reg.attendance),days:generateRegister(month,t,jobOf(e),shiftOf,e.id)}));
   await saveMany('register-save-many',rows,'Day');},
  draft&&employee?async()=>{await saveMonth({...draft,days:generateRegister(month,t,job!,shiftOf,employee.id)});}:undefined);}

 const fig=draft?monthFigures(draft.days):null;const x=employee?extras[String(employee.sourceKey||employee.id)]:undefined;
 const ledger=draft?withTotals(draft).leaveLedger:[];
 const loading=employee&&!draft&&(recordQ.isPending||registerQ.isPending||!punchesReady);
 const editable=!!draft&&!busy;const daily=mode==='daily';
 const title=(daily?'Time Updation':'Times Updation')+(employee?`  ${listLabel(employee)}${employee.doj?'  D.O.J '+dojText(employee.doj):''}`:'');
 return <div className="to-window">
  <div className="to-titlebar"><strong>{title}</strong>{status&&<span className="to-status" role="status">{status}</span>}</div>
  <div className="to-body">
   <section className="to-gridpane" aria-label="Days of the month">
    <div className="to-gridscroll"><table className="to-grid"><thead><tr>{['Date','Mch-In','Mch-Out','Man-In','Man-Out','Sft','1st','2nd','OT Hr','Lt Hr',...(daily?['Wrk Hr']:[])].map(h=><th key={h}>{h}</th>)}</tr></thead>
     <tbody>{draft?draft.days.map(d=>{const date=new Date(`${month}-${pad(d.day)}T12:00:00`);const off=!!job?.offDays.has(d.day);
      const time=(field:'machineIn'|'machineOut'|'manualIn'|'manualOut',readOnly:boolean)=>readOnly?<td className="to-ro">{d[field]||''}</td>:<td><input key={field+(d[field]||'')} aria-label={`Day ${d.day} ${field}`} defaultValue={d[field]||''} maxLength={5} disabled={!editable} onBlur={e=>{const v=normalTime(e.target.value);if(v===null){toast.error('Enter the time as HH:MM (24 hours).');e.target.value=d[field]||'';return;}if(v!==(d[field]||''))setDay(d.day,{[field]:v},daily);}}/></td>;
      const dur=(field:'ot'|'late')=><td><input key={field+d[field]} aria-label={`Day ${d.day} ${field==='ot'?'OT hours':'late hours'}`} defaultValue={d[field]} maxLength={5} disabled={!editable} onBlur={e=>{const v=normalTime(e.target.value);if(v===null){toast.error('Enter hours as HH:MM.');e.target.value=d[field];return;}if(v!==d[field])setDay(d.day,{[field]:v});}}/></td>;
      const mark=(field:'first'|'second')=><td className={markClass(d[field])}><select aria-label={`Day ${d.day} ${field==='first'?'1st':'2nd'} half`} value={d[field]} disabled={!editable} onChange={e=>setDay(d.day,{[field]:e.target.value as Mark})}>{attendanceCodes.map(c=><option key={c||'blank'} value={c}>{c}</option>)}</select></td>;
      return <tr key={d.day} className={off?'is-off':''}><td className="to-date">{d.day} {date.toLocaleDateString('en-IN',{weekday:'short'})}{daily&&<details><summary>Punch list</summary><textarea aria-label={'Day '+d.day+' punch list'} defaultValue={punchText(d.punches||[])} disabled={!editable} placeholder="IN 09:00, OUT 11:00, IN 13:00, OUT 18:00" onBlur={ev=>{if(ev.target.value.trim()===punchText(d.punches||[]).trim())return;try{const punches=parsePunchText(ev.target.value),issues=analysePunches(punches).issues;if(issues.length){toast.error(issues.join('; '));return;}setDay(d.day,{punches,manualIn:'',manualOut:'',machineIn:punches[0]?.time||'',machineOut:punches.at(-1)?.time||'',deduct:undefined,approvedOt:false},true);}catch(error){toast.error((error as Error).message);}}}/>{d.punchIssues?.map((v,i)=><small key={i}>{v}</small>)}</details>}</td>{time('machineIn',daily)}{time('machineOut',daily)}{time('manualIn',false)}{time('manualOut',false)}
       <td><select aria-label={`Day ${d.day} shift`} value={d.shift} disabled={!editable} onChange={e=>setDay(d.day,{shift:e.target.value},daily)}>{[...new Set(['',d.shift,...shifts.map(s=>s.name)])].map(s=><option key={s||'blank'} value={s}>{s}</option>)}</select></td>
       {mark('first')}{mark('second')}{dur('ot')}{dur('late')}{daily&&<td className="to-ro">{d.workHours||''}</td>}</tr>;}):
      <tr><td colSpan={daily?11:10} className="to-empty">{loading?'Loading…':employee?'':'Select an employee from the list on the right.'}</td></tr>}</tbody></table></div>
    <div className="to-totals">{([['W.Day',fig?num(fig.worked):'0'],['WO',fig?num(fig.weeklyOff):'0'],['HD',fig?num(fig.holiday):'0'],['LV',fig?num(fig.leave):'0'],['P.Day',fig?num(fig.payable):'0'],['AB',fig?num(fig.absent):'0'],['O.T.',fig?hhmm(fig.ot)||'0:00':'0:00'],['Late',fig?hhmm(fig.late)||'0:00':'0:00'],
     ...(daily?[['Inc.',fig&&x?.incentAlw==='1'?num(fig.worked):'0'],['t.Hr',fig?hhmm(fig.work)||'0:00':'0:00'],['Food',fig&&x?.foodAlw==='1'?num(fig.worked):'0'],['Tea',fig&&x?.teaAlw==='1'?num(fig.worked):'0']]:[])] as [string,string][]).map(([k,v])=><span key={k}>{k}<b>{v}</b></span>)}</div>
   </section>
   <aside className="to-side">
    <label className="to-field">Month Name<select value={month} onChange={e=>changeMonth(e.target.value)} disabled={busy}>{[...new Set([...pickMonths.map(m=>m.value),month])].sort().map(v=><option key={v} value={v}>{monthLabel(v)}</option>)}</select></label>
    <label className="to-field">Location Name<select value={location} onChange={e=>setLocation(e.target.value)} disabled={busy}><option value="">All locations</option>{locations.map(l=><option key={l} value={l}>{l}</option>)}</select></label>
    <div className="to-row">
     {daily&&<button type="button" className="to-btn is-primary" disabled={busy||!employees.length} onClick={openBio} title="Read the punches from the Biometric Attendance app (machines KE1, KE2, b4 …)">Biometric Fetch</button>}
     {daily&&<button type="button" className="to-btn" disabled={busy||dataset==='manual'&&!employees.length} onClick={()=>fileRef.current?.click()} title="Copy punches from an attendance-machine export file (CSV / TXT)">Machine Data Copy</button>}
     <button type="button" className="to-btn" disabled={!editable} onClick={deletePunches} title="Delete the punches of the From–To days below">Del.Punch</button>
     {daily&&<button type="button" className="to-btn" disabled={busy} onClick={showMismatch} title="Days with only one punch">Mismatch</button>}
     {daily&&onOpen&&canOpen('transaction/times')&&<button type="button" className="to-btn" disabled={busy||dirty} onClick={()=>onOpen('transaction/times')}>Times</button>}
     <input ref={fileRef} type="file" accept=".csv,.txt,.dat,text/csv,text/plain" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void chooseFile(f);}}/>
    </div>
    <EmployeePick employees={listed} selectedId={employeeId} onSelect={select} name={'to-'+mode}/>
    <div className="to-row">
     <button type="button" className="to-btn is-primary" disabled={!dirty||busy} onClick={()=>draft&&void saveMonth(draft)}>{busy?'Please wait…':'Save'}</button>
     <button type="button" className="to-btn" disabled={!dirty||busy} onClick={()=>setEdit(null)}>Cancel</button>
     <button type="button" className="to-btn" disabled={busy} onClick={updateAll}>Update All</button>
     {daily?<button type="button" className="to-btn" disabled={busy} onClick={machineDownload}>Machine Download</button>:<button type="button" className="to-btn" disabled={busy} onClick={tDownload}>T.Download</button>}
    </div>
    <fieldset className="to-fieldset"><legend>Leave Direct Entry</legend>
     <label>Leave<select value={leave.code} onChange={e=>setLeave({...leave,code:e.target.value})} disabled={leave.clear}>{ENTRY_CODES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
     <label>From<input className="to-input to-small" type="number" min={1} max={n} value={leave.from} onChange={e=>setLeave({...leave,from:e.target.value})}/></label>
     <label>To<input className="to-input to-small" type="number" min={1} max={n} value={leave.to} onChange={e=>setLeave({...leave,to:e.target.value})}/></label>
     <button type="button" className="to-btn" disabled={!editable} onClick={applyLeave}>Ok</button>
     <div className="to-row">{([['full','Fullday'],['first','1st Half day'],['second','2nd Half day']] as const).map(([v,l])=><label key={v}><input type="radio" name={'to-half-'+mode} checked={leave.half===v} onChange={()=>setLeave({...leave,half:v})}/>{l}</label>)}<label><input type="checkbox" checked={leave.clear} onChange={e=>setLeave({...leave,clear:e.target.checked})}/>Clear Leave</label></div>
    </fieldset>
    <table className="to-leave"><thead><tr>{['code','Leave','Open.','Earning','Taken(Year)','Taken(Month)','Balance'].map(h=><th key={h}>{h}</th>)}</tr></thead>
     <tbody>{LEAVE_ROWS.map(([code,name])=>{const l=ledger.find(r=>r.code===name);return <tr key={code}><td>{code}</td><td>{name}</td><td>{l?.opening??''}</td><td>{l?.earning??''}</td><td>{draft?l?.takenYear||0:''}</td><td>{draft?l?.takenMonth||0:''}</td><td>{draft?l?.balance??0:''}</td></tr>;})}</tbody></table>
    {!daily&&<fieldset className="to-fieldset"><legend>Make register</legend><div className="to-gen">{(['pd','el','cl','sl','hr'] as const).map(k=><label key={k}>{k==='pd'?'Pd':k==='hr'?'Hr':k.toUpperCase()}<input className="to-input" type="number" min={0} max={k==='hr'?999:n} step={k==='hr'?1:0.5} value={gen[k]} onChange={e=>setGen({...gen,[k]:e.target.value})}/></label>)}<button type="button" className="to-btn" disabled={busy} onClick={dayGenerate}>Day</button></div>
     <p className="to-note">Pd = paid days of the month (weekly offs and holidays included), EL / CL / SL = leave days, Hr = overtime hours to spread over the days worked.</p></fieldset>}
    {daily?<p className="to-note">Machine punches come from the biometric machines (Biometric Fetch), the original software or Machine Data Copy. Machine Download works the marks, late, OT and work hours out from them; leave and OD entered by hand are kept.</p>
     :<p className="to-note">This register is what Muster Roll, Form 14 and Leave Detail print. T.Download copies Time Updation with regular in / out times.</p>}
   </aside>
  </div>
  <AlertDialog open={!!ask} onOpenChange={v=>{if(!v)setAsk(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{ask?.title}</AlertDialogTitle><AlertDialogDescription>{ask?.text}</AlertDialogDescription></AlertDialogHeader>
   <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>{ask?.no&&<AlertDialogAction className="to-no" onClick={()=>{const no=ask.no!;setAsk(null);no();}}>No</AlertDialogAction>}<AlertDialogAction onClick={()=>{const yes=ask!.yes;setAsk(null);yes();}}>Yes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <Dialog open={!!bio} onOpenChange={v=>{if(!v&&!bio?.loading)setBio(null);}}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Biometric Fetch · {monthLabel(month)}</DialogTitle><DialogDescription>Reads the punches from the Biometric Attendance app and copies them into Time Updation as machine punches. Leave and OD entered by hand are kept.</DialogDescription></DialogHeader>
   {bio&&<div className="bio-fetch">
    <div className="to-row"><label>From day<input className="to-input" type="number" min={1} max={n} value={bio.from} disabled={bio.loading} onChange={e=>setBio({...bio,from:e.target.value,preview:null,error:''})}/></label>
     <label>To day<input className="to-input" type="number" min={1} max={n} value={bio.to} disabled={bio.loading} onChange={e=>setBio({...bio,to:e.target.value,preview:null,error:''})}/></label>
     <label><input type="checkbox" checked={bio.calc} disabled={bio.loading} onChange={e=>setBio({...bio,calc:e.target.checked})}/>Calculate the attendance (as Machine Download)</label>
     <button type="button" className="to-btn" disabled={bio.loading} onClick={()=>void bioRead()}>{bio.loading?'Reading…':'Read punches'}</button></div>
    {bio.error&&<div className="bio-msg is-bad">{bio.error}{onOpen&&canOpen('utilities/biometric')&&<button type="button" className="to-btn" onClick={()=>{setBio(null);onOpen('utilities/biometric');}}>Biometric Machine Setup</button>}</div>}
    {bio.preview&&<>
     <div className="bio-sum"><span>Punches read<b>{bio.preview.punches.toLocaleString('en-IN')}</b></span><span>Employees<b>{bio.preview.byEmployee.size}</b></span><span>Punch days<b>{bio.preview.days}</b></span><span>Unknown machine IDs<b>{bio.preview.unmatched.length}</b></span>{bio.preview.skipped>0&&<span>Left / not joined<b>{bio.preview.skipped}</b></span>}</div>
     {bio.preview.unmatched.length>0&&<><p className="to-note">These machine user IDs match no employee (Card No. or paycode), so their punches are not copied. Match them on Biometric Machine Setup › Employee Match.</p>
      <div className="bio-unknown"><table className="bio-table"><thead><tr><th>Machine User ID</th><th>Name on machine</th><th className="num">Punches</th></tr></thead><tbody>{bio.preview.unmatched.slice(0,100).map(u=><tr key={u.userId}><td>{u.userId}</td><td>{u.name}</td><td className="num">{u.n}</td></tr>)}</tbody></table></div></>}
     {!bio.preview.days&&<p className="bio-msg is-bad">No punch of a known employee was found for days {bio.from}–{bio.to}. Download the machines on Biometric Machine Setup, or check the employee match.</p>}
    </>}
    <div className="to-row">
     <button type="button" className="to-btn is-primary" disabled={bio.loading||!bio.preview?.days} onClick={bioCopy}>Copy into Time Updation{bio.calc?' and calculate':''}</button>
     <button type="button" className="to-btn" disabled={bio.loading} onClick={()=>setBio(null)}>Close</button>
     {onOpen&&canOpen('utilities/biometric')&&<button type="button" className="to-btn" disabled={bio.loading} onClick={()=>{setBio(null);onOpen('utilities/biometric');}}>Biometric Machine Setup</button>}
    </div>
   </div>}
  </DialogContent></Dialog>
  <Dialog open={!!mismatch} onOpenChange={v=>{if(!v)setMismatch(null);}}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Mismatch · {monthLabel(month)}</DialogTitle><DialogDescription>{mismatch?.length?`${count(mismatch.length,'day')} with only one punch. Click a row to open the employee.`:'Every punched day has both an in and an out time.'}</DialogDescription></DialogHeader>
   {!!mismatch?.length&&<div className="to-mismatch"><table><thead><tr><th>Paycode</th><th>Employee Name</th><th>Date</th><th>In</th><th>Out</th></tr></thead><tbody>{mismatch.map(r=><tr key={r.e.id+'|'+r.day} onClick={()=>{setMismatch(null);select(r.e);}}><td>{r.e.paycode}</td><td>{r.e.name}</td><td>{pad(r.day)}/{month.slice(5,7)}/{month.slice(0,4)}</td><td>{r.in}</td><td>{r.out}</td></tr>)}</tbody></table></div>}
  </DialogContent></Dialog>
 </div>;
}
