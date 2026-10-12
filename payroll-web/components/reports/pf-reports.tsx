'use client';
import {useEffect,type ReactNode} from 'react';
import {useQueries} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import type {SalarySnapshot} from '@/lib/backup';
import type {OriginalSlip} from '@/lib/salary-slip';
import {trimCell,type MasterValues} from '@/lib/masters';
import {defaultRules} from '@/lib/salary-engine';
import {requestJson} from '@/lib/client-api';
import {amountInWords,dmy,employeeSex,fyMonths,monthLabel,monthTitle,realResignDate,type Extra} from '@/lib/report-utils';
import type {Lists,ReportConfig,ReportContext,ReportField,ReportOption,ReportPage} from './report-form';
import {Header,extraOf,monthDaysOf,nz,tablePages,type Column} from './report-parts';
import {Sections} from './salary-reports';

// Reports › P.F.Detail (Monthly Reports, Yearly Reports, Eligibilty Register), made from the saved salaries:
//  member       an employee whose salary of the month has a PF (or VPF) deduction
//  EPF wages    the PF wages saved with the salary (Salary Preparation), else the original salary slip's PF wages
//               (tbmonth_hist), else worked back from the PF deducted (PF ÷ 12 %)
//  A/c 1        employee share = PF (+ VPF) deducted; employer share = PF − pension
//  A/c 10       pension 8.33 % of EPF wages up to the pension wage limit; nil once the member turned 58 before the wage month
//  A/c 2/21/22  A/c 2 on EPF wages, A/c 21 and 22 on EDLI wages (EPF wages up to the pension wage limit), at the PF master's rates
// Percentages and limits: Master Entry › PF / ESI setup (tbpfesi, via lib/salary-engine defaultRules) and the PF master (tbpfmast).
export type Slips=Record<string,OriginalSlip>;
type Rates={ee:number;eps:number;epsLimit:number;wageLimit:number;ac2:number;ac21:number;ac22:number};
export type PfLine={e:Employee;uan:string;gross:number;days:number;wages:number;epsWages:number;edliWages:number;ee:number;vpf:number;eps:number;er:number;ncp:number;member:boolean};
type NumKey='gross'|'days'|'wages'|'epsWages'|'edliWages'|'ee'|'vpf'|'eps'|'er'|'ncp';
type Loaded={slips:Map<string,Slips>;salaries:Map<string,Map<string,SalarySnapshot>>;failed:boolean};

