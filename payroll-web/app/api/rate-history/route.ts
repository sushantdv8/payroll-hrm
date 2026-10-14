import {datasetYear} from '@/lib/dataset-year';
import {ownerId,fail,RequestError,validDataset} from '@/lib/server-store';
import {readSourceTable} from '@/lib/source-archive';
import {datasetKey} from '@/lib/full-import';
import {hrIdentity,assertHr} from '@/lib/hr-store';
import {employeeScope,needCode} from '@/lib/unit-scope';
import {screenRight} from '@/lib/access';
export const dynamic='force-dynamic';

// Salary Rate History of one employee (Employee Entry › Salary): the rates saved with each month's salary in the original.
export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);const dataset=datasetKey.parse(url.searchParams.get('dataset'));await validDataset(owner,dataset);const actor=await hrIdentity(owner);
 // Employee Entry shows the salary rates of the employee, so its login may read their history too; otherwise the salary screens' right is needed.
 assertHr(actor,dataset,screenRight(actor,'master/employee','view')?'employees':'payroll');
 const emp=url.searchParams.get('emp')||'';if(!/^\d{1,9}$/.test(emp))return Response.json({history:[]},{headers:{'Cache-Control':'no-store'}});
 needCode(await employeeScope(owner,dataset,actor),emp);
 const hist=await readSourceTable(owner,dataset,'tbmonth_hist',200000);if(!hist)return Response.json({history:[]},{headers:{'Cache-Control':'no-store'}});
 const at=Object.fromEntries(hist.columns.map((c,i)=>[c.name,i]));if(at.emp_code===undefined)throw new RequestError('Salary history is unavailable.',503);
 const cell=(r:(string|null)[],c:string)=>(r[at[c]]??'').trim();
 const history=hist.rows.filter(r=>cell(r,'emp_code')===emp).map(r=>{const m=Number(cell(r,'month_no'));const month=`${datasetYear(dataset)+Math.floor((m-1)/12)}-${String(((m-1)%12)+1).padStart(2,'0')}`;
  const rates=Array.from({length:15},(_,k)=>({label:cell(r,'earnn'+(k+1)),rate:Number(cell(r,'earnr'+(k+1)))||0})).filter(x=>x.label||x.rate);
  return {month,total:Number(cell(r,'totrate'))||rates.reduce((s,x)=>s+x.rate,0),rates};}).sort((a,b)=>b.month.localeCompare(a.month));
 return Response.json({history},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
