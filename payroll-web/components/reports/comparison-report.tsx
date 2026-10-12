import {useQuery} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {AttendanceMonth,Employee} from '@/lib/payroll';
import type {SalarySnapshot} from '@/lib/backup';
import {trimCell,type MasterRow} from '@/lib/masters';
import {buildRules,makeCalculator} from '@/lib/salary-calc-core';
import {exportExcel,requestJson,type XlCell} from '@/lib/client-api';
import {fyMonths,monthLabel,type Extra} from '@/lib/report-utils';
import type {ReportConfig,ReportContext,ReportOption} from './report-form';
import {Header} from './report-parts';

// Reports › Comparison Report: two months side by side (Rate, Day, OT Hrs., Tot.Earn., OT Amt., Total) and a Difference block that
// shows only the increase of the second month over the first (never a negative). A month's figures are its saved salary; a month
// without a saved salary is worked out the way Salary Preparation does it (rate x paid days, attendance of that month).
type Block={rate:number;day:number;otHrs:number;earn:number;otAmt:number;total:number};
type Line={e:Employee;rate:number;m1:Block|null;m2:Block|null};
const MONEY=['Rate','Day','OT Hrs.','Tot.Earn.','OT Amt.','Total'] as const;
const nextMonth=(m:string)=>{const [y,mo]=m.split('-').map(Number);const d=new Date(Date.UTC(y,mo,1));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');};
const secondMonth=(ctx:ReportContext)=>/^\d{4}-\d{2}$/.test(ctx.options.fields.month2||'')?ctx.options.fields.month2:nextMonth(ctx.month);
const numeric=(v:string)=>{const n=Number(v.replace(/\D/g,''));return v.trim()!==''&&Number.isFinite(n)&&/^\d+$/.test(v.trim())?n:v;};
const shortMonth=(m:string)=>monthLabel(m).replace(/-\d\d(\d\d)$/,'-$1');
const show=(v:number|undefined)=>v==null?'':String(Math.round(v*100)/100);

const master=(dataset:string,table:string)=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset,table})).then(r=>r.rows);
async function loadShared(dataset:string){
 const [rates,earn,ded,overrides,otSlabs,pfesi,rule,emp]=await Promise.all(['tbsal','tbearn','tbded','tbempsal','tbshiftset','tbpfesi','tbsalrule','tbemp'].map(t=>master(dataset,t)));
 // An employee saved without its original code is found again through the paycode.
 const codeOf=new Map(emp.map(r=>[trimCell(r.values.emp_paycode),trimCell(r.values.emp_code)]));
 const {extras}=await requestJson<{extras:Record<string,Extra>}>('/api/employee-extras?'+new URLSearchParams({dataset}));
 // One rate per earning head (a head listed twice takes its last row); the employee's rate is the total of the heads.
 const heads=new Map<string,number>();for(const r of rates)heads.set(trimCell(r.values.emp_code)+'|'+trimCell(r.values.e_code),Number(trimCell(r.values.rt1))||0);
 const rateOf=new Map<string,number>();for(const [k,v] of heads){const emp=k.slice(0,k.lastIndexOf('|'));rateOf.set(emp,(rateOf.get(emp)||0)+v);}
 return {rates,earn,ded,overrides,otSlabs,extras,rateOf,codeOf,rules:buildRules(dataset,pfesi[0]?.values,rule[0]?.values)};
}
type Shared=Awaited<ReturnType<typeof loadShared>>;
async function loadMonth(dataset:string,month:string,shared:Shared){
 const [sal,att]=await Promise.all([requestJson<{salaries:SalarySnapshot[]}>('/api/backup?'+new URLSearchParams({view:'salaries',dataset,month})),requestJson<{attendance:AttendanceMonth[]}>('/api/records?'+new URLSearchParams({month,dataset}))]);
 return {snaps:new Map(sal.salaries.map(s=>[s.employeeId,s])),calc:makeCalculator({...shared,attendance:att.attendance},shared.rules,month)};
}
type Month=Awaited<ReturnType<typeof loadMonth>>;
function blockOf(e:Employee,rate:number,m:Month):Block|null{
 const snap=m.snaps.get(e.id);
 if(snap)return {rate,day:snap.payableDays||0,otHrs:0,earn:snap.gross||0,otAmt:0,total:snap.gross||0};
 const c=m.calc(e);if(!(c.payableDays>0)||!c.hasRates)return null;
 const otAmt=c.result.ot.amount||0;return {rate,day:c.payableDays,otHrs:c.otOn?c.otHours:0,earn:c.result.gross-otAmt,otAmt,total:c.result.gross};
}

async function loadComparison(ctx:ReportContext):Promise<{lines:Line[];month2:string}>{
 const month2=secondMonth(ctx);const shared=await loadShared(ctx.dataset);
 const [a,b]=await Promise.all([loadMonth(ctx.dataset,ctx.month,shared),loadMonth(ctx.dataset,month2,shared)]);
 const lines=ctx.employees.flatMap(emp=>{const key=String(emp.sourceKey||shared.codeOf.get(emp.paycode.trim())||'');const e=key===emp.sourceKey?emp:{...emp,sourceKey:key};
  const rate=shared.rateOf.get(key)||0;if(!(rate>0))return [];
  const m1=blockOf(e,rate,a),m2=blockOf(e,rate,b);return (m1?.day||0)>0||(m2?.day||0)>0?[{e,rate,m1,m2}]:[];});
 lines.sort((x,y)=>{const p=Number(x.e.paycode.replace(/\D/g,'')),q=Number(y.e.paycode.replace(/\D/g,''));return p-q||x.e.paycode.localeCompare(y.e.paycode);});
 return {lines,month2};
}
// A month without any salary is empty in the first block (nothing to compare with) and zeros with the rate in the second.
const cells=(b:Block|null,blank:boolean,rate:number):(number|null)[]=>b?[b.rate,b.day,b.otHrs,b.earn,b.otAmt,b.total]:blank?[null,null,null,null,null,null]:[rate,0,0,0,0,0];
const gain=(x:number|null,y:number|null)=>Math.max(0,(y||0)-(x||0));
const rowOf=(l:Line)=>{const a=cells(l.m1,true,l.rate),b=cells(l.m2,false,l.rate);return {a,b,d:a.map((v,i)=>gain(v,b[i]))};};

