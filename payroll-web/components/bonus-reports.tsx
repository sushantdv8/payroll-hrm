'use client';
import {useMemo,useRef,useState,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import type {SalarySnapshot} from '@/lib/backup';
import {trimCell,type MasterRow,type MasterValues} from '@/lib/masters';
import {exportExcel,requestJson} from '@/lib/client-api';
import {dmy,fyMonths} from '@/lib/report-utils';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {ErrorMessage} from './payroll-controls';
import {ReportForm,type FilterKey,type ReportConfig,type ReportContext,type ReportPage} from './reports/report-form';
import {n2,nz,tablePages} from './reports/report-parts';
import './reports/reports.css';
import './bonus-reports.css';

// tbbon keeps one set of columns per month: 4..15 = Apr-2026..Mar-2027 (the original's month_no, = fyMonths index + 1).
const MONTHS=Array.from({length:12},(_,k)=>k+4);
const PARTS=['day','tearn','bwage','ewage','bon','exg'] as const;type Part=typeof PARTS[number];
type Line=Record<Part,number>;
type BonusRow={key:string;bonp:number;exgp:number;months:Partial<Record<number,Line>>};
// rows are keyed by employee id; source 'saved' = read back from tbbon (nothing processed in this window yet).
type BonusData={source:'processed'|'saved';from:number;to:number;rows:Map<string,BonusRow>};
type Item={e:Employee;r:BonusRow};
const FIELDS=[['bonusPct','Bonus %','8.33'],['exgPct','Ex-Gratia%','8.33'],['bonusAmt','Bonus Amt.','3500'],['exgAmt','Exg. Amt.','50000'],['bonusLimit','Bonus Limit','10000'],['exgLimit','Exg. Limit','200000']] as const;
type FieldKey=typeof FIELDS[number][0];
type Params=Record<FieldKey,number>&{net:boolean;from:number;to:number};
const ALL_FILTERS:FilterKey[]=['company','subCompany','location','dhead','department','designation','category','salaryGrade','leaveGrade','shift'];
const NOTHING='No bonus has been processed or saved yet. Press Process on the Bonus calculation tab first.';

const mValue=(k:number)=>fyMonths[k-1].value;const mLabel=(k:number)=>fyMonths[k-1].label;
const span=(d:BonusData)=>MONTHS.filter(k=>k>=d.from&&k<=d.to);
const sum=(r:BonusRow,p:Part)=>MONTHS.reduce((s,k)=>s+(r.months[k]?.[p]||0),0);
const r2=(v:number)=>Math.round(v*100)/100;
const num=(v:string|null|undefined)=>{const n=Number(trimCell(v));return Number.isFinite(n)?n:0;};
const keyOf=(e:Employee)=>String(e.sourceKey||e.id);
const period=(d:BonusData)=>`For the period ${mLabel(d.from)} to ${mLabel(d.to)}${d.source==='saved'?' (bonus saved earlier)':''}`;
const yearEnd=(k:number)=>{const [y,m]=mValue(k).split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const age15=(dob:string,start:string)=>!/^\d{4}-\d{2}-\d{2}$/.test(dob)||dob>='2099'?'':`${Number(dob.slice(0,4))+15}${dob.slice(4)}`<=start?'Yes':'No';
function common(rows:MasterRow[]|undefined,col:string){const counts=new Map<string,number>();for(const r of rows||[]){const v=trimCell(r.values[col]);if(num(v))counts.set(v,(counts.get(v)||0)+1);}let best:string|undefined,top=0;for(const [v,c] of counts)if(c>top){best=v;top=c;}return best;}

// Employee Entry's bonus_min / bonus_max (yearly amounts, 0 = none) raise or cap the year's bonus; the change is spread over the months in proportion.
// 'outside' is the bonus already saved for the year's other months, so processing the year in parts still limits the year.
function limitBonus(months:BonusRow['months'],min:number,max:number,outside=0){
 const ks=Object.keys(months).map(Number);const total=ks.reduce((s,k)=>s+months[k]!.bon,0);const year=outside+total;
 const yearTarget=max>0&&year>max?max:min>0&&year>0&&year<min?min:year;const target=Math.max(0,r2(yearTarget-outside));if(!total||target===total)return;
 let left=target;ks.forEach((k,i)=>{const m=months[k]!;m.bon=i===ks.length-1?r2(left):r2(m.bon*target/total);left-=m.bon;});
}
// Payment of Bonus Act, month by month on the saved salary:
// - eligibility: a month whose bonus wages exceed 'Bonus Limit' (10000 = the Act's eligibility limit before 2015; 21000 now) earns no bonus;
// - calculation ceiling: the Act computes bonus on min(wages, max(7000, minimum wage)) (3500 before 2015). The screen has no minimum-wage box,
//   so 'Bonus Amt.' is taken as that monthly ceiling: bonus wages = min(wages, Bonus Amt.); bonus = bonus wages x Bonus %;
// - ex-gratia works the same way with its own boxes: 'Exg. Limit' = monthly wage limit, 'Exg. Amt.' = monthly ceiling, ex-gratia = ex-gratia wages x Ex-Gratia%.
// A limit or ceiling of 0 means none. The original's saved salaries carry no head rates, so both tests use the month's earned wages.
// Wages = earnings of the heads ticked 'Bonus' in Earning heads (tbearn bon_alw), the gross when no head is ticked, the net salary when 'Net Earning' is ticked.
// An employee who already has a saved bonus stays in the result even when nothing is due now, so Save sets the processed months to 0.
function calculate(p:Params,{employees,tbemp,tbearn,tbbon,salaries}:{employees:Employee[];tbemp:MasterRow[];tbearn:MasterRow[];tbbon:MasterRow[];salaries:Map<number,Map<string,SalarySnapshot>>}){
 const emp=new Map(tbemp.map(r=>[trimCell(r.values.emp_code).toLowerCase(),r.values]));
 const outside=new Map(tbbon.map(r=>[trimCell(r.values.emp_code).toLowerCase(),MONTHS.filter(k=>k<p.from||k>p.to).reduce((s,k)=>s+num(r.values['bon'+k]),0)]));
 const heads=new Set(tbearn.filter(r=>trimCell(r.values.bon_alw)==='1').map(r=>trimCell(r.values.ern_name).toLowerCase()).filter(Boolean));
 // Employee Entry's 'Bonus Allow' / 'Bonus Exg.' ticks choose who is paid; a tick that no employee has (the original data has none) is not used, so everybody is processed.
 const bonusTicks=tbemp.some(r=>trimCell(r.values.bonus_alw)==='1'),exgTicks=tbemp.some(r=>trimCell(r.values.ex_gratia)==='1');
 const rows=new Map<string,BonusRow>();
 for(const e of employees){
  const k0=keyOf(e).toLowerCase();const hasSaved=outside.has(k0);
  const x=emp.get(k0);const bonusOn=!bonusTicks||trimCell(x?.bonus_alw)==='1',exgOn=!exgTicks||trimCell(x?.ex_gratia)==='1';if(!bonusOn&&!exgOn&&!hasSaved)continue;
  // The employee's own Bonus % (Employee Entry) replaces the screen's.
  const bonp=bonusOn?num(x?.bonus_per)>0?num(x?.bonus_per):p.bonusPct:0,exgp=exgOn?p.exgPct:0;const months:BonusRow['months']={};
  for(let k=p.from;k<=p.to;k++){const s=salaries.get(k)?.get(e.id);if(!s)continue;
   const wages=Math.max(0,p.net?s.net||0:heads.size?s.earnings.filter(h=>heads.has(trimCell(h.label).toLowerCase())).reduce((a,h)=>a+(h.amount||0),0):s.gross||0);
   const bwage=bonusOn&&(!p.bonusLimit||wages<=p.bonusLimit)?Math.min(wages,p.bonusAmt||wages):0,ewage=exgOn&&(!p.exgLimit||wages<=p.exgLimit)?Math.min(wages,p.exgAmt||wages):0;
   months[k]={day:s.payableDays||0,tearn:s.gross||0,bwage:r2(bwage),ewage:r2(ewage),bon:r2(bwage*bonp/100),exg:r2(ewage*exgp/100)};}
  // The yearly minimum is only known to be short once the range reaches March; an earlier part is never raised.
  limitBonus(months,p.to===15?num(x?.bonus_min):0,num(x?.bonus_max),outside.get(k0)||0);
  // A saved employee with no salary in these months is left alone: missing salaries are not a bonus of 0.
  const row:BonusRow={key:keyOf(e),bonp,exgp,months};if(sum(row,'bon')+sum(row,'exg')>0||(hasSaved&&Object.keys(months).length>0))rows.set(e.id,row);
 }
 return {rows,bonusTicks,exgTicks,heads:heads.size};
}
function savedData(rows:MasterRow[],employees:Employee[]):BonusData|null{
 const byKey=new Map(employees.map(e=>[keyOf(e).toLowerCase(),e]));const out=new Map<string,BonusRow>();
 for(const r of rows){const e=byKey.get(trimCell(r.values.emp_code).toLowerCase());if(!e)continue;const months:BonusRow['months']={};
  for(const k of MONTHS){const line=Object.fromEntries(PARTS.map(p=>[p,num(r.values[p+k])])) as Line;if(PARTS.some(p=>line[p]))months[k]=line;}
  out.set(e.id,{key:keyOf(e),bonp:num(r.values.bonp),exgp:num(r.values.exgp),months});}
 return out.size?{source:'saved',from:4,to:15,rows:out}:null;
}
// Values for POST /api/masters master-save on tbbon (every field of the definition; cmp_code comes from its defaults on a new row).
function saveValues(r:BonusRow,d:BonusData,old:MasterValues|undefined){
 const fmt=(v:number)=>{const x=r2(v);return x===0?'0':String(x);};
 const out:Record<string,string>={emp_code:r.key,bonp:fmt(r.bonp),exgp:fmt(r.exgp),bpaid:trimCell(old?.bpaid)==='1'?'1':'0'};
 // Months outside the processed range keep what was saved before.
 for(const k of MONTHS)for(const p of PARTS)out[p+k]=k>=d.from&&k<=d.to?fmt(r.months[k]?.[p]||0):old?fmt(num(old[p+k])):'0';
 return out;
}

type Spec={h:string;cls?:string;w?:string;v:(it:Item,i:number)=>string|number;total?:boolean;fmt?:(v:number)=>string};
function specPages(ctx:ReportContext,o:{key:string;title:string;subtitle:string;specs:Spec[];list:Item[];perPage:number;numbered?:boolean;footer?:ReactNode;cls?:string}):ReportPage[]{
 const cell=(s:Spec,v:string|number)=>typeof v==='number'?(s.fmt||n2)(v):v;
 const pages=tablePages(ctx,{key:o.key,title:o.title,subtitle:o.subtitle,perPage:o.perPage,footer:o.footer,tree:rows=>o.list[rows[0]]?.e.paycode||'',
  columns:o.specs.map((s,j)=>({h:o.numbered?<>{s.h}<div className="bon-colno">{j+1}</div></>:s.h,cls:s.cls,w:s.w})),
  rows:o.list.map((it,i)=>o.specs.map(s=>cell(s,s.v(it,i)))),
  totals:o.specs.map((s,j)=>s.total?cell(s,o.list.reduce((a,it,i)=>a+(Number(s.v(it,i))||0),0)):j===1?'Total':'')});
 return o.cls?pages.map(p=>({...p,node:<div className={o.cls}>{p.node}</div>})):pages;
}
const specExcel=(specs:Spec[],list:Item[])=>[specs.map(s=>s.h),...list.map((it,i)=>specs.map(s=>{const v=s.v(it,i);return typeof v==='number'?r2(v):v;}))];
const sno:Spec['fmt']=v=>String(v);
const summarySpecs:Spec[]=[{h:'Sno',cls:'c',v:(_,i)=>i+1,fmt:sno},{h:'Paycode',v:({e})=>e.paycode},{h:'Card No',v:({e})=>e.cardNo},{h:'Employee Name',v:({e})=>e.name},{h:'Department',v:({e})=>e.department},{h:'Designation',v:({e})=>e.designation},
 {h:'Days',cls:'num',v:({r})=>sum(r,'day'),total:true,fmt:nz},{h:'Total Earning',cls:'num',v:({r})=>sum(r,'tearn'),total:true},{h:'Bonus Wages',cls:'num',v:({r})=>sum(r,'bwage'),total:true},{h:'Bonus %',cls:'num',v:({r})=>r.bonp},{h:'Bonus',cls:'num',v:({r})=>sum(r,'bon'),total:true},
 {h:'Exg. Wages',cls:'num',v:({r})=>sum(r,'ewage'),total:true},{h:'Ex-Gratia %',cls:'num',v:({r})=>r.exgp},{h:'Ex-Gratia',cls:'num',v:({r})=>sum(r,'exg'),total:true},{h:'Total',cls:'num',v:({r})=>sum(r,'bon')+sum(r,'exg'),total:true}];
// Payment of Bonus Rules, Form C (register of bonus paid). Deductions (columns 9-12) are not kept by this program and print empty.
const formCSpecs=(start:string):Spec[]=>[{h:'Sl. No.',cls:'c',v:(_,i)=>i+1,fmt:sno},{h:'Name of the employee',w:'30mm',v:({e})=>e.name},{h:"Father's name",w:'28mm',v:({e})=>e.fatherName},{h:'Whether he has completed 15 years of age at the beginning of the accounting year',cls:'c',v:({e})=>age15(e.dob,start)},{h:'Designation',w:'22mm',v:({e})=>e.designation},
 {h:'No. of days worked in the year',cls:'num',v:({r})=>sum(r,'day'),total:true,fmt:nz},{h:'Total salary or wage in respect of the accounting year',cls:'num',v:({r})=>sum(r,'bwage'),total:true},{h:'Amount of bonus payable under section 10 or 11',cls:'num',v:({r})=>sum(r,'bon'),total:true},
 {h:'Puja bonus or other customary bonus paid during the accounting year',cls:'num',v:()=>''},{h:'Interim bonus or bonus paid in advance',cls:'num',v:()=>''},{h:'Amount of income-tax deducted',cls:'num',v:()=>''},{h:'Deduction on account of financial loss, if any, caused by misconduct of the employee',cls:'num',v:()=>''},
 {h:'Total sum deducted under columns 9, 10, 11 and 12',cls:'num',v:()=>0,total:true},{h:'Net amount payable (column 8 minus column 13)',cls:'num',v:({r})=>sum(r,'bon'),total:true},{h:'Amount actually paid',cls:'num',v:()=>''},{h:'Date on which paid',v:()=>''},{h:'Signature / thumb impression of the employee',w:'26mm',v:()=>''}];
function registerPages(ctx:ReportContext,d:BonusData,list:Item[]):ReportPage[]{
 const ks=span(d);const two=(a:number,b:number)=><>{n2(a)}<br/>{n2(b)}</>;const tot=(p:Part,k?:number)=>list.reduce((s,{r})=>s+(k==null?sum(r,p):r.months[k]?.[p]||0),0);
 return tablePages(ctx,{key:'bonreg',title:'Bonus Register',subtitle:period(d),perPage:14,tree:rows=>list[rows[0]]?.e.paycode||'',
  columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name',w:'32mm'},...ks.map(k=>({h:<>{mLabel(k)}<br/>Wages / Bonus</>,cls:'num'})),{h:'Bonus Wages',cls:'num'},{h:'Total Bonus',cls:'num'},{h:'Ex-Gratia',cls:'num'},{h:'Total',cls:'num'}],
  rows:list.map(({e,r},i)=>[i+1,e.paycode,e.name,...ks.map(k=>{const m=r.months[k];return m?two(m.bwage,m.bon):'';}),n2(sum(r,'bwage')),n2(sum(r,'bon')),n2(sum(r,'exg')),n2(sum(r,'bon')+sum(r,'exg'))]),
  totals:['','','Total',...ks.map(k=>two(tot('bwage',k),tot('bon',k))),n2(tot('bwage')),n2(tot('bon')),n2(tot('exg')),n2(tot('bon')+tot('exg'))]});
}
const registerExcel=(d:BonusData,list:Item[])=>{const ks=span(d);return [['Sno','Paycode','Employee Name',...ks.flatMap(k=>[`${mLabel(k)} Wages`,`${mLabel(k)} Bonus`]),'Bonus Wages','Total Bonus','Ex-Gratia','Total'],
 ...list.map(({e,r},i)=>[i+1,e.paycode,e.name,...ks.flatMap(k=>[r2(r.months[k]?.bwage||0),r2(r.months[k]?.bon||0)]),r2(sum(r,'bwage')),r2(sum(r,'bon')),r2(sum(r,'exg')),r2(sum(r,'bon')+sum(r,'exg'))])];};
function exportRows(d:BonusData,list:Item[]){const ks=span(d);const names:[Part,string][]=[['day','Days'],['tearn','Total Earning'],['bwage','Bonus Wages'],['bon','Bonus'],['ewage','Exg. Wages'],['exg','Ex-Gratia']];
 return [['Paycode','Card No','Employee Name','Father Name','Department','Designation',...ks.flatMap(k=>names.map(([,l])=>`${mLabel(k)} ${l}`)),...names.map(([,l])=>'Total '+l),'Bonus %','Ex-Gratia %','Bonus + Ex-Gratia'],
  ...list.map(({e,r})=>[e.paycode,e.cardNo,e.name,e.fatherName,e.department,e.designation,...ks.flatMap(k=>names.map(([p])=>r2(r.months[k]?.[p]||0))),...names.map(([p])=>r2(sum(r,p))),r.bonp,r.exgp,r2(sum(r,'bon')+sum(r,'exg'))])];}

export function BonusReports({dataset,employees,companyName,onClose}:{dataset:string;employees:Employee[];companyName:string;onClose:()=>void}){
 const client=useQueryClient();const formRef=useRef<HTMLDivElement>(null);
 const [tab,setTab]=useState<'calc'|'form'>('calc');const [values,setValues]=useState<Partial<Record<FieldKey,string>>>({});const [net,setNet]=useState(false);const [from,setFrom]=useState(4);const [to,setTo]=useState(15);
 const [result,setResult]=useState<BonusData|null>(null);const [status,setStatus]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [generated,setGenerated]=useState(false);
 const [allTicked,setAllTicked]=useState(true);const [exceptions,setExceptions]=useState<Set<string>>(new Set());const [search,setSearch]=useState('');const [limit,setLimit]=useState(200);
 const [confirm,setConfirm]=useState(false);const [saving,setSaving]=useState<[number,number]|null>(null);
 const tbbonUrl='/api/masters?'+new URLSearchParams({dataset,table:'tbbon'});
 const savedQuery=useQuery({queryKey:['masters',dataset,'tbbon'],queryFn:({signal})=>requestJson<{rows:MasterRow[]}>(tbbonUrl,{signal}),refetchOnWindowFocus:false});
 const saved=useMemo(()=>savedData(savedQuery.data?.rows||[],employees),[savedQuery.data,employees]);
 const data=result||saved;
 // Bonus % / Ex-Gratia% start from the rates most used in the saved bonus (tbbon), when there is any; the other boxes start from the original's defaults.
 const prefill=useMemo<Partial<Record<FieldKey,string>>>(()=>({bonusPct:common(savedQuery.data?.rows,'bonp'),exgPct:common(savedQuery.data?.rows,'exgp')}),[savedQuery.data]);
 const value=(k:FieldKey)=>values[k]??prefill[k]??FIELDS.find(f=>f[0]===k)![2];
 const resultList=useMemo(()=>result?employees.filter(e=>result.rows.has(e.id)).sort((a,b)=>a.paycode.localeCompare(b.paycode,undefined,{numeric:true})):[],[result,employees]);
 const shown=useMemo(()=>{const q=search.trim().toLowerCase();return q?resultList.filter(e=>[e.name,e.paycode,e.cardNo].join(' ').toLowerCase().includes(q)):resultList;},[resultList,search]);
 const isTicked=(id:string)=>allTicked?!exceptions.has(id):exceptions.has(id);const tickedCount=resultList.filter(e=>isTicked(e.id)).length;
 const formEmployees=useMemo(()=>data?employees.filter(e=>{const r=data.rows.get(e.id);return !!r&&sum(r,'bon')+sum(r,'exg')>0;}):[],[data,employees]);

 const config=useMemo<ReportConfig>(()=>{
  // Rows kept only to clear a bonus saved earlier (nothing due now) are not printed.
  const need=(ctx:ReportContext)=>{if(!data)throw new Error(NOTHING);return {d:data,list:ctx.employees.flatMap(e=>{const r=data.rows.get(e.id);return r&&sum(r,'bon')+sum(r,'exg')>0?[{e,r}]:[];})};};
  // The ReportForm's Report tab is reachable from the calculation tab once a report was built.
  const built=(make:(ctx:ReportContext)=>ReportPage[])=>(ctx:ReportContext)=>{const pages=make(ctx);setGenerated(true);return pages;};
  const summary=(ctx:ReportContext)=>{const {d,list}=need(ctx);return specPages(ctx,{key:'bonsum',title:'Bonus Summary',subtitle:period(d),specs:summarySpecs,list,perPage:28});};
  const note=!data?NOTHING:data.source==='saved'?'Nothing processed in this window: the reports print the bonus saved earlier. Press Process on the Bonus calculation tab to work it out again.':`The reports print the bonus processed on the Bonus calculation tab (${mLabel(data.from)} to ${mLabel(data.to)}).`;
  return {period:'none',filters:ALL_FILTERS,withLeft:true,paymentMode:true,note,options:[
   {value:'register',label:'Bonus Register',build:built(ctx=>{const {d,list}=need(ctx);return registerPages(ctx,d,list);}),excel:ctx=>{const {d,list}=need(ctx);return registerExcel(d,list);}},
   {value:'summary',label:'Bonus Summary',build:built(summary),excel:ctx=>specExcel(summarySpecs,need(ctx).list)},
   // Form C lists only the employees with a statutory bonus (ex-gratia is not part of it).
   {value:'formc',label:'Bonus Form C',build:built(ctx=>{const {d,list}=need(ctx);const start=mValue(d.from)+'-01';return specPages(ctx,{key:'bonc',title:'FORM C  [See Rule 4(c)]',subtitle:`Bonus paid to employees for the accounting year ending on the ${dmy(yearEnd(d.to))}`,specs:formCSpecs(start),list:list.filter(({r})=>sum(r,'bon')>0),perPage:12,numbered:true,cls:'bon-formc',
    footer:<div className="bon-sign-row"><span>Date : {dmy(ctx.printDate)}</span><span>Signature of the Employer / Authorised Signatory</span></div>});}),excel:ctx=>{const {d,list}=need(ctx);return specExcel(formCSpecs(mValue(d.from)+'-01'),list.filter(({r})=>sum(r,'bon')>0));}},
   {value:'export',label:'Bonus Export',note:'Creates an Excel file with the monthly days, earning, bonus wages, bonus and ex-gratia of the ticked employees.',build:built(summary),
    action:async ctx=>{const {d,list}=need(ctx);if(!list.length)throw new Error('None of the ticked employees has a bonus.');await exportExcel(`Bonus_Export_${mLabel(d.from)}_${mLabel(d.to)}.xlsx`,[{name:'Bonus',rows:exportRows(d,list)}]);toast.success('Excel file created');}}]};
 },[data]);

 async function process(){
  setError('');const p={net,from,to} as Params;
  for(const [k,label] of FIELDS){const s=value(k).trim();const v=Number(s);if(!s||!Number.isFinite(v)||v<0){setError(`${label}: enter a number (0 or more).`);return;}p[k]=v;}
  if(p.bonusPct>100||p.exgPct>100){setError('Bonus % and Ex-Gratia% cannot be more than 100.');return;}
  if(from>to){setError('From Month must be on or before To Month.');return;}
  setBusy(true);setStatus('');
  try{
   const get=<T,>(key:unknown[],url:string)=>client.fetchQuery({queryKey:key,queryFn:({signal})=>requestJson<T>(url,{signal}),staleTime:30000});const ks=MONTHS.filter(k=>k>=from&&k<=to);
   const [emp,earn,bon,sal]=await Promise.all([get<{rows:MasterRow[]}>(['masters',dataset,'tbemp'],'/api/masters?'+new URLSearchParams({dataset,table:'tbemp'})),get<{rows:MasterRow[]}>(['masters',dataset,'tbearn'],'/api/masters?'+new URLSearchParams({dataset,table:'tbearn'})),
    client.fetchQuery({queryKey:['masters',dataset,'tbbon'],queryFn:({signal})=>requestJson<{rows:MasterRow[]}>(tbbonUrl,{signal}),staleTime:0}),
    Promise.all(ks.map(k=>get<{salaries:SalarySnapshot[]}>(['backup','salaries',dataset,mValue(k)],'/api/backup?'+new URLSearchParams({view:'salaries',dataset,month:mValue(k)}))))]);
   const out=calculate(p,{employees,tbemp:emp.rows,tbearn:earn.rows,tbbon:bon.rows,salaries:new Map(ks.map((k,i)=>[k,new Map(sal[i].salaries.map(s=>[s.employeeId,s]))]))});
   const missing=ks.filter((_,i)=>!sal[i].salaries.length);const due=[...out.rows.values()].filter(r=>sum(r,'bon')+sum(r,'exg')>0).length;const cleared=out.rows.size-due;
   setResult({source:'processed',from,to,rows:out.rows});setAllTicked(true);setExceptions(new Set());setLimit(200);setSearch('');
   setStatus([`${due} employees have a bonus for ${mLabel(from)} to ${mLabel(to)}.`,cleared?`${cleared} employees with a bonus saved earlier have none now; Save sets their bonus for these months to 0.`:'',missing.length===ks.length?'No salary is saved in this period.':missing.length?`No salary saved for ${missing.map(mLabel).join(', ')}.`:'',
    net?'Wages = net salary.':out.heads?`Wages = the ${out.heads} earning heads ticked “Bonus”.`:'No earning head is ticked “Bonus”: wages = gross salary.',
    !out.bonusTicks?'No employee has “Bonus Allow” ticked in Employee Entry, so every employee was processed.':'',!out.exgTicks?'No employee has “Bonus Exg.” ticked, so ex-gratia was worked out for everyone.':''].filter(Boolean).join(' '));
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 // Writes the ticked processed rows to tbbon, one master-save per employee (existing rows are updated with their current revision).
 async function save(){
  setConfirm(false);if(!result)return;const ticked=resultList.filter(e=>isTicked(e.id));if(!ticked.length){setError('Tick at least one employee to save.');return;}
  setError('');setSaving([0,ticked.length]);
  try{
   const fresh=await client.fetchQuery({queryKey:['masters',dataset,'tbbon'],queryFn:({signal})=>requestJson<{rows:MasterRow[]}>(tbbonUrl,{signal}),staleTime:0});const byKey=new Map(fresh.rows.map(r=>[r.key.toLowerCase(),r]));
   let n=0;for(const e of ticked){const row=result.rows.get(e.id)!;const old=byKey.get(row.key.toLowerCase());
    await requestJson('/api/masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'master-save',table:'tbbon',dataset,key:old?old.key:null,revision:old?old.revision:0,values:saveValues(row,result,old?.values)})});setSaving([++n,ticked.length]);}
   toast.success(`Bonus saved for ${n} employees`);
  }catch(e){setError((e as Error).message);}finally{setSaving(null);await client.invalidateQueries({queryKey:['masters',dataset,'tbbon']});}
 }
 // ReportForm keeps its own Selecion / Report tab; the tab strip of the calculation tab switches it through its buttons.
 function openForm(which:0|1){formRef.current?.querySelectorAll<HTMLButtonElement>('.rpt-tabs button')[which]?.click();setTab('form');}
 function toggle(id:string){setExceptions(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});}
 const total=(p:Part)=>resultList.reduce((s,e)=>s+sum(result!.rows.get(e.id)!,p),0);
 const months=fyMonths.slice(3,15).map((m,i)=>({k:i+4,label:m.label}));

 return <div className="bon-reports">
  {tab==='calc'&&<div className="rpt-window">
   <div className="rpt-tabs no-print"><button type="button" className="is-active">Bonus calculation</button><button type="button" onClick={()=>openForm(0)}>Selecion</button><button type="button" disabled={!generated} onClick={()=>openForm(1)}>Report</button><span className="rpt-title">Bonus Reports</span></div>
   <div className="bon-calc">
    <div className="bon-top">
     <div className="bon-params">{FIELDS.map(([k,label])=><label key={k}><span>{label}</span><input inputMode="decimal" value={value(k)} disabled={busy||!!saving} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/></label>)}</div>
     <label className="bon-check"><input type="checkbox" checked={net} disabled={busy||!!saving} onChange={e=>setNet(e.target.checked)}/>Net Earning</label>
     <div className="bon-months"><label><span>From Month</span><select value={from} disabled={busy||!!saving} onChange={e=>setFrom(Number(e.target.value))}>{months.map(m=><option key={m.k} value={m.k}>{m.label}</option>)}</select></label>
      <label><span>To Month</span><select value={to} disabled={busy||!!saving} onChange={e=>setTo(Number(e.target.value))}>{months.map(m=><option key={m.k} value={m.k}>{m.label}</option>)}</select></label></div>
     <div className="bon-buttons"><button type="button" disabled={busy||!!saving} onClick={()=>void process()}>{busy?'Please Wait…':'Process'}</button>
      <button type="button" disabled={!result||busy||!!saving||!tickedCount} onClick={()=>setConfirm(true)}>{saving?`Saving ${saving[0]} of ${saving[1]}…`:'Save Bonus'}</button>
      <button type="button" disabled={!!saving} onClick={onClose}>Close</button></div>
    </div>
    <p className="rpt-note">Each month: wages above <b>Bonus Limit</b> earn no bonus, wages above <b>Bonus Amt.</b> count as Bonus Amt., bonus = bonus wages × Bonus %. Ex-gratia uses Exg. Limit, Exg. Amt. and Ex-Gratia% the same way. Save Bonus stores the ticked employees in the bonus table; the Selecion and Report tabs print the processed figures.</p>
    {error&&<ErrorMessage message={error}/>}
    {status&&<p className="bon-status">{status}</p>}
    {result&&<div className="bon-result">
     <div className="rpt-grid-head"><input aria-label="Find employee in result" className="rpt-find" value={search} onChange={e=>{setSearch(e.target.value);setLimit(200);}} placeholder="Find"/><label><input type="checkbox" checked={allTicked&&exceptions.size===0} onChange={e=>{setAllTicked(e.target.checked);setExceptions(new Set());}}/>Checked For All Employee</label><span className="subtle">{tickedCount} of {resultList.length} ticked to save</span></div>
     <div className="bon-grid"><table><thead><tr><th/><th>Paycode</th><th>Employee Name</th><th>Days</th><th>Total Earning</th><th>Bonus Wages</th><th>Bonus</th><th>Exg. Wages</th><th>Ex-Gratia</th><th>Total</th></tr></thead>
      <tbody>{shown.slice(0,limit).map(e=>{const r=result.rows.get(e.id)!;return <tr key={e.id}><td><input type="checkbox" aria-label={'Save bonus of '+e.name} checked={isTicked(e.id)} onChange={()=>toggle(e.id)}/></td><td>{e.paycode}</td><td>{e.name}</td><td className="num">{nz(sum(r,'day'))}</td><td className="num">{n2(sum(r,'tearn'))}</td><td className="num">{n2(sum(r,'bwage'))}</td><td className="num">{n2(sum(r,'bon'))}</td><td className="num">{n2(sum(r,'ewage'))}</td><td className="num">{n2(sum(r,'exg'))}</td><td className="num">{n2(sum(r,'bon')+sum(r,'exg'))}</td></tr>;})}
       {!resultList.length&&<tr><td colSpan={10} className="bon-empty">No employee has a bonus for this period.</td></tr>}</tbody>
      {resultList.length>0&&<tfoot><tr><td/><td/><td>Total ({resultList.length})</td><td className="num">{nz(total('day'))}</td><td className="num">{n2(total('tearn'))}</td><td className="num">{n2(total('bwage'))}</td><td className="num">{n2(total('bon'))}</td><td className="num">{n2(total('ewage'))}</td><td className="num">{n2(total('exg'))}</td><td className="num">{n2(total('bon')+total('exg'))}</td></tr></tfoot>}</table>
      {shown.length>limit&&<button type="button" className="rpt-more" onClick={()=>setLimit(l=>l+300)}>Show more ({shown.length-limit} more)</button>}</div>
    </div>}
   </div>
  </div>}
  <div ref={formRef} className="bon-form" hidden={tab!=='form'}>
   <button type="button" className="bon-calc-tab no-print" onClick={()=>setTab('calc')}>Bonus calculation</button>
   <ReportForm dataset={dataset} employees={formEmployees} title="Bonus Reports" config={config} companyName={companyName} onClose={onClose}/>
  </div>
  <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent className="rpt-dialog"><DialogHeader><DialogTitle>Save Bonus</DialogTitle><DialogDescription>Save the processed bonus of {tickedCount} ticked {tickedCount===1?'employee':'employees'} ({result?`${mLabel(result.from)} to ${mLabel(result.to)}`:''})? Their saved bonus for these months is replaced.</DialogDescription></DialogHeader>
   <div className="rpt-dialog-actions"><Button onClick={()=>void save()}>Yes</Button><Button variant="outline" onClick={()=>setConfirm(false)}>No</Button></div></DialogContent></Dialog>
 </div>;
}
