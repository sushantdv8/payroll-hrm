'use client';

import './time-office.css';

import './salary-prep.css';

import {useEffect,useState} from 'react';

import {useQuery,useQueryClient} from '@tanstack/react-query';

import {toast} from 'sonner';

import type {Employee} from '@/lib/payroll';

import {MANUAL_SALARY,type SalarySnapshot} from '@/lib/backup';

import {requestJson} from '@/lib/client-api';

import {pickMonths,monthLabel} from '@/lib/report-utils';

import type {OriginalSlip} from '@/lib/salary-slip';

import {trimCell,type MasterRow} from '@/lib/masters';

import {useSalaryCalculator,type Calculated,type CalcOverrides} from './salary-calc';

import {EmployeePick,pickLabel,sortEmployees} from './employee-pick';

import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';



// Transaction › Salary Prepairation in the original's layout: E.Heads (Rate, Arear, Earn) and D.Heads (Ded.) grids, Paid Day,

// PF / ESI wages, O.T. hours and amount and Net Sal. for one employee-month; Save, Generate All and Save, Close.

type Head={label:string;rate:number|null;arrear:number;earn:number};

type Shown={heads:Head[];deductions:{label:string;amount:number}[];paidDays:number|null;pfWages:number|null;esiWages:number|null;otHours:number;otAmount:number;gross:number;totalDeductions:number;net:number;source:string;steps:string[]};

type Form={payableDays:string;rates:Record<string,string>;arrears:Record<string,string>;deductions:Record<string,string>;pfWages:string|null;esiWages:string|null;otHours:string};

type Ask={title:string;text:string;yes:()=>void};

const OT_LABEL='O.T. Amount';

const isAuto=(label:string)=>['PF','ESI'].includes(label.trim().toUpperCase());

const r2=(n:number)=>Math.round(n*100)/100;

const fmt=(n:number|null|undefined)=>n==null?'':String(r2(n));

const given=(v:string)=>{const t=v.trim();if(t==='')return undefined;const n=Number(t);return Number.isFinite(n)?n:undefined;};

const sum=(xs:number[])=>r2(xs.reduce((s,x)=>s+x,0));



function fromSaved(s:SalarySnapshot,slip:OriginalSlip|undefined,source:string):Shown{

 const lines=s.earnings.filter(e=>e.label!==OT_LABEL);const ot=s.earnings.find(e=>e.label===OT_LABEL);

 const heads=lines.map(e=>{const h=slip?.heads.find(x=>x.label===e.label);const arrear=e.arrear??h?.arrear??0;return {label:e.label,rate:e.rate??h?.rate??null,arrear,earn:(e.amount??0)-(e.arrear??0)};});

 return {heads,deductions:s.deductions.map(d=>({label:d.label,amount:d.amount??0})),paidDays:s.payableDays,pfWages:s.pfWages??slip?.pfWages??null,esiWages:s.esiWages??slip?.esiWages??null,

  otHours:s.otHours??slip?.otHours??0,otAmount:s.otAmount??ot?.amount??slip?.otAmount??0,gross:s.gross??0,totalDeductions:s.totalDeductions??0,net:s.net??0,source,steps:[]};

}

function fromCalc(c:Calculated,source:string):Shown{

 const lines=c.result.earnings.filter(e=>e.label!==OT_LABEL);

 return {heads:lines.map(e=>({label:e.label,rate:e.rate??null,arrear:e.arrear||0,earn:e.amount-(e.arrear||0)})),deductions:c.result.deductions,paidDays:c.payableDays,pfWages:c.pf?c.result.pf.wages:null,esiWages:c.esi?c.result.esi.wages:null,

  otHours:c.otHours,otAmount:c.result.ot.amount,gross:c.result.gross,totalDeductions:c.result.totalDeductions,net:c.result.net,source,

  steps:[`Paid days ${c.payableDays} (${c.daysSource}); salary mode ${c.salMode==='0'?'Monthly':'Daily'}; PF ${c.pf?'on':'off'}; ESI ${c.esi?'on':'off'}.`,...c.result.steps]};

}

