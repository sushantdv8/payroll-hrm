import {datasetYear} from '@/lib/dataset-year';
import {z} from 'zod';
import {ownerId,checkOrigin,fail,readBounded,RequestError,validDataset,drained} from '@/lib/server-store';
import {readSourceTable,type SourceTable} from '@/lib/source-archive';
import {datasetKey} from '@/lib/full-import';
import {computeSalary,type SalaryRules} from '@/lib/salary-engine';
import {hrIdentity,assertHr} from '@/lib/hr-store';
import {employeeScope} from '@/lib/unit-scope';
export const dynamic='force-dynamic';

const rulesSchema=z.object({monthlyDivisor:z.enum(['30','monthDays','26']),pfEmployeePct:z.number(),pensionPct:z.number(),pfWageLimit:z.number(),pensionWageLimit:z.number(),esiEmployeePct:z.number(),esiEmployerPct:z.number(),esiRounding:z.enum(['ceil','round']),useRate2ForPf:z.boolean(),otRateType:z.enum(['double','single','fixed']),otHoursPerDay:z.number().positive(),otBands:z.boolean(),allowanceBasis:z.enum(['present','payable','month']),allowancesInEsi:z.boolean()}).strict();
const rowsOf=(t:SourceTable|null)=>(t?.rows||[]).map(r=>Object.fromEntries(t!.columns.map((c,i)=>[c.name,(r[i]??'').trim()])));
const num=(v:string|undefined)=>{const n=Number(v);return Number.isFinite(n)?n:0;};

// Recomputes the original software's saved monthly salaries with the given rules and reports how many match.
async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);const input=JSON.parse(new TextDecoder().decode(await readBounded(request,20000)));
 const dataset=datasetKey.parse(input?.dataset);await validDataset(owner,dataset);const actor=await hrIdentity(owner);assertHr(actor,dataset,'payroll');const rules=rulesSchema.parse(input?.rules) as SalaryRules;const scope=await employeeScope(owner,dataset,actor);
 const month=input?.month==null?null:z.number().int().min(1).max(12).parse(input.month);
 const [hist,emp,sal,earn,ded]=await Promise.all(['tbmonth_hist','tbemp','tbsal','tbearn','tbded'].map(t=>readSourceTable(owner,dataset,t,200000)));
 if(!hist)throw new RequestError('This company has no saved salary history to check against.',404);
 const emps=new Map(rowsOf(emp).map(e=>[e.emp_code,e]));const heads=rowsOf(earn).sort((a,b)=>num(a.ern_code)-num(b.ern_code));const dedHeads=rowsOf(ded).sort((a,b)=>num(a.ded_code)-num(b.ded_code)).map(d=>({code:d.ded_code,label:d.ded_name}));
 const rate2=new Map<string,number>();for(const s of rowsOf(sal)){const k=s.emp_code+'|'+s.e_code;if(!rate2.has(k))rate2.set(k,num(s.rt2));}
 const stats={rows:0,earnings:0,pf:0,esi:0,net:0,byDivisor:{'30':0,monthDays:0,'26':0} as Record<string,number>,monthlyRows:0};const samples:{emp:string;month:number;field:string;saved:number;calculated:number}[]=[];
 for(const r of rowsOf(hist)){
  const m=num(r.month_no);if(num(r.totearn)<=0||m<1||m>12||(month&&m!==month))continue;const e=emps.get(r.emp_code);if(!e||(scope&&!scope.codes.has(r.emp_code)))continue;
  const monthDays=new Date(Date.UTC(datasetYear(dataset),m,0)).getUTCDate();const payableDays=num(r.pday);
  const engineHeads=heads.map(h=>({code:h.ern_code,label:h.ern_name,rate1:num(r['earnr'+h.ern_code]),rate2:rate2.get(r.emp_code+'|'+h.ern_code)||0,pf:h.pf_alw==='1',esi:h.esi_alw==='1'}));
  const base={heads:engineHeads,deductionHeads:dedHeads,payableDays,monthDays,salMode:e.sal_mode,pfApplies:e.pf_alw==='1',esiApplies:e.esi_alw==='1'};
  const result=computeSalary(base,rules);stats.rows++;
  const earnOk=heads.every((h,i)=>Math.abs(result.earnings[i].amount-num(r['earn'+h.ern_code]))<=0.01);
  const pfOk=Math.abs(result.pf.employee-num(r.emppf))<=0.01,esiOk=Math.abs(result.esi.employee-num(r.empesi))<=0.01,netOk=Math.abs(result.net-num(r.netsal))<=0.01;
  if(earnOk)stats.earnings++;if(pfOk)stats.pf++;if(esiOk)stats.esi++;if(netOk)stats.net++;
  if(e.sal_mode==='0'){stats.monthlyRows++;for(const d of ['30','monthDays','26'] as const){const alt=computeSalary(base,{...rules,monthlyDivisor:d});if(heads.every((h,i)=>Math.abs(alt.earnings[i].amount-num(r['earn'+h.ern_code]))<=0.01))stats.byDivisor[d]++;}}
  if(!netOk&&samples.length<15)samples.push({emp:e.emp_paycode||r.emp_code,month:m,field:!earnOk?'earnings':!pfOk?'PF':!esiOk?'ESI':'net',saved:!earnOk?num(r.totearn):!pfOk?num(r.emppf):!esiOk?num(r.empesi):num(r.netsal),calculated:!earnOk?result.gross:!pfOk?result.pf.employee:!esiOk?result.esi.employee:result.net});
 }
 return Response.json({stats,samples});
}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(error);}}
export const POST=drained(postHandler);
