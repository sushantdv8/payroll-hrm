// Salary calculation rules recovered from the original software's saved salary history
// (KISHOR EXPORT om_01_26 / om_02_26, Jan–Aug 2026). Match rates found when recomputing the history:
//  earnings  monthly (sal_mode 0): round(rate × payable days ÷ 30) om_01 1067/1067; ÷ month days om_02 256/257
//            daily (sal_mode 1, 2): round(rate × payable days)                     om_01 830/830, om_02 696/696
//  PF        only when the employee's PF flag is on; wages = min(earned PF heads, Rate 2 of PF heads, 15000) 286/288
//            employee = round(wages × 12%); pension = round(min(wages,15000) × 8.33%); employer PF = employee − pension
//  ESI       only when the employee's ESI flag is on; wages = earned ESI heads; employee = ceil(wages × ESI%), employer = round(wages × ESI employer%) 426/426
//  net       = total earnings − total deductions (exact in all 2,850 saved months)
// OT, food, tea and incentive were never used in the saved history (all amounts 0), so their rules are
// settings with standard defaults: OT at twice the ordinary hourly wage (Factories Act s.59), allowances per present day.
export type SalaryRules={monthlyDivisor:'30'|'monthDays'|'26';pfEmployeePct:number;pensionPct:number;pfWageLimit:number;pensionWageLimit:number;esiEmployeePct:number;esiEmployerPct:number;esiRounding:'ceil'|'round';useRate2ForPf:boolean;
 otRateType:'double'|'single'|'fixed';otHoursPerDay:number;otBands:boolean;allowanceBasis:'present'|'payable'|'month';allowancesInEsi:boolean};
export type EngineHead={code:string;label:string;rate1:number;rate2:number;pf:boolean;esi:boolean};
export type EngineAllowance={label:string;on:boolean;rate:number};
// arrears: amount added to a head's earning (by head label); pfWages / esiWages: wages entered by hand in place of the calculated ones.
export type EngineInput={heads:EngineHead[];deductionHeads:{code:string;label:string}[];payableDays:number;monthDays:number;salMode:string;pfApplies:boolean;esiApplies:boolean;otherDeductions?:Record<string,number>;
 presentDays?:number;ot?:{on:boolean;hours:number;fixedRate:number;esiOnOt:boolean};allowances?:EngineAllowance[];arrears?:Record<string,number>;pfWages?:number|null;esiWages?:number|null};
export type EngineResult={earnings:{label:string;amount:number;rate?:number;arrear?:number}[];deductions:{label:string;amount:number}[];gross:number;totalDeductions:number;net:number;pf:{wages:number;employee:number;pension:number;employer:number};esi:{wages:number;employee:number;employer:number};ot:{hours:number;hourlyRate:number;amount:number};steps:string[]};

export const defaultRules=(dataset:string,pfesi?:Record<string,string|null>):SalaryRules=>{const num=(k:string,d:number)=>{const v=Number(String(pfesi?.[k]??'').trim());return Number.isFinite(v)&&String(pfesi?.[k]??'').trim()!==''?v:d;};
 return {monthlyDivisor:dataset==='om_02_26'?'monthDays':'30',pfEmployeePct:num('pf_ac1_pee',12),pensionPct:num('pf_ac10_p',8.33),pfWageLimit:num('pf_le',15000),pensionWageLimit:num('fpf_lr',15000),esiEmployeePct:num('esi_pe',0.75),esiEmployerPct:num('esi_pr',3.25),esiRounding:'ceil',useRate2ForPf:true,
  otRateType:'double',otHoursPerDay:8,otBands:true,allowanceBasis:'present',allowancesInEsi:true};};
// Present days for food / tea: each half marked P or OD counts 0.5.
export function presentFromMarks(days:{first:string;second:string}[]){return days.reduce((s,d)=>s+(['P','OD'].includes(d.first)?0.5:0)+(['P','OD'].includes(d.second)?0.5:0),0);}
// Rounds one day's OT minutes by the shift's OT slabs (Shift Ot Setup, day type 0): minutes within [min,max] are paid as the slab's value.
export function roundOtMinutes(minutes:number,bands:{min:number;max:number;paid:number}[]){if(minutes<=0)return 0;const b=bands.find(x=>minutes>=x.min&&minutes<=x.max);return b?b.paid:minutes;}
export const salaryModes=[{value:'0',label:'Monthly'},{value:'1',label:'Daily'},{value:'2',label:'Daily (2)'}];
// Paid weight of each attendance half from the original status dictionary (tbattd): 0.5 = paid half day.
const paidMarks=new Set(['P','OD','WO','HD','EL','PL','CL','SL','CO','MT','SP']);
export function payableFromMarks(days:{first:string;second:string}[]){return days.reduce((s,d)=>s+(paidMarks.has(d.first)?0.5:0)+(paidMarks.has(d.second)?0.5:0),0);}
const r2=(n:number)=>Math.round(n*100)/100;
// .NET Math.Round default (midpoint to even), which is what the saved history matches.
const roundToEven=(n:number)=>{const f=Math.floor(n);const d=n-f;if(Math.abs(d-0.5)<1e-9)return f%2===0?f:f+1;return Math.round(n);};

