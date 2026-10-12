import {useMemo,type ReactNode} from 'react';
import {useQueries} from '@tanstack/react-query';
import type {AttendanceMonth,Employee} from '@/lib/payroll';
import type {SalarySnapshot} from '@/lib/backup';
import type {OriginalSlip} from '@/lib/salary-slip';
import {trimCell,type MasterRow} from '@/lib/masters';
import {dMonY,dmy,employeePayMode,fyMonths,monthLabel,monthTitle} from '@/lib/report-utils';
import {exportExcel,requestJson} from '@/lib/client-api';
import type {ReportConfig,ReportContext,ReportOption,ReportPage} from './report-form';
import {chunk,extraOf,hhmm,minutes,n2,tablePages,type Column} from './report-parts';
import {unitSheetOptions} from './unit-sheets';
import {toast} from 'sonner';

const SAL_FILTERS=['company','subCompany','location','department','category','salaryGrade'] as const;

// Shared with the arrear and E.S.I. reports: data a report page loads itself (Generate fetches one month and one master only).
export const masterQuery=(dataset:string,table:string)=>({queryKey:['masters',dataset,table],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset,table}),{signal}),refetchOnWindowFocus:false,staleTime:600000});
export const salaryQuery=(dataset:string,month:string)=>({queryKey:['backup','salaries',dataset,month],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{salaries:SalarySnapshot[]}>('/api/backup?'+new URLSearchParams({view:'salaries',dataset,month}),{signal}),refetchOnWindowFocus:false,staleTime:60000});
const slipQuery=(dataset:string,month:string)=>({queryKey:['salary-slips',dataset,month],queryFn:({signal}:{signal:AbortSignal})=>dataset==='manual'?Promise.resolve({slips:{} as Record<string,OriginalSlip>}):requestJson<{slips:Record<string,OriginalSlip>}>('/api/salary-slips?'+new URLSearchParams({dataset,month}),{signal}),refetchOnWindowFocus:false,staleTime:600000});
export const monthsBetween=(from:string,to:string)=>fyMonths.map(m=>m.value).filter(m=>m>=from&&m<=to);
export const dMonYSlash=(v:string)=>dMonY(v).replace(/-/g,'/');
// Several report pages drawn in one viewer page (a new printed page each).
export function Sections({pages}:{pages:ReportPage[]}){return <>{pages.map((p,i)=><div key={p.key} className={i?'rpt-section rpt-section-break':'rpt-section'}>{p.node}</div>)}</>;}
const W1=['ZERO','ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN'];
const W10=['','','TWENTY','THIRTY','FORTY','FIFTY','SIXTY','SEVENTY','EIGHTY','NINETY'];
const w999=(n:number)=>{const h=Math.floor(n/100),r=n%100;return [h?W1[h]+' HUNDRED':'',r<20?(r?W1[r]:''):W10[Math.floor(r/10)]+(r%10?'-'+W1[r%10]:'')].filter(Boolean).join(' ');};
// The original prints amounts with Crystal's ToWords in capitals: 296 -> "TWO HUNDRED NINETY-SIX" (international grouping).
export function upperWords(value:number|null|undefined){const v=Math.abs(Number(value)||0);let n=Math.floor(v+1e-9);const paise=Math.round((v-n)*100);const parts:string[]=[];
 for(const [size,name] of [[1e9,'BILLION'],[1e6,'MILLION'],[1e3,'THOUSAND']] as const){const k=Math.floor(n/size);if(k){parts.push(w999(k)+' '+name);n%=size;}}if(n)parts.push(w999(n));
 return ((Number(value)||0)<0?'MINUS ':'')+(parts.join(' ')||'ZERO')+(paise?' AND '+w999(paise)+' PAISE':'');}
type Row={e:Employee;s:SalarySnapshot};
function rowsOf(ctx:ReportContext):Row[]{return ctx.employees.flatMap(e=>{const s=ctx.salaries.get(e.id);return s?[{e,s}]:[];});}
function heads(rows:Row[],kind:'earnings'|'deductions'){const out:string[]=[];for(const r of rows)for(const c of r.s[kind])if(!out.includes(c.label))out.push(c.label);return out;}
const amt=(s:SalarySnapshot,kind:'earnings'|'deductions',label:string)=>s[kind].find(c=>c.label===label)?.amount??null;
const sum=(values:(number|null)[])=>values.reduce<number>((a,b)=>a+(b||0),0);
const subtitle=(ctx:ReportContext)=>`Salary for the month of ${monthTitle(ctx.month)}`;
const missingNote=(ctx:ReportContext,rows:Row[])=>ctx.employees.length>rows.length?<p style={{fontSize:'10px',marginTop:'4px'}}>{ctx.employees.length-rows.length} ticked employees have no saved salary for {monthLabel(ctx.month)} and are not listed.</p>:null;

