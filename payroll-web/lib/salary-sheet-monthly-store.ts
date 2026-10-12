import {monthNo} from './dataset-year';
import {hrRows,hrSettings} from './hr-store';
import {db,decoded,visibleImport} from './server-store';
import {loadMasterRows} from './master-store';
import {masterDefs} from './masters';
import {loadEmployeeExtras} from './employee-extras-store';
import {readSourceTable} from './source-archive';
import {buildRules,makeCalculator} from './salary-calc-core';
import {monthDays,type Employee,type AttendanceMonth} from './payroll';
import type {SalarySnapshot} from './backup';
import {generateMonthlySheets,type MonthlyBasis} from './salary-sheet-monthly';
import type {SheetDocument} from './salary-sheets';

export async function loadMonthlySheets(owner:string,dataset:string,month:string,comparisonMonth:string,scope:string,references:Record<string,SheetDocument>){
 const names=['tbsal','tbearn','tbded','tbempsal','tbshiftset','tbpfesi','tbsalrule'];
 const [loaded,extras,history,employees,attendance,salaries,months]=await Promise.all([
  Promise.all(names.map(table=>loadMasterRows(owner,dataset,masterDefs[table]))),loadEmployeeExtras(owner,dataset),readSourceTable(owner,dataset,'tbmonth_hist',200000),
  db().prepare(`SELECT data,revision,dataset FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND ${visibleImport} ORDER BY paycode COLLATE NOCASE`).bind(owner,dataset).all<{data:string;revision:number;dataset:string}>(),
  db().prepare(`SELECT data,revision FROM attendance WHERE owner=? AND month IN (?,?) AND ${visibleImport}`).bind(owner,month,comparisonMonth).all<{data:string;revision:number}>(),
  db().prepare(`SELECT data FROM salary_snapshots WHERE owner=? AND month IN (?,?) AND ${visibleImport}`).bind(owner,month,comparisonMonth).all<{data:string}>(),
  db().prepare(`SELECT a.month FROM attendance a JOIN employees e ON e.id=a.employee_id AND e.owner=a.owner WHERE a.owner=? AND e.dataset=? AND e.deleted=0 UNION SELECT s.month FROM salary_snapshots s JOIN employees e ON e.id=s.employee_id AND e.owner=s.owner WHERE s.owner=? AND e.dataset=? AND e.deleted=0 ORDER BY month`).bind(owner,dataset,owner,dataset).all<{month:string}>()
 ]);
 const masters=Object.fromEntries(names.map((n,i)=>[n,loaded[i].rows]));const rules=buildRules(dataset,masters.tbpfesi[0]?.values,masters.tbsalrule[0]?.values);
 const emps=employees.results.map(decoded) as Employee[],ids=new Set(emps.map(e=>e.id));
 const att=(attendance.results.map(decoded) as AttendanceMonth[]).filter(a=>ids.has(a.employeeId));
 const saved=salaries.results.map(r=>JSON.parse(r.data) as SalarySnapshot).filter(s=>ids.has(s.employeeId));
 // Salary history carries each historical month's effective rates. Today's master rates are used for new months.
 const historic=new Map<string,Map<string,{month:number;rates:Record<string,number>}>>();
 if(history){const cols=new Map(history.columns.map((c,i)=>[c.name,i]));const read=(r:(string|null)[],col:string)=>r[cols.get(col)??-1]?.trim()||'';
  for(const row of history.rows){const key=read(row,'emp_code'),no=Number(read(row,'month_no'));if(!key||!Number.isInteger(no)||no<1)continue;const rates:Record<string,number>={};for(let n=1;n<=15;n++){const label=read(row,'earnn'+n);if(label)rates[label]=Number(read(row,'earnr'+n))||0;}if(!historic.has(key))historic.set(key,new Map());historic.get(key)!.set(String(no),{month:no,rates});}
 }
 function basis(target:string){
  const byAtt=new Map(att.filter(a=>a.month===target).map(a=>[a.employeeId,a])),bySalary=new Map(saved.filter(s=>s.month===target).map(s=>[s.employeeId,s]));
  const targetNo=monthNo(dataset,target);
  const calc=makeCalculator({rates:masters.tbsal,earn:masters.tbearn,ded:masters.tbded,overrides:masters.tbempsal,otSlabs:masters.tbshiftset,extras,attendance:[...byAtt.values()],hr},rules,target);
  return emps.map(e=>{
   const s=bySalary.get(e.id),h=historic.get(String(e.sourceKey||e.id));const entries=[...(h?.values()||[])].sort((a,b)=>b.month-a.month),historical=entries.find(h=>h.month<=targetNo);
   const entered=s?.earnings.some(h=>h.rate!=null)?Object.fromEntries(s.earnings.filter(h=>h.rate!=null).map(h=>[h.label,h.rate!])):targetNo<=Math.max(0,...entries.map(h=>h.month))?historical?.rates:undefined;
   const calculated=calc(e,entered?{rates:entered}:{});
   const rate=entered?Object.values(entered).reduce((s,n)=>s+n,0):calculated.result.earnings.reduce((s,h)=>s+(h.rate||0),0);
   const rateEdited=masters.tbsal.some(r=>r.origin!=='original'&&String(r.values.emp_code||'').trim()===String(e.sourceKey||e.id));
   return {employee:e,attendance:byAtt.get(e.id),salary:s,calculated,rate,rateEdited,extra:extras[String(e.sourceKey||e.id)],divisor:rules.monthlyDivisor==='monthDays'?monthDays(target):Number(rules.monthlyDivisor)} as MonthlyBasis;
  });
 }
 const hr={settings:(await hrSettings(owner,dataset)).settings,records:await hrRows(owner,dataset)};
 const current=basis(month),prior=basis(comparisonMonth).filter(b=>b.attendance||b.salary);
 const result=generateMonthlySheets(dataset,month,current,prior,scope,references,comparisonMonth);
 const scopes=[{value:'format',label:'Employees assigned to this sample format'},{value:'all',label:'All employees in selected company'},...[...new Set(emps.map(e=>e.department).filter(Boolean))].sort().map(s=>({value:'department:'+s,label:'Department — '+s})),...[...new Set(emps.map(e=>e.subCompany).filter(Boolean))].sort().map(s=>({value:'subCompany:'+s,label:'Sub-company — '+s}))];
 return {...result,availableMonths:months.results.map(m=>m.month),scopes,currentRecords:current.filter(b=>b.salary||b.attendance).length,previousRecords:prior.length};
}
