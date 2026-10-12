import type {Employee,AttendanceMonth} from './payroll';
import type {SalarySnapshot} from './backup';
import type {HrRecord,HrSettings} from './hrm';
import {loanOutstanding} from './hr-loan';
const money=(n:number)=>Math.round(n*100)/100;
export function servicePeriod(from:string,to:string){if(!from||!to||from>to)return {years:0,months:0};const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);let years=end.getUTCFullYear()-start.getUTCFullYear(),months=end.getUTCMonth()-start.getUTCMonth();if(end.getUTCDate()<start.getUTCDate())months--;if(months<0){years--;months+=12;}return {years:Math.max(0,years),months:Math.max(0,months)};}
export function calculateSettlement(e:Employee,exit:HrRecord,salary:SalarySnapshot|undefined,attendance:AttendanceMonth|undefined,records:HrRecord[],rules:HrSettings,daily=false){
 if(exit.status==='settled'&&exit.data.settlement)return exit.data.settlement as Settlement;
 const last=String(exit.data.lastWorkingDate),rate=salary?.earnings.filter(h=>h.rate!=null).reduce((n,h)=>n+Math.max(0,h.rate||0),0)||0;
 const monthlyRate=daily?rate*rules.fnfDivisor:rate;const service=servicePeriod(e.doj,last),serviceYears=service.years+(service.months>=rules.gratuityRoundMonths?1:0);
 const leaveDays=exit.data.leaveDays!==''&&exit.data.leaveDays!=null?Number(exit.data.leaveDays):Math.max(0,Number(attendance?.leaveLedger.find(l=>l.code===rules.encashLeaveCode)?.balance||0));
 const loans=records.filter(r=>r.module==='loan'&&r.employeeId===e.id&&r.status==='approved').map(r=>({id:r.id,amount:loanOutstanding(r,records)})).filter(r=>r.amount>0);
 const unpaidExpenses=records.filter(r=>r.module==='expenses'&&r.employeeId===e.id&&r.status==='approved'&&String(r.data.date)<=last).map(r=>({id:r.id,amount:Number(r.data.amount||0)}));
 const served=Math.max(0,(Date.parse(last+'T00:00:00Z')-Date.parse(String(exit.data.requestDate)+'T00:00:00Z'))/86400000+1);
 const leaveEncashment=money(leaveDays*monthlyRate/rules.fnfDivisor),gratuity=service.years>=rules.gratuityMinimumYears?money(rules.gratuityDays/rules.gratuityDivisor*monthlyRate*serviceYears):0,loanRecovery=money(loans.reduce((s,r)=>s+r.amount,0)),expenseReimbursement=money(unpaidExpenses.reduce((s,r)=>s+r.amount,0)),noticeRecovery=money(Math.max(0,Number(exit.data.noticeDays||0)-served)*rules.noticeRecoveryRate),adjustment=Number(exit.data.adjustment||0),salaryNet=salary?.net??0;
 const pending:string[]=[];if(!salary||salary.net==null)pending.push('Prepare last-month salary first');if((leaveDays>0||service.years>=rules.gratuityMinimumYears)&&!monthlyRate)pending.push('Saved fixed earning rates are required');
 return {lastWorkingDate:last,salaryNet,monthlyRate,serviceYears,leaveDays,leaveEncashment,gratuity,loanRecovery,expenseReimbursement,noticeRecovery,adjustment,finalPayable:money(salaryNet+leaveEncashment+gratuity+expenseReimbursement-loanRecovery-noticeRecovery+adjustment),loans,unpaidExpenses,pending};
}
export type Settlement={lastWorkingDate:string;salaryNet:number;monthlyRate:number;serviceYears:number;leaveDays:number;leaveEncashment:number;gratuity:number;loanRecovery:number;expenseReimbursement:number;noticeRecovery:number;adjustment:number;finalPayable:number;loans:{id:string;amount:number}[];unpaidExpenses:{id:string;amount:number}[];pending:string[]};
