import type {HrPayrollContext} from '@/lib/hr-payroll';
'use client';
import {useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Calculator} from 'lucide-react';
import type {AttendanceMonth,Employee} from '@/lib/payroll';
import type {MasterRow} from '@/lib/masters';
import {salaryModes,type SalaryRules} from '@/lib/salary-engine';
import {buildRules,makeCalculator,type Calculated,type CalcOverrides} from '@/lib/salary-calc-core';
import type {Extra} from '@/lib/report-utils';
import {requestJson} from '@/lib/client-api';
import {Button} from '@/components/ui/button';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {ErrorMessage} from './payroll-controls';
import {MasterEntry} from './master-entry';

const masters=(dataset:string,table:string)=>({queryKey:['masters',dataset,table],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset,table}),{signal}),refetchOnWindowFocus:false});

export function useRules(dataset:string){
 const pfesi=useQuery(masters(dataset,'tbpfesi'));const rule=useQuery(masters(dataset,'tbsalrule'));
 const rules=useMemo<SalaryRules>(()=>buildRules(dataset,pfesi.data?.rows[0]?.values,rule.data?.rows[0]?.values),[dataset,pfesi.data,rule.data]);
 // A failed load is not "ready": salaries must not be calculated with default PF / ESI settings in its place.
 return {rules,ready:pfesi.isSuccess&&rule.isSuccess,error:(pfesi.error||rule.error||undefined) as Error|undefined,saved:!!rule.data?.rows.length};
}

export type {Calculated,CalcOverrides};
// Gathers rates, heads, employee salary settings and the month's attendance, and returns a calculator per employee.
export function useSalaryCalculator(dataset:string,month:string){
 const {rules,ready:rulesReady,error:rulesError}=useRules(dataset);
 const rates=useQuery(masters(dataset,'tbsal'));const earn=useQuery(masters(dataset,'tbearn'));const ded=useQuery(masters(dataset,'tbded'));const overrides=useQuery(masters(dataset,'tbempsal'));const otSlabs=useQuery(masters(dataset,'tbshiftset'));
 const extras=useQuery({queryKey:['employee-extras',dataset],queryFn:({signal})=>requestJson<{extras:Record<string,Extra>}>('/api/employee-extras?'+new URLSearchParams({dataset}),{signal}),refetchOnWindowFocus:false,staleTime:600000});
 const attendance=useQuery({queryKey:['report','attendance',dataset,month],queryFn:({signal})=>requestJson<{attendance:AttendanceMonth[]}>('/api/records?'+new URLSearchParams({month,dataset}),{signal}),refetchOnWindowFocus:false});
 // Every input has to load: a failed query (status 'error' is not pending) would otherwise drop heads, rates or settings silently.
 const hr=useQuery({queryKey:['hr-payroll',dataset,month],queryFn:({signal})=>requestJson<HrPayrollContext>('/api/hr-payroll?'+new URLSearchParams({dataset,month}),{signal}),refetchOnWindowFocus:false});
 const ready=rulesReady&&hr.isSuccess&&[rates,earn,ded,overrides,extras,attendance,otSlabs].every(q=>q.isSuccess);
 const error=(rulesError||hr.error||[rates,earn,ded,overrides,extras,attendance,otSlabs].find(q=>q.error)?.error||undefined) as Error|undefined;
 const extraMap=extras.data?.extras;
 const calc=useMemo(()=>makeCalculator({rates:rates.data?.rows||[],earn:earn.data?.rows||[],ded:ded.data?.rows||[],overrides:overrides.data?.rows||[],otSlabs:otSlabs.data?.rows||[],extras:extraMap,attendance:attendance.data?.attendance||[],hr:hr.data},rules,month),[rates.data,earn.data,ded.data,overrides.data,extraMap,attendance.data,otSlabs.data,rules,month,hr.data]);
 return {calc,ready,error,rules};
}

type Check={stats:{rows:number;earnings:number;pf:number;esi:number;net:number;monthlyRows:number;byDivisor:Record<string,number>};samples:{emp:string;month:number;field:string;saved:number;calculated:number}[]};
const pct=(a:number,b:number)=>b?`${a} of ${b} (${(a/b*100).toFixed(1)}%)`:'—';

