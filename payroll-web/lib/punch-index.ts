import {monthIndex} from './month-index';

// Machine punches of an imported dataset (original tbtime idt/odt) for one month: each employee (original emp_code)
// maps to one entry per day, "in|out", or '' when the machine has no punch for that day.
export type MonthPunches=Record<string,string[]>;

export function monthPunches(owner:string,dataset:string,monthNo:number):Promise<MonthPunches>{
 return monthIndex(owner,dataset,'tbtime','v1',monthNo,cell=>{const days=Array.from({length:31},(_,k)=>{const a=cell('idt'+(k+1)),b=cell('odt'+(k+1));return a||b?a+'|'+b:'';});return days.some(Boolean)?days:null;});
}