function formOf(s:Shown):Form{

 return {payableDays:fmt(s.paidDays),rates:Object.fromEntries(s.heads.filter(h=>h.rate!=null).map(h=>[h.label,fmt(h.rate)])),arrears:Object.fromEntries(s.heads.filter(h=>h.rate!=null).map(h=>[h.label,fmt(h.arrear)])),

  deductions:Object.fromEntries(s.deductions.filter(d=>!isAuto(d.label)).map(d=>[d.label,fmt(d.amount)])),pfWages:null,esiWages:null,otHours:fmt(s.otHours)};

}

function overridesOf(f:Form):CalcOverrides{

 const nums=(r:Record<string,string>)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,given(v)??0]));

 return {payableDays:given(f.payableDays)??0,rates:nums(f.rates),arrears:nums(f.arrears),otherDeductions:nums(f.deductions),pfWages:given(f.pfWages??'')??null,esiWages:given(f.esiWages??'')??null,otHours:given(f.otHours)??0};

}

// used: the overrides typed on the form; PF / ESI wages typed there are marked as entered so a later edit keeps them.

const snapshotOf=(e:Employee,month:string,c:Calculated,saved:SalarySnapshot|undefined,used?:CalcOverrides):SalarySnapshot=>({employeeId:e.id,month,sourceDataset:saved?.sourceDataset||MANUAL_SALARY,...(saved?.sourceKey?{sourceKey:saved.sourceKey}:{}),

 workingHours:c.hr.workingHours,basePayHours:c.hr.basePayHours,paidLeaveHours:c.hr.paidLeaveHours,shortHours:c.hr.shortHours,lateHours:c.hr.lateHours,earlyHours:c.hr.earlyHours,requiredHours:c.hr.requiredHours,employerPF:c.hr.employerPF,employerESI:c.hr.employerESI,loanRecoveries:c.hr.loanRecoveries,expenseIds:c.hr.expenseIds,payableDays:c.payableDays,gross:c.result.gross,totalDeductions:c.result.totalDeductions,net:c.result.net,earnings:c.result.earnings,deductions:c.result.deductions,

 otHours:c.otHours,otAmount:c.result.ot.amount,...(c.pf?{pfWages:c.result.pf.wages}:{}),...(c.esi?{esiWages:c.result.esi.wages}:{}),

 ...(c.pf&&used?.pfWages!=null?{pfWagesEntered:true}:{}),...(c.esi&&used?.esiWages!=null?{esiWagesEntered:true}:{}),revision:saved?(saved.revision??1):0});



