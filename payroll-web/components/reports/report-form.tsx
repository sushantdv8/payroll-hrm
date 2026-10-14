'use client';
import {useMemo,useState,type ReactNode} from 'react';
import {useQueries,useQuery,useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {AttendanceMonth,Employee} from '@/lib/payroll';
import type {SalarySnapshot} from '@/lib/backup';
import {masterDef,trimCell,type MasterRow} from '@/lib/masters';
import {exportExcel,requestJson,type XlCell} from '@/lib/client-api';
import {rawPunchDays,type BioPunches,type BioSettings} from '@/lib/biometric';
import {employeePayMode,employeeSex,fyMonths,pickMonths,isLeft,type Extra} from '@/lib/report-utils';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {ErrorMessage} from '../payroll-controls';
import {Viewer,orderByOwner} from './report-viewer';
import './reports.css';

export type FilterKey='company'|'subCompany'|'location'|'dhead'|'department'|'designation'|'category'|'salaryGrade'|'leaveGrade'|'shift';
export type Lists=Record<string,{code:string;name:string;values:MasterRow['values']}[]>;
// rawPunches (option need 'rawpunches'): the machines' own punches per employee and calendar day, read from the Biometric Attendance app; rawPunchNote says why they could not be read.
export type ReportContext={dataset:string;company:{name:string;address:string;values:MasterRow['values']};month:string;dayFrom:number;dayTo:number;from:string;to:string;date:string;printDate:string;employees:Employee[];extras:Record<string,Extra>;attendance:Map<string,AttendanceMonth>;salaries:Map<string,SalarySnapshot>;period:AttendanceMonth[];rows:MasterRow[];lists:Lists;rawPunches?:Map<string,Map<string,string[]>>;rawPunchNote?:string;options:{groupByDept:boolean;otExtraSpace:boolean;salaryWithOt:boolean;advValue:string;addressPrint:string;choice:string;fields:Record<string,string>}};
// Extra controls of a report screen (Bank Name, Cheque No., Weekly / Fortnighty …); their values reach the report as ctx.options.fields[key].
// place: 'left' under the month / filters, 'middle' beside the Reports Selection. options may be built from the master lists.
export type ReportField={key:string;label:string;kind:'text'|'number'|'date'|'select'|'check'|'radio';place?:'left'|'middle';default?:string;options?:{value:string;label:string}[]|((lists:Lists)=>{value:string;label:string}[])};
// trees: one group-tree node per employee on the page (like the original viewer); tree: a single node for the page.
// find: extra text the Find box searches that is not shown in the tree (e.g. every name printed on a page).
// owners: the employees the page is printed for ("code · name"). A screen that prints several documents for each employee (Personal File forms) gives its pages owners and a file (the document's name):
// the viewer then lists each employee in the group tree with the documents under it, and the pages are ordered employee by employee.
export type ReportOwner={id:string;label:string};
export type ReportPage={key:string;tree?:string;trees?:string[];find?:string;file?:string;owners?:ReportOwner[];orientation:'portrait'|'landscape';node:ReactNode};
export type ReportOption={value:string;label:string;needs?:('attendance'|'salaries'|'period'|'rawpunches')[];table?:string;build:(ctx:ReportContext)=>ReportPage[];excel?:(ctx:ReportContext)=>XlCell[][];action?:(ctx:ReportContext)=>Promise<void>;note?:string;withEmployees?:boolean;hidden?:boolean;sheetName?:string};
// attendanceSource: the report can use the original's separate muster register (default) or the daily attendance.
// confirm: a Yes / No question asked before Generate (the original's "Please Check Proper Address"); No stops.
// periodLabels: captions of the From / To boxes of a 'range' screen (the original's "Date Select" / "To Date").
export type ReportConfig={attendanceSource?:boolean;period:'month'|'month-days'|'date'|'range'|'none';filters:FilterKey[];paymentMode?:boolean;resignMode?:boolean;sex?:boolean;withLeft?:boolean;otExtraSpace?:boolean;advSheet?:boolean;options:ReportOption[];columns?:number;defaultPaymentMode?:string;extraButtons?:{label:string;option:string}[];choices?:{label:string;values:{value:string;label:string}[]};note?:string;fields?:ReportField[];confirm?:string;periodLabels?:{from:string;to:string};noAddress?:boolean;noSort?:boolean;noPrintDate?:boolean;multi?:boolean};

const filterDefs:Record<FilterKey,{label:string;table:string;by:'name'|'code';get:(e:Employee,x?:Extra)=>string}>={
 company:{label:'Company Name',table:'tbcmp',by:'code',get:()=>''},subCompany:{label:'Sub Company Name',table:'tbsubcmp',by:'name',get:e=>e.subCompany},location:{label:'Location Name',table:'tblocation',by:'name',get:e=>e.location},
 dhead:{label:'Department Head Name',table:'tbdephead',by:'code',get:(e,x)=>x?.dhead||''},department:{label:'Department Name',table:'tbdep',by:'name',get:e=>e.department},designation:{label:'Designation Name',table:'tbdes',by:'name',get:e=>e.designation},
 category:{label:'Category Name',table:'tbcat',by:'code',get:(e,x)=>x?.cat||''},salaryGrade:{label:'Salary Grade Name',table:'tbsalg',by:'code',get:(e,x)=>x?.salg||''},leaveGrade:{label:'Leave Grade',table:'tblvgrade',by:'code',get:(e,x)=>x?.lvg||''},shift:{label:'Shift Name',table:'tbshift',by:'code',get:(e,x)=>x?.sft||''},
};
const listTables=['tbcmp','tbsubcmp','tblocation','tbdephead','tbdep','tbdes','tbcat','tbsalg','tblvgrade','tbshift','tbbank','tbpfmast','tbesimast','tbempsal'];
const numeric=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true});

