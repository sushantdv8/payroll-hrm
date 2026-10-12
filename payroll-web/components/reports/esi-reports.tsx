import {useQueries} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import type {SalarySnapshot} from '@/lib/backup';
import {trimCell} from '@/lib/masters';
import {defaultRules,type SalaryRules} from '@/lib/salary-engine';
import {dmy,fyMonths,monthLabel,realResignDate} from '@/lib/report-utils';
import {exportExcel} from '@/lib/client-api';
import type {Lists,ReportConfig,ReportContext,ReportField,ReportPage} from './report-form';
import {Header,extraOf,monthDaysOf,n2,tablePages} from './report-parts';
import {Sections,salaryQuery,upperWords} from './salary-reports';

// Reports › E.S.I.Detail › Monthly / Half Yearly. Per employee and month, from the saved salary:
//  ESI wages   = wages saved with the salary (Salary Preparation), else gross less O.T. (unless ESI on OT is on)
//  employee    = the ESI deduction saved with the salary (0.75 %, rounded up)
//  employer    = ESI wages × employer % (3.25 %), rounded like the salary calculation
// rates from Master Entry › PF / ESI setup (tbpfesi). Members: ESI deducted, ESI wages saved, or ESI flag on with wages within the ESI limit.
const ESI_FILTERS=['subCompany','location'] as const;
const OT='O.T. Amount';
type EsiLine={e:Employee;ip:string;days:number;wages:number;employee:number;employer:number};
const roundEven=(n:number)=>{const f=Math.floor(n);return Math.abs(n-f-0.5)<1e-9?(f%2===0?f:f+1):Math.round(n);};
const total=(list:EsiLine[],k:'days'|'wages'|'employee'|'employer')=>list.reduce((s,l)=>s+l[k],0);
const rulesOf=(ctx:ReportContext)=>defaultRules(ctx.dataset,ctx.rows[0]?.values);
const esiMaster=(ctx:ReportContext)=>{const list=ctx.lists.tbesimast||[];return list.find(r=>r.code===ctx.options.fields.esi)||list[0];};
const esiCode=(ctx:ReportContext)=>esiMaster(ctx)?.name||'';
const esiField:ReportField={key:'esi',label:'E.S.I. No.',kind:'select',place:'left',default:'1',options:(lists:Lists)=>(lists.tbesimast||[]).map(r=>({value:r.code,label:r.name||r.code}))};
function esiLine(ctx:ReportContext,rules:SalaryRules,e:Employee,s:SalarySnapshot|undefined):EsiLine|null{
 if(!s)return null;const x=extraOf(ctx,e);const limit=Number(trimCell(ctx.rows[0]?.values.esi_le))||21000;
 // ESI flags as the salary calculation finds them: Employee salary settings first, then the employee master.
 const o=ctx.lists.tbempsal?.find(r=>r.code===String(e.sourceKey||e.id))?.values;
 const esiOn=o?trimCell(o.esi_alw)==='1':x?.esiAlw==='1';const esiOtOn=(o&&trimCell(o.esi_ot)!==''?trimCell(o.esi_ot):(x?.esiOt||''))==='1';
 const employee=s.deductions.find(d=>d.label.trim().toUpperCase()==='ESI')?.amount||0;const ot=esiOtOn?0:(s.earnings.find(l=>l.label===OT)?.amount||0);
 const wages=s.esiWages??Math.max(0,(s.gross??0)-ot);
 if(!(employee>0||(s.esiWages??0)>0||(esiOn&&wages<=limit)))return null;
 return {e,ip:x?.esiNo||'',days:s.payableDays??0,wages,employee,employer:roundEven(wages*rules.esiEmployerPct/100)};}
function monthLines(ctx:ReportContext){const rules=rulesOf(ctx);const lines=ctx.employees.flatMap(e=>{const l=esiLine(ctx,rules,e,ctx.salaries.get(e.id));return l?[l]:[];});
 return ctx.options.fields.sort==='esi'?[...lines].sort((a,b)=>a.ip.localeCompare(b.ip,undefined,{numeric:true})):lines;}

function esiStatement(ctx:ReportContext):ReportPage[]{const lines=monthLines(ctx);const r=rulesOf(ctx);
 return tablePages(ctx,{key:'esis',title:'E.S.I. Statement',subtitle:`For the month of ${monthLabel(ctx.month)}    Employer's Code No. ${esiCode(ctx)}`,perPage:28,tree:p=>lines[p[0]]?.e.paycode||'Page',
  columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'I.P. Number'},{h:'Employee Name'},{h:'Days',cls:'num'},{h:'E.S.I. Wages',cls:'num'},{h:`Employee (${r.esiEmployeePct}%)`,cls:'num'},{h:`Employer (${r.esiEmployerPct}%)`,cls:'num'},{h:'Total',cls:'num'}],
  rows:lines.map((l,i)=>[i+1,l.e.paycode,l.ip,l.e.name,l.days,n2(l.wages),n2(l.employee),n2(l.employer),n2(l.employee+l.employer)]),
  totals:['','Total','',`${lines.length} employees`,total(lines,'days'),n2(total(lines,'wages')),n2(total(lines,'employee')),n2(total(lines,'employer')),n2(total(lines,'employee')+total(lines,'employer'))],
  footer:!lines.length?<p>No E.S.I. member among the ticked employees has a saved salary for {monthLabel(ctx.month)}.</p>:undefined});}