export function SalaryRulesPanel({dataset,employees}:{dataset:string;employees:Employee[]}){
 const {rules}=useRules(dataset);const [check,setCheck]=useState<Check|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function run(){setBusy(true);setError('');try{setCheck(await requestJson<Check>('/api/salary-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataset,rules})}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <>
  <section className="panel"><div className="panel-toolbar"><div><h2>Rules in use</h2><p className="subtle">Recovered from the original software&apos;s saved salaries. PF / ESI percentages and limits come from Master Entry › Setup Entry › PF / ESI setup.</p></div></div>
   <div className="section-help"><ul className="rule-list">
    <li><b>Monthly rate:</b> amount = rate × payable days ÷ {rules.monthlyDivisor==='monthDays'?'days in the month':rules.monthlyDivisor}, rounded to the rupee.</li>
    <li><b>Daily rate:</b> amount = rate × payable days, rounded to the rupee.</li>
    <li><b>Payable days:</b> P.Day of the month&apos;s attendance (or counted from the day marks when P.Day is blank).</li>
    <li><b>PF</b> (employees with PF on): wages = the month&apos;s own earning on PF heads{rules.useRate2ForPf?' (at most Rate 2 of the PF heads)':''} plus any arrear on PF heads, up to ₹{rules.pfWageLimit}; employee {rules.pfEmployeePct}%; pension {rules.pensionPct}% of wages up to ₹{rules.pensionWageLimit}; employer PF = employee PF − pension.</li>
    <li><b>ESI</b> (employees with ESI on): wages = earned ESI heads; employee {rules.esiEmployeePct}% {rules.esiRounding==='ceil'?'rounded up':'rounded'}; employer {rules.esiEmployerPct}%.</li>
    <li><b>Overtime</b> (employees with Over time Allow on): OT hours = the month&apos;s daily OT Hr{rules.otBands?' after the Shift Ot Setup slabs of the employee\'s shift':''}, limited by the employee&apos;s OT limit; amount = hours × {rules.otRateType==='fixed'?"the employee's O.T. rate":`${rules.otRateType==='double'?'twice':'once'} the ordinary hourly wage (daily wage ÷ ${rules.otHoursPerDay} h)`}. {rules.otRateType==='double'?'Twice the ordinary rate is the Factories Act (section 59) rule.':''} OT is added to ESI wages only when the employee&apos;s ESI on OT is on; never to PF.</li>
    <li><b>Food / Tea / Incentive</b> (when the employee&apos;s Allow is on): rate × {rules.allowanceBasis==='month'?'1 (once a month)':rules.allowanceBasis==='payable'?'payable days':'present days (P / OD halves count 0.5)'}{rules.allowancesInEsi?'; included in ESI wages':''}.</li>
    <li className="subtle">The saved history has no overtime, food, tea or incentive amounts, so these two rules are standard defaults — change them below if your company pays differently.</li>
    <li><b>Net salary</b> = total earnings − total deductions. Other deductions (loan, advance, TDS…) are entered on the salary.</li>
    <li>Rounding follows the original (.NET) rounding: exact halves go to the even rupee.</li></ul></div>
   <div className="section-help"><Button onClick={run} disabled={busy}><Calculator size={16}/>{busy?'Checking…':'Check rules against saved salary history'}</Button></div>
   {error&&<ErrorMessage message={error}/>}
   {check&&<div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Check ({check.stats.rows} saved salary months)</TableHead><TableHead>Matches the original</TableHead></TableRow></TableHeader><TableBody>
    <TableRow><TableCell>Earnings (every head)</TableCell><TableCell>{pct(check.stats.earnings,check.stats.rows)}</TableCell></TableRow>
    <TableRow><TableCell>PF (employee)</TableCell><TableCell>{pct(check.stats.pf,check.stats.rows)}</TableCell></TableRow>
    <TableRow><TableCell>ESI (employee)</TableCell><TableCell>{pct(check.stats.esi,check.stats.rows)}</TableCell></TableRow>
    <TableRow><TableCell><b>Net salary</b></TableCell><TableCell><b>{pct(check.stats.net,check.stats.rows)}</b></TableCell></TableRow>
    {check.stats.monthlyRows>0&&Object.entries(check.stats.byDivisor).map(([d,v])=><TableRow key={d}><TableCell>Monthly rates ÷ {d==='monthDays'?'days in month':d}</TableCell><TableCell>{pct(v,check.stats.monthlyRows)}</TableCell></TableRow>)}
   </TableBody></Table>{check.samples.length>0&&<p className="section-help">Examples that differ: {check.samples.slice(0,8).map(s=>`${s.emp} (month ${s.month}, ${s.field}: saved ${s.saved}, calculated ${s.calculated})`).join('; ')}</p>}</div>}
  </section>
  <div className="space-top"><MasterEntry bare dataset={dataset} employees={employees} title="Salary rules" tables={['tbsalrule']} note="Change the divisor or rounding here if your company uses a different rule. Without a saved setting the rules above apply."/></div>
 </>;
}
export {salaryModes};