function combineLists(results:{data?:{rows:MasterRow[]}}[]):Lists{const out:Lists={};listTables.forEach((table,k)=>{const def=masterDef(table)!;out[table]=(results[k]?.data?.rows||[]).map(r=>({code:trimCell(r.values[def.key[0]]),name:def.nameCol?trimCell(r.values[def.nameCol]):'',values:r.values})).sort((a,b)=>numeric(a.code,b.code));});return out;}
// pending: Generate and the extra buttons wait for the lists, since reports read them (e.g. Employee salary settings) when built.
const combineAll=(results:{data?:{rows:MasterRow[]};isPending:boolean}[])=>({lists:combineLists(results),pending:results.some(q=>q.isPending)});
function useLists(dataset:string){
 return useQueries({queries:listTables.map(table=>({queryKey:['masters',dataset,table],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset,table}),{signal}),refetchOnWindowFocus:false})),combine:combineAll});
}

function FilterPicker({label,options,selected,onChange}:{label:string;options:{code:string;name:string}[];selected:string[];onChange:(v:string[])=>void}){
 const [open,setOpen]=useState(false);const [draft,setDraft]=useState<string[]>([]);
 const names=options.filter(o=>selected.includes(o.code)).map(o=>o.name||o.code);
 return <div className="rpt-filter"><div className="rpt-filter-box" title={names.join(', ')}><b>{label}</b>{names.length>0&&<span>{names.join(', ')}</span>}</div><button type="button" className="rpt-dots" aria-label={'Choose '+label} onClick={()=>{setDraft(selected);setOpen(true);}}>....</button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="rpt-dialog"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>Tick the entries to include. Leave all unticked for every entry.</DialogDescription></DialogHeader>
   <div className="rpt-dialog-actions"><Button variant="outline" size="sm" onClick={()=>setDraft(options.map(o=>o.code))}>Select all</Button><Button variant="outline" size="sm" onClick={()=>setDraft([])}>Clear</Button></div>
   <div className="rpt-check-list">{options.map(o=><label key={o.code}><input type="checkbox" checked={draft.includes(o.code)} onChange={e=>setDraft(d=>e.target.checked?[...d,o.code]:d.filter(x=>x!==o.code))}/>{o.code} · {o.name||'—'}</label>)}{!options.length&&<p className="subtle">No entries.</p>}</div>
   <div className="rpt-dialog-actions"><Button onClick={()=>{onChange(draft);setOpen(false);}}>OK</Button><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button></div></DialogContent></Dialog></div>;
}