export function SalaryForm({dataset,employees,month,setMonth,onDirty,onClose}:{dataset:string;employees:Employee[];month:string;setMonth:(m:string)=>void;onDirty?:(v:boolean)=>void;onClose?:()=>void}){

 const client=useQueryClient();

 const [employeeId,setEmployeeId]=useState('');const [draft,setDraft]=useState<{key:string;form:Form}|null>(null);const [busy,setBusy]=useState(false);const [status,setStatus]=useState('');const [ask,setAsk]=useState<Ask|null>(null);

 const key=`${dataset}|${employeeId}|${month}`;const dirty=!!draft&&draft.key===key;

 useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false);},[dirty,onDirty]);

 const salaries=useQuery({queryKey:['backup','salaries',dataset,month],queryFn:({signal})=>requestJson<{salaries:SalarySnapshot[]}>('/api/backup?'+new URLSearchParams({view:'salaries',dataset,month}),{signal}),refetchOnWindowFocus:false});

 const slips=useQuery({queryKey:['salary-slips',dataset,month],queryFn:({signal})=>dataset==='manual'?Promise.resolve({slips:{} as Record<string,OriginalSlip>}):requestJson<{slips:Record<string,OriginalSlip>}>('/api/salary-slips?'+new URLSearchParams({dataset,month}),{signal}),refetchOnWindowFocus:false,staleTime:600000});

 const calculator=useSalaryCalculator(dataset,month);

 // Head names for the empty form (the original lists the heads before an employee is chosen).

 const headNames=(table:'tbearn'|'tbded')=>({queryKey:['masters',dataset,table],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset,table}),{signal}),refetchOnWindowFocus:false,

  select:(d:{rows:MasterRow[]})=>d.rows.map(r=>({code:Number(trimCell(r.values[table==='tbearn'?'ern_code':'ded_code'])),name:trimCell(r.values[table==='tbearn'?'ern_name':'ded_name'])})).sort((a,b)=>a.code-b.code).map(h=>h.name).filter(Boolean)});

 const earnNames=useQuery(headNames('tbearn')).data||[];const dedNames=useQuery(headNames('tbded')).data||[];

 const savedBy=new Map((salaries.data?.salaries||[]).map(s=>[s.employeeId,s]));

 const employee=employees.find(e=>e.id===employeeId);const saved=employee?savedBy.get(employee.id):undefined;

 const slipOf=(e:Employee)=>e.sourceKey?slips.data?.slips[String(e.sourceKey)]:undefined;

 // An imported salary needs its original slip (the month's rates, arrears, OT, PF / ESI wages) before it can be edited.

 const imported=!!saved&&saved.sourceDataset!==MANUAL_SALARY;const slipPending=imported&&!!employee?.sourceKey&&!slips.isSuccess;

 const loadError=(calculator.error||salaries.error||(imported?slips.error:null)||undefined) as Error|undefined;

 // Showing a saved salary needs only the saved salaries (and an imported one's slip); calculating needs every calculator input.

 const viewReady=salaries.isSuccess&&!slipPending;const ready=calculator.ready&&viewReady;



 let shown:Shown|null=null;let calculated:Calculated|null=null;

 if(employee&&viewReady){

  if(dirty){if(ready){calculated=calculator.calc(employee,overridesOf(draft!.form));shown=fromCalc(calculated,'Changed here — press Save to keep it');}}

  else if(saved)shown=fromSaved(saved,slipOf(employee),saved.sourceDataset===MANUAL_SALARY?'Saved in this application':(saved.revision??1)>1?'Imported from the original software · modified here':'Imported from the original software');

  else if(ready){calculated=calculator.calc(employee);shown=calculated.hasRates?fromCalc(calculated,'Not saved yet — calculated from the salary rates and the P.Day of Time Updation; press Save'):null;}

 }

 // PF / ESI wages typed on an earlier save stay as entered; all other wages are calculated again when the salary is edited.

 function seed(s:Shown):Form{const f=formOf(s);if(!saved)return f;

  return {...f,pfWages:saved.pfWagesEntered&&saved.pfWages!=null?fmt(saved.pfWages):null,esiWages:saved.esiWagesEntered&&saved.esiWages!=null?fmt(saved.esiWages):null};}

 const form=dirty?draft!.form:shown?formOf(shown):null;

 const edit=(patch:(f:Form)=>Form)=>{if(!shown||busy||!ready)return;setDraft({key,form:patch(dirty?draft!.form:seed(shown))});};



 function select(e:Employee){if(busy)return false;if(e.id===employeeId)return true;if(dirty){toast.error('Save the changes (or press Cancel) before opening another employee.');return false;}setEmployeeId(e.id);setStatus('');return true;}

 function changeMonth(value:string){if(value===month||busy)return;if(dirty){toast.error('Save the changes (or press Cancel) before changing the month.');return;}setMonth(value);setStatus('');}

 const post=(body:object)=>requestJson<{record?:SalarySnapshot;saved?:number;failed?:{employeeId:string;error:string}[]}>('/api/salaries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});



 async function save(){

  if(!employee){toast.error('Select an employee first.');return;}

  if(loadError){toast.error(`Cannot calculate the salary: ${loadError.message}`);return;}

  if(!ready){toast.error('Salary rates are still loading.');return;}

  if(saved&&!dirty){toast('No changes to save.');return;}

  const c=calculated;if(c?.hr.pendingApproval){toast.error('Approve this employee’s monthly attendance before preparing salary.');return;}if(!c||!c.hasRates){toast.error(`${employee.name} has no salary rate. Enter it in Salary rates (or Employee Entry › Salary).`);return;}

  setBusy(true);

  try{const {record}=await post({action:'salary-save',data:snapshotOf(employee,month,c,saved,dirty?overridesOf(draft!.form):undefined)});

   client.setQueryData<{salaries:SalarySnapshot[]}>(['backup','salaries',dataset,month],old=>({salaries:[...(old?.salaries||[]).filter(s=>s.employeeId!==employee.id),record!]}));

   void client.invalidateQueries({queryKey:['report']});setDraft(null);setStatus(`${pickLabel(employee)} Saved Successfully`);toast.success('Saved successfully');

  }catch(error){toast.error((error as Error).message);}finally{setBusy(false);}

 }

 function generateAll(){

  if(dirty){toast.error('Save the open employee (or press Cancel) first.');return;}

  if(calculator.error||salaries.error){toast.error(`Cannot calculate salaries: ${(calculator.error||salaries.error)!.message}`);return;}

  if(!calculator.ready||!salaries.isSuccess){toast.error('Salary rates are still loading.');return;}

  let kept=0,skipped=0;const rows:SalarySnapshot[]=[];

  for(const e of employees){const s=savedBy.get(e.id);if(s&&s.sourceDataset!==MANUAL_SALARY){kept++;continue;}

   // A salary prepared here before keeps the arrears and deductions entered on it (advance, loan, TDS…); the rest is calculated again.

   const entered:CalcOverrides=s?{arrears:Object.fromEntries(s.earnings.filter(l=>l.label!==OT_LABEL&&l.arrear).map(l=>[l.label,l.arrear!])),otherDeductions:Object.fromEntries(s.deductions.filter(d=>!isAuto(d.label)&&d.amount).map(d=>[d.label,d.amount!]))}:{};

   const c=calculator.calc(e,entered);if(!c.hasRates||c.payableDays<=0||c.hr.pendingApproval){skipped++;continue;}rows.push(snapshotOf(e,month,c,s));}

  if(!rows.length){toast.error(`Nobody to calculate for ${monthLabel(month)}: ${kept} imported salaries are kept and ${skipped} employees have no rate or no P.Day.`);return;}

  setAsk({title:'Generate All and Save',text:`Calculate and save the ${monthLabel(month)} salary of ${rows.length} employees? ${kept?`${kept} salaries imported from the original software are kept as they are. `:''}${skipped?`${skipped} employees without a salary rate or P.Day are skipped. `:''}Salary prepared here before is calculated again with today's rates and P.Day; the arrears and deductions entered on it are kept.`,

   yes:()=>void (async()=>{setBusy(true);let done=0;const failed:string[]=[];

    try{for(let i=0;i<rows.length;i+=50){setStatus(`Generate All and Save: ${Math.min(i+50,rows.length)} / ${rows.length}`);const r=await post({action:'salary-save-many',records:rows.slice(i,i+50)});done+=r.saved||0;failed.push(...(r.failed||[]).map(f=>f.error));}

     const text=`Generate All and Save completed: ${done} salaries saved for ${monthLabel(month)}${failed.length?`, ${failed.length} not saved (${failed[0]})`:''}.`;setStatus(text);(failed.length?toast.error:toast.success)(text);

    }catch(error){const text=`Generate All and Save stopped after ${done} salaries: ${(error as Error).message}`;setStatus(text);toast.error(text);}

    finally{await client.invalidateQueries({queryKey:['backup','salaries',dataset,month]});void client.invalidateQueries({queryKey:['report']});setBusy(false);}})()});

 }



 const savedRows=sortEmployees(employees.filter(e=>savedBy.has(e.id)),'paycode');

 const x=shown;const rateTotal=x?sum(x.heads.map(h=>h.rate||0)):0,arrearTotal=x?sum(x.heads.map(h=>h.arrear)):0,earnTotal=x?sum(x.heads.map(h=>h.earn)):0;

 const editable=!!shown&&!busy&&ready;

 const otAllowed=!!employee&&ready&&(calculated??calculator.calc(employee)).otOn;

 const numberCell=(value:string,label:string,onChange:(v:string)=>void)=><input aria-label={label} inputMode="decimal" value={value} disabled={!editable} onChange={e=>onChange(e.target.value)}/>;

 return <div className="to-window">

  <div className="to-titlebar"><strong>Salary Preparation{employee?`  ${pickLabel(employee)}`:''}</strong>{status&&<span className="to-status" role="status">{status}</span>}</div>

  <div className="sp-body">

   <section className="sp-saved" aria-label="Salaries saved this month"><div className="to-gridscroll"><table className="to-grid"><thead><tr><th>Paycode</th><th>Name</th><th>Net Sal.</th></tr></thead>

    <tbody>{savedRows.map(e=><tr key={e.id} className={e.id===employeeId?'is-selected':''} onClick={()=>select(e)}><td>{e.paycode}</td><td>{e.name}</td><td style={{textAlign:'right'}}>{fmt(savedBy.get(e.id)?.net)}</td></tr>)}

     {!savedRows.length&&<tr><td colSpan={3} className="to-empty">{salaries.isPending?'Loading…':salaries.error?'Saved salaries could not be loaded.':`No salary saved for ${monthLabel(month)}.`}</td></tr>}</tbody></table></div>

    <div className="to-totals"><span>Saved<b>{savedRows.length}</b></span></div></section>

   <div className="sp-main">

    <div className="sp-top">

     <label className="to-field">Month Name<select value={month} onChange={e=>changeMonth(e.target.value)} disabled={busy}>{[...new Set([...pickMonths.map(m=>m.value),month])].sort().map(v=><option key={v} value={v}>{monthLabel(v)}</option>)}</select></label>

     <div className="sp-pick"><EmployeePick employees={employees} selectedId={employeeId} onSelect={select} name="sp" height={110} suffix={e=>e.sourceKey?'~'+e.sourceKey:''}/></div>

    </div>

    {loadError&&<p className="to-note" role="alert">Salary data could not be loaded: {loadError.message} <button type="button" className="to-btn" onClick={()=>void client.refetchQueries({type:'active'})}>Try again</button></p>}

    <div className="sp-sheet">

     <div className="sp-heads">

      <table className="sp-grid" aria-label="Earning heads"><thead><tr><th>E.Heads</th><th>Rate</th><th>Arear</th><th>Earn</th></tr></thead>

       <tbody>{(x?.heads||[]).map(h=><tr key={h.label}><td title={h.label}>{h.label}</td>

        <td>{h.rate==null||!form?fmt(h.rate):numberCell(form.rates[h.label]??'',`${h.label} rate`,v=>edit(f=>({...f,rates:{...f.rates,[h.label]:v}})))}</td>

        <td>{h.rate==null||!form?fmt(h.arrear||null):numberCell(form.arrears[h.label]??'',`${h.label} arrear`,v=>edit(f=>({...f,arrears:{...f.arrears,[h.label]:v}})))}</td>

        <td>{fmt(h.earn)}</td></tr>)}

        {!x&&earnNames.map(name=><tr key={name}><td title={name}>{name}</td><td/><td/><td/></tr>)}

        {!x&&employee&&<tr><td colSpan={4} className="sp-note">{!ready?'Loading…':`${employee.name} has no salary rate.`}</td></tr>}</tbody>

       <tfoot><tr><td>Total</td><td>{fmt(rateTotal)}</td><td>{fmt(arrearTotal)}</td><td>{fmt(earnTotal)}</td></tr></tfoot></table>

      <table className="sp-grid" aria-label="Deduction heads"><thead><tr><th>D.Heads</th><th>Ded.</th></tr></thead>

       <tbody>{!x&&dedNames.map(name=><tr key={name}><td>{name}</td><td/></tr>)}{(x?.deductions||[]).map(d=><tr key={d.label}><td>{d.label}</td><td>{isAuto(d.label)||!form?fmt(d.amount):numberCell(form.deductions[d.label]??'',`${d.label} deduction`,v=>edit(f=>({...f,deductions:{...f.deductions,[d.label]:v}})))}</td></tr>)}</tbody>

       <tfoot><tr><td>Total</td><td>{fmt(x?.totalDeductions??0)}</td></tr></tfoot></table>

     </div>

     <div className="sp-side">

      <span>Paid Day</span><input className="sp-red" aria-label="Paid days" inputMode="decimal" value={form?form.payableDays:''} disabled={!editable} onChange={e=>edit(f=>({...f,payableDays:e.target.value}))}/>

      <span>PF</span><input className="to-input" aria-label="PF wages" title="PF wages (blank = calculated)" inputMode="decimal" value={form?(form.pfWages??fmt(x?.pfWages??0)):'0'} disabled={!editable||x?.pfWages==null} onChange={e=>edit(f=>({...f,pfWages:e.target.value}))}/>

      <span>ESI</span><input className="to-input" aria-label="ESI wages" title="ESI wages (blank = calculated)" inputMode="decimal" value={form?(form.esiWages??fmt(x?.esiWages??0)):'0'} disabled={!editable||x?.esiWages==null} onChange={e=>edit(f=>({...f,esiWages:e.target.value}))}/>

      <span className="sp-gap"/>

      <span>O.T.Hrs</span><input className="sp-red" aria-label="OT hours" inputMode="decimal" value={form?form.otHours:''} disabled={!editable||!otAllowed} title={!employee||otAllowed?'O.T. hours':'Over time Allow is off for this employee'} onChange={e=>edit(f=>({...f,otHours:e.target.value}))}/>

      <span>O.T.Amt</span><span className="sp-red">{x?fmt(x.otAmount):''}</span>

      <span className="sp-gap"/>

      <span className="sp-net">Net Sal.</span><span className="sp-red sp-net">{x?fmt(x.net):''}</span>

     </div>

    </div>

    {x&&<p className="sp-source">{x.source}{x.gross?` · Gross ${fmt(x.gross)}`:''}</p>}

    {x&&x.steps.length>0&&<ul className="sp-steps">{x.steps.map((s,i)=><li key={i}>{s}</li>)}</ul>}

    <div className="sp-buttons">

     <button type="button" className="to-btn is-primary" disabled={busy||!!loadError} onClick={()=>void save()}>{busy?'Please wait…':'Save'}</button>

     <button type="button" className="to-btn" disabled={!dirty||busy} onClick={()=>setDraft(null)}>Cancel</button>

     <button type="button" className="to-btn" disabled={busy||!!calculator.error||!!salaries.error} onClick={generateAll}>Generate All and Save</button>

     {onClose&&<button type="button" className="to-btn" disabled={busy||dirty} onClick={onClose}>Close</button>}

    </div>

   </div>

  </div>

  <AlertDialog open={!!ask} onOpenChange={v=>{if(!v)setAsk(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{ask?.title}</AlertDialogTitle><AlertDialogDescription>{ask?.text}</AlertDialogDescription></AlertDialogHeader>

   <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={()=>{const yes=ask!.yes;setAsk(null);yes();}}>Yes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

 </div>;

}

