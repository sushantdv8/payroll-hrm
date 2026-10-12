import {effectiveRevision,weightedRevisionRates,parseSalaryRates,hourSalaryBasis,applyHrPayroll,type HrPayrollContext,type HrPayrollExtras} from './hr-payroll';
import {minutesValue} from './hrm';
import type {AttendanceMonth,Employee} from './payroll';
import {monthDays} from './payroll';
import {trimCell,type MasterRow} from './masters';
import {computeSalary,defaultRules,payableFromMarks,presentFromMarks,roundOtMinutes,type EngineResult,type SalaryRules} from './salary-engine';
import type {Extra} from './report-utils';

// The salary calculator of Salary Preparation, without React: given the loaded masters it returns a function that works one
// employee's month out. The Salary Comparison report uses it too, for months whose salary has not been saved yet.
const num=(v:string|null|undefined)=>{const n=Number(trimCell(v));return Number.isFinite(n)?n:0;};

export function buildRules(dataset:string,pfesi?:Record<string,string|null>,rule?:Record<string,string|null>):SalaryRules{
 const base=defaultRules(dataset,pfesi);const r=rule;if(!r)return base;
 const pick=<T extends string>(v:string,allowed:readonly T[],d:T)=>(allowed as readonly string[]).includes(v)?v as T:d;const hours=num(r.ot_hours);
 return {...base,monthlyDivisor:pick(trimCell(r.div),['30','monthDays','26'] as const,base.monthlyDivisor),esiRounding:trimCell(r.esi_round)==='round'?'round':'ceil',useRate2ForPf:trimCell(r.pf_rate2)!=='0',
  otRateType:pick(trimCell(r.ot_type),['double','single','fixed'] as const,base.otRateType),otHoursPerDay:hours>0?hours:base.otHoursPerDay,otBands:trimCell(r.ot_bands)!=='0',allowanceBasis:pick(trimCell(r.alw_basis),['present','payable','month'] as const,base.allowanceBasis),allowancesInEsi:trimCell(r.alw_esi)!=='0'};
}

export type Calculated={result:EngineResult;payableDays:number;salMode:string;pf:boolean;esi:boolean;hasRates:boolean;daysSource:string;otHours:number;otOn:boolean;hr:HrPayrollExtras};
// Values entered on the Salary Preparation form in place of the calculated ones.
export type CalcOverrides={payableDays?:number;rates?:Record<string,number>;arrears?:Record<string,number>;otherDeductions?:Record<string,number>;pfWages?:number|null;esiWages?:number|null;otHours?:number};
export type CalcData={rates:MasterRow[];earn:MasterRow[];ded:MasterRow[];overrides:MasterRow[];otSlabs:MasterRow[];extras:Record<string,Extra>|undefined;attendance:AttendanceMonth[];hr?:HrPayrollContext};