function Table({ctx,data}:{ctx:ReportContext;data:{lines:Line[];month2:string}}){
 const {lines,month2}=data;const rows=lines.map(rowOf);
 const total=(pick:(r:ReturnType<typeof rowOf>)=>(number|null)[])=>MONEY.map((_,i)=>rows.reduce((s,r)=>s+(pick(r)[i]||0),0));
 const t1=total(r=>r.a),t2=total(r=>r.b),td=total(r=>r.d);
 return <>
  <Header ctx={ctx} title={`Comparison Report For the Month of ${monthLabel(ctx.month)} and ${monthLabel(month2)}`}/>
  <table><thead>
   <tr><th colSpan={6}/><th colSpan={6} className="c">{monthLabel(ctx.month)}</th><th colSpan={6} className="c">{monthLabel(month2)}</th><th colSpan={6} className="c">Difference</th></tr>
   <tr>{['Sno.','Paycode','Card No.','Employee Name','Dep.Name','Des. Name'].map(h=><th key={h}>{h}</th>)}{[0,1,2].flatMap(k=>MONEY.map(h=><th key={k+h} className="num">{h}</th>))}</tr></thead>
   <tbody>{lines.map((l,i)=>{const r=rows[i];return <tr key={l.e.id}><td className="c">{i+1}</td><td>{l.e.paycode}</td><td>{l.e.cardNo||l.e.paycode}</td><td>{l.e.name}</td><td>{l.e.department}</td><td>{l.e.designation}</td>
    {[r.a,r.b,r.d].flatMap((blk,k)=>blk.map((v,j)=><td key={k+'-'+j} className="num">{show(v??undefined)}</td>))}</tr>;})}
    <tr><td colSpan={6}><b>Total ({lines.length} employees)</b></td>{[t1,t2,td].flatMap((blk,k)=>blk.map((v,j)=><td key={k+'-'+j} className="num"><b>{j===0?'':show(v)}</b></td>))}</tr></tbody></table>
  <p style={{fontSize:'10px',marginTop:'4px'}}>A month uses its saved salary; a month without one is worked out from its attendance and the rate master. The Difference block shows only an increase of {monthLabel(month2)} over {monthLabel(ctx.month)}. Employees without a rate, or without paid days in both months, are not listed.</p>
 </>;
}
function Gate({ctx}:{ctx:ReportContext}){
 const q=useQuery({queryKey:['comparison',ctx.dataset,ctx.month,secondMonth(ctx),ctx.employees.map(e=>e.id).join(',')],queryFn:()=>loadComparison(ctx),refetchOnWindowFocus:false,staleTime:0,gcTime:0});
 if(q.isPending)return <p className="rpt-loading" style={{padding:'24px',fontSize:'13px'}}>Loading the salaries of the two months…</p>;
 if(q.error)return <p style={{padding:'24px',fontSize:'13px'}}>{(q.error as Error).message} <button type="button" onClick={()=>void q.refetch()}>Try again</button></p>;
 return <Table ctx={ctx} data={q.data}/>;
}

async function comparisonExcel(ctx:ReportContext){
 const {lines,month2}=await loadComparison(ctx);if(!lines.length)throw new Error('No ticked employee has a rate and paid days in these two months.');
 const blank=(n:number):XlCell[]=>Array(n).fill(null);
 const head=['Sno.','Paycode','Card No.','Employee Name','Dep.Name','Des. Name'];
 const rows:XlCell[][]=[[ctx.company.name],[`Comparison Report For the Month of ${monthLabel(ctx.month)} and ${monthLabel(month2)}`],[...blank(6),shortMonth(ctx.month),...blank(5),shortMonth(month2),...blank(5),'Difference'],
  [...head,...MONEY,...MONEY,...MONEY],
  ...lines.map((l,i)=>{const r=rowOf(l);return [i+1,numeric(l.e.paycode),numeric(l.e.cardNo||l.e.paycode),l.e.name,l.e.department,l.e.designation,...r.a,...r.b,...r.d] as XlCell[];})];
 await exportExcel(`Comparison_${ctx.month}_${month2}.xlsx`,[{name:'Sheet1',rows}]);toast.success('Excel file created');
}

const options:ReportOption[]=[
 {value:'comparison',label:'Comparison Report',build:ctx=>[{key:'cmp',orientation:'landscape',tree:'Comparison Report',node:<Gate ctx={ctx}/>}]},
 {value:'excel',label:'Comparison Excel',hidden:true,build:()=>[],action:comparisonExcel},
];
export const comparisonConfig:ReportConfig={period:'month',filters:['company','subCompany','location','department','category'],options,
 fields:[{key:'month2',label:'Compare With',kind:'select',place:'left',default:'',options:[{value:'',label:'Next month'},...fyMonths.map(m=>({value:m.value,label:monthLabel(m.value)}))]}],
 extraButtons:[{label:'Excel Export',option:'excel'}]};