function registerPages(ctx:ReportContext,byDepartment=false):ReportPage[]{
 const rows=rowsOf(ctx);const eh=heads(rows,'earnings'),dh=heads(rows,'deductions');
 const columns:Column[]=[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name / Designation'},{h:'P.Day',cls:'num'},...eh.map(h=>({h,cls:'num'})),{h:'Gross',cls:'num'},...dh.map(h=>({h,cls:'num'})),{h:'Tot.Ded',cls:'num'},{h:'Net Salary',cls:'num'},{h:'Signature',w:'70px'}];
 const line=(r:Row,i:number)=>[i+1,r.e.paycode,<><b>{r.e.name}</b><br/>{r.e.designation}</>,r.s.payableDays??'',...eh.map(h=>n2(amt(r.s,'earnings',h))),n2(r.s.gross),...dh.map(h=>n2(amt(r.s,'deductions',h))),n2(r.s.totalDeductions),<b key="n">{n2(r.s.net)}</b>,''];
 const total=(list:Row[],label:string)=>['',label,'',n2(sum(list.map(r=>r.s.payableDays))),...eh.map(h=>n2(sum(list.map(r=>amt(r.s,'earnings',h))))),n2(sum(list.map(r=>r.s.gross))),...dh.map(h=>n2(sum(list.map(r=>amt(r.s,'deductions',h))))),n2(sum(list.map(r=>r.s.totalDeductions))),n2(sum(list.map(r=>r.s.net))),''];
 const body:ReactNode[][]=[];
 if(byDepartment){const deps=[...new Set(rows.map(r=>r.e.department||'—'))].sort();let i=0;for(const d of deps){const list=rows.filter(r=>(r.e.department||'—')===d);body.push(['',<b key="d">{d}</b>,...Array(columns.length-2).fill('')]);for(const r of list)body.push(line(r,i++));body.push(total(list,'Department total'));}}
 else rows.forEach((r,i)=>body.push(line(r,i)));
 return tablePages(ctx,{key:byDepartment?'dw':'sr',title:byDepartment?'Department Wise Salary Detail':'Salary Sheet / Salary Register',subtitle:subtitle(ctx),columns,rows:body,perPage:14,totals:total(rows,'Grand total'),footer:missingNote(ctx,rows)});
}
function registerExcel(ctx:ReportContext){const rows=rowsOf(ctx);const eh=heads(rows,'earnings'),dh=heads(rows,'deductions');return [['Sno','Paycode','Card No.','Employee Name','Designation','Department','P.Day',...eh,'Gross',...dh,'Tot.Ded','Net Salary'],...rows.map((r,i)=>[i+1,r.e.paycode,r.e.cardNo,r.e.name,r.e.designation,r.e.department,r.s.payableDays??'',...eh.map(h=>amt(r.s,'earnings',h)??''),r.s.gross??'',...dh.map(h=>amt(r.s,'deductions',h)??''),r.s.totalDeductions??'',r.s.net??''])];}

// "Salary Export" in the original's column order (rate columns are not in the imported history).
async function salaryExport(ctx:ReportContext){const rows=rowsOf(ctx);if(!rows.length)throw new Error('No saved salary for the ticked employees in this month.');const eh=heads(rows,'earnings'),dh=heads(rows,'deductions');
 await exportExcel(`Salary_Export_${ctx.month}.xlsx`,[{name:'Sheet1',rows:[['Sno','Paycode','Card No.','EMP.NAME','Father.Name','Department','Designation','Location','D.O.J.','PF No.','ESI No.','Bank Ac No','Paymode','Pday',...eh,'Earn Total',...dh,'Ded Total','Net Salary'],
  ...rows.map((r,i)=>{const x=extraOf(ctx,r.e);return [i+1,r.e.paycode,r.e.cardNo,r.e.name,r.e.fatherName,r.e.department,r.e.designation,r.e.location,dmy(r.e.doj),x?.pfNo||'',x?.esiNo||'',r.e.accountNo,employeePayMode(r.e,x),r.s.payableDays??'',...eh.map(h=>amt(r.s,'earnings',h)??''),r.s.gross??'',...dh.map(h=>amt(r.s,'deductions',h)??''),r.s.totalDeductions??'',r.s.net??''];})]}]);toast.success('Export Successfully');}

const otMinutes=(ctx:ReportContext,e:Employee)=>(ctx.attendance.get(e.id)?.days||[]).reduce((s,d)=>s+minutes(d.ot),0);
function simpleSheet(ctx:ReportContext,key:string,title:string,columns:Column[],make:(r:Row,i:number)=>ReactNode[],tall=false,totals?:ReactNode[]){const rows=rowsOf(ctx);return tablePages(ctx,{key,title,subtitle:subtitle(ctx),columns,rows:rows.map(make),perPage:tall||ctx.options.otExtraSpace?16:26,totals,footer:missingNote(ctx,rows)});}
function groupSummary(ctx:ReportContext,key:string,title:string,label:string,by:(r:Row)=>string){const rows=rowsOf(ctx);const groups=[...new Set(rows.map(by))].sort();
 return tablePages(ctx,{key,title,subtitle:subtitle(ctx),orientation:'portrait',perPage:40,columns:[{h:label},{h:'Employees',cls:'num'},{h:'Pay Days',cls:'num'},{h:'Gross',cls:'num'},{h:'Deductions',cls:'num'},{h:'Net',cls:'num'}],
  rows:groups.map(g=>{const l=rows.filter(r=>by(r)===g);return [g||'Not recorded',l.length,n2(sum(l.map(r=>r.s.payableDays))),n2(sum(l.map(r=>r.s.gross))),n2(sum(l.map(r=>r.s.totalDeductions))),n2(sum(l.map(r=>r.s.net)))];}),
  totals:['Total',rows.length,n2(sum(rows.map(r=>r.s.payableDays))),n2(sum(rows.map(r=>r.s.gross))),n2(sum(rows.map(r=>r.s.totalDeductions))),n2(sum(rows.map(r=>r.s.net)))]});}

const salaryOptions:ReportOption[]=[
 {value:'register',label:'Salary Sheet/Salary Register',needs:['salaries'],build:ctx=>registerPages(ctx),excel:registerExcel},
 {value:'ot',label:'O.T. Sheet',needs:['salaries','attendance'],note:'OT hours are added up from the saved daily OT hours. OT amounts need the confirmed OT rate rules.',build:ctx=>{const withSalary=ctx.options.salaryWithOt;return tablePages(ctx,{key:'ot',title:'O.T. Sheet',subtitle:subtitle(ctx),perPage:ctx.options.otExtraSpace?16:26,
  columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'OT Hrs',cls:'num'},...(withSalary?[{h:'Gross',cls:'num'},{h:'Net Salary',cls:'num'}]:[]),{h:'Signature',w:'90px'}],
  rows:ctx.employees.map((e,i)=>{const s=ctx.salaries.get(e.id);return [i+1,e.paycode,e.name,e.department,hhmm(otMinutes(ctx,e)),...(withSalary?[n2(s?.gross),n2(s?.net)]:[]),''];})});},
  excel:ctx=>[['Sno','Paycode','Employee Name','Department','OT Hrs','Gross','Net Salary'],...ctx.employees.map((e,i)=>{const s=ctx.salaries.get(e.id);return [i+1,e.paycode,e.name,e.department,hhmm(otMinutes(ctx,e)),s?.gross??'',s?.net??''];})]},
 {value:'payment',label:'Payment Sheet',needs:['salaries'],build:ctx=>simpleSheet(ctx,'pay','Payment Sheet',[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Paymode'},{h:'Bank A/c No.'},{h:'Net Salary',cls:'num'},{h:'Signature',w:'110px'}],(r,i)=>[i+1,r.e.paycode,r.e.name,r.e.department,employeePayMode(r.e,extraOf(ctx,r.e)),r.e.accountNo,n2(r.s.net),''],true,['','Total','','','','',n2(sum(rowsOf(ctx).map(r=>r.s.net))),'']),excel:registerExcel},
 {value:'advance',label:'Adv . Sheet',needs:['salaries'],note:'The value next to Adv . Sheet is printed in the sheet heading as entered.',build:ctx=>simpleSheet(ctx,'adv',`Advance Sheet (${ctx.options.advValue})`,[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Net Salary',cls:'num'},{h:'Advance',w:'90px'},{h:'Signature',w:'110px'}],(r,i)=>[i+1,r.e.paycode,r.e.name,r.e.department,n2(r.s.net),'',''],true)},
 {value:'summary',label:'Salary Summary',needs:['salaries'],build:ctx=>{const rows=rowsOf(ctx);const eh=heads(rows,'earnings'),dh=heads(rows,'deductions');
  return tablePages(ctx,{key:'ss',title:'Salary Summary',subtitle:subtitle(ctx),orientation:'portrait',perPage:60,columns:[{h:'Head'},{h:'Type'},{h:'Amount',cls:'num'}],
   rows:[...eh.map(h=>[h,'Earning',n2(sum(rows.map(r=>amt(r.s,'earnings',h))))]),['Gross','',<b key="g">{n2(sum(rows.map(r=>r.s.gross)))}</b>],...dh.map(h=>[h,'Deduction',n2(sum(rows.map(r=>amt(r.s,'deductions',h))))]),['Total deductions','',<b key="d">{n2(sum(rows.map(r=>r.s.totalDeductions)))}</b>],['Net salary',`${rows.length} employees`,<b key="n">{n2(sum(rows.map(r=>r.s.net)))}</b>]]});}},
 {value:'paymode',label:'Paymode Wise Summary',needs:['salaries'],build:ctx=>groupSummary(ctx,'pm','Paymode Wise Summary','Payment Mode',r=>employeePayMode(r.e,extraOf(ctx,r.e)))},
 {value:'department',label:'DepartmentWise Summary',needs:['salaries'],build:ctx=>groupSummary(ctx,'ds','Department Wise Summary','Department',r=>r.e.department)},
 ...unitSheetOptions,
 {value:'export',label:'Salary Export',needs:['salaries'],hidden:true,build:()=>[],action:salaryExport},
 {value:'depdetail',label:'Dep.Wise Detail',needs:['salaries'],hidden:true,build:ctx=>registerPages(ctx,true),excel:registerExcel},
];
export const salaryConfig:ReportConfig={period:'month',filters:[...SAL_FILTERS],paymentMode:true,resignMode:true,otExtraSpace:true,advSheet:true,columns:2,options:salaryOptions,extraButtons:[{label:'Salary Export',option:'export'},{label:'Dep.Wise Detail',option:'depdetail'}]};

// Reports › Bank/Cheque/Cash: the bank advice letter (Bank, PF Exmpeted …) or a Cheque / Cash statement of the month's net salary.
type PayKind='bank'|'cheque'|'cash'|'pfExempt'|'pfExempt1'|'esiExempt';
const bankOf=(ctx:ReportContext)=>{const list=ctx.lists.tbbank||[];return list.find(b=>b.code===ctx.options.fields.bank)||list[0];};
// Employees keep the bank's name (not its code), so the bank is matched by name; an employee without a bank name goes with any bank.
// PF Exmpeted = PF flag off; PF Exmpeted 1 = no PF number; ESI Exmpted = ESI flag off (all three among the bank-paid employees).
function payRows(ctx:ReportContext,kind:PayKind):Row[]{const bank=trimCell(bankOf(ctx)?.name).toLowerCase();
 return rowsOf(ctx).filter(r=>{if(!((r.s.net??0)>0))return false;const x=extraOf(ctx,r.e);const mode=employeePayMode(r.e,x);
  if(kind==='cheque'||kind==='cash')return mode===(kind==='cheque'?'Cheque':'Cash');
  const own=r.e.bankName.trim().toLowerCase();if(mode!=='Bank'||(bank&&own&&own!==bank))return false;
  // PF / ESI applicable as the salary calculation finds them: Employee salary settings first, then the employee master.
  const o=ctx.lists.tbempsal?.find(t=>t.code===String(r.e.sourceKey||r.e.id))?.values;const pfOn=o?trimCell(o.pf_alw)==='1':x?.pfAlw==='1';const esiOn=o?trimCell(o.esi_alw)==='1':x?.esiAlw==='1';
  return kind==='pfExempt'?!pfOn:kind==='pfExempt1'?!x?.pfNo:kind==='esiExempt'?!esiOn:true;});}
const FIRST_ROWS=20,NEXT_ROWS=36;
function bankLetter(ctx:ReportContext,kind:PayKind):ReportPage[]{const bank=bankOf(ctx);const rows=payRows(ctx,kind);const total=sum(rows.map(r=>r.s.net));
 const parts=[rows.slice(0,FIRST_ROWS)];for(let i=FIRST_ROWS;i<rows.length;i+=NEXT_ROWS)parts.push(rows.slice(i,i+NEXT_ROWS));
 return parts.map((part,p)=>{const start=p?FIRST_ROWS+(p-1)*NEXT_ROWS:0;const last=p===parts.length-1;
  return {key:`bl${kind}${p}`,orientation:'portrait',tree:p?`Page ${p+1}`:trimCell(bank?.name)||'Bank',node:<div className="bl-letter">
   {p===0&&<><div className="bl-letterhead"/><p>The Manager,</p><p><b>{trimCell(bank?.name)}</b></p><p>&nbsp;</p><p>Dear Sir/Madam,</p><p><b>Ref:-</b>&nbsp;&nbsp;<b>Current Account no.</b> {trimCell(bank?.values.bank_ac)}</p><p>&nbsp;</p>
    <p>and credit the Saving Accounts of our ({rows.length}) Employees as per details given bellow:</p></>}
   <p className="bl-right">Page {p+1} of {parts.length}</p>{ctx.printDate&&<p className="bl-right">Print Date&nbsp;&nbsp;&nbsp;{dMonYSlash(ctx.printDate)}</p>}
   <table className="bl-table"><thead><tr><th className="c">Sno.</th><th>Pay Code</th><th>Bank Account No.</th><th>Employee Name</th><th className="num">Salary (in Rs.)</th><th colSpan={2}/></tr></thead>
    <tbody>{part.map((r,i)=><tr key={r.e.id}><td className="c">{start+i+1}</td><td>{r.e.paycode}</td><td>{r.e.accountNo}</td><td>{r.e.name}</td><td className="num">{n2(r.s.net)}</td><td/><td/></tr>)}
     {last&&<tr><td colSpan={4} className="num"><b>Total</b></td><td className="num"><b>{n2(total)}</b></td><td/><td/></tr>}</tbody></table>
   {last&&<><p className="bl-words">(Rupees {upperWords(total)} ONLY</p><hr/><p><b>For&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{ctx.company.name}</b></p></>}
  </div>};});}
function payStatement(ctx:ReportContext,kind:'cheque'|'cash'):ReportPage[]{const rows=payRows(ctx,kind);const total=sum(rows.map(r=>r.s.net));
 return tablePages(ctx,{key:'st'+kind,title:kind==='cheque'?'Cheque Statement':'Cash Statement',subtitle:subtitle(ctx),orientation:'portrait',perPage:ctx.options.otExtraSpace?22:34,
  columns:[{h:'Sno.',cls:'c'},{h:'Pay Code'},{h:'Employee Name'},{h:'Department'},{h:'Salary (in Rs.)',cls:'num'},{h:'Signature',w:'110px'}],rows:rows.map((r,i)=>[i+1,r.e.paycode,r.e.name,r.e.department,n2(r.s.net),'']),
  totals:['','','Total','',n2(total),''],footer:<p className="bl-words">(Rupees {upperWords(total)} ONLY</p>});}
const payOptions:[PayKind,string][]=[['bank','Bank'],['cheque','Cheque'],['cash','Cash'],['pfExempt','PF Exmpeted'],['pfExempt1','PF Exmpeted 1'],['esiExempt','ESI Exmpted']];
export const bankConfig:ReportConfig={period:'month',filters:[...SAL_FILTERS],paymentMode:true,resignMode:true,otExtraSpace:true,
 fields:[{key:'bank',label:'Bank Name',kind:'select',place:'left',default:'1',options:lists=>(lists.tbbank||[]).map(b=>({value:b.code,label:`${b.name||'Bank'}~${b.code}`}))}],
 options:payOptions.map(([value,label]):ReportOption=>({value,label,needs:['salaries'],build:ctx=>value==='cheque'||value==='cash'?payStatement(ctx,value):bankLetter(ctx,value),
  excel:ctx=>[['Sno.','Pay Code','Bank Account No.','Employee Name','Department','Salary (in Rs.)'],...payRows(ctx,value).map((r,i)=>[i+1,r.e.paycode,r.e.accountNo,r.e.name,r.e.department,r.s.net??0])]}))};

// Reports › Payslip: the original's "Form X (Rule 26)" slip. Rate of a head = the rate saved with the salary, else the rate of the
// original's saved month (imported salaries), else the employee's current rate (Salary rates, tbsal). Earnings exclude arrears.
const OT='O.T. Amount';
type Lang='en'|'hi';
type SlipInput={e:Employee;month:string;s:SalarySnapshot;a?:AttendanceMonth;orig?:OriginalSlip;rates?:Map<string,number>};
const CAPTIONS={
 en:{paycode:'Paycode',card:'Card NO.',name:'Emp. Name',father:'E.F/H Name',desig:'Designation',dept:'Department',form:'Form X',rule:'(Rule 26)',title:(m:string)=>`Payslip for the month of ${m}`,pf:'PF No.',esi:'ESIC No.',doj:'DOJ',bank:'B.A/c No.',
  attn:'Attn.details',avl:'Avl.',bal:'Bal.',rate:'Salary/WageRate',earn:'Earnings',arrear:'Arrears',ded:'Deductions',net:'Net Salary',ot:'O.T.Hrs/Amt',paid:'Paid.days',totRate:'Total rate',
  words:(w:string)=>`Rs. ${w} Only`,auth:'Authorised Signatory',sign:"Employee's Signature",note:'This is Computer generated Pay Slip.It does not require Signature.'},
 hi:{paycode:'पे कोड',card:'कार्ड नं.',name:'कर्मचारी का नाम',father:'पिता/पति का नाम',desig:'पद',dept:'विभाग',form:'प्रपत्र X',rule:'(नियम 26)',title:(m:string)=>`वेतन पर्ची माह ${m}`,pf:'पी.एफ. नं.',esi:'ई.एस.आई.सी. नं.',doj:'कार्यग्रहण तिथि',bank:'बैंक खाता नं.',
  attn:'उपस्थिति विवरण',avl:'लिया',bal:'शेष',rate:'वेतन/मजदूरी दर',earn:'अर्जित वेतन',arrear:'बकाया',ded:'कटौती',net:'शुद्ध वेतन',ot:'ओ.टी. घंटे/राशि',paid:'भुगतान दिवस',totRate:'कुल दर',
  words:(w:string)=>`रु. ${w} मात्र`,auth:'अधिकृत हस्ताक्षरकर्ता',sign:'कर्मचारी के हस्ताक्षर',note:'यह कंप्यूटर द्वारा बनाई गई वेतन पर्ची है। इस पर हस्ताक्षर की आवश्यकता नहीं है।'}};
const HINDI:Record<string,string>={WD:'कार्य दिवस',WO:'साप्ताहिक अवकाश',HDD:'छुट्टी',EL:'अर्जित अवकाश',CL:'आकस्मिक अवकाश',SL:'बीमारी अवकाश',CO:'प्रतिपूरक अवकाश',OL:'अन्य अवकाश',AB:'अनुपस्थित',
 HRA:'मकान किराया भत्ता','CONV.':'वाहन भत्ता','OTHER ALLOW.':'अन्य भत्ता',PHONE:'फोन भत्ता',MEDICAL:'चिकित्सा भत्ता',PF:'भविष्य निधि',ESI:'ई.एस.आई.',VPF:'वी.पी.एफ.',LOAN:'ऋण',ADVANCE:'अग्रिम',TDS:'टी.डी.एस.',OTHERS:'अन्य'};
const say=(lang:Lang,label:string)=>lang==='hi'?HINDI[label.trim().toUpperCase()]||label:label;
const halves=(a:AttendanceMonth|undefined,codes:string[])=>(a?.days||[]).reduce((s,d)=>s+(codes.includes(d.first)?0.5:0)+(codes.includes(d.second)?0.5:0),0);
// Avl. = days of the month (P.Day totals, else counted from the day marks); Bal. = leave balance of the month's leave ledger.
// A line with nothing to show stays blank; otherwise a zero prints as '-' (WD 22.5 / -, CL - / 3.0 in the original).
function attnRows(a:AttendanceMonth|undefined){const t=a?.totals;const tot=(v:number|''|undefined,codes:string[])=>typeof v==='number'?v:halves(a,codes);
 const bal=(...codes:string[])=>{const v=(a?.leaveLedger||[]).filter(l=>codes.includes(l.code)&&typeof l.balance==='number');return v.length?v.reduce((s,l)=>s+Number(l.balance),0):0;};
 const rows:[string,number,number|null][]=[['WD',tot(t?.worked,['P','OD']),null],['WO',tot(t?.weeklyOff,['WO','WO*']),null],['HDD',tot(t?.holiday,['HD','HD*']),null],['EL',halves(a,['EL']),bal('EL')],['CL',halves(a,['CL']),bal('CL')],
  ['SL',halves(a,['SL']),bal('SL')],['CO',halves(a,['CO']),bal('CO')],['OL',halves(a,['PL','MT','SP']),bal('PL','MT')],['AB',tot(t?.absent,['A','LWP']),null]];
 return rows.map(([code,avl,b])=>!avl&&!b?{code,avl:'',bal:''}:{code,avl:avl?avl.toFixed(1):'-',bal:b?b.toFixed(1):'-'});}
function FormXSlip({ctx,d,lang}:{ctx:ReportContext;d:SlipInput;lang:Lang}){
 const t=CAPTIONS[lang];const {e,s}=d;const x=extraOf(ctx,e);const z=(v:number|null|undefined)=>v?n2(v):'';
 const lines=s.earnings.filter(l=>l.label!==OT).map(l=>{const o=d.orig?.heads.find(h=>h.label===l.label);const arrear=l.arrear??o?.arrear??0;
  return {label:l.label,rate:l.rate??o?.rate??d.rates?.get(l.label)??0,earn:l.arrear!=null?(l.amount??0)-l.arrear:o?o.earn:(l.amount??0)-arrear,arrear};});
 const otHrs=s.otHours??d.orig?.otHours??0,otAmt=s.otAmount??s.earnings.find(l=>l.label===OT)?.amount??d.orig?.otAmount??0;
 const attn=attnRows(d.a);const n=Math.max(attn.length,lines.length+1,s.deductions.length);
 const tot={rate:sum(lines.map(l=>l.rate)),earn:sum(lines.map(l=>l.earn))+(otAmt||0),arrear:sum(lines.map(l=>l.arrear)),ded:s.totalDeductions??sum(s.deductions.map(v=>v.amount))};
 return <div className={'ps-slip'+(lang==='hi'?' ps-hi':'')}>
  <div className="ps-head">
   <div className="ps-kv"><b>{t.paycode}</b><span>: {e.paycode}</span><b>{t.card}</b><span>: {e.cardNo}</span><b>{t.name}</b><span>: {e.name}</span><b>{t.father}</b><span>: {e.fatherName}</span><b>{t.desig}</b><span>: {e.designation}</span><b>{t.dept}</b><span>: {e.department}</span></div>
   <div className="ps-centre"><div className="ps-co">{ctx.company.name}</div>{ctx.company.address&&<div>{ctx.company.address}</div>}<div className="ps-form">{t.form}</div><div>{t.rule}</div><div className="ps-month">{t.title(monthLabel(d.month))}</div></div>
   <div className="ps-kv ps-right"><b>{t.pf}</b><span>: {x?.pfNo||''}</span><b>{t.esi}</b><span>: {x?.esiNo||''}</span><b>{t.doj}</b><span>: {dMonY(e.doj)}</span><b>{t.bank}</b><span>: {e.accountNo}</span></div>
  </div>
  <table className="ps-table"><thead><tr><th>{t.attn}</th><th className="num">{t.avl}</th><th className="num">{t.bal}</th><th>{t.rate}</th><th className="num">{t.earn}</th><th className="num">{t.arrear}</th><th>{t.ded}</th><th className="num">{t.net}</th></tr></thead>
   <tbody>{Array.from({length:n},(_,i)=>{const a=attn[i],l=lines[i],dd=s.deductions[i],ot=i===lines.length;
    return <tr key={i}><td>{a?say(lang,a.code):''}</td><td className="num">{a?.avl}</td><td className="num">{a?.bal}</td>
     <td><div className="ps-split"><span>{l?say(lang,l.label):ot?t.ot:''}</span><span>{l?z(l.rate):ot?z(otHrs):''}</span></div></td><td className="num">{l?z(l.earn):ot?z(otAmt):''}</td><td className="num">{l?z(l.arrear):''}</td>
     <td><div className="ps-split"><span>{dd?say(lang,dd.label):''}</span><span>{dd?z(dd.amount):''}</span></div></td>{i===0&&<td className="num ps-net" rowSpan={n}><b>{n2(s.net)}</b></td>}</tr>;})}
    <tr className="ps-tot"><td colSpan={3}>{t.paid} {(s.payableDays??0).toFixed(1)}</td><td><div className="ps-split"><span>{t.totRate}</span><span>{n2(tot.rate)}</span></div></td><td className="num">{n2(tot.earn)}</td><td className="num">{n2(tot.arrear)}</td><td className="num">{n2(tot.ded)}</td><td/></tr></tbody></table>
  <p className="ps-hours">Working hours: {(s.workingHours??(d.a?.days||[]).reduce((n,v)=>{const p=(v.workHours||'0:00').split(':').map(Number);return n+(p[0]||0)+(p[1]||0)/60;},0)).toFixed(2)} • OT hours: {otHrs.toFixed(2)}</p><div className="ps-words">{t.words(upperWords(s.net))}</div>
  <div className="ps-foot"><span>{t.auth}</span><span>{t.sign}</span><span className="ps-note">{t.note}</span></div>
 </div>;}
// Head rates of the original's saved months (imported salaries) and the employees' current rates (tbsal by earning head code).
function useSlipSources(dataset:string,months:string[]){
 const [sal,earn]=useQueries({queries:[masterQuery(dataset,'tbsal'),masterQuery(dataset,'tbearn')]});const slips=useQueries({queries:months.map(m=>slipQuery(dataset,m))});
 const salRows=sal.data?.rows,earnRows=earn.data?.rows;
 const rates=useMemo(()=>{const names=new Map((earnRows||[]).map(r=>[trimCell(r.values.ern_code),trimCell(r.values.ern_name)]));const out=new Map<string,Map<string,number>>();
  for(const r of salRows||[]){const emp=trimCell(r.values.emp_code),name=names.get(trimCell(r.values.e_code));if(!name)continue;if(!out.has(emp))out.set(emp,new Map());const m=out.get(emp)!;m.set(name,Number(trimCell(r.values.rt1))||0);}return out;},[salRows,earnRows]);
 // The slip is not drawn until the rates and original slips are in, so it never prints with the wrong rate.
 const pending=sal.isPending||earn.isPending||slips.some(q=>q.isPending);
 const error=(sal.error||earn.error||slips.find(q=>q.error)?.error||null) as Error|null;
 return {pending,error,rates:(e:Employee)=>rates.get(String(e.sourceKey||e.id)),orig:(month:string,e:Employee)=>e.sourceKey?slips[months.indexOf(month)]?.data?.slips[String(e.sourceKey)]:undefined};}
function MonthSlips({ctx,items,lang}:{ctx:ReportContext;items:Row[];lang:Lang}){const src=useSlipSources(ctx.dataset,[ctx.month]);
 if(src.pending)return <p className="rpt-loading">Loading the salary rates and original slips…</p>;
 if(src.error)return <p>The salary rates or original slips could not be loaded: {src.error.message}</p>;
 return <>{items.map((r,i)=><div key={r.e.id}>{i>0&&<div className="rpt-cut"/>}<FormXSlip ctx={ctx} lang={lang} d={{e:r.e,month:ctx.month,s:r.s,a:ctx.attendance.get(r.e.id),orig:src.orig(ctx.month,r.e),rates:src.rates(r.e)}}/></div>)}</>;}
// Individual From -To Month: every saved month of the range for one employee (salaries and that employee's attendance per month).
function RangeSlips({ctx,e,months}:{ctx:ReportContext;e:Employee;months:string[]}){
 const src=useSlipSources(ctx.dataset,months);const sal=useQueries({queries:months.map(m=>salaryQuery(ctx.dataset,m))});
 const att=useQueries({queries:months.map(m=>({queryKey:['report','attendance-one',ctx.dataset,e.id,m],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{attendance:AttendanceMonth|null}>('/api/records?'+new URLSearchParams({month:m,employeeId:e.id}),{signal}),refetchOnWindowFocus:false,staleTime:60000}))});
 if(src.pending||sal.some(q=>q.isPending)||att.some(q=>q.isPending))return <p className="rpt-loading">Loading the salaries of {e.name}…</p>;
 const failed=[...sal,...att].find(q=>q.error);const err=src.error||(failed?.error as Error|undefined);if(err)return <p>The salaries could not be loaded: {err.message}</p>;
 const items=months.flatMap((m,k)=>{const s=sal[k].data?.salaries.find(v=>v.employeeId===e.id);return s?[{m,s,a:att[k].data?.attendance||undefined}]:[];});
 if(!items.length)return <p>No salary saved for {e.name} ({e.paycode}) from {monthLabel(months[0])} to {monthLabel(months[months.length-1])}.</p>;
 return <>{items.map((it,i)=><div key={it.m}>{i>0&&<div className="rpt-cut"/>}<FormXSlip ctx={ctx} lang="en" d={{e,month:it.m,s:it.s,a:it.a,orig:src.orig(it.m,e),rates:src.rates(e)}}/></div>)}</>;}
const formXPages=(lang:Lang)=>(ctx:ReportContext):ReportPage[]=>{const rows=rowsOf(ctx);if(!rows.length)throw new Error(`No salary saved for ${monthLabel(ctx.month)} for the ticked employees.`);
 return chunk(rows,2).map((group,p)=>({key:`ps${lang}${p}`,orientation:'portrait',trees:group.map(r=>r.e.name),node:<MonthSlips ctx={ctx} items={group} lang={lang}/>}));};
function rangePages(ctx:ReportContext):ReportPage[]{const {fromMonth='',toMonth=''}=ctx.options.fields;if(!fromMonth||!toMonth||fromMonth>toMonth)throw new Error('Choose a From Month on or before the To Month.');
 if(ctx.employees.length>10)throw new Error('Individual From -To Month prints the slips of one employee: tick only that employee (at most 10).');
 const months=monthsBetween(fromMonth,toMonth);return ctx.employees.map(e=>({key:'pr'+e.id,orientation:'portrait',tree:e.name,node:<RangeSlips ctx={ctx} e={e} months={months}/>}));}
export const payslipConfig:ReportConfig={period:'month',filters:[...SAL_FILTERS],withLeft:true,confirm:'Please Check Proper Address',
 fields:[{key:'fromMonth',label:'From Month',kind:'select',place:'middle',default:'2026-04',options:fyMonths},{key:'toMonth',label:'To Month',kind:'select',place:'middle',default:'2026-09',options:fyMonths}],options:[
 {value:'english',label:'Payslip(English)',needs:['salaries','attendance'],build:formXPages('en')},
 {value:'hindi',label:'Payslip(Hindi)',needs:['salaries','attendance'],build:formXPages('hi')},
 {value:'individual',label:'Individual From -To Month',note:'Prints the slips of every saved month from From Month to To Month for the ticked employee.',build:rangePages}]};

// P.F. / E.S.I. detail from the saved salary: recorded deductions only; no contribution is calculated.
function statutory(kind:'PF'|'ESI'):ReportConfig{
 const find=(s:SalarySnapshot,label:string)=>s.deductions.find(d=>d.label.trim().toUpperCase()===label)?.amount??null;
 const cols:Column[]=[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:`${kind} No.`},{h:'P.Day',cls:'num'},{h:'Gross',cls:'num'},{h:`${kind} (recorded)`,cls:'num'},...(kind==='PF'?[{h:'VPF (recorded)',cls:'num'}]:[])];
 const line=(ctx:ReportContext,r:Row,i:number)=>{const x=extraOf(ctx,r.e);return [i+1,r.e.paycode,r.e.name,(kind==='PF'?x?.pfNo:x?.esiNo)||'',r.s.payableDays??'',n2(r.s.gross),n2(find(r.s,kind)),...(kind==='PF'?[n2(find(r.s,'VPF'))]:[])];};
 const pages=(ctx:ReportContext,onlyNumbered:boolean)=>{const rows=rowsOf(ctx).filter(r=>!onlyNumbered||((kind==='PF'?extraOf(ctx,r.e)?.pfNo:extraOf(ctx,r.e)?.esiNo)||'').trim());
  return tablePages(ctx,{key:kind+onlyNumbered,title:`${kind==='PF'?'P.F.':'E.S.I.'} Detail`,subtitle:subtitle(ctx),perPage:30,columns:cols,rows:rows.map((r,i)=>line(ctx,r,i)),totals:['','Total','','','',n2(sum(rows.map(r=>r.s.gross))),n2(sum(rows.map(r=>find(r.s,kind)))),...(kind==='PF'?[n2(sum(rows.map(r=>find(r.s,'VPF'))))]:[])]});};
 return {period:'month',filters:[...SAL_FILTERS],resignMode:true,note:`${kind} amounts are the deductions saved with each salary. Employer contributions need the confirmed rules.`,options:[
  {value:'all',label:`${kind} Detail (all employees)`,needs:['salaries'],build:ctx=>pages(ctx,false),excel:ctx=>[cols.map(c=>String(c.h)),...rowsOf(ctx).map((r,i)=>line(ctx,r,i).map(v=>typeof v==='number'?v:String(v??'')))]},
  {value:'numbered',label:`Only employees with ${kind} No.`,needs:['salaries'],build:ctx=>pages(ctx,true)}]};
}
export const pfConfig=statutory('PF');
export const esiConfig=statutory('ESI');