// A head with two rate rows takes the LAST one: that is what the original's saved salaries and the employee total use.
export function makeCalculator(data:CalcData,rules:SalaryRules,month:string){
 const byEmp=new Map<string,Map<string,{rate1:number;rate2:number}>>();for(const r of data.rates){const e=trimCell(r.values.emp_code),c=trimCell(r.values.e_code);if(!byEmp.has(e))byEmp.set(e,new Map());byEmp.get(e)!.set(c,{rate1:num(r.values.rt1),rate2:num(r.values.rt2)});}
 const heads=data.earn.map(r=>({code:trimCell(r.values.ern_code),label:trimCell(r.values.ern_name),pf:trimCell(r.values.pf_alw)==='1',esi:trimCell(r.values.esi_alw)==='1'})).sort((a,b)=>Number(a.code)-Number(b.code));
 const dedHeads=data.ded.map(r=>({code:trimCell(r.values.ded_code),label:trimCell(r.values.ded_name)})).sort((a,b)=>Number(a.code)-Number(b.code));
 const over=new Map(data.overrides.map(r=>[trimCell(r.values.emp_code),r.values]));
 const slabs=new Map<string,{min:number;max:number;paid:number}[]>();for(const r of data.otSlabs){if(trimCell(r.values.day_type)!=='0')continue;const s=trimCell(r.values.sft_code);slabs.set(s,[...(slabs.get(s)||[]),{min:num(r.values.mintime),max:num(r.values.maxtime),paid:num(r.values.ret_time)}]);}
 const att=new Map(data.attendance.map(a=>[a.employeeId,a]));const extraMap=data.extras;
 return (e:Employee,given:CalcOverrides={}):Calculated=>{const key=String(e.sourceKey||e.id);const x=key?extraMap?.[key]:undefined;const o=key?over.get(key):undefined;const profile=data.hr?.records.find(r=>r.module==='salary-profile'&&r.employeeId===e.id&&r.status==='approved')?.data;const fixed=profile?parseSalaryRates(String(profile.rates)):undefined;const ownHeads=[...heads];if(fixed)for(const label of Object.keys(fixed))if(!ownHeads.some(h=>h.label.toLowerCase()===label.toLowerCase()))ownHeads.push({code:'hr-'+label,label,pf:/basic/i.test(label),esi:true});
  let salMode=profile?(profile.salaryMode==='Daily'?'1':'0'):o?trimCell(o.sal_mode):x?.salMode||(e.salaryMode==='Daily'?'1':'0');const pf=profile?!!profile.pf:o?trimCell(o.pf_alw)==='1':x?.pfAlw==='1';const esi=profile?!!profile.esi:o?trimCell(o.esi_alw)==='1':x?.esiAlw==='1';
  const a=att.get(e.id);const stored=a?.totals.payable;const unpaidCodes=new Set((data.hr?.records||[]).filter(r=>r.module==='leave-types'&&(!r.unit||r.unit===e.location)&&r.data.paid===false&&r.data.code!=='LWP').map(r=>String(r.data.code)));const unpaidLeave=(a?.days||[]).reduce((n,d)=>n+(unpaidCodes.has(d.first)?.5:0)+(unpaidCodes.has(d.second)?.5:0),0);const payableDays=given.payableDays??Math.max(0,(typeof stored==='number'?stored:a?payableFromMarks(a.days):0)-unpaidLeave);const daysSource=given.payableDays!==undefined?'entered':typeof stored==='number'?'P.Day of the attendance month':a?'counted from the day marks':'no attendance for this month';
  const empRates=byEmp.get(key);const engineHeads=ownHeads.map(h=>{const profileLabel=fixed&&Object.keys(fixed).find(l=>l.toLowerCase()===h.label.toLowerCase()),rate=profileLabel?fixed![profileLabel]:empRates?.get(h.code)?.rate1||0;return {...h,rate1:given.rates?.[h.label]??rate,rate2:fixed?rate:empRates?.get(h.code)?.rate2||0};});
  const revision=data.hr?effectiveRevision(data.hr.records,e.id,month):undefined;
  if(revision){const divisor=rules.monthlyDivisor==='monthDays'?monthDays(month):Number(rules.monthlyDivisor);const base=Object.fromEntries(engineHeads.map(h=>[h.label,h.rate1*(salMode==='1'||salMode==='2'?divisor:1)]));const values=weightedRevisionRates(data.hr!.records,e,month,a,ownHeads.map(h=>h.label),base,data.hr?.settings.salaryBasis==='hours');engineHeads.forEach(h=>{h.rate1=given.rates?.[h.label]??values[h.label];h.rate2=h.rate1;});salMode='0';}
  const hs=data.hr?.settings;let engineDays=payableDays,engineMode=salMode;
  if(hs?.salaryBasis==='hours'){const actualHours=hourSalaryBasis(a,data.hr!.records,e,hs).basePayHours;const divisor=rules.monthlyDivisor==='monthDays'?monthDays(month):Number(rules.monthlyDivisor);if(salMode==='1'||salMode==='2')engineHeads.forEach(h=>{h.rate1*=hs.requiredMonthHours/Math.max(1,hs.requiredDayHours);h.rate2*=hs.requiredMonthHours/Math.max(1,hs.requiredDayHours);});engineMode='0';engineDays=Math.min(actualHours,hs.requiredMonthHours)/hs.requiredMonthHours*divisor;}
  // Employee OT / allowance settings: the entry in Employee salary settings, otherwise the original employee master.
  const val=(col:string,fallback:string|undefined)=>o&&trimCell(o[col])!==''?trimCell(o[col]):(fallback||'');
  const otOn=profile?!!profile.ot:val('ot_alw',x?.otAlw)==='1';const bands=(slabs.get(String(profile?.shiftCode||x?.sft||''))||[]);let otMinutes=0;
  for(const d of a?.days||[]){const m=/^(\d{1,3}):(\d{2})$/.exec(d.ot||'');let mins=m?Number(m[1])*60+Number(m[2]):0,approvedLimit=Infinity;if(hs?.requireOtApproval){const approval=data.hr?.records.filter(r=>r.module==='overtime'&&r.employeeId===e.id&&r.status==='approved'&&r.data.date===month+'-'+String(d.day).padStart(2,'0')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];if(!approval)continue;approvedLimit=Number(approval.data.hours||0)*60;mins=Math.min(mins,approvedLimit);}otMinutes+=Math.min(approvedLimit,rules.otBands&&bands.length?roundOtMinutes(mins,bands):mins);}
  const limit=num(val('ot_limit',x?.otLimit));const computedOt=Math.round((limit>0?Math.min(otMinutes/60,limit):otMinutes/60)*100)/100;const otHours=hs?.requireOtApproval?computedOt:given.otHours??computedOt;
  const allowances=[{label:'Food Allow',on:val('food_alw',x?.foodAlw)==='1',rate:num(val('food1',x?.food1))},{label:'Tea Allow',on:val('tea_alw',x?.teaAlw)==='1',rate:num(val('tea1',x?.tea1))},{label:'Incentive',on:val('incent_alw',x?.incentAlw)==='1',rate:num(val('incent1',x?.incent1))}];
  const employeeRules={...rules};if(profile)for(const [key,target] of [['pfEmployeePct','pfEmployeePct'],['pfLimit','pfWageLimit'],['esiEmployeePct','esiEmployeePct'],['esiEmployerPct','esiEmployerPct']] as const)if(profile[key]!==''&&profile[key]!=null)employeeRules[target]=key==='pfLimit'&&Number(profile[key])===0?1e12:Number(profile[key]);if(profile?.otRate!==''&&profile?.otRate!=null)employeeRules.otRateType='fixed';const ownDed=[...dedHeads];for(const label of ['PF','ESI'])if(!ownDed.some(d=>d.label.toUpperCase()===label))ownDed.push({code:label,label});
  const result=computeSalary({heads:engineHeads,deductionHeads:ownDed,payableDays:engineDays,monthDays:monthDays(month),salMode:engineMode,pfApplies:pf,esiApplies:esi,presentDays:a?presentFromMarks(a.days):0,ot:{on:otOn,hours:otHours,fixedRate:profile?.otRate!==''&&profile?.otRate!=null?Number(profile.otRate):num(val('ot_rate',x?.otRate)),esiOnOt:val('esi_ot',x?.esiOt)==='1'},allowances,arrears:given.arrears,otherDeductions:given.otherDeductions,pfWages:given.pfWages,esiWages:given.esiWages},employeeRules);
  const hr=applyHrPayroll(result,e,a,month,data.hr,engineHeads.reduce((s,h)=>s+h.rate1,0));
  return {result,hr,payableDays,salMode,pf,esi,hasRates:engineHeads.some(h=>h.rate1>0),daysSource,otHours:otOn?otHours:0,otOn};};
}
