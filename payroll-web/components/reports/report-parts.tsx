import type {ReactNode} from 'react';
import type {AttendanceDay,AttendanceMonth,Employee} from '@/lib/payroll';
import {dmy,type Extra} from '@/lib/report-utils';
import type {ReportContext,ReportOwner,ReportPage} from './report-form';
import type {SmartSpec,SmartTable} from './smart-table';

export const chunk=<T,>(items:T[],size:number)=>{const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;};
// Imported employees are keyed by their original code, employees added in this app by their id (as /api/employee-extras returns them).
export const extraOf=(ctx:ReportContext,e:Employee):Extra|undefined=>ctx.extras[String(e.sourceKey||e.id)];
// The employee a page is printed for, as the viewer's group tree lists him / her: "paycode · name" (the Find box finds either).
export const ownerOf=(e:Employee):ReportOwner=>({id:e.id,label:[e.paycode,e.name].filter(Boolean).join(' · ')});
export const listName=(ctx:ReportContext,table:string,code:string|undefined)=>ctx.lists[table]?.find(o=>o.code===code)?.name||'';
export const n2=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'':Number(v).toFixed(2);
export const nz=(v:number)=>v?String(Math.round(v*100)/100):'';

export function Header({ctx,title,subtitle,page,pages,left,right}:{ctx:ReportContext;title:string;subtitle?:string;page?:number;pages?:number;left?:ReactNode;right?:ReactNode}){
 return <><div className="rpt-head"><div className="left">{left}</div><div><h1>{ctx.company.name}</h1>{ctx.company.address&&<h3>{ctx.company.address}</h3>}<h2>{title}</h2>{subtitle&&<h3>{subtitle}</h3>}</div><div className="right">{right}{page!=null&&<div>Page No. {page}{pages?` of ${pages}`:''}</div>}{ctx.printDate&&<div>Print Date : {dmy(ctx.printDate)}</div>}</div></div></>;
}

export type Column={h:ReactNode;cls?:string;w?:string};
// Splits a table into pages with the report header repeated, like the original's paged report viewer.
// Every page also carries the table itself (page.table): the viewer's smart view shows it as a table that can be searched, sorted, filtered, grouped and exported.
// smart: what the report knows about its rows (colours, status, quick filters, detail panel); false: no smart view; smartRows: the smart view lists these rows instead (more than the printed ones - smart.* then count them).
export function tablePages(ctx:ReportContext,{key,title,subtitle,columns,rows,perPage,orientation='landscape',tree,footer,totals,group,smart,smartRows}:{key:string;title:string;subtitle?:string;columns:Column[];rows:ReactNode[][];perPage:number;orientation?:'landscape'|'portrait';tree?:(pageRows:number[])=>string;footer?:ReactNode;totals?:ReactNode[];group?:(number|null)[];smart?:SmartSpec|false;smartRows?:ReactNode[][]}):ReportPage[]{
 const build=(list:ReactNode[][],tail=true,k=key,note=''):ReportPage[]=>{
  const indexes=list.map((_,i)=>i);const parts=chunk(indexes,perPage);if(!parts.length)parts.push([]);
  return parts.map((part,p)=>({key:`${k}-${p}`,orientation,tree:tail&&tree?tree(part):`Page ${p+1}`,node:<>
   <Header ctx={ctx} title={title} subtitle={[subtitle,note].filter(Boolean).join(' · ')||undefined} page={p+1} pages={parts.length}/>
   <table><thead><tr>{columns.map((c,i)=><th key={i} className={c.cls} style={c.w?{width:c.w}:undefined}>{c.h}</th>)}</tr></thead>
    <tbody>{part.map(i=><tr key={i} className={tail&&group?.[i]!=null?'rpt-group-row':''}>{list[i].map((cell,j)=><td key={j} className={columns[j]?.cls}>{cell}</td>)}</tr>)}
     {tail&&p===parts.length-1&&totals&&<tr>{totals.map((cell,j)=><td key={j} className={columns[j]?.cls}><b>{cell}</b></td>)}</tr>}</tbody></table>
   {tail&&p===parts.length-1&&footer}</>}));};
 const pages=build(rows);
 if(smart===false||group)return pages;   // a table with group rows inside is not a flat list of records
 const table:SmartTable={key,title,subtitle,fileName:`${title.replace(/[^A-Za-z0-9]+/g,'_')}_${ctx.date||ctx.from||ctx.month||''}`.replace(/_$/,''),columns,rows:smartRows||rows,smart:smart||undefined,
  pagesFor:(list,note)=>build(list,false,key+'-v',note)};   // printing the rows on screen: no totals row, no footer note - they belong to the whole report
 return pages.map(p=>({...p,table}));
}

export function EmployeeCell({ctx,e}:{ctx:ReportContext;e:Employee}){const x=extraOf(ctx,e);
 return <div><div>{e.paycode} &nbsp; {e.cardNo}</div><div><b>{e.name}</b></div><div>{e.fatherName}</div><div>{e.designation}</div><div>PF No. {x?.pfNo||''}</div><div>ESI No. {x?.esiNo||''}</div></div>;}

export const halves=(d:AttendanceDay)=>[d.first||'',d.second||''];
export const LEAVE=['EL','PL','CL','SL','CO','MT','SP'];
// Half-day counts of each mark within a day range (each half counts 0.5).
export function markCounts(month:AttendanceMonth|undefined,from=1,to=31){const c:Record<string,number>={};for(const d of month?.days||[]){if(d.day<from||d.day>to)continue;for(const h of halves(d))if(h)c[h]=(c[h]||0)+0.5;}return c;}
export const dayMark=(d:AttendanceDay|undefined)=>{if(!d)return '';const [a,b]=halves(d);if(!a&&!b)return d.sourceStatus&&d.sourceStatus!=='-'?'':d.sourceStatus||'';return a===b?a:`${a||'-'}/${b||'-'}`;};
export const minutes=(v:string|undefined)=>{const m=/^(\d{1,3}):(\d{2})$/.exec(v||'');return m?Number(m[1])*60+Number(m[2]):0;};
export const hhmm=(mins:number)=>mins?`${Math.floor(mins/60)}:${String(mins%60).padStart(2,'0')}`:'';
export const monthDaysOf=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
