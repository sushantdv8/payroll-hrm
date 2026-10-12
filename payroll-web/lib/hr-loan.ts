import type {HrRecord} from './hrm';
export const loanPrincipal=(r:HrRecord)=>Number(r.data.amount||0)*(1+Number(r.data.interestPct||0)/100);
export function loanOutstanding(r:HrRecord,rows:HrRecord[],excludeMonth?:string){return Math.max(0,loanPrincipal(r)-rows.filter(p=>p.module==='loan-payment'&&p.data.loanId===r.id&&p.status==='approved'&&(!excludeMonth||(p.data.sourceSalary?String(p.data.month)<excludeMonth:String(p.data.month)<=excludeMonth))).reduce((s,p)=>s+Number(p.data.amount||0),0));}