// .NET Math.Round (midpoint to even), the rounding of the original's PF figures (as in lib/salary-engine).
export const roundEven=(n:number)=>{const f=Math.floor(n);return Math.abs(n-f-0.5)<1e-9?(f%2===0?f:f+1):Math.round(n);};
const num=(v:string|null|undefined,d:number)=>{const s=trimCell(v).trim();const x=Number(s);return s!==''&&Number.isFinite(x)?x:d;};
const rs=(v:number)=>String(Math.round(v));
export const localDay=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
// Establishment code of a PF master entry: region / office / establishment / extension (e.g. MR/NOI/0012345/000).
export const estCode=(v:MasterValues|undefined)=>v?[v.pf_roc,v.pf_oc,v.pf_esc,v.pf_ext].map(c=>trimCell(c).trim()).filter(Boolean).join('/'):'';
export const pfOptions=(lists:Lists)=>[{value:'',label:''},...(lists.tbpfmast||[]).map(p=>({value:p.code,label:`${p.code}  ${estCode(p.values)||trimCell(p.values.pf_name).trim()}`}))];
// An employee's P.F. code is the PF code of his location (Location Entry › PF Code); the first PF master entry when the location has none.
export function pfCodeOf(lists:Lists,e:Employee){const loc=(lists.tblocation||[]).find(l=>l.name.trim().toLowerCase()===e.location.trim().toLowerCase());return trimCell(loc?.values.pf_code).trim()||lists.tbpfmast?.[0]?.code||'';}
// Leaving date: the employee record's resign date, else the original master's emp_dol (01/Jan/2100 = still working).
export const leftOn=(e:Employee,x?:Extra)=>{const d=(realResignDate(e)||x?.dol||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)&&d<'2099'?d:'';};
export function ageOn(dob:string,on:string){const a=/^(\d{4})-(\d{2})-(\d{2})/.exec(dob||''),b=/^(\d{4})-(\d{2})-(\d{2})/.exec(on||'');if(!a||!b||a[1]>='2099')return null;const [y,m,d]=a.slice(1).map(Number),[Y,M,D]=b.slice(1).map(Number);return Y-y-((M<m||(M===m&&D<d))?1:0);}
export function downloadText(name:string,text:string,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
export const csvCell=(v:string|number)=>{const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const keyOf=(e:Employee)=>String(e.sourceKey||e.id);

const scoped=(ctx:ReportContext)=>{const code=ctx.options.fields.pfCode||'';return code?ctx.employees.filter(e=>pfCodeOf(ctx.lists,e)===code):ctx.employees;};
const pfMaster=(ctx:ReportContext)=>{const code=ctx.options.fields.pfCode||'';return (ctx.lists.tbpfmast||[]).find(p=>p.code===code)||ctx.lists.tbpfmast?.[0];};
// A/c 2 / 21 / 22 rates: the PF master's (when above 0), else the PF / ESI setup's.
function ratesOf(ctx:ReportContext):Rates{const setup=ctx.rows.find(r=>r.values.pf_ac1_pee!==undefined)?.values;const r=defaultRules(ctx.dataset,setup);const m=pfMaster(ctx)?.values;
 const pick=(col:string,setupCol:string,d:number)=>{const v=num(m?.[col],0);return v>0?v:num(setup?.[setupCol],d);};
 return {ee:r.pfEmployeePct,eps:r.pensionPct,epsLimit:r.pensionWageLimit,wageLimit:r.pfWageLimit,ac2:pick('pf_ac2','pf_ac2_p',0.5),ac21:pick('pf_ac21','pf_ac21_p',0.5),ac22:pick('pf_ac22','pf_ac22_p',0)};}
const deduction=(s:SalarySnapshot|undefined,label:string)=>s?.deductions.find(d=>d.label.trim().toUpperCase()===label)?.amount||0;
function pfLine(ctx:ReportContext,r:Rates,month:string,e:Employee,s:SalarySnapshot,slip?:OriginalSlip):PfLine{
 const ee=deduction(s,'PF'),vpf=deduction(s,'VPF');const member=ee>0||vpf>0;
 const wages=!member?0:s.pfWages??(slip&&slip.pfWages>0?slip.pfWages:Math.round(ee*100/r.ee));
 const age=ageOn(e.dob,month+'-01');const capped=Math.min(wages,r.epsLimit);const epsWages=member&&(age==null||age<58)?capped:0;
 const eps=Math.min(ee,roundEven(epsWages*r.eps/100));const days=s.payableDays??0;
 return {e,uan:extraOf(ctx,e)?.pfNo?.trim()||'',gross:s.gross??0,days,wages,epsWages,edliWages:member?capped:0,ee,vpf,eps,er:ee-eps,ncp:Math.max(0,Math.round(monthDaysOf(month)-days)),member};}
function monthLines(ctx:ReportContext,month:string,salaries:Map<string,SalarySnapshot>,slips:Slips|undefined,list=scoped(ctx)):PfLine[]{const r=ratesOf(ctx);
 const out=list.flatMap(e=>{const s=salaries.get(e.id);return s?[pfLine(ctx,r,month,e,s,e.sourceKey?slips?.[String(e.sourceKey)]:undefined)]:[];});
 return ctx.options.fields.pfWise==='1'?[...out].sort((a,b)=>(a.uan||'~').localeCompare(b.uan||'~',undefined,{numeric:true})):out;}
const sum=(lines:PfLine[],k:NumKey)=>lines.reduce((s,l)=>s+l[k],0);
// PF applicable as the salary calculation finds it: Employee salary settings first, then the employee master.
const pfOn=(ctx:ReportContext,e:Employee)=>{const o=ctx.lists.tbempsal?.find(r=>r.code===keyOf(e))?.values;return o?trimCell(o.pf_alw)==='1':extraOf(ctx,e)?.pfAlw==='1';};
const flagged=(ctx:ReportContext,e:Employee)=>pfOn(ctx,e)||!!extraOf(ctx,e)?.pfNo?.trim();
const isPfMember=(ctx:ReportContext,e:Employee)=>flagged(ctx,e)||deduction(ctx.salaries.get(e.id),'PF')>0;
// EPFO administration charges (A/c 2): the rate, with a minimum of Rs 500 a month when anyone contributed (since June 2018);
// none when the rate is set to 0.
const AC2_MIN=500;
function totalsOf(lines:PfLine[],r:Rates){const m=lines.filter(l=>l.member);const epfW=sum(m,'wages'),epsW=sum(m,'epsWages'),edliW=sum(m,'edliWages');
 const ac1ee=sum(m,'ee')+sum(m,'vpf'),ac1er=sum(m,'er'),ac10=sum(m,'eps'),ac2=m.length&&r.ac2>0?Math.max(AC2_MIN,Math.round(epfW*r.ac2/100)):0,ac21=Math.round(edliW*r.ac21/100),ac22=Math.round(edliW*r.ac22/100);
 return {members:m.length,epsMembers:m.filter(l=>l.epsWages>0).length,epfW,epsW,edliW,ac1ee,ac1er,ac10,ac2,ac21,ac22,total:ac1ee+ac1er+ac10+ac2+ac21+ac22};}

// Original salary slips (PF wages) and saved salaries of other months are loaded by the report pages themselves.
const slipCache=new Map<string,Slips>();
const slipQuery=(dataset:string,month:string)=>({queryKey:['salary-slips',dataset,month],queryFn:({signal}:{signal:AbortSignal})=>dataset==='manual'?Promise.resolve({slips:{} as Slips}):requestJson<{slips:Slips}>('/api/salary-slips?'+new URLSearchParams({dataset,month}),{signal}),refetchOnWindowFocus:false,staleTime:600000});
const salaryQuery=(dataset:string,month:string)=>({queryKey:['backup','salaries',dataset,month],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{salaries:SalarySnapshot[]}>('/api/backup?'+new URLSearchParams({view:'salaries',dataset,month}),{signal}),refetchOnWindowFocus:false,staleTime:30000});
// A slip that cannot be read only costs precision: the PF wages are then worked back from the PF deducted.
async function fetchSlips(dataset:string,month:string):Promise<Slips>{const hit=slipCache.get(dataset+'|'+month);if(hit)return hit;if(dataset==='manual')return {};
 try{const r=await requestJson<{slips:Slips}>('/api/salary-slips?'+new URLSearchParams({dataset,month}));slipCache.set(dataset+'|'+month,r.slips);return r.slips;}catch{return {};}}
async function fetchYear(dataset:string,months:string[]):Promise<Loaded>{
 const [sal,slips]=await Promise.all([Promise.all(months.map(m=>requestJson<{salaries:SalarySnapshot[]}>('/api/backup?'+new URLSearchParams({view:'salaries',dataset,month:m})))),Promise.all(months.map(m=>fetchSlips(dataset,m)))]);
 return {slips:new Map(months.map((m,i)=>[m,slips[i]])),salaries:new Map(months.map((m,i)=>[m,new Map(sal[i].salaries.map(s=>[s.employeeId,s]))])),failed:false};}
function Gate({dataset,slipMonths,salaryMonths,render}:{dataset:string;slipMonths:string[];salaryMonths:string[];render:(d:Loaded)=>ReactNode}){
 const slips=useQueries({queries:slipMonths.map(m=>slipQuery(dataset,m))});const sals=useQueries({queries:salaryMonths.map(m=>salaryQuery(dataset,m))});
 // Kept for Excel / ECR, which run outside the page once it has shown the figures.
 useEffect(()=>{slipMonths.forEach((m,i)=>{const d=slips[i]?.data;if(d)slipCache.set(dataset+'|'+m,d.slips);});});
 if(slips.some(q=>q.isPending)||sals.some(q=>q.isPending))return <p className="rpt-loading" style={{padding:'24px',fontSize:'13px'}}>Loading the saved salaries and the original salary slips…</p>;
 // A month whose salaries did not load would print as nil, so the figures are not shown at all.
 const bad=salaryMonths.filter((m,i)=>sals[i].isError);
 if(bad.length)return <p style={{padding:'24px',fontSize:'13px'}}>The saved salaries of {bad.map(monthLabel).join(', ')} could not be loaded, so the figures would be incomplete. <button type="button" onClick={()=>sals.forEach(q=>{if(q.isError)void q.refetch();})}>Try again</button></p>;
 return <>{render({slips:new Map(slipMonths.map((m,i)=>[m,slips[i].data?.slips||{}])),salaries:new Map(salaryMonths.map((m,i)=>[m,new Map((sals[i].data?.salaries||[]).map(s=>[s.employeeId,s]))])),failed:slips.some(q=>q.isError)})}</>;
}
const NONE:Loaded={slips:new Map(),salaries:new Map(),failed:false};
// Pages are laid out when Generate is pressed (their rows never depend on the slips); each page fills in its figures when the data has loaded.
function gated(ctx:ReportContext,slipMonths:string[],salaryMonths:string[],make:(d:Loaded)=>ReportPage[]):ReportPage[]{
 return make(NONE).map((p,i)=>({...p,node:<Gate dataset={ctx.dataset} slipMonths={slipMonths} salaryMonths={salaryMonths} render={d=>make(d)[i]?.node}/>}));}

const sub=(ctx:ReportContext,period=`Wage month ${monthTitle(ctx.month)}`)=>{const code=estCode(pfMaster(ctx)?.values);return [code&&`Establishment Code ${code}`,period].filter(Boolean).join(' · ');};
const small=(text:ReactNode)=><p style={{fontSize:'10px',marginTop:'6px'}}>{text}</p>;
const slipNote=(d:Loaded)=>d.failed?small('Some original salary slips could not be read; their PF wages are worked back from the PF deducted.'):null;
const signature=(label='Signature of the Employer with office seal')=><p style={{marginTop:'36px',textAlign:'right',fontSize:'11px'}}>{label}</p>;

// ---------- Monthly ----------
const STATEMENT_COLS:Column[]=[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'UAN / P.F. No.'},{h:'Employee Name'},{h:"Father's / Husband's Name"},{h:'Days',cls:'num'},{h:'Gross Wages',cls:'num'},{h:'EPF Wages',cls:'num'},{h:'EPS Wages',cls:'num'},{h:'EPF 12%',cls:'num'},{h:'VPF',cls:'num'},{h:'EPS 8.33%',cls:'num'},{h:'EPF Diff 3.67%',cls:'num'},{h:'Total',cls:'num'}];
const statementRow=(l:PfLine,i:number)=>[i+1,l.e.paycode,l.uan,l.e.name,l.e.fatherName,l.days||'',nz(l.gross),nz(l.wages),nz(l.epsWages),nz(l.ee),nz(l.vpf),nz(l.eps),nz(l.er),nz(l.ee+l.vpf+l.eps+l.er)];
// Exempted (no PF deducted) employees are listed only when they earned something in the month.
const keep=(withExempt:boolean)=>(l:PfLine)=>l.member||(withExempt&&l.gross>0);
function statementPages(ctx:ReportContext,withExempt:boolean):ReportPage[]{
 return gated(ctx,[ctx.month],[],d=>{const all=monthLines(ctx,ctx.month,ctx.salaries,d.slips.get(ctx.month));const lines=all.filter(keep(withExempt));
  return tablePages(ctx,{key:withExempt?'pfi':'pfs',title:withExempt?'P.F. Statement (Including Exempted)':'P.F. Statement',subtitle:sub(ctx),columns:STATEMENT_COLS,perPage:24,rows:lines.map(statementRow),
   totals:['','Total',`${lines.filter(l=>l.member).length} members`,'','','',rs(sum(lines,'gross')),rs(sum(lines,'wages')),rs(sum(lines,'epsWages')),rs(sum(lines,'ee')),rs(sum(lines,'vpf')),rs(sum(lines,'eps')),rs(sum(lines,'er')),rs(sum(lines,'ee')+sum(lines,'vpf')+sum(lines,'eps')+sum(lines,'er'))],
   footer:<>{!all.length&&small(`No saved salary for ${monthLabel(ctx.month)}.`)}{slipNote(d)}</>});});}
function statementExcel(ctx:ReportContext,withExempt:boolean){const lines=monthLines(ctx,ctx.month,ctx.salaries,slipCache.get(ctx.dataset+'|'+ctx.month)).filter(keep(withExempt));
 return [STATEMENT_COLS.map(c=>String(c.h)),...lines.map((l,i)=>[i+1,l.e.paycode,l.uan,l.e.name,l.e.fatherName,l.days,l.gross,l.wages,l.epsWages,l.ee,l.vpf,l.eps,l.er,l.ee+l.vpf+l.eps+l.er])];}

// P.F.Statement 2: the ECR layout, one line per member.
const ECR_COLS:Column[]=[{h:'Sno',cls:'c'},{h:'UAN'},{h:'Member Name'},{h:'Gross Wages',cls:'num'},{h:'EPF Wages',cls:'num'},{h:'EPS Wages',cls:'num'},{h:'EDLI Wages',cls:'num'},{h:'EPF Contri Remitted',cls:'num'},{h:'EPS Contri Remitted',cls:'num'},{h:'EPF EPS Diff Remitted',cls:'num'},{h:'NCP Days',cls:'num'},{h:'Refund of Advances',cls:'num'}];
const ecrValues=(l:PfLine)=>[l.uan,l.e.name.trim().toUpperCase(),Math.round(l.gross),Math.round(l.wages),Math.round(l.epsWages),Math.round(l.edliWages),Math.round(l.ee+l.vpf),Math.round(l.eps),Math.round(l.er),l.ncp,0];
function statement2Pages(ctx:ReportContext):ReportPage[]{
 return gated(ctx,[ctx.month],[],d=>{const lines=monthLines(ctx,ctx.month,ctx.salaries,d.slips.get(ctx.month)).filter(l=>l.member);
  return tablePages(ctx,{key:'pfs2',title:'P.F. Statement 2',subtitle:sub(ctx),columns:ECR_COLS,perPage:26,rows:lines.map((l,i)=>[i+1,...ecrValues(l)]),
   totals:['','Total',`${lines.length} members`,rs(sum(lines,'gross')),rs(sum(lines,'wages')),rs(sum(lines,'epsWages')),rs(sum(lines,'edliWages')),rs(sum(lines,'ee')+sum(lines,'vpf')),rs(sum(lines,'eps')),rs(sum(lines,'er')),rs(sum(lines,'ncp')),'0'],footer:slipNote(d)});});}

function remittance(ctx:ReportContext){const f=ctx.options.fields;const bank=f.bank?.trim()||trimCell(pfMaster(ctx)?.values.pf_bank).trim();
 return <table style={{marginTop:'8px'}}><tbody>
  <tr><td><b>Bank Name</b></td><td colSpan={3}>{bank}</td></tr>
  <tr><td><b>Cheque No.</b></td><td>{f.chequeNo}</td><td><b>Cheque Date</b></td><td>{dmy(f.chequeDate)||f.chequeDate}</td></tr>
  <tr><td><b>Deposited By</b></td><td>{f.depositedBy}</td><td><b>Deposit Date</b></td><td>{dmy(f.depositDate)||f.depositDate}</td></tr>
  <tr><td><b>Contractor Employee</b></td><td colSpan={3}>{f.contractor}</td></tr></tbody></table>;}
const rateNote=(r:Rates)=>small(`A/c 1: ${r.ee}% employee share; employer share = PF − pension. A/c 10: ${r.eps}% of EPS wages (up to ${r.epsLimit}). A/c 2: ${r.ac2}% of EPF wages. A/c 21: ${r.ac21}% and A/c 22: ${r.ac22}% of EDLI wages.`);

type ChRow=[string,number,number,number,number,number];
function challanPages(ctx:ReportContext):ReportPage[]{
 return gated(ctx,[ctx.month],[],d=>{const r=ratesOf(ctx);const t=totalsOf(monthLines(ctx,ctx.month,ctx.salaries,d.slips.get(ctx.month)),r);
  const rows:ChRow[]=[['Administration Charges',0,t.ac2,0,0,t.ac22],["Employer's Share",t.ac1er,0,t.ac10,t.ac21,0],["Employee's Share",t.ac1ee,0,0,0,0],['Penal Damages',0,0,0,0,0],['Misc. Payment',0,0,0,0,0]];
  const col=(k:number)=>rows.reduce((s,x)=>s+Number(x[k]),0);
  return [{key:'pfch',orientation:'portrait',tree:'Challan',node:<>
   <Header ctx={ctx} title="COMBINED CHALLAN OF A/C NO. 01, 02, 10, 21 & 22 (WITH ECR)" subtitle={sub(ctx)}/>
   <table style={{margin:'6px 0'}}><tbody>
    <tr><td><b>Establishment Code &amp; Name</b></td><td colSpan={3}>{estCode(pfMaster(ctx)?.values)} &nbsp; {ctx.company.name}</td></tr>
    <tr><td><b>Address</b></td><td colSpan={3}>{ctx.company.address}</td></tr>
    <tr><td><b>Dues for the wage month of</b></td><td colSpan={3}>{monthTitle(ctx.month)}</td></tr>
    <tr><td><b>Total Subscribers</b></td><td>EPF {t.members}</td><td>EPS {t.epsMembers}</td><td>EDLI {t.members}</td></tr>
    <tr><td><b>Total Wages</b></td><td>EPF {rs(t.epfW)}</td><td>EPS {rs(t.epsW)}</td><td>EDLI {rs(t.edliW)}</td></tr></tbody></table>
   <table><thead><tr><th>Particulars</th>{['A/c. 01','A/c. 02','A/c. 10','A/c. 21','A/c. 22','Total'].map(h=><th key={h} className="num">{h}</th>)}</tr></thead>
    <tbody>{rows.map(x=><tr key={x[0]}><td>{x[0]}</td>{[1,2,3,4,5].map(k=><td key={k} className="num">{rs(Number(x[k]))}</td>)}<td className="num">{rs(x[1]+x[2]+x[3]+x[4]+x[5])}</td></tr>)}
     <tr><td><b>Grand Total</b></td>{[1,2,3,4,5].map(k=><td key={k} className="num"><b>{rs(col(k))}</b></td>)}<td className="num"><b>{rs(t.total)}</b></td></tr></tbody></table>
   <p style={{fontSize:'12px'}}><b>Total amount (in words): {amountInWords(t.total)}</b></p>
   {remittance(ctx)}{rateNote(r)}{slipNote(d)}{signature('Signature of the Depositor / Employer')}</>}];});}

function form12aPages(ctx:ReportContext):ReportPage[]{
 return gated(ctx,[ctx.month],[],d=>{const r=ratesOf(ctx);const t=totalsOf(monthLines(ctx,ctx.month,ctx.salaries,d.slips.get(ctx.month)),r);const f=ctx.options.fields;const contract=Math.max(0,Math.min(t.members,Math.round(Number(f.contractor)||0)));
  const rows:[string,number,number|null,number][]=[['E.P.F. A/c No. 1',t.epfW,t.ac1ee,t.ac1er],['Pension Fund A/c No. 10',t.epsW,null,t.ac10],['E.D.L.I. A/c No. 21',t.edliW,null,t.ac21],['Administrative Charges A/c No. 2',t.epfW,null,t.ac2],['Administrative Charges A/c No. 22',t.edliW,null,t.ac22]];
  return [{key:'pf12a',orientation:'portrait',tree:'Form 12A',node:<>
   <Header ctx={ctx} title="FORM 12A (Revised)" subtitle={`Statement of contribution for the month of ${monthTitle(ctx.month)}`}/>
   <p style={{textAlign:'center',fontSize:'10px',margin:'0 0 6px'}}>{"The Employees' Provident Fund Scheme, 1952 (Para 38(2)) and The Employees' Pension Scheme, 1995 (Para 20(4))"}</p>
   <table style={{marginBottom:'6px'}}><tbody><tr><td><b>Name &amp; address of the establishment</b></td><td>{ctx.company.name}, {ctx.company.address}</td></tr><tr><td><b>Code No. of the establishment</b></td><td>{estCode(pfMaster(ctx)?.values)}</td></tr></tbody></table>
   <table><thead><tr><th>Particulars</th><th className="num">Wages on which contributions are payable</th><th className="num">Recovered from the workers</th><th className="num">Payable by the employer</th><th className="num">Total</th><th>Date of remittance</th></tr></thead>
    <tbody>{rows.map(x=><tr key={x[0]}><td>{x[0]}</td><td className="num">{rs(x[1])}</td><td className="num">{x[2]==null?'—':rs(x[2])}</td><td className="num">{rs(x[3])}</td><td className="num">{rs((x[2]||0)+x[3])}</td><td>{dmy(f.depositDate)||f.depositDate}</td></tr>)}
     <tr><td><b>Total</b></td><td/><td className="num"><b>{rs(t.ac1ee)}</b></td><td className="num"><b>{rs(t.ac1er+t.ac10+t.ac21+t.ac2+t.ac22)}</b></td><td className="num"><b>{rs(t.total)}</b></td><td/></tr></tbody></table>
   <table style={{marginTop:'8px'}}><thead><tr><th>Details of subscribers</th><th className="num">E.P.F.</th><th className="num">E.P.S.</th><th className="num">E.D.L.I.</th></tr></thead><tbody>
    <tr><td>New subscribers this month (Form 5)</td>{[0,1,2].map(k=><td key={k} className="num">{joiners(ctx).length}</td>)}</tr>
    <tr><td>Subscribers left service this month (Form 10)</td>{[0,1,2].map(k=><td key={k} className="num">{leavers(ctx).length}</td>)}</tr>
    <tr><td><b>Subscribers contributing this month</b></td><td className="num"><b>{t.members}</b></td><td className="num"><b>{t.epsMembers}</b></td><td className="num"><b>{t.members}</b></td></tr>
    <tr><td>Contract / Rest</td><td className="num" colSpan={3}>Contract {contract} &nbsp; Rest {t.members-contract}</td></tr></tbody></table>
   {remittance(ctx)}{rateNote(r)}{slipNote(d)}{signature()}</>}];});}

const joiners=(ctx:ReportContext)=>scoped(ctx).filter(e=>(e.doj||'').slice(0,7)===ctx.month&&isPfMember(ctx,e));
const leavers=(ctx:ReportContext)=>scoped(ctx).filter(e=>leftOn(e,extraOf(ctx,e)).slice(0,7)===ctx.month&&isPfMember(ctx,e));
// Reason for leaving from the original employee master (tbemp.reason; "Unresigned" means still working).
const reasonOf=(ctx:ReportContext,e:Employee)=>{const v=trimCell(ctx.rows.find(r=>trimCell(r.values.emp_code).trim()===keyOf(e))?.values.reason).trim();return /^unresigned$/i.test(v)?'':v;};
// EPFO exit codes: D death, P permanent disablement, R retirement, S superannuation (58 years), C cessation (short service).
function exitCode(e:Employee,left:string,reason:string){if(/death|expire|died/i.test(reason))return 'D';if(/disab/i.test(reason))return 'P';if(/retire/i.test(reason))return 'R';const age=ageOn(e.dob,left);return age!=null&&age>=58?'S':'C';}

function form5Pages(ctx:ReportContext):ReportPage[]{const list=joiners(ctx);
 return tablePages(ctx,{key:'pf5',title:'FORM - 5 (Para 36(2)(a) & (b))',subtitle:sub(ctx,`Return of employees qualifying for membership for the first time during the month of ${monthTitle(ctx.month)}`),perPage:22,
  columns:[{h:'Sl. No.',cls:'c'},{h:'Account No. (UAN)'},{h:'Name of the employee (in block letters)'},{h:"Father's Name (or Husband's Name in case of married woman)"},{h:'Date of Birth',cls:'c'},{h:'Sex',cls:'c'},{h:'Date of joining the Fund',cls:'c'},{h:'Total period of previous service'},{h:'Remarks'}],
  rows:list.map((e,i)=>[i+1,extraOf(ctx,e)?.pfNo||'',e.name.toUpperCase(),e.fatherName,dmy(e.dob),employeeSex(e,extraOf(ctx,e)),dmy(e.doj),'',e.paycode]),
  footer:<>{!list.length&&small(`No P.F. member joined in ${monthLabel(ctx.month)}.`)}{signature()}</>});}
function form10Pages(ctx:ReportContext):ReportPage[]{const list=leavers(ctx);
 return tablePages(ctx,{key:'pf10',title:'FORM - 10 (Para 36(2)(a) & (b))',subtitle:sub(ctx,`Return of members leaving service during the month of ${monthTitle(ctx.month)}`),perPage:22,
  columns:[{h:'Sl. No.',cls:'c'},{h:'Account No. (UAN)'},{h:'Name of the member (in block letters)'},{h:"Father's Name (or Husband's Name in case of married woman)"},{h:'Date of leaving service',cls:'c'},{h:'Reasons for leaving service'},{h:'Remarks'}],
  rows:list.map((e,i)=>[i+1,extraOf(ctx,e)?.pfNo||'',e.name.toUpperCase(),e.fatherName,dmy(leftOn(e,extraOf(ctx,e))),reasonOf(ctx,e),e.paycode]),
  footer:<>{!list.length&&small(`No P.F. member left in ${monthLabel(ctx.month)}.`)}{signature()}</>});}

function exemptPages(ctx:ReportContext):ReportPage[]{const r=ratesOf(ctx);const list=monthLines(ctx,ctx.month,ctx.salaries,undefined).filter(l=>!l.member&&l.gross>0);
 return tablePages(ctx,{key:'pfx',title:'P.F. Exempted Employees',subtitle:sub(ctx),perPage:28,columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Designation'},{h:'Days',cls:'num'},{h:'Gross Wages',cls:'num'},{h:'P.F. No.'},{h:'Remarks'}],
  rows:list.map((l,i)=>[i+1,l.e.paycode,l.e.name,l.e.department,l.e.designation,l.days||'',nz(l.gross),l.uan,l.gross>r.wageLimit?`Excluded (wages above ${r.wageLimit})`:flagged(ctx,l.e)?'No P.F. deducted this month':'P.F. not applicable']),
  totals:['','Total',`${list.length} employees`,'','','',rs(sum(list,'gross')),'','']});}

function exitRows(ctx:ReportContext){return leavers(ctx).map(e=>{const left=leftOn(e,extraOf(ctx,e));const reason=reasonOf(ctx,e);return {e,uan:extraOf(ctx,e)?.pfNo||'',left,reason,code:exitCode(e,left,reason)};});}
function exitPages(ctx:ReportContext):ReportPage[]{const list=exitRows(ctx);
 return tablePages(ctx,{key:'pfexit',title:'Exit Members',subtitle:sub(ctx),perPage:28,columns:[{h:'Sno',cls:'c'},{h:'UAN'},{h:'Paycode'},{h:'Employee Name'},{h:"Father's / Husband's Name"},{h:'D.O.J.',cls:'c'},{h:'Date of Exit',cls:'c'},{h:'Reason'},{h:'Exit Code',cls:'c'}],
  rows:list.map((x,i)=>[i+1,x.uan,x.e.paycode,x.e.name,x.e.fatherName,dmy(x.e.doj),dmy(x.left),x.reason,x.code]),footer:<>{!list.length&&small(`No P.F. member left in ${monthLabel(ctx.month)}.`)}{small('Exit codes: C cessation (short service), S superannuation, R retirement, D death in service, P permanent disablement.')}</>});}
const exitExcel=(ctx:ReportContext)=>[['UAN','Member Name','Date of Exit','Reason','Exit Code','Paycode','D.O.J.'],...exitRows(ctx).map(x=>[x.uan,x.e.name,dmy(x.left),x.reason,x.code,x.e.paycode,dmy(x.e.doj)])];

// ECR NEW: the EPFO ECR text file, one line per member with a UAN, fields joined by #~#.
async function ecrFile(ctx:ReportContext){const lines=monthLines(ctx,ctx.month,ctx.salaries,await fetchSlips(ctx.dataset,ctx.month)).filter(l=>l.member);
 if(!lines.length)throw new Error(`No P.F. member has a saved salary for ${monthLabel(ctx.month)}.`);
 const ok=lines.filter(l=>l.uan),missing=lines.filter(l=>!l.uan);if(!ok.length)throw new Error('None of the P.F. members has a UAN (P.F. No. in Employee Entry).');
 downloadText(`ECR_${ctx.month}.txt`,ok.map(l=>ecrValues(l).join('#~#')).join('\n'));toast.success(`ECR file created for ${ok.length} members`);
 if(missing.length)toast.warning(`${missing.length} members have no UAN and were left out: ${missing.slice(0,10).map(l=>l.e.paycode).join(', ')}${missing.length>10?' …':''}`);}

// P.F.No. Wise: the original's second Sort On choice (sorts the members by UAN / P.F. No.).
const MONTHLY_FIELDS:ReportField[]=[{key:'pfCode',label:'P.F.No.',kind:'select',place:'left',default:'',options:pfOptions},{key:'pfWise',label:'P.F.No. Wise',kind:'check',place:'left',default:'0'},
 {key:'bank',label:'Bank Name',kind:'text',place:'middle'},{key:'chequeNo',label:'Cheque No.',kind:'text',place:'middle'},{key:'chequeDate',label:'Cheque Date',kind:'date',place:'middle'},{key:'depositedBy',label:'Deposited By',kind:'text',place:'middle'},
 {key:'depositDate',label:'Deposit Date',kind:'date',place:'middle'},{key:'contractor',label:'Contractor Employee',kind:'number',place:'middle'}];
const salaryPf:Pick<ReportOption,'needs'|'table'|'withEmployees'>={needs:['salaries'],table:'tbpfesi',withEmployees:false};
// In the original's reading order (row 1 Statement, Statement 2, Combined Challan; row 2 Form 5, Form10, Form 12A; row 3 Pf Exmp, Pf Included exmpted).
const monthlyOptions:ReportOption[]=[
 {value:'statement',label:'P.F.Statement',...salaryPf,build:ctx=>statementPages(ctx,false),excel:ctx=>statementExcel(ctx,false)},
 {value:'statement2',label:'P.F.Statement 2',...salaryPf,build:statement2Pages,excel:ctx=>[ECR_COLS.slice(1).map(c=>String(c.h)),...monthLines(ctx,ctx.month,ctx.salaries,slipCache.get(ctx.dataset+'|'+ctx.month)).filter(l=>l.member).map(ecrValues)]},
 {value:'challan',label:'P.F.Combined Challan',...salaryPf,build:challanPages},
 {value:'form5',label:'P.F.Form 5',needs:['salaries'],withEmployees:false,build:form5Pages,excel:ctx=>[['Sl. No.','UAN','Name','Father / Husband Name','Date of Birth','Sex','Date of Joining'],...joiners(ctx).map((e,i)=>[i+1,extraOf(ctx,e)?.pfNo||'',e.name,e.fatherName,dmy(e.dob),employeeSex(e,extraOf(ctx,e)),dmy(e.doj)])]},
 {value:'form10',label:'P.F.Form10',needs:['salaries'],table:'tbemp',withEmployees:false,build:form10Pages,excel:exitExcel},
 {value:'form12a',label:'P.F.Form 12A',...salaryPf,build:form12aPages},
 {value:'exmp',label:'Pf Exmp',...salaryPf,build:exemptPages},
 {value:'included',label:'Pf Included exmpted',...salaryPf,build:ctx=>statementPages(ctx,true),excel:ctx=>statementExcel(ctx,true)},
 {value:'ecr',label:'ECR NEW',hidden:true,...salaryPf,build:()=>[],action:ecrFile},
 {value:'exit',label:'Exit Member',hidden:true,needs:['salaries'],table:'tbemp',withEmployees:false,build:exitPages,excel:exitExcel},
];
export const pfMonthlyConfig:ReportConfig={period:'month',filters:['subCompany','location'],columns:2,fields:MONTHLY_FIELDS,options:monthlyOptions,extraButtons:[{label:'ECR NEW',option:'ecr'},{label:'Exit Member',option:'exit'}]};

// ---------- Yearly (financial year April – March, the last 12 months of the month list) ----------
const fyAll=()=>fyMonths.slice(-12).map(m=>m.value);
const fyText=()=>{const a=fyAll();return `01/04/${a[0].slice(0,4)} to 31/03/${a[11].slice(0,4)}`;};
// Months up to the current one: later months have no salary yet.
const fyLoad=()=>{const now=localDay(new Date()).slice(0,7);return fyAll().filter(m=>m<=now);};
// Yearly P.F. members: ticked employees with PF (or VPF) deducted in any saved salary of the year, plus those with PF
// applicable today who earned something in the year (imported months also hold nil salaries). The flag alone is not enough: Employee salary settings can
// switch PF on, and an imported salary keeps the PF it was paid with whatever the flag says now. Left employees often
// have no leaving date, so "paid in the year" is what keeps people who left long ago out.
const pfIn=(d:Loaded,e:Employee)=>[...d.salaries.values()].some(m=>{const s=m.get(e.id);return deduction(s,'PF')>0||deduction(s,'VPF')>0;});
const paidIn=(d:Loaded,e:Employee)=>[...d.salaries.values()].some(m=>(m.get(e.id)?.gross??0)>0);
const yearMembers=(ctx:ReportContext,d:Loaded)=>scoped(ctx).filter(e=>pfIn(d,e)||(pfOn(ctx,e)&&paidIn(d,e)));
function memberYear(ctx:ReportContext,d:Loaded,e:Employee){const r=ratesOf(ctx);return fyAll().map(m=>{const s=d.salaries.get(m)?.get(e.id);const l=s?pfLine(ctx,r,m,e,s,e.sourceKey?d.slips.get(m)?.[String(e.sourceKey)]:undefined):null;return {m,l:l?.member?l:null};});}
function form3aNode(ctx:ReportContext,d:Loaded,e:Employee):ReactNode{const x=extraOf(ctx,e);const r=ratesOf(ctx);const year=memberYear(ctx,d,e);const ls=year.flatMap(y=>y.l?[y.l]:[]);const left=leftOn(e,x);
 const head=['Month','Amount of wages',"Worker's share EPF","Employer's share EPF (12% − 8.33%)",'Pension Fund 8.33%','Refund of advances','No. of days of non-contributing service','Remarks'];
 return <><Header ctx={ctx} title="FORM 3A (Revised)" subtitle={`Contribution card for the currency period from ${fyText()}`}/>
  <p style={{textAlign:'center',fontSize:'10px',margin:'0 0 6px'}}>{"The Employees' Provident Fund Scheme, 1952 (Paras 35 & 42) and The Employees' Pension Scheme, 1995 (Para 19)"}</p>
  <table><tbody>
   <tr><td>1. Account No. (UAN)</td><td><b>{x?.pfNo||''}</b></td><td>5. Statutory rate of contribution</td><td>{r.ee}%</td></tr>
   <tr><td>2. Name / Surname</td><td><b>{e.name}</b></td><td>{"6. Voluntary higher rate of employee's contribution, if any"}</td><td>{sum(ls,'vpf')>0?'VPF':''}</td></tr>
   <tr><td>{"3. Father's / Husband's Name"}</td><td>{e.fatherName}</td><td>Paycode</td><td>{e.paycode}</td></tr>
   <tr><td>4. Name &amp; address of the factory / establishment</td><td colSpan={3}>{[ctx.company.name,ctx.company.address].filter(Boolean).join(', ')}</td></tr></tbody></table>
  <table style={{marginTop:'8px'}}><thead><tr>{head.map(h=><th key={h} className={h==='Month'||h==='Remarks'?'':'num'}>{h}</th>)}</tr><tr>{head.map((h,i)=><th key={h} className="c">{i+1}</th>)}</tr></thead>
   <tbody>{year.map(({m,l})=><tr key={m}><td>{monthLabel(m)}</td><td className="num">{l?rs(l.wages):''}</td><td className="num">{l?rs(l.ee+l.vpf):''}</td><td className="num">{l?rs(l.er):''}</td><td className="num">{l?rs(l.eps):''}</td><td/><td className="num">{l?.ncp||''}</td><td>{left.slice(0,7)===m?`Left on ${dmy(left)}`:''}</td></tr>)}
    <tr><td><b>Total</b></td><td className="num"><b>{rs(sum(ls,'wages'))}</b></td><td className="num"><b>{rs(sum(ls,'ee')+sum(ls,'vpf'))}</b></td><td className="num"><b>{rs(sum(ls,'er'))}</b></td><td className="num"><b>{rs(sum(ls,'eps'))}</b></td><td/><td className="num"><b>{sum(ls,'ncp')||''}</b></td><td/></tr></tbody></table>
  {!ls.length&&small('No P.F. was deducted from the saved salaries of this period.')}
  {small('Certified that the difference between the total of the contributions shown under columns 3, 4 and 5 and that arrived at on the total wages shown in column 2 at the prescribed rate is solely due to the rounding off of contributions to the nearest rupee.')}
  {slipNote(d)}{signature()}</>;}
function form6aRows(ctx:ReportContext,d:Loaded){return yearMembers(ctx,d).map(e=>{const ls=memberYear(ctx,d,e).flatMap(y=>y.l?[y.l]:[]);const left=leftOn(e,extraOf(ctx,e));const all=fyAll();
 return {e,uan:extraOf(ctx,e)?.pfNo||'',wages:sum(ls,'wages'),ee:sum(ls,'ee')+sum(ls,'vpf'),er:sum(ls,'er'),eps:sum(ls,'eps'),vpf:sum(ls,'vpf'),remark:left&&left.slice(0,7)>=all[0]&&left.slice(0,7)<=all[11]?`Left on ${dmy(left)}`:''};});}
const SIXA_HEAD=['Sl. No.','Account No. (UAN)','Name of member','Wages, retaining allowance & D.A. paid during the currency period',"Amount of worker's contributions deducted from the wages",'Employer EPF (12% − 8.33%)','Pension Fund 8.33%','Refund of advances','Rate of higher voluntary contribution','Remarks'];
// Form 3A and Form 6A pick their members from the year's salaries, so their pages can only be laid out once those have
// loaded: each is one viewer page that holds the printed pages (each printed on a new sheet).
const yearGated=(ctx:ReportContext,key:string,tree:string,orientation:'portrait'|'landscape',months:string[],make:(d:Loaded)=>ReportPage[]):ReportPage[]=>
 [{key,tree,orientation,node:<Gate dataset={ctx.dataset} slipMonths={months} salaryMonths={months} render={d=><Sections pages={make(d)}/>}/>}];
function form6aPages(ctx:ReportContext,months:string[]):ReportPage[]{
 return yearGated(ctx,'pf6a','Form 6A','landscape',months,d=>{const rows=form6aRows(ctx,d);
  return tablePages(ctx,{key:'pf6a',title:'FORM 6A (Revised)',subtitle:sub(ctx,`Annual statement of contribution for the currency period from ${fyText()}`),perPage:22,columns:SIXA_HEAD.map((h,i)=>({h,cls:i===0?'c':i>=3&&i<=7?'num':undefined})),
   rows:rows.map((x,i)=>[i+1,x.uan,x.e.name,rs(x.wages),rs(x.ee),rs(x.er),rs(x.eps),'',x.vpf>0?'VPF':'',x.remark]),
   totals:['','Total',`${rows.length} members`,rs(rows.reduce((s,x)=>s+x.wages,0)),rs(rows.reduce((s,x)=>s+x.ee,0)),rs(rows.reduce((s,x)=>s+x.er,0)),rs(rows.reduce((s,x)=>s+x.eps,0)),'','',''],footer:<>{slipNote(d)}{signature()}</>});});}
function reconPages(ctx:ReportContext,months:string[]):ReportPage[]{
 return gated(ctx,months,months,d=>{const r=ratesOf(ctx);const per=fyAll().map(m=>({m,t:totalsOf(monthLines(ctx,m,d.salaries.get(m)||new Map(),d.slips.get(m)),r)}));const tt=(k:Exclude<keyof ReturnType<typeof totalsOf>,'members'|'epsMembers'>)=>rs(per.reduce((s,x)=>s+x.t[k],0));
  return tablePages(ctx,{key:'pfrec',title:'Reconcilation',subtitle:sub(ctx,`Statement of contributions for the currency period from ${fyText()}`),perPage:14,
   columns:[{h:'Month'},{h:'Members',cls:'num'},{h:'EPF Wages',cls:'num'},{h:'EPS Wages',cls:'num'},{h:'EDLI Wages',cls:'num'},{h:'A/c 1 Employee',cls:'num'},{h:'A/c 1 Employer',cls:'num'},{h:'A/c 2',cls:'num'},{h:'A/c 10',cls:'num'},{h:'A/c 21',cls:'num'},{h:'A/c 22',cls:'num'},{h:'Total',cls:'num'}],
   rows:per.map(({m,t})=>[monthLabel(m),t.members||'',rs(t.epfW),rs(t.epsW),rs(t.edliW),rs(t.ac1ee),rs(t.ac1er),rs(t.ac2),rs(t.ac10),rs(t.ac21),rs(t.ac22),rs(t.total)]),
   totals:['Total','',tt('epfW'),tt('epsW'),tt('edliW'),tt('ac1ee'),tt('ac1er'),tt('ac2'),tt('ac10'),tt('ac21'),tt('ac22'),tt('total')],footer:<>{rateNote(r)}{slipNote(d)}</>});});}
async function form6aText(ctx:ReportContext){const all=fyAll();const d=await fetchYear(ctx.dataset,fyLoad());if(!yearMembers(ctx,d).length)throw new Error('None of the ticked employees has P.F. in this period.');
 const rows=form6aRows(ctx,d).filter(x=>x.wages>0||x.ee>0);if(!rows.length)throw new Error('No P.F. was deducted from the saved salaries of the ticked employees in this period.');
 const lines=[['Sl No','UAN','Paycode','Member Name','Wages','Worker Contribution','Employer EPF','Pension Fund','Refund of Advances','Higher Voluntary Contribution','Remarks'],...rows.map((x,i)=>[i+1,x.uan,x.e.paycode,x.e.name,Math.round(x.wages),Math.round(x.ee),Math.round(x.er),Math.round(x.eps),0,Math.round(x.vpf),x.remark])];
 downloadText(`Form6A_${all[0].slice(0,4)}-${all[11].slice(2,4)}.txt`,lines.map(l=>l.map(csvCell).join(',')).join('\r\n'));toast.success('Text File Generated');}
const yearlyOptions:ReportOption[]=[
 {value:'form3a',label:'Form 3A',table:'tbpfesi',build:ctx=>yearGated(ctx,'pf3a','Form 3A','portrait',fyLoad(),d=>{const list=yearMembers(ctx,d);
  if(!list.length)return tablePages(ctx,{key:'pf3a0',title:'FORM 3A (Revised)',perPage:1,orientation:'portrait',columns:[{h:'Note'}],rows:[['None of the ticked employees has P.F. in this period.']]});
  return list.map(e=>({key:'pf3a'+e.id,orientation:'portrait',tree:e.paycode,node:form3aNode(ctx,d,e)}));})},
 {value:'form6a',label:'Form 6A',table:'tbpfesi',build:ctx=>form6aPages(ctx,fyLoad())},
 {value:'recon',label:'Reconcilation',table:'tbpfesi',build:ctx=>reconPages(ctx,fyLoad())},
 {value:'text',label:'Generate Text File',hidden:true,table:'tbpfesi',build:()=>[],action:form6aText},
 // Nothing is kept per form here (the forms are made from the saved salaries), so Edit only explains where to change the figures.
 {value:'edit',label:'Edit',hidden:true,withEmployees:false,build:()=>[],action:async()=>{toast.info('Form 3A / Form 6A are made from the saved salaries. To change a figure, change that month on Transaction › Salary Prepairation and press Generate again.');}},
];
export const pfYearlyConfig:ReportConfig={period:'none',filters:['subCompany','location'],fields:[{key:'pfCode',label:'P.F.No.',kind:'select',place:'left',default:'',options:pfOptions}],options:yearlyOptions,extraButtons:[{label:'Generate Text File',option:'text'},{label:'Edit',option:'edit'}]};

// ---------- Eligibilty Register: employees joined between From and To, with age (on the To date) and the PF flag ----------
const TODAY=localDay(new Date());
const FROM30=(()=>{const d=new Date();return localDay(new Date(d.getFullYear()-30,d.getMonth(),d.getDate()));})();
function eligibleRows(ctx:ReportContext){const {from='',to=''}=ctx.options.fields;if(from&&to&&from>to)throw new Error('From date must be on or before To date.');
 return scoped(ctx).filter(e=>{const j=(e.doj||'').slice(0,10);return !!j&&(!from||j>=from)&&(!to||j<=to);}).map(e=>{const x=extraOf(ctx,e);const age=ageOn(e.dob,to||TODAY);const left=leftOn(e,x);
  return {e,age,pf:x?.pfAlw==='1'?'Y':'N',pfNo:x?.pfNo||'',remark:[left&&`Left ${dmy(left)}`,age!=null&&age>=58?'58+ : no pension':''].filter(Boolean).join('; ')};});}
const ELIG_HEAD=['Sno','Paycode','Card No.','Employee Name',"Father's / Husband's Name",'Department','Designation','D.O.J.','D.O.B.','Age','P.F. Applicable','P.F. No.','Remarks'];
export const pfEligibilityConfig:ReportConfig={period:'none',filters:['subCompany','location'],
 fields:[{key:'pfCode',label:'P.F.No.',kind:'select',place:'left',default:'',options:pfOptions},{key:'from',label:'From',kind:'date',place:'left',default:FROM30},{key:'to',label:'To',kind:'date',place:'left',default:TODAY}],
 options:[{value:'register',label:'P.F. Eligibilty Register',build:ctx=>{const rows=eligibleRows(ctx);const {from='',to=''}=ctx.options.fields;
  return tablePages(ctx,{key:'pfel',title:'P.F. Eligibilty Register',subtitle:sub(ctx,`Employees joined from ${dmy(from)||'—'} to ${dmy(to)||'—'}`),perPage:26,columns:ELIG_HEAD.map((h,i)=>({h,cls:i===0||i===7||i===8||i===10?'c':i===9?'num':undefined})),
   rows:rows.map((x,i)=>[i+1,x.e.paycode,x.e.cardNo,x.e.name,x.e.fatherName,x.e.department,x.e.designation,dmy(x.e.doj),dmy(x.e.dob),x.age??'',x.pf,x.pfNo,x.remark]),
   footer:small(`${rows.length} employees · ${rows.filter(x=>x.pf==='Y').length} with P.F. applicable. Age is on the To date.`)});},
  excel:ctx=>[ELIG_HEAD,...eligibleRows(ctx).map((x,i)=>[i+1,x.e.paycode,x.e.cardNo,x.e.name,x.e.fatherName,x.e.department,x.e.designation,dmy(x.e.doj),dmy(x.e.dob),x.age??'',x.pf,x.pfNo,x.remark])]}]};
