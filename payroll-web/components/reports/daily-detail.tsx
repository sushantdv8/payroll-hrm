import type {Employee} from '@/lib/payroll';
import {classifyDay,type Tone} from '@/lib/smart-report';
import {dmy,monthLabel} from '@/lib/report-utils';
import type {ReportContext} from './report-form';
import {halves,hhmm,markCounts,minutes,monthDaysOf} from './report-parts';

// The detail panel of the Daily Reports smart view: what one employee did on the day (marks, in / out, every punch) and the whole month at a glance.
const tone=(t:Tone|'')=>t?' t-'+t:'';
export function DailyDetail({ctx,e,day}:{ctx:ReportContext;e:Employee;day:number}){
 const a=ctx.attendance.get(e.id);const d=a?.days.find(x=>x.day===day);const month=a?.days||[];
 const x=(ctx.extras[String(e.sourceKey||e.id)]||{}) as {sft?:string};
 const shift=d?.shift||ctx.lists.tbshift?.find(s=>s.code===x.sft)?.name||'';
 const inT=d?.manualIn||d?.machineIn||'',outT=d?.manualOut||d?.machineOut||'';
 const f=classifyDay(d?.first||'',d?.second||'',!!(inT||outT));
 const last=monthDaysOf(ctx.month);const byDay=new Map(month.map(m=>[m.day,m]));
 const c=markCounts(a);const present=(c.P||0)+(c.OD||0)+(c['WO*']||0)+(c['HD*']||0),absent=(c.A||0)+(c.LWP||0),leave=['EL','PL','CL','SL','CO','MT','SP'].reduce((s,k)=>s+(c[k]||0),0),off=(c.WO||0)+(c.HD||0);
 const lateDays=month.filter(m=>minutes(m.late||m.sourceLateHours)>0).length;const ot=month.reduce((s,m)=>s+minutes(m.ot),0),work=month.reduce((s,m)=>s+minutes(m.workHours),0);
 const weekday=new Date(ctx.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'long'});
 const extra:[string,string|undefined][]=[['Outside hours',d?.outsideHours],['Early going',d?.earlyHours],['Short hours',d?.shortHours],['Extra hours',d?.extraHours]];
 return <div className="dd">
  <div className="dd-who"><b>{e.name}</b><span>{e.paycode}{e.cardNo?` · Card ${e.cardNo}`:''}</span><span>{[e.department,e.designation].filter(Boolean).join(' · ')||'—'}</span></div>
  <section className="dd-card"><h4>{dmy(ctx.date)} · {weekday}</h4>
   <div className="dd-status"><span className={'rpt-sm-badge'+tone(f.tone)}>{f.label}</span>{shift&&<span className="dd-shift">Shift {shift}</span>}</div>
   {d?<dl className="dd-kv"><dt>In</dt><dd>{inT||'—'}</dd><dt>Out</dt><dd>{outT||'—'}</dd><dt>1st half</dt><dd>{d.first||'—'}</dd><dt>2nd half</dt><dd>{d.second||'—'}</dd>
     <dt>Work hours</dt><dd>{d.workHours||'—'}</dd><dt>Late</dt><dd>{d.late||d.sourceLateHours||'—'}</dd><dt>Overtime</dt><dd>{d.ot||'—'}{d.approvedOt?' (approved)':''}</dd>
     {extra.filter(([,v])=>v).map(([k,v])=><div key={k} className="dd-kv-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    :<p className="dd-none">No attendance is saved for this employee for {monthLabel(ctx.month)}.</p>}
   {!!d?.punches?.length&&<><h5>Punches ({d.punches.length})</h5><ul className="dd-punches">{d.punches.map((p,i)=><li key={i}><span className={'k '+p.kind.toLowerCase()}>{p.kind}</span><b>{p.time}</b>{p.dayOffset?<em>next day</em>:null}</li>)}</ul></>}
   {!!d?.punchIssues?.length&&<ul className="dd-issues">{d.punchIssues.map((s,i)=><li key={i}>{s}</li>)}</ul>}
  </section>
  <section className="dd-card"><h4>{monthLabel(ctx.month)}</h4>
   {a?<><div className="dd-strip" role="img" aria-label="Marks of the month">{Array.from({length:last},(_,i)=>i+1).map(n=>{const m=byDay.get(n);const k=m?classifyDay(m.first,m.second,!!(m.manualIn||m.machineIn||m.manualOut||m.machineOut)):null;const [h1,h2]=m?halves(m):['',''];
     return <span key={n} className={'dd-day'+tone(k?.tone||'')+(n===day?' is-today':'')} title={`${n}: ${k?.label||'No entry'}`}><i>{n}</i><b>{!m?'':h1===h2?h1:`${h1||'-'}/${h2||'-'}`}</b></span>;})}</div>
    <dl className="dd-kv dd-month"><dt>Present</dt><dd>{present}</dd><dt>Absent</dt><dd>{absent}</dd><dt>Leave</dt><dd>{leave}</dd><dt>Weekly off / holiday</dt><dd>{off}</dd><dt>Late days</dt><dd>{lateDays}</dd><dt>Work hours</dt><dd>{hhmm(work)||'—'}</dd><dt>Overtime</dt><dd>{hhmm(ot)||'—'}</dd></dl></>
    :<p className="dd-none">No attendance saved for this month.</p>}
  </section></div>;
}