export function ReportForm({dataset,employees,title,config,companyName,onClose}:{dataset:string;employees:Employee[];title:string;config:ReportConfig;companyName:string;onClose:()=>void}){
 const client=useQueryClient();const {lists,pending:listsPending}=useLists(dataset);
 const extrasQuery=useQuery({queryKey:['employee-extras',dataset],queryFn:({signal})=>requestJson<{extras:Record<string,Extra>}>('/api/employee-extras?'+new URLSearchParams({dataset}),{signal}),refetchOnWindowFocus:false,staleTime:600000});
 const extras=useMemo(()=>extrasQuery.data?.extras||{},[extrasQuery.data]);
 const [tab,setTab]=useState<'sel'|'rep'>('sel');const [gen,setGen]=useState(0);const [month,setMonth]=useState('2026-08');const [dayFrom,setDayFrom]=useState(1);const [dayTo,setDayTo]=useState(31);
 const [from,setFrom]=useState('2026-04-01');const [to,setTo]=useState('2026-08-31');const [date,setDate]=useState('2026-08-01');
 const [filters,setFilters]=useState<Partial<Record<FilterKey,string[]>>>({});const [sex,setSex]=useState('all');const [sortOn,setSortOn]=useState('paycode');const [withLeft,setWithLeft]=useState(true);const [groupByDept,setGroupByDept]=useState(false);const [otExtra,setOtExtra]=useState(false);
 const [addressPrint,setAddressPrint]=useState('main');const [printDate,setPrintDate]=useState(()=>new Date().toISOString().slice(0,10));const [printDateShow,setPrintDateShow]=useState(true);
 const [payMode,setPayMode]=useState(config.defaultPaymentMode||'all');const [resignMode,setResignMode]=useState('all');const [option,setOption]=useState(config.options[0].value);const [picked,setPicked]=useState<string[]>([config.options[0].value]);const [salaryWithOt,setSalaryWithOt]=useState(false);const [adv,setAdv]=useState('50');const [choice,setChoice]=useState(config.choices?.values[0]?.value||'');
 const [fieldValues,setFieldValues]=useState<Record<string,string>>(()=>Object.fromEntries((config.fields||[]).map(f=>[f.key,f.default??''])));const [asking,setAsking]=useState<string|null>(null);
 const [attSource,setAttSource]=useState<'register'|'daily'>('register');const useRegister=!!config.attendanceSource&&attSource==='register';
 const register=useQuery({queryKey:['register',dataset,month],queryFn:({signal})=>requestJson<{attendance:AttendanceMonth[];available:boolean}>('/api/register?'+new URLSearchParams({dataset,month}),{signal}),enabled:useRegister,refetchOnWindowFocus:false,staleTime:60000});
 const registerIds=useMemo(()=>useRegister?new Set((register.data?.attendance||[]).map(a=>a.employeeId)):null,[useRegister,register.data]);
 const [allChecked,setAllChecked]=useState(true);const [exceptions,setExceptions]=useState<Set<string>>(new Set());const [search,setSearch]=useState('');
 const [pages,setPages]=useState<ReportPage[]>([]);const [ctx,setCtx]=useState<ReportContext|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [limit,setLimit]=useState(200);
 const selectedOption=config.options.find(o=>o.value===option)||config.options[0];
 const base=useMemo(()=>{
  let list=employees.filter(e=>{if(registerIds&&!registerIds.has(e.id))return false;const x=extras[String(e.sourceKey||e.id)];
   for(const [key,values] of Object.entries(filters) as [FilterKey,string[]][]){if(!values?.length||key==='company')continue;const f=filterDefs[key];const v=trimCell(f.get(e,x));
    if(f.by==='code'?!values.includes(v):!values.some(code=>(lists[f.table]||[]).find(o=>o.code===code)?.name.toLowerCase()===v.toLowerCase()))return false;}
   if(config.sex&&sex!=='all'&&employeeSex(e,x)!==sex)return false;
   const left=isLeft(e,x);if(config.withLeft&&!withLeft&&left)return false;if(config.resignMode&&(resignMode==='without'&&left||resignMode==='only'&&!left))return false;
   if(config.paymentMode&&payMode!=='all'&&employeePayMode(e,x)!==payMode)return false;return true;});
  const key=(e:Employee)=>sortOn==='card'?e.cardNo||e.paycode:sortOn==='name'?e.name:e.paycode;
  list=[...list].sort((a,b)=>(groupByDept?a.department.localeCompare(b.department):0)||(sortOn==='name'?key(a).localeCompare(key(b)):key(a)<key(b)?-1:key(a)>key(b)?1:0));return list;
 },[employees,extras,filters,lists,sex,withLeft,resignMode,payMode,sortOn,groupByDept,config,registerIds]);
 const isChecked=(id:string)=>allChecked?!exceptions.has(id):exceptions.has(id);
 const shown=useMemo(()=>{const q=search.trim().toLowerCase();return q?base.filter(e=>[e.name,e.paycode,e.cardNo].join(' ').toLowerCase().includes(q)):base;},[base,search]);
 function toggle(id:string){setExceptions(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});}
 async function generate(optionValue=option){
  // A multi screen (Personal File forms) prints every ticked report one after the other.
  const multiRun=!!config.multi&&optionValue===option;
  const opts=multiRun?config.options.filter(o=>picked.includes(o.value)):[config.options.find(o=>o.value===optionValue)||selectedOption];
  const opt=opts[0];setBusy(true);setError('');
  try{
   if(!opt)throw new Error('Tick at least one report in Reports Selection.');
   const chosen=base.filter(e=>isChecked(e.id));if(opts.some(o=>o.withEmployees!==false)&&!chosen.length&&!opts.some(o=>o.table))throw new Error('Tick at least one employee.');
   if(config.period==='range'&&from>to)throw new Error('From date must be on or before To date.');
   // A Month + Day From / To screen reports that day range of the month (its day-wise options read ctx.period / ctx.from / ctx.to).
   const pad2=(n:number)=>String(n).padStart(2,'0');const lastDay=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
   const rangeFrom=config.period==='month-days'?`${month}-${pad2(Math.max(1,dayFrom))}`:from,rangeTo=config.period==='month-days'?`${month}-${pad2(Math.min(dayTo,lastDay))}`:to;
   const run=async(opt:ReportOption)=>{const needs=new Set(opt.needs||[]);const fetch=<T,>(key:unknown[],url:string)=>client.fetchQuery({queryKey:key,queryFn:({signal})=>requestJson<T>(url,{signal}),staleTime:30000});
   const monthOf=config.period==='date'?date.slice(0,7):month;
   const [att,sal,rows]=await Promise.all([
    needs.has('attendance')?(useRegister?fetch<{attendance:AttendanceMonth[]}>(['register',dataset,monthOf],'/api/register?'+new URLSearchParams({month:monthOf,dataset})):fetch<{attendance:AttendanceMonth[]}>(['report','attendance',dataset,monthOf],'/api/records?'+new URLSearchParams({month:monthOf,dataset,punches:'1'}))):null,
    needs.has('salaries')?fetch<{salaries:SalarySnapshot[]}>(['backup','salaries',dataset,monthOf],'/api/backup?'+new URLSearchParams({view:'salaries',dataset,month:monthOf})):null,
    opt.table?fetch<{rows:MasterRow[]}>(['masters',dataset,opt.table],'/api/masters?'+new URLSearchParams({dataset,table:opt.table})):null]);
   let period:AttendanceMonth[]=[];
   if(needs.has('period')){const months:string[]=[];for(let d=new Date(rangeFrom.slice(0,7)+'-01T00:00:00Z');d.toISOString().slice(0,7)<=rangeTo.slice(0,7)&&months.length<15;d.setUTCMonth(d.getUTCMonth()+1))months.push(d.toISOString().slice(0,7));
    const all=await Promise.all(months.map(m=>fetch<{attendance:AttendanceMonth[]}>(['report','attendance',dataset,m],'/api/records?'+new URLSearchParams({month:m,dataset,punches:'1'}))));period=all.flatMap(a=>a.attendance);}
   // Multi Punch Report: the punches as the machines recorded them (the days Punch From / Punch To ask for, else the whole month).
   let rawPunches:ReportContext['rawPunches'],rawPunchNote='';
   if(needs.has('rawpunches')){const inMonth=(v:string|undefined)=>v&&v.slice(0,7)===monthOf?v:'';const monthLast=new Date(Date.UTC(Number(monthOf.slice(0,4)),Number(monthOf.slice(5,7)),0)).getUTCDate();
    const rf=inMonth(fieldValues.mpFrom)||`${monthOf}-01`,rt=inMonth(fieldValues.mpTo)||`${monthOf}-${pad2(monthLast)}`;
    if(rf<=rt)try{const [bioSettings,bio]=await Promise.all([requestJson<BioSettings>('/api/biometric?'+new URLSearchParams({dataset,view:'settings'})),requestJson<BioPunches>('/api/biometric?'+new URLSearchParams({dataset,view:'punches',from:rf,to:rt}))]);const found=rawPunchDays(employees,bioSettings.map,bio,rf,rt);
     // The app is running but holds no punch of these days for this company's employees (machines not downloaded yet, other machines ticked, an old year): use what Time Updation has.
     if([...found.values()].some(days=>days.size))rawPunches=found;else rawPunchNote='the Biometric Attendance app has no punches for these days yet – download the machines in Biometric Machine Setup';}
    catch(e){rawPunchNote=(e as Error).message;}}
   const cmp=lists.tbcmp?.[0];const loc=(filters.location||[]).length===1?lists.tblocation?.find(l=>l.code===filters.location![0]):undefined;
   const address=addressPrint==='none'?'':addressPrint==='location'&&loc?trimCell(loc.values.loc_add1):[trimCell(cmp?.values.cmp_add1),trimCell(cmp?.values.cmp_add2)].filter(Boolean).join(', ');
   const context:ReportContext={dataset,company:{name:trimCell(cmp?.values.cmp_name)||companyName,address,values:cmp?.values||{}},month:monthOf,dayFrom,dayTo,from:rangeFrom,to:rangeTo,date,printDate:printDateShow&&!config.noPrintDate?printDate:'',employees:chosen,extras,
    attendance:new Map((att?.attendance||[]).map(a=>[a.employeeId,a])),salaries:new Map((sal?.salaries||[]).map(s=>[s.employeeId,s])),period,rows:rows?.rows||[],lists,rawPunches,rawPunchNote,options:{groupByDept,otExtraSpace:otExtra,salaryWithOt,advValue:adv,addressPrint,choice,fields:fieldValues}};return context;};
   const built:{o:ReportOption;context:ReportContext}[]=[];for(const o of opts)built.push({o,context:await run(o)});
   if(opt.action){await opt.action(built[0].context);return;}
   for(const {o,context} of built)if(o.needs?.includes('rawpunches')&&context.rawPunchNote)toast.warning(`The machine punches could not be read (${context.rawPunchNote}) – the punches saved in Time Updation are printed instead.`);
   // Personal File forms: every page knows its document (file) and its employee; the pages go employee by employee, each employee's documents together.
   const made=built.flatMap(({o,context})=>o.build(context).map(p=>{const q=built.length>1?{...p,key:o.value+':'+p.key}:p;return config.multi?{...q,file:o.label}:q;}));
   setCtx(built[0].context);setPages(config.multi?orderByOwner(made):made);setOption(opt.value);if(tab==='sel')setGen(g=>g+1);setTab('rep');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function excel(){if(!ctx||!selectedOption.excel)return;await exportExcel(`${title.replace(/[^A-Za-z0-9]+/g,'_')}_${ctx.month}.xlsx`,[{name:(selectedOption.sheetName||selectedOption.label).slice(0,31),rows:selectedOption.excel(ctx)}]);toast.success('Excel file created');}
 const monthDaysCount=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
 // Generate (and the extra buttons) ask the screen's question first when it has one.
 const start=(optionValue=option)=>{if(config.confirm)setAsking(optionValue);else void generate(optionValue);};
 const fieldControl=(f:ReportField)=>{const v=fieldValues[f.key]??'';const set=(x:string)=>setFieldValues(p=>({...p,[f.key]:x}));const opts=typeof f.options==='function'?f.options(lists):f.options||[];
  if(f.kind==='check')return <label key={f.key} className="rpt-inline-field"><input type="checkbox" checked={v==='1'} onChange={e=>set(e.target.checked?'1':'0')}/>{f.label}</label>;
  if(f.kind==='radio')return <fieldset key={f.key} className="rpt-field-radios"><legend>{f.label}</legend>{opts.map(o=><label key={o.value}><input type="radio" name={'fld'+title+f.key} checked={v===o.value} onChange={()=>set(o.value)}/>{o.label}</label>)}</fieldset>;
  return <label key={f.key} className="rpt-row"><b>{f.label}</b>{f.kind==='select'?<select value={v} onChange={e=>set(e.target.value)}>{opts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input type={f.kind==='date'?'date':f.kind==='number'?'number':'text'} value={v} onChange={e=>set(e.target.value)}/>}</label>;};
 const leftFields=(config.fields||[]).filter(f=>(f.place||'left')==='left'),middleFields=(config.fields||[]).filter(f=>f.place==='middle');
 return <div className="rpt-window">
  <div className="rpt-tabs no-print"><button type="button" className={tab==='sel'?'is-active':''} onClick={()=>setTab('sel')}>Selecion</button><button type="button" className={tab==='rep'?'is-active':''} disabled={!ctx} onClick={()=>setTab('rep')}>Report</button><span className="rpt-title">{title}</span></div>
  {tab==='sel'&&<div className="rpt-selection">
   <div className="rpt-left">
    {(config.period==='month'||config.period==='month-days')&&<label className="rpt-row"><b>Month Name</b><select value={month} onChange={e=>{setMonth(e.target.value);const n=new Date(Date.UTC(Number(e.target.value.slice(0,4)),Number(e.target.value.slice(5,7)),0)).getUTCDate();setDayTo(n);}}>{pickMonths.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}</select></label>}
    {config.period==='month-days'&&<div className="rpt-row rpt-days"><span>Day From</span><input type="number" min={1} max={monthDaysCount} value={dayFrom} onChange={e=>setDayFrom(Math.max(1,Math.min(Number(e.target.value)||1,monthDaysCount)))}/><span>To</span><input type="number" min={dayFrom} max={monthDaysCount} value={Math.min(dayTo,monthDaysCount)} onChange={e=>setDayTo(Math.max(dayFrom,Math.min(Number(e.target.value)||monthDaysCount,monthDaysCount)))}/></div>}
    {config.period==='date'&&<label className="rpt-row"><b>Date</b><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>}
    {config.period==='range'&&<div className="rpt-row rpt-days"><span>{config.periodLabels?.from||'From'}</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/><span>{config.periodLabels?.to||'To'}</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>}
    {leftFields.map(fieldControl)}
    {config.filters.map(key=>{const f=filterDefs[key];return key==='company'?<div key={key} className="rpt-filter"><div className="rpt-filter-box"><b>{f.label}</b><span>{companyName}</span></div><span className="rpt-dots is-static">....</span></div>:<FilterPicker key={key} label={f.label} options={lists[f.table]||[]} selected={filters[key]||[]} onChange={v=>setFilters(p=>({...p,[key]:v}))}/>;})}
    {config.attendanceSource&&<label className="rpt-row"><b>Attendance</b><select value={attSource} onChange={e=>setAttSource(e.target.value as 'register'|'daily')}><option value="register">Muster register (original)</option><option value="daily">Time Updation attendance</option></select></label>}
    {useRegister&&register.data&&!register.data.attendance.length&&<p className="rpt-note">The original software has no muster register for {fyMonths.find(m=>m.value===month)?.label||month}. Choose “Time Updation attendance” to print this month from the daily attendance.</p>}
    {config.sex&&<label className="rpt-row"><b>Sex Selection</b><select value={sex} onChange={e=>setSex(e.target.value)}><option value="all">All</option><option value="Male">Male</option><option value="Female">Female</option></select></label>}
    <div className="rpt-sort">{!config.noSort&&<fieldset><legend>Sort On</legend>{[['paycode','Paycode'],['card','Card No.'],['name','Employee Name']].map(([v,l])=><label key={v}><input type="radio" name={'sort'+title} checked={sortOn===v} onChange={()=>setSortOn(v)}/>{l}</label>)}</fieldset>}
     <div>{config.withLeft&&<label><input type="checkbox" checked={withLeft} onChange={e=>setWithLeft(e.target.checked)}/>With Left Employee</label>}<label><input type="checkbox" checked={groupByDept} onChange={e=>setGroupByDept(e.target.checked)}/>Group By Department</label>{config.otExtraSpace&&<label><input type="checkbox" checked={otExtra} onChange={e=>setOtExtra(e.target.checked)}/>Ot Extra Space</label>}</div></div>
    {!config.noAddress&&<label className="rpt-row"><b>Address Print</b><select value={addressPrint} onChange={e=>setAddressPrint(e.target.value)}><option value="main">Main Company Address</option><option value="location">Location Address</option><option value="none">No Address</option></select></label>}
    {!config.noPrintDate&&<div className="rpt-row"><b>Print Date</b><input type="date" value={printDate} onChange={e=>setPrintDate(e.target.value)}/><label><input type="checkbox" checked={printDateShow} onChange={e=>setPrintDateShow(e.target.checked)}/>Print Date Show</label></div>}
    {(config.paymentMode||config.resignMode)&&<div className="rpt-modes">{config.paymentMode&&<fieldset><legend>Payment Mode</legend>{[['all','All'],['Bank','Bank'],['Cheque','Cheque'],['Cash','Cash']].map(([v,l])=><label key={v}><input type="radio" name={'pm'+title} checked={payMode===v} onChange={()=>setPayMode(v)}/>{l}</label>)}</fieldset>}
     {config.resignMode&&<fieldset><legend>Resign Mode</legend>{[['all','All'],['without','Without Resign'],['only','Only Resign']].map(([v,l])=><label key={v}><input type="radio" name={'rm'+title} checked={resignMode===v} onChange={()=>setResignMode(v)}/>{l}</label>)}</fieldset>}</div>}
   </div>
   <div className="rpt-middle">
    <div className="rpt-top">
     <fieldset className="rpt-options" style={{columnCount:config.columns||1}}><legend>Reports Selection</legend>{config.multi&&<div style={{columnSpan:'all',display:'flex',alignItems:'center',gap:8,marginBottom:8}}><button type="button" style={{width:'auto',padding:'3px 10px',border:'1px solid #9aa9b8',borderRadius:4,background:'#f4f7fa',fontSize:13}} onClick={()=>{const all=config.options.filter(o=>!o.hidden).map(o=>o.value);setPicked(all);setOption(all[0]);}}>Select all</button><button type="button" style={{width:'auto',padding:'3px 10px',border:'1px solid #9aa9b8',borderRadius:4,background:'#f4f7fa',fontSize:13}} onClick={()=>setPicked([])}>Clear</button><span className="subtle">{picked.length} selected</span></div>}{config.options.filter(o=>!o.hidden).map(o=><label key={o.value}>{config.multi?<input type="checkbox" checked={picked.includes(o.value)} onChange={e=>{const next=e.target.checked?config.options.map(x=>x.value).filter(v=>v===o.value||picked.includes(v)):picked.filter(v=>v!==o.value);setPicked(next);if(next[0])setOption(next[0]);}}/>:<input type="radio" name={'opt'+title} checked={option===o.value} onChange={()=>setOption(o.value)}/>}{o.label}{o.value==='ot'&&<span className="rpt-inline"><input type="checkbox" checked={salaryWithOt} onChange={e=>setSalaryWithOt(e.target.checked)}/>Salary</span>}{o.value==='advance'&&config.advSheet&&<input className="rpt-small" aria-label="Advance sheet value" value={adv} onChange={e=>setAdv(e.target.value)}/>}</label>)}</fieldset>
     {config.choices&&<label className="rpt-row"><b>{config.choices.label}</b><select value={choice} onChange={e=>setChoice(e.target.value)}>{config.choices.values.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select></label>}
     {middleFields.length>0&&<div className="rpt-middle-fields">{middleFields.map(fieldControl)}</div>}
     <div className="rpt-buttons"><button type="button" className="rpt-generate" disabled={busy||extrasQuery.isPending||listsPending} onClick={()=>start()}>{busy?'Please Wait…':'Generate'}</button><button type="button" className="rpt-close" onClick={onClose}>Close</button>
      {config.extraButtons?.map(b=><button key={b.option} type="button" className="rpt-big" disabled={busy||extrasQuery.isPending||listsPending} onClick={()=>start(b.option)}>{b.label}</button>)}</div>
    </div>
    {selectedOption.note&&<p className="rpt-note">{selectedOption.note}</p>}{config.note&&<p className="rpt-note">{config.note}</p>}
    {error&&<ErrorMessage message={error}/>}
    {selectedOption.withEmployees!==false&&<div className="rpt-grid-area"><div className="rpt-grid-head"><input aria-label="Find employee in list" className="rpt-find" value={search} onChange={e=>{setSearch(e.target.value);setLimit(200);}} placeholder="Find"/><label><input type="checkbox" checked={allChecked&&exceptions.size===0} onChange={e=>{setAllChecked(e.target.checked);setExceptions(new Set());}}/>Checked For All Employee</label><span className="subtle">{base.filter(e=>isChecked(e.id)).length} of {base.length} ticked</span></div>
     <div className="rpt-grid"><table><thead><tr><th/><th>Employee Name</th><th>Paycode</th><th>Card No</th></tr></thead><tbody>{shown.slice(0,limit).map(e=><tr key={e.id}><td><input type="checkbox" aria-label={'Include '+e.name} checked={isChecked(e.id)} onChange={()=>toggle(e.id)}/></td><td>{e.name}</td><td>{e.paycode}</td><td>{e.cardNo}</td></tr>)}</tbody></table>
      {shown.length>limit&&<button type="button" className="rpt-more" onClick={()=>setLimit(l=>l+300)}>Show more ({shown.length-limit} more)</button>}</div></div>}
   </div>
  </div>}
  {/* The viewer stays mounted behind the Selecion tab, so going back to the Report finds the same page; a new Generate starts it afresh. */}
  {ctx&&<div hidden={tab!=='rep'}><Viewer key={gen} active={tab==='rep'} title={title} pages={pages} onRefresh={()=>generate(option)} onExcel={selectedOption.excel&&!(config.multi&&picked.length>1)?excel:undefined}/></div>}
  <Dialog open={asking!==null} onOpenChange={v=>{if(!v)setAsking(null);}}><DialogContent className="rpt-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{config.confirm}</DialogDescription></DialogHeader>
   <div className="rpt-dialog-actions"><Button onClick={()=>{const v=asking!;setAsking(null);void generate(v);}}>Yes</Button><Button variant="outline" onClick={()=>setAsking(null)}>No</Button></div></DialogContent></Dialog>
 </div>;
}
