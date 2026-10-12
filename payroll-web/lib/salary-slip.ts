import {monthIndex} from './month-index';

// The salary the original software saved for one employee-month (tbmonth_hist), as Salary Preparation shows it:
// per earning head the rate, the amount earned and the arrear; the deductions; paid days, PF / ESI wages and OT.
export type OriginalSlip={heads:{label:string;rate:number;earn:number;arrear:number}[];deductions:{label:string;amount:number}[];
 paidDays:number;pfWages:number;esiWages:number;otHours:number;otRate:number;otAmount:number;totals:{rate:number;earn:number;arrear:number;deduction:number;net:number}};

const n=(v:string)=>{const x=Number(v);return Number.isFinite(x)?x:0;};
export function monthSlips(owner:string,dataset:string,monthNo:number):Promise<Record<string,OriginalSlip>>{
 return monthIndex(owner,dataset,'tbmonth_hist','v1',monthNo,cell=>{
  const heads=Array.from({length:15},(_,k)=>({label:cell('earnn'+(k+1)),rate:n(cell('earnr'+(k+1))),earn:n(cell('earn'+(k+1))),arrear:n(cell('earr'+(k+1)))})).filter(h=>h.label);
  const deductions=Array.from({length:15},(_,k)=>({label:cell('dedn'+(k+1)),amount:n(cell('ded'+(k+1)))})).filter(d=>d.label);
  if(!heads.length&&!deductions.length)return null;
  return {heads,deductions,paidDays:n(cell('pday')),pfWages:n(cell('pfwages')),esiWages:n(cell('esiwages')),otHours:n(cell('othrs1')),otRate:n(cell('otrate1')),otAmount:n(cell('otamt1')),
   totals:{rate:n(cell('totrate')),earn:n(cell('totearn')),arrear:n(cell('totarr')),deduction:n(cell('totded')),net:n(cell('netsal'))}};});
}
