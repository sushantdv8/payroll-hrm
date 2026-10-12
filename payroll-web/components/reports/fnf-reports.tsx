import type {Employee} from '@/lib/payroll';
import {amountInWords,dmy,monthLabel,realResignDate} from '@/lib/report-utils';
import type {ReportConfig,ReportContext,ReportPage} from './report-form';
import {trimCell} from '@/lib/masters';
import {Header,extraOf,n2,tablePages} from './report-parts';

// Reports › Full and Final: settlement of employees who left. For each ticked employee with a leaving date:
//  salary      the saved salary of the chosen month (net)
//  leave       EL balance of that month's leave ledger × daily rate (monthly rate ÷ 30)
//  gratuity    15 / 26 × monthly rate × completed years of service (a part year of 6 months or more counts),
//              only after 5 years of service (Payment of Gratuity Act)
// Monthly rate = the rates saved with the salary (Rate column of Salary Preparation), or the gross when no rate was saved.
type Settlement={e:Employee;left:string;years:number;months:number;days:number;rate:number;dayRate:number;net:number;elDays:number;leave:number;gratuity:number;total:number};
const ALL=['company','subCompany','location','dhead','department','designation','category','salaryGrade'] as const;
// Service counts the leaving day itself: it runs to the day after it, so 01-04-2019 to 31-03-2024 is 5 years exactly.
function service(from:string,to:string){if(!from||!to||to<from)return {years:0,months:0,days:0};const a=new Date(from+'T00:00:00Z'),b=new Date(Date.parse(to+'T00:00:00Z')+864e5);let y=b.getUTCFullYear()-a.getUTCFullYear(),m=b.getUTCMonth()-a.getUTCMonth(),d=b.getUTCDate()-a.getUTCDate();
 if(d<0){m--;d=Math.max(0,d+new Date(Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),0)).getUTCDate());}if(m<0){y--;m+=12;}return {years:y,months:m,days:d};}
function settlements(ctx:ReportContext):Settlement[]{
 // The form skips its own 'tick an employee' check for options that read a table, so it is made here.
 if(!ctx.employees.length)throw new Error('Tick at least one employee.');
 return ctx.employees.filter(e=>realResignDate(e)).map(e=>{const left=realResignDate(e).slice(0,10);const s=ctx.salaries.get(e.id);const a=ctx.attendance.get(e.id);const sv=service((e.doj||'').slice(0,10),left);
  // Salary mode as the salary calculation finds it (Employee salary settings first): modes 1 and 2 are rated per day.
  const rated=(s?.earnings||[]).reduce((x,l)=>x+(l.rate||0),0);const key=String(e.sourceKey||e.id);const o=ctx.rows.find(r=>trimCell(r.values.emp_code)===key);
  const mode=o?trimCell(o.values.sal_mode):extraOf(ctx,e)?.salMode||'0';const daily=rated>0&&(mode==='1'||mode==='2');
  const rate=daily?rated*26:(rated||s?.gross||0);const dayRate=daily?rated:rate/30;
  const el=a?.leaveLedger.find(l=>l.code==='EL');const elDays=typeof el?.balance==='number'&&el.balance>0?el.balance:0;
  const leave=Math.round(dayRate*elDays);const years=sv.years+(sv.months>=6?1:0);const gratuity=sv.years>=5?Math.round(15/26*rate*years):0;const net=s?.net||0;
  return {e,left,...sv,rate,dayRate,net,elDays,leave,gratuity,total:net+leave+gratuity};});
}
function statement(ctx:ReportContext,r:Settlement):ReportPage{
 const line=(label:string,value:string)=><tr key={label}><td>{label}</td><td className="num">{value}</td></tr>;
 return {key:'fnf'+r.e.id,orientation:'portrait',tree:r.e.paycode,node:<><Header ctx={ctx} title="FULL AND FINAL SETTLEMENT" subtitle={`Settlement month ${monthLabel(ctx.month)}`}/>
  <table><tbody>
   <tr><td><b>Paycode</b></td><td>{r.e.paycode}</td><td><b>Employee Name</b></td><td>{r.e.name}</td></tr>
   <tr><td><b>Father/Husband Name</b></td><td>{r.e.fatherName}</td><td><b>Designation</b></td><td>{r.e.designation}</td></tr>
   <tr><td><b>Department</b></td><td>{r.e.department}</td><td><b>Date of Joining</b></td><td>{dmy(r.e.doj)}</td></tr>
   <tr><td><b>Date of Leaving</b></td><td>{dmy(r.left)}</td><td><b>Service</b></td><td>{r.years} Years {r.months} Months {r.days} Days</td></tr>
  </tbody></table>
  <table style={{marginTop:'10px'}}><thead><tr><th>Particulars</th><th className="num">Amount (Rs.)</th></tr></thead><tbody>
   {line(`Salary for ${monthLabel(ctx.month)} (net)`,n2(r.net))}
   {line(`Leave encashment (EL ${r.elDays} days × ${n2(r.dayRate)})`,n2(r.leave))}
   {line(r.years>=5?`Gratuity (15/26 × ${n2(r.rate)} × ${r.years+(r.months>=6?1:0)} years)`:'Gratuity (not eligible: less than 5 years)',n2(r.gratuity))}
   <tr><td><b>Total payable</b></td><td className="num"><b>{n2(r.total)}</b></td></tr>
  </tbody></table>
  <p><b>{amountInWords(r.total)}</b></p>
  <p style={{marginTop:'40px',display:'flex',justifyContent:'space-between'}}><span>Prepared By</span><span>Authorised Signatory</span><span>Employee&apos;s Signature</span></p>
  <p>I have received the above amount in full and final settlement of all my dues and have no further claim against the company.</p></>};
}
export const fullFinalConfig:ReportConfig={period:'month',filters:[...ALL],resignMode:true,note:'Only ticked employees with a leaving date are settled. Choose the month of the last salary.',options:[
 {value:'statement',label:'Full and Final Statement',needs:['salaries','attendance'],table:'tbempsal',build:ctx=>{const list=settlements(ctx);return list.length?list.map(r=>statement(ctx,r)):tablePages(ctx,{key:'fnf0',title:'Full and Final Settlement',perPage:1,columns:[{h:'Note'}],rows:[['No ticked employee has a leaving date.']]});}},
 {value:'register',label:'Full and Final Register',needs:['salaries','attendance'],table:'tbempsal',build:ctx=>{const list=settlements(ctx);return tablePages(ctx,{key:'fnfr',title:'Full and Final Register',subtitle:monthLabel(ctx.month),perPage:30,
  columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'D.O.J',cls:'c'},{h:'D.O.L',cls:'c'},{h:'Service'},{h:'Salary',cls:'num'},{h:'Leave',cls:'num'},{h:'Gratuity',cls:'num'},{h:'Total',cls:'num'}],
  rows:list.map((r,i)=>[i+1,r.e.paycode,r.e.name,dmy(r.e.doj),dmy(r.left),`${r.years}y ${r.months}m`,n2(r.net),n2(r.leave),n2(r.gratuity),n2(r.total)])});},
  excel:ctx=>[['Sno','Paycode','Employee Name','D.O.J','D.O.L','Years','Months','Salary','Leave','Gratuity','Total'],...settlements(ctx).map((r,i)=>[i+1,r.e.paycode,r.e.name,dmy(r.e.doj),dmy(r.left),r.years,r.months,r.net,r.leave,r.gratuity,r.total])]},
]};
