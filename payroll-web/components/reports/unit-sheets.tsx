import type {ReactNode} from 'react';
import type {Employee} from '@/lib/payroll';
import {trimCell} from '@/lib/masters';
import {monthTitle} from '@/lib/report-utils';
import {computeRow,excelRows,unitStyles,type SheetRow,type UnitStyle,type Vals} from '@/lib/unit-sheet';
import type {ReportContext,ReportOption,ReportPage} from './report-form';
import {tablePages,type Column} from './report-parts';

// Reports › Salary Sheet/Overtime › Unit Salary Sheet (…): the unit sheets (Rate x Pday + extra buckets) prefilled from the
// database. Prefilled: card, name, Rate (sum of the rate master's first rate for the employee), paid days (the month's
// attendance total) and "New Presant" (days marked MS on both halves). Everything else is typed in Excel, where the
// calculated columns are live formulas (see lib/unit-sheet.ts).
const cardNumber=(e:Employee)=>Number((e.cardNo||e.paycode).replace(/\D/g,''))||0;
const sorted=(list:Employee[])=>[...list].sort((a,b)=>cardNumber(a)-cardNumber(b)||a.paycode.localeCompare(b.paycode,undefined,{numeric:true}));
const fmt=(v:number)=>String(Math.round(v*100)/100);

function rateOf(ctx:ReportContext,e:Employee):number|null{
 const key=String(e.sourceKey||'');if(!key)return null;
 // One rate per earning head; a head listed twice takes its last row (as the saved salaries do).
 const byHead=new Map<string,number>();for(const r of ctx.rows)if(trimCell(r.values.emp_code)===key){const v=Number(trimCell(r.values.rt1));byHead.set(trimCell(r.values.e_code),Number.isFinite(v)?v:0);}
 const total=[...byHead.values()].reduce((a,b)=>a+(b>0?b:0),0);
 return total>0?total:null;
}
function rowsOf(ctx:ReportContext,style:UnitStyle):SheetRow[]{
 const keys=new Set(style.cols.map(c=>c.key));
 return sorted(ctx.employees).map(e=>{
  const a=ctx.attendance.get(e.id);const payable=a?Number(a.totals.payable):NaN;
  const single=a?a.days.filter(d=>d.first==='MS'&&d.second==='MS').length:0;
  const input:Vals={};
  if(keys.has('rate'))input.rate=rateOf(ctx,e);
  if(keys.has('days'))input.days=Number.isFinite(payable)&&String(a?.totals.payable??'')!==''?payable:null;
  if(keys.has('np'))input.np=single>0?single:null;
  return {card:style.cols[1].head==='Paycode'?e.paycode:(e.cardNo||e.paycode),name:e.name,input};
 });
}
const title=(ctx:ReportContext,style:UnitStyle)=>style.title(monthTitle(ctx.month));

function pages(ctx:ReportContext,style:UnitStyle):ReportPage[]{
 const rows=rowsOf(ctx,style);
 const columns:Column[]=style.cols.map(c=>({h:c.head,cls:['sno','card','name','text'].includes(c.spec.kind)?(c.spec.kind==='sno'?'c':undefined):'num'}));
 const calc=rows.map(r=>computeRow(style.cols,r.input));
 const show=(c:UnitStyle['cols'][number],v:Vals):ReactNode=>{const x=v[c.key];if(x==null||x===0)return '';return fmt(x);};
 const body:ReactNode[][]=rows.map((r,i)=>style.cols.map(c=>c.spec.kind==='sno'?i+1:c.spec.kind==='card'?r.card:c.spec.kind==='name'?r.name:c.spec.kind==='text'?'':show(c,calc[i])));
 const totals=style.cols.map((c,j)=>j===2?'Total':c.total?fmt(calc.reduce((s,v)=>s+(v[c.key]||0),0)):'');
 return tablePages(ctx,{key:'unit-'+style.value,title:title(ctx,style),columns,rows:body,perPage:24,totals:rows.length?totals:undefined,
  footer:<p style={{fontSize:'10px',marginTop:'4px'}}>Rate is the rate master&apos;s rate and New Presant counts the missed-punch (MS) days; both are suggestions to correct in Excel. Paid days are the attendance total. Hours, holiday, advance, PF and ESI are typed in the Excel file, where Basic, Amt, Total Salary and the deductions are live formulas.</p>});
}

export const unitSheetOptions:ReportOption[]=unitStyles.map(style=>({value:'unit-'+style.value,label:style.label,needs:['attendance'],table:'tbsal',
 note:'Prefilled from the database (card, name, rate master, paid days, missed-punch days). Tick the employees of the unit, then use Excel to correct the rate and type hours, holiday, advance, PF and ESI; the totals are formulas.',
 sheetName:style.sheetName,build:ctx=>pages(ctx,style),excel:ctx=>excelRows(style.cols,title(ctx,style),rowsOf(ctx,style),style.totalLabel)}));