export function computeSalary(input:EngineInput,rules:SalaryRules):EngineResult{
 const steps:string[]=[];const daily=input.salMode==='1'||input.salMode==='2';
 const divisor=daily?1:rules.monthlyDivisor==='monthDays'?input.monthDays:Number(rules.monthlyDivisor);
 steps.push(daily?`Daily rate: amount = rate × ${input.payableDays} payable days`:`Monthly rate: amount = rate × ${input.payableDays} payable days ÷ ${divisor}`);
 const earnings:{label:string;amount:number;pf:boolean;esi:boolean;rate2:number;rate?:number;arrear?:number}[]=input.heads.map(h=>{const arrear=input.arrears?.[h.label]||0;
  return {label:h.label,amount:(h.rate1>0?roundToEven(h.rate1*input.payableDays/divisor):0)+arrear,pf:h.pf,esi:h.esi,rate2:h.rate2,rate:h.rate1,arrear};});
 if(Object.values(input.arrears||{}).some(Boolean))steps.push(`Arrears added: ${Object.entries(input.arrears!).filter(([,v])=>v).map(([k,v])=>`${k} ${v}`).join(', ')}`);
 // Overtime: hours × hourly rate; ordinary hourly wage = daily wage ÷ hours per day (daily wage = monthly rate ÷ divisor for monthly-rated staff).
 let ot={hours:0,hourlyRate:0,amount:0};
 if(input.ot?.on&&input.ot.hours>0){const rate=input.heads.reduce((s,h)=>s+h.rate1,0);const dailyWage=daily?rate:rate/divisor;const ordinary=dailyWage/rules.otHoursPerDay;
  const hourlyRate=rules.otRateType==='fixed'?input.ot.fixedRate:ordinary*(rules.otRateType==='double'?2:1);ot={hours:input.ot.hours,hourlyRate:r2(hourlyRate),amount:roundToEven(hourlyRate*input.ot.hours)};
  earnings.push({label:'O.T. Amount',amount:ot.amount,pf:false,esi:input.ot.esiOnOt,rate2:0});
  steps.push(`OT ${input.ot.hours} h × ₹${ot.hourlyRate}/h (${rules.otRateType==='fixed'?'employee O.T. rate':`${rules.otRateType==='double'?'twice':'once'} the ordinary hourly wage, ${rules.otHoursPerDay} h a day`}) = ${ot.amount}`);}
 for(const a of input.allowances||[]){if(!a.on||a.rate<=0)continue;const qty=rules.allowanceBasis==='month'?1:rules.allowanceBasis==='payable'?input.payableDays:(input.presentDays??input.payableDays);const amount=roundToEven(a.rate*qty);
  earnings.push({label:a.label,amount,pf:false,esi:rules.allowancesInEsi,rate2:0});steps.push(`${a.label} = ₹${a.rate} × ${rules.allowanceBasis==='month'?'1 month':`${qty} ${rules.allowanceBasis==='payable'?'payable':'present'} days`} = ${amount}`);}
 const gross=earnings.reduce((s,e)=>s+e.amount,0);
 let pf={wages:0,employee:0,pension:0,employer:0};
 if(input.pfApplies){const pfHeads=earnings.filter(e=>e.pf);const earned=pfHeads.reduce((s,e)=>s+e.amount,0);const rate2=pfHeads.reduce((s,e)=>s+e.rate2,0);const arrearPf=pfHeads.reduce((s,e)=>s+(e.arrear||0),0);
  // Rate 2 caps the month's own earning only; an arrear on a PF head is added on top (up to the PF wage limit).
  const wages=input.pfWages!=null?input.pfWages:Math.min(Math.min(earned-arrearPf,rules.useRate2ForPf&&rate2>0?rate2:Infinity)+arrearPf,rules.pfWageLimit);const employee=roundToEven(wages*rules.pfEmployeePct/100);const pension=roundToEven(Math.min(wages,rules.pensionWageLimit)*rules.pensionPct/100);
  const cap=rules.useRate2ForPf&&rate2>0?`, Rate 2 ${rate2}`:'';
  const formula=arrearPf?`min(min(own PF earning ${earned-arrearPf}${cap}) + arrear ${arrearPf}, ${rules.pfWageLimit})`:`min(earned PF heads ${earned}${cap}, ${rules.pfWageLimit})`;
  pf={wages,employee,pension,employer:employee-pension};steps.push(`PF wages = ${input.pfWages!=null?`entered ${wages}`:`${formula} = ${wages}`}; PF ${rules.pfEmployeePct}% = ${employee}`);}
 let esi={wages:0,employee:0,employer:0};
 if(input.esiApplies){const wages=input.esiWages!=null?input.esiWages:earnings.filter(e=>e.esi).reduce((s,e)=>s+e.amount,0);const raw=wages*rules.esiEmployeePct/100;const employee=rules.esiRounding==='ceil'?Math.ceil(r2(raw)):roundToEven(raw);
  esi={wages,employee,employer:roundToEven(wages*rules.esiEmployerPct/100)};steps.push(`ESI wages = ${wages}; ESI ${rules.esiEmployeePct}% (${rules.esiRounding==='ceil'?'rounded up':'rounded'}) = ${employee}`);}
 const deductions=input.deductionHeads.map(d=>{const name=d.label.trim().toUpperCase();const amount=name==='PF'?pf.employee:name==='ESI'?esi.employee:(input.otherDeductions?.[d.label]||0);return {label:d.label,amount};});
 const totalDeductions=r2(deductions.reduce((s,d)=>s+d.amount,0));
 return {earnings:earnings.map(({label,amount,rate,arrear})=>rate===undefined?{label,amount}:{label,amount,rate,arrear:arrear||0}),deductions,gross:r2(gross),totalDeductions,net:r2(gross-totalDeductions),pf,esi,ot,steps};
}