const statementExcel=(ctx:ReportContext)=>[['Sno','Paycode','I.P. Number','Employee Name','Days','E.S.I. Wages','Employee','Employer','Total'],...monthLines(ctx).map((l,i)=>[i+1,l.e.paycode,l.ip,l.e.name,l.days,l.wages,l.employee,l.employer,l.employee+l.employer])];
// ES.I.Challan: the month's totals with the payment details typed on the screen (bank name defaults to the E.S.I. master's bank).
function esiChallan(ctx:ReportContext):ReportPage[]{const lines=monthLines(ctx);const r=rulesOf(ctx);const f=ctx.options.fields;const emp=total(lines,'employee'),empr=total(lines,'employer');
 const kv=(a:string,b:string,c:string,d:string)=><tr><td><b>{a}</b></td><td>{b}</td><td><b>{c}</b></td><td>{d}</td></tr>;
 return [{key:'esic',orientation:'portrait',tree:'Challan',node:<><Header ctx={ctx} title="E.S.I. CHALLAN" subtitle={`Contribution for the month of ${monthLabel(ctx.month)}`}/>
  <table className="esi-kv"><tbody>{kv("Employer's Code No.",esiCode(ctx),'Month',monthLabel(ctx.month))}{kv('Bank Name',f.bankName||trimCell(esiMaster(ctx)?.values.esi_bank),'SBI CBS',f.sbiCbs||'')}
   {kv('Cheque No.',f.chequeNo||'','Cheque Date',dmy(f.chequeDate))}{kv('Pay Date',dmy(f.payDate),'No Of Emp.',String(lines.length))}</tbody></table>
  <table style={{marginTop:'12px'}}><thead><tr><th>Particulars</th><th className="num">Amount (Rs.)</th></tr></thead><tbody>
   <tr><td>Wages (E.S.I. wages of {lines.length} employees)</td><td className="num">{n2(total(lines,'wages'))}</td></tr>
   <tr><td>Employees&apos; contribution (Empl {r.esiEmployeePct}%)</td><td className="num">{n2(emp)}</td></tr>
   <tr><td>Employer&apos;s contribution (Empr {r.esiEmployerPct}%)</td><td className="num">{n2(empr)}</td></tr>
   <tr><td><b>Challan Value</b></td><td className="num"><b>{n2(emp+empr)}</b></td></tr></tbody></table>
  <p className="bl-words">(Rupees {upperWords(emp+empr)} ONLY</p>
  <div className="esi-sign"><span>Deposited By</span><span>For {ctx.company.name}<br/><br/><br/>Authorised Signatory</span></div></>}];}
// File Update: the ESIC portal's monthly contribution upload. Reason code 2 (left service) with the last working day for employees who
// left by the month end, 1 (on leave) for no paid day, else 0. Names keep letters and spaces only (the portal rejects other characters).
async function esiFile(ctx:ReportContext){const all=monthLines(ctx);const list=all.filter(l=>l.ip);const end=`${ctx.month}-${String(monthDaysOf(ctx.month)).padStart(2,'0')}`;
 if(!list.length)throw new Error(`No E.S.I. member with an I.P. number has a saved salary for ${monthLabel(ctx.month)}.`);
 await exportExcel(`ESI_File_${ctx.month}.xlsx`,[{name:'Sheet1',rows:[['IP Number','IP Name','No of Days','Total Monthly Wages','Reason Code for Zero workings days','Last Working Day'],
  ...list.map(l=>{const left=realResignDate(l.e);const gone=!!left&&left.slice(0,10)<=end;return [l.ip,l.e.name.replace(/[^A-Za-z ]+/g,' ').replace(/\s+/g,' ').trim(),l.days,Math.round(l.wages*100)/100,gone?2:l.days?0:1,gone?dmy(left):''];})]}]);
 toast.success(`File Update: ${list.length} I.P.s written${all.length>list.length?`; ${all.length-list.length} without an I.P. number left out`:''}`);}
export const esiMonthlyConfig:ReportConfig={period:'month',filters:[...ESI_FILTERS],noAddress:true,noSort:true,
 fields:[esiField,{key:'sort',label:'Sort On',kind:'radio',place:'left',default:'paycode',options:[{value:'paycode',label:'Paycode'},{value:'esi',label:'E.S.I.No. Wise'}]},
  {key:'bankName',label:'Bank Name',kind:'text',place:'middle'},{key:'chequeNo',label:'Cheque No.',kind:'text',place:'middle'},{key:'chequeDate',label:'Cheque Date',kind:'date',place:'middle'},{key:'sbiCbs',label:'SBI CBS',kind:'text',place:'middle'},{key:'payDate',label:'Pay Date',kind:'date',place:'middle'}],
 options:[{value:'statement',label:'E.S.I.Statement',needs:['salaries'],table:'tbpfesi',build:esiStatement,excel:statementExcel},
  {value:'challan',label:'ES.I.Challan',needs:['salaries'],table:'tbpfesi',build:esiChallan},
  {value:'file',label:'File Update',hidden:true,needs:['salaries'],table:'tbpfesi',build:()=>[],action:esiFile}],
 extraButtons:[{label:'File Update',option:'file'}]};

// Half yearly: contribution period April–September or October–March of 2026-27; the six months' salaries are read when the page is shown.
type HalfRow={e:Employee;ip:string;per:(EsiLine|null)[];days:number;wages:number;employee:number;employer:number};
const halfMonths=(v:string|undefined)=>fyMonths.map(m=>m.value).filter(m=>v==='oct'?m>='2026-10':m>='2026-04'&&m<='2026-09');
const periodText=(months:string[])=>`From ${dmy(months[0]+'-01')} To ${dmy(`${months[5]}-${monthDaysOf(months[5])}`)}`;
function annexurePages(ctx:ReportContext,months:string[],rows:HalfRow[]):ReportPage[]{
 return tablePages(ctx,{key:'anx',title:'E.S.I. Anexure',subtitle:`Contribution period ${periodText(months)}    Employer's Code No. ${esiCode(ctx)}`,perPage:18,
  columns:[{h:'Sno',cls:'c'},{h:'I.P. Number'},{h:'Employee Name'},...months.map(m=>({h:<>{monthLabel(m)}<br/>Days / Wages</>,cls:'num'})),{h:'Total Days',cls:'num'},{h:'Total Wages',cls:'num'},{h:'Employee',cls:'num'},{h:'Employer',cls:'num'}],
  rows:rows.map((r,i)=>[i+1,r.ip,<><b>{r.e.name}</b><br/>{r.e.paycode}</>,...r.per.map(l=>l?<>{l.days}<br/>{n2(l.wages)}</>:''),r.days,n2(r.wages),n2(r.employee),n2(r.employer)]),
  totals:['','Total',`${rows.length} employees`,...months.map(()=>''),rows.reduce((s,r)=>s+r.days,0),n2(rows.reduce((s,r)=>s+r.wages,0)),n2(rows.reduce((s,r)=>s+r.employee,0)),n2(rows.reduce((s,r)=>s+r.employer,0))],
  footer:!rows.length?<p>No E.S.I. member among the ticked employees has a saved salary in this period.</p>:undefined});}
// ES.I. Form5 (Return of Contributions, Regulation 26): the months' challans (paid on Date 1 … Date 6) and one line per insured person.
function form5Pages(ctx:ReportContext,months:string[],rows:HalfRow[]):ReportPage[]{const f=ctx.options.fields;const first=months[0]+'-01',last=`${months[5]}-${monthDaysOf(months[5])}`;
 const month=(k:number)=>rows.flatMap(r=>r.per[k]?[r.per[k]!]:[]);const sumOf=(k:'wages'|'employee'|'employer')=>rows.reduce((s,r)=>s+r[k],0);
 const head:ReportPage={key:'f5h',orientation:'portrait',node:<>
  <div className="esi-form5"><h2>FORM 5</h2><h3>RETURN OF CONTRIBUTIONS</h3><h3>EMPLOYEES&apos; STATE INSURANCE CORPORATION</h3><div>(Regulation 26)</div></div>
  <table className="esi-kv"><tbody><tr><td><b>Name and address of the factory or establishment</b></td><td>{ctx.company.name}{ctx.company.address?`, ${ctx.company.address}`:''}</td></tr>
   <tr><td><b>Employer&apos;s Code No.</b></td><td>{esiCode(ctx)}</td></tr><tr><td><b>Contribution period</b></td><td>{periodText(months)}</td></tr></tbody></table>
  <p style={{margin:'10px 0 4px'}}><b>Particulars of the contributions paid</b></p>
  <table><thead><tr><th className="c">Sl. No.</th><th>Month</th><th className="c">Challan paid on</th><th className="num">No. of I.P.s</th><th className="num">Total Wages</th><th className="num">Employee&apos;s Share</th><th className="num">Employer&apos;s Share</th><th className="num">Total</th></tr></thead>
   <tbody>{months.map((m,k)=>{const l=month(k);return <tr key={m}><td className="c">{k+1}</td><td>{monthLabel(m)}</td><td className="c">{dmy(f['date'+(k+1)])}</td><td className="num">{l.length}</td><td className="num">{n2(total(l,'wages'))}</td><td className="num">{n2(total(l,'employee'))}</td><td className="num">{n2(total(l,'employer'))}</td><td className="num">{n2(total(l,'employee')+total(l,'employer'))}</td></tr>;})}
    <tr><td/><td><b>Total</b></td><td/><td/><td className="num"><b>{n2(sumOf('wages'))}</b></td><td className="num"><b>{n2(sumOf('employee'))}</b></td><td className="num"><b>{n2(sumOf('employer'))}</b></td><td className="num"><b>{n2(sumOf('employee')+sumOf('employer'))}</b></td></tr></tbody></table>
  <p style={{marginTop:'12px'}}>Certified that the particulars given in this return are correct and that the contributions shown were paid on the dates given above.</p>
  <div className="esi-sign"><span>Place:<br/>Date:</span><span>Signature of the Employer<br/>Designation</span></div></>};
 const remarks=(e:Employee)=>{const left=realResignDate(e).slice(0,10);return left&&left>=first&&left<=last?`Left on ${dmy(left)}`:'';};
 return [head,...tablePages(ctx,{key:'f5',title:'FORM 5 - RETURN OF CONTRIBUTIONS',subtitle:`Contribution period ${periodText(months)}    Employer's Code No. ${esiCode(ctx)}`,orientation:'portrait',perPage:30,
  columns:[{h:'Sl. No.',cls:'c'},{h:'Insurance Number'},{h:'Name of the Insured Person'},{h:'No. of days for which wages paid',cls:'num'},{h:'Total amount of wages paid',cls:'num'},{h:"Employee's contribution deducted",cls:'num'},{h:'Average daily wages',cls:'num'},{h:'Remarks'}],
  rows:rows.map((r,i)=>[i+1,r.ip,r.e.name,r.days,n2(r.wages),n2(r.employee),r.days?n2(r.wages/r.days):'',remarks(r.e)]),
  totals:['','Total',`${rows.length} insured persons`,rows.reduce((s,r)=>s+r.days,0),n2(sumOf('wages')),n2(sumOf('employee')),'',''],
  footer:!rows.length?<p>No E.S.I. member among the ticked employees has a saved salary in this period.</p>:undefined})];}
function HalfYear({ctx,months,form5}:{ctx:ReportContext;months:string[];form5:boolean}){
 const sal=useQueries({queries:months.map(m=>salaryQuery(ctx.dataset,m))});
 if(sal.some(q=>q.isPending))return <p className="rpt-loading">Loading the salaries of {monthLabel(months[0])} to {monthLabel(months[5])}…</p>;
 const failed=sal.find(q=>q.error);if(failed)return <p>The salaries could not be loaded: {(failed.error as Error).message}</p>;
 const rules=rulesOf(ctx);const maps=sal.map(q=>new Map((q.data?.salaries||[]).map(s=>[s.employeeId,s])));
 const rows=ctx.employees.flatMap(e=>{const per=maps.map(m=>esiLine(ctx,rules,e,m.get(e.id)));const got=per.filter((l):l is EsiLine=>!!l);
  return got.length?[{e,ip:extraOf(ctx,e)?.esiNo||'',per,days:total(got,'days'),wages:total(got,'wages'),employee:total(got,'employee'),employer:total(got,'employer')}]:[];});
 return <Sections pages={form5?form5Pages(ctx,months,rows):annexurePages(ctx,months,rows)}/>;}
const halfBuild=(form5:boolean)=>(ctx:ReportContext):ReportPage[]=>[{key:form5?'f5':'anx',orientation:form5?'portrait':'landscape',tree:form5?'Form 5':'Anexure',node:<HalfYear ctx={ctx} months={halfMonths(ctx.options.fields.half)} form5={form5}/>}];
export const esiHalfYearlyConfig:ReportConfig={period:'none',filters:[...ESI_FILTERS],noAddress:true,noSort:true,noPrintDate:true,
 fields:[esiField,{key:'half',label:'Period',kind:'radio',place:'left',default:'apr',options:[{value:'apr',label:'April To September'},{value:'oct',label:'October to March'}]},
  ...[1,2,3,4,5,6].map((k):ReportField=>({key:'date'+k,label:'Date '+k,kind:'date',place:'middle'}))],
 options:[{value:'annexure',label:'E.S.I. Anexure',table:'tbpfesi',build:halfBuild(false)},{value:'form5',label:'ES.I. Form5',table:'tbpfesi',build:halfBuild(true)}]};
