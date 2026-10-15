import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {exportExcel,requestJson} from '@/lib/client-api';
import {dMonY,dmy,monthLabel} from '@/lib/report-utils';
import {trimCell,type MasterRow} from '@/lib/masters';
import {classifyDay,worstTone,type DayKind,type Tone} from '@/lib/smart-report';
import type {ReportConfig,ReportContext,ReportOption,ReportPage} from './report-form';
import type {SmartSpec} from './smart-table';
import {DailyDetail} from './daily-detail';
import {EmployeeCell,Header,LEAVE,chunk,dayMark,extraOf,halves,hhmm,listName,markCounts,minutes,monthDaysOf,n2,nz,tablePages} from './report-parts';
import type {ReactNode} from 'react';

const ALL_FILTERS=['company','subCompany','location','dhead','department','designation','category','salaryGrade','leaveGrade','shift'] as const;
const range=(ctx:ReportContext)=>{const n=monthDaysOf(ctx.month);const from=Math.max(1,ctx.dayFrom),to=Math.min(n,ctx.dayTo);return Array.from({length:Math.max(0,to-from+1)},(_,k)=>from+k);};
const fullMonth=(ctx:ReportContext)=>ctx.dayFrom<=1&&ctx.dayTo>=monthDaysOf(ctx.month);
function totalsFor(ctx:ReportContext,e:Employee){const a=ctx.attendance.get(e.id);const c=markCounts(a,ctx.dayFrom,ctx.dayTo);const t=a?.totals;const stored=fullMonth(ctx)&&t;
 // Printed like the original register: one decimal, blank for zero.
 const f1=(v:number|string)=>v===''||!Number(v)?'':Number(v).toFixed(1);
 const pick=(k:keyof NonNullable<typeof t>,fallback:number)=>f1(stored&&t![k]!==''?t![k]:fallback);
 return {WD:pick('worked',(c.P||0)+(c.OD||0)),AB:pick('absent',c.A||0),WO:pick('weeklyOff',c.WO||0),HD:pick('holiday',c.HD||0),EL:f1(c.EL||0),CL:f1(c.CL||0),SL:f1(c.SL||0),PD:stored&&t!.payable!==''?f1(t!.payable):''};}
function workingHours(ctx:ReportContext){const codes=ctx.employees.map(e=>extraOf(ctx,e)?.sft).filter(Boolean) as string[];const top=codes.sort((a,b)=>codes.filter(v=>v===b).length-codes.filter(v=>v===a).length)[0];const s=ctx.lists.tbshift?.find(x=>x.code===top)||ctx.lists.tbshift?.[0];
 return s?{start:trimCell(s.values.sft_bg),end:trimCell(s.values.sft_en),lunch:trimCell(s.values.sft_lunch)}:null;}

function musterPages(ctx:ReportContext):ReportPage[]{
 const days=range(ctx);const wh=workingHours(ctx);const groups=chunk(ctx.employees,4);
 // The original always prints 31 day columns; days that the month does not have stay blank.
 const blanks=fullMonth(ctx)?Array.from({length:Math.max(0,31-days.length)},(_,k)=>k):[];
 return groups.map((group,p)=>({key:'m'+p,orientation:'landscape',trees:group.map(e=>e.paycode),node:<>
  <div className="rpt-head"><div className="left"><table className="no-border"><tbody><tr><td>Name of the Factory</td><td><b>{ctx.company.name}</b></td></tr><tr><td>Place Where situated</td><td>{ctx.company.address}</td></tr></tbody></table></div>
   <div><h1>FORM No. 12</h1><h3>( RULE No. 78)</h3><h2>Register of Adult worker prescribed under section 62 of the Act</h2></div>
   <div className="right">{wh&&<table style={{width:'auto'}}><thead><tr><th colSpan={3}>WORKING HOURS</th></tr><tr><th>Time of Commencement of work</th><th>Rest period</th><th>Time of Completion of work</th></tr></thead><tbody><tr><td className="c">{wh.start}</td><td className="c">{wh.lunch?`Lunch ${wh.lunch} min`:''}</td><td className="c">{wh.end}</td></tr></tbody></table>}<div>Page No. {p+1}</div></div></div>
  <div className="rpt-meta"><span>Attendance Detail for the month of {monthLabel(ctx.month)}{fullMonth(ctx)?'':` (days ${days[0]}–${days.at(-1)})`}</span>{ctx.printDate&&<span>Print Date : {dmy(ctx.printDate)}</span>}</div>
  <table><thead><tr><th>Sno</th><th style={{width:'150px'}}>Employee Details</th>{days.map(d=><th key={d} className="c">{d}</th>)}{blanks.map(k=><th key={'b'+k}/>)}{['WD','AB','WO','HD','EL','CL','SL','P.Day'].map(h=><th key={h} className="c">{h}</th>)}</tr></thead>
   <tbody>{group.map((e,k)=>{const a=ctx.attendance.get(e.id);const byDay=new Map((a?.days||[]).map(d=>[d.day,d]));const t=totalsFor(ctx,e);const x=extraOf(ctx,e);
    return [0,1].map(half=><tr key={e.id+half} className={half?'rpt-dotted':''}>{half===0&&<><td rowSpan={2} className="c"><div>{p*4+k+1}</div><div className="rpt-vert">{dMonY(e.doj)} {listName(ctx,'tbshift',x?.sft)}</div></td><td rowSpan={2}><EmployeeCell ctx={ctx} e={e}/></td></>}
     {days.map(d=>{const day=byDay.get(d);return <td key={d} className="c">{day?halves(day)[half]:''}</td>;})}{blanks.map(k=><td key={'b'+k}/>)}
     {half===0?<>{[t.WD,t.AB,t.WO,t.HD,t.EL,t.CL,t.SL,t.PD].map((v,i)=><td key={i} className="c" rowSpan={2}>{v}</td>)}</>:null}</tr>);})}</tbody></table></>}));
}
function musterExcel(ctx:ReportContext){const days=range(ctx);return [['Sno','Paycode','Card No.','Employee Name','Father/Husband','Designation',...days.map(String),'WD','AB','WO','HD','EL','CL','SL','P.Day'],...ctx.employees.map((e,i)=>{const a=ctx.attendance.get(e.id);const m=new Map((a?.days||[]).map(d=>[d.day,d]));const t=totalsFor(ctx,e);return [i+1,e.paycode,e.cardNo,e.name,e.fatherName,e.designation,...days.map(d=>dayMark(m.get(d))),t.WD,t.AB,t.WO,t.HD,t.EL,t.CL,t.SL,t.PD];})];}

function form14Pages(ctx:ReportContext):ReportPage[]{
 const year=ctx.month.slice(0,4);const openings=new Map(ctx.rows.filter(r=>trimCell(r.values.yr)===year).map(r=>[trimCell(r.values.emp_code),r.values]));
 return chunk(ctx.employees,3).map((group,p)=>({key:'f'+p,orientation:'portrait',tree:group[0]?.paycode,node:<><Header ctx={ctx} title="FORM No. 14" subtitle={`Register of Leave with Wages · ${monthLabel(ctx.month)}`} page={p+1}/>
  {group.map(e=>{const a=ctx.attendance.get(e.id);const c=markCounts(a);const open=openings.get(String(e.sourceKey||e.id));const dates=(code:string)=>(a?.days||[]).filter(d=>halves(d).includes(code)).map(d=>d.day+(halves(d).filter(h=>h===code).length===1?'½':'')).join(', ');
   return <div key={e.id} style={{marginBottom:'8mm'}}><div className="rpt-kv"><b>Name</b><span>{e.name} ({e.paycode})</span><b>Father / Husband</b><span>{e.fatherName||'—'}</span><b>Designation</b><span>{e.designation||'—'}</span><b>Date of Joining</b><span>{dmy(e.doj)||'—'}</span></div>
    <table><thead><tr><th>Leave</th><th className="num">Opening ({year})</th><th className="num">Taken in {monthLabel(ctx.month)}</th><th>Dates</th></tr></thead><tbody>{LEAVE.map(code=><tr key={code}><td>{code}</td><td className="num">{open?trimCell(open[code]):''}</td><td className="num">{nz(c[code]||0)}</td><td>{dates(code)}</td></tr>)}</tbody></table></div>;})}
  <p className="subtle">Opening values are the saved Leave Opening entries. Balances are not calculated.</p></>}));
}
function leaveDetailRows(ctx:ReportContext){const rows:{e:Employee;day:number;half:string;code:string}[]=[];for(const e of ctx.employees){const a=ctx.attendance.get(e.id);for(const d of a?.days||[]){if(d.day<ctx.dayFrom||d.day>ctx.dayTo)continue;const [f,s]=halves(d);if(f&&f===s&&LEAVE.includes(f))rows.push({e,day:d.day,half:'Full day',code:f});else{if(LEAVE.includes(f))rows.push({e,day:d.day,half:'1st half',code:f});if(LEAVE.includes(s))rows.push({e,day:d.day,half:'2nd half',code:s});}}}return rows;}
const dateOf=(ctx:ReportContext,day:number)=>`${String(day).padStart(2,'0')}/${ctx.month.slice(5,7)}/${ctx.month.slice(0,4)}`;

export const musterConfig:ReportConfig={attendanceSource:true,period:'month-days',filters:[...ALL_FILTERS],sex:true,withLeft:true,options:[
 {value:'muster',label:'Muster Roll',needs:['attendance'],build:musterPages,excel:musterExcel},
 {value:'form14',label:'Form14(Leave Register)',needs:['attendance'],table:'tblvopen1',build:form14Pages},
 {value:'leave',label:'Leave Detail',needs:['attendance'],build:ctx=>{const rows=leaveDetailRows(ctx);return tablePages(ctx,{key:'ld',title:'Leave Detail',subtitle:`For the month of ${monthLabel(ctx.month)}`,perPage:32,columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Date',cls:'c'},{h:'Day'},{h:'Leave',cls:'c'}],rows:rows.map((r,i)=>[i+1,r.e.paycode,r.e.name,r.e.department,dateOf(ctx,r.day),r.half,r.code])});},
  excel:ctx=>[['Sno','Paycode','Employee Name','Department','Date','Day','Leave'],...leaveDetailRows(ctx).map((r,i)=>[i+1,r.e.paycode,r.e.name,r.e.department,dateOf(ctx,r.day),r.half,r.code])]},
]};

// Time Attendence > Monthly/Periodically
// Attendence Register in the printed layout: five employees per landscape page, each with six rows per day
// (1 In Time, 2 Out Time, 3 Total working hours, 4 Late Hours, 5 O.T. hours, 6 Attendance status) and the month's counts on the right.
function monthlyRegister(ctx:ReportContext):ReportPage[]{
 const days=range(ctx);const [yy,mm]=ctx.month.split('-').map(Number);
 const wd=(d:number)=>new Date(Date.UTC(yy,mm-1,d)).toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});
 const mon=new Date(Date.UTC(yy,mm-1,1)).toLocaleDateString('en-US',{month:'short',timeZone:'UTC'})+'-'+yy;
 const one=(v:number)=>v.toFixed(1),hm=(v:number)=>hhmm(v)||'0:00';
 const counters=['OL','SL','CL','EL','HD','WO'];const hourLabels=['T.hrs','Ot.hrs','Lt.hrs'];
 const parts=chunk(ctx.employees,5);if(!parts.length)parts.push([]);
 const block=(e:Employee)=>{
  const a=ctx.attendance.get(e.id);const m=new Map((a?.days||[]).map(d=>[d.day,d]));const t=totalsFor(ctx,e);const c=markCounts(a,ctx.dayFrom,ctx.dayTo);
  const shift=a?.days.find(d=>d.shift)?.shift||listName(ctx,'tbshift',extraOf(ctx,e)?.sft);
  const sum=(key:'workHours'|'late'|'ot')=>days.reduce((s,d)=>{const x=m.get(d);return s+minutes(key==='late'?(x?.late||x?.sourceLateHours):x?.[key]);},0);
  const hours=[hm(sum('workHours')),hm(sum('ot')),hm(sum('late'))];
  const cell=(r:number,d:number)=>{const x=m.get(d);if(!x)return '';
   if(r===0)return x.manualIn||x.machineIn||'';if(r===1)return x.manualOut||x.machineOut||'';if(r===2)return x.workHours||'';
   if(r===3)return x.late||x.sourceLateHours||'';if(r===4)return x.ot||'';return x.first||x.second?`${x.first||'-'}-${x.second||'-'}`:'';};
  return <tbody key={e.id}>
   <tr className="rpt-reg-info"><td colSpan={days.length+3}><span><b>PayCode:</b> {e.paycode}</span><span><b>Cardno:</b> {e.cardNo}</span><span><b>Name:</b> {e.name}</span><span><b>Shift:</b> {shift}</span><span><b>Desig:</b> {e.designation}</span><span><b>Paid/ Work Days</b> {t.PD||'0.0'} / {t.WD||'0.0'}</span></td></tr>
   {[0,1,2,3,4,5].map(r=><tr key={r}><td className="c rpt-reg-lab">{r+1}</td>{days.map(d=><td key={d} className="c">{cell(r,d)}</td>)}
    <td className="rpt-reg-sum"><b>{counters[r]}</b> {one(c[counters[r]]||0)}</td>
    <td className="rpt-reg-sum">{r%2===0?<b>{hourLabels[r/2]}</b>:hours[(r-1)/2]}</td></tr>)}
  </tbody>;};
 return parts.map((part,p)=>({key:`mr-${p}`,orientation:'landscape' as const,tree:part[0]?.paycode||`Page ${p+1}`,trees:part.map(e=>e.paycode),node:<>
  <Header ctx={ctx} title={`Attendance Register for the month of ${mon}`} page={p+1} pages={parts.length}/>
  <table className="rpt-reg"><thead>
   <tr className="rpt-reg-legend"><th colSpan={days.length+3}>1.In Time &nbsp; 2.Out Time &nbsp; 3.Total working hours &nbsp; 4.Late Hours &nbsp; 5.O.T.hours &nbsp; 6.Attendance status</th></tr>
   <tr><th className="rpt-reg-lab"/>{days.map(d=><th key={d}>{d}</th>)}<th className="rpt-reg-sum">Tot Atd</th><th className="rpt-reg-sum">Tot. Hrs.</th></tr>
   <tr><th className="rpt-reg-lab"/>{days.map(d=><th key={d}>{wd(d)}</th>)}<th/><th/></tr></thead>
   {part.map(block)}</table></>}));}
// (Monthly/Periodically is built below, after the day-wise helpers it shares with Periodically Reports.)

// Time Attendence > Daily Reports
type DailyRow={e:Employee;shift:string;in:string;out:string;first:string;second:string;work:string;late:string;ot:string};
const dayRow=(ctx:ReportContext,e:Employee,day:number):DailyRow=>{const d=ctx.attendance.get(e.id)?.days.find(x=>x.day===day);return {e,shift:d?.shift||'',in:d?.manualIn||d?.machineIn||'',out:d?.manualOut||d?.machineOut||'',first:d?.first||'',second:d?.second||'',work:d?.workHours||'',late:d?.late||d?.sourceLateHours||'',ot:d?.ot||''};};
function dailyRows(ctx:ReportContext,kind:string):DailyRow[]{const day=Number(ctx.date.slice(8,10));return ctx.employees.map(e=>dayRow(ctx,e,day))
 .filter(r=>kind==='all'||(kind==='present'?['P','OD'].includes(r.first)||['P','OD'].includes(r.second):kind==='absent'?r.first==='A'||r.second==='A':kind==='late'?minutes(r.late)>0:true));}
const DAILY_COLUMNS=[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Card No.'},{h:'Employee Name'},{h:'Department'},{h:'Shift',cls:'c'},{h:'In',cls:'c'},{h:'Out',cls:'c'},{h:'1st',cls:'c'},{h:'2nd',cls:'c'},{h:'Work Hrs',cls:'c'},{h:'Late Hrs',cls:'c'},{h:'OT Hrs',cls:'c'}];
const DAILY_HEAD=['Sno','Paycode','Card No.','Employee Name','Department','Shift','In','Out','1st','2nd','Work Hrs','Late Hrs','OT Hrs'];
const dailyCells=(r:DailyRow,i:number)=>[i+1,r.e.paycode,r.e.cardNo,r.e.name,r.e.department,r.shift,r.in,r.out,r.first,r.second,r.work,r.late,r.ot];
// The smart view of the daily reports lists every employee of the day with a status, a colour and quick filters (Present / Absent / Late / Mispunch …),
// each with the same count of the day before; a click on a row opens that employee's day and month.
type DayFlags={kind:DayKind;label:string;tone:Tone|'';present:boolean;absent:boolean;late:boolean;mis:boolean;leave:boolean;off:boolean;ot:boolean};
function dayFlags(r:DailyRow):DayFlags{const c=classifyDay(r.first,r.second,!!(r.in||r.out));const has=(codes:string[])=>codes.includes(r.first)||codes.includes(r.second);
 return {kind:c.kind,label:c.label,tone:c.tone,present:has(['P','OD']),absent:has(['A','LWP']),late:minutes(r.late)>0,mis:!!r.in!==!!r.out||has(['MS']),leave:has(LEAVE),off:r.first==='WO'||r.first==='HD'||r.second==='WO'||r.second==='HD',ot:minutes(r.ot)>0};}
const DAILY_CHIPS:{id:string;label:string;tone:Tone;pred:(f:DayFlags)=>boolean}[]=[
 {id:'present',label:'Present',tone:'ok',pred:f=>f.present},{id:'absent',label:'Absent',tone:'bad',pred:f=>f.absent},{id:'late',label:'Late',tone:'warn',pred:f=>f.late},{id:'mispunch',label:'Mispunch',tone:'warn',pred:f=>f.mis},
 {id:'leave',label:'On leave',tone:'info',pred:f=>f.leave},{id:'off',label:'Off day',tone:'mute',pred:f=>f.off},{id:'ot',label:'Overtime',tone:'info',pred:f=>f.ot},{id:'none',label:'No entry',tone:'mute',pred:f=>f.kind==='none'}];
function dailySmart(ctx:ReportContext,kind:string,all:DailyRow[],day:number):SmartSpec{
 const flags=all.map(dayFlags);const before=day>1?ctx.employees.map(e=>dayFlags(dayRow(ctx,e,day-1))):null;
 return {pref:'daily',defaultView:true,groupBy:4,sums:[10,11,12],initialChip:['present','absent','late'].includes(kind)?kind:'all',chipLabel:'yesterday',
  chips:DAILY_CHIPS.map(c=>({id:c.id,label:c.label,tone:c.tone,test:i=>c.pred(flags[i]),before:before?before.filter(c.pred).length:undefined})),
  status:flags.map(f=>[f.label,f.late?'Late':'',f.mis&&f.kind!=='mispunch'?'Mispunch':''].filter(Boolean).join(' · ')),
  tone:flags.map(f=>worstTone(f.tone,f.late?'warn':'',f.mis?'warn':'')),
  detail:i=><DailyDetail ctx={ctx} e={all[i].e} day={day}/>,detailTitle:i=>all[i].e.name};}
const dailyOption=(value:string,label:string):ReportOption=>({value,label,needs:['attendance'],build:ctx=>{const day=Number(ctx.date.slice(8,10));const printed=dailyRows(ctx,value);const all=value==='all'?printed:ctx.employees.map(e=>dayRow(ctx,e,day));
  return tablePages(ctx,{key:'d'+value,title:label,subtitle:`Date : ${dmy(ctx.date)}`,perPage:30,columns:DAILY_COLUMNS,rows:printed.map(dailyCells),smart:dailySmart(ctx,value,all,day),smartRows:value==='all'?undefined:all.map(dailyCells)});},
 excel:ctx=>[DAILY_HEAD,...dailyRows(ctx,value).map(dailyCells)]});
// Daily Reports > Multi Punch Report: every punch of each employee and day (Card No. / Name / Date / Description), grouped by department.
// One line per employee and calendar day that has punches, all the punches of the day as "HH:MM,HH:MM," – the machines' own
// punches (Biometric Attendance app) when they could be read, else the punches saved in Time Updation. Departments in
// A–Z order, inside a department by Card No.; days without a punch have no line.
function multiPunchRows(ctx:ReportContext){
 const lastDay=monthDaysOf(ctx.month);const pad=(n:number)=>String(n).padStart(2,'0');const f=ctx.options.fields;
 const inMonth=(v:string|undefined)=>v&&v.slice(0,7)===ctx.month?Number(v.slice(8,10)):0;
 const from=inMonth(f.mpFrom)||1,to=Math.min(lastDay,inMonth(f.mpTo)||lastDay);
 if(from>to)throw new Error('Punch From must be on or before Punch To.');
 const dep=(e:Employee)=>(e.department||'').trim();
 const sorted=[...ctx.employees].sort((a,b)=>{const x=dep(a).toLowerCase(),y=dep(b).toLowerCase();return x<y?-1:x>y?1:(a.cardNo||a.paycode).localeCompare(b.cardNo||b.paycode,undefined,{numeric:true})||a.name.localeCompare(b.name);});
 const rows:{e:Employee;date:string;text:string}[]=[];
 for(const e of sorted){
  const raw=ctx.rawPunches?.get(e.id);const days:[number,string[]][]=[];
  if(ctx.rawPunches)for(const [date,times] of raw||[]){const d=Number(date.slice(8,10));if(date.slice(0,7)===ctx.month&&d>=from&&d<=to)days.push([d,times]);}
  else for(const d of ctx.attendance.get(e.id)?.days||[]){if(d.day<from||d.day>to)continue;
   const times=d.punches?.length?d.punches.map(p=>p.time):[d.manualIn||d.machineIn,d.manualOut||d.machineOut].filter(Boolean) as string[];days.push([d.day,times]);}
  for(const [d,times] of days.sort((a,b)=>a[0]-b[0]))if(times.length)rows.push({e,date:`${pad(d)}-${ctx.month.slice(5,7)}-${ctx.month.slice(0,4)}`,text:times.map(x=>x+',').join('')});}
 return {rows,from,to};
}
// The printed Punch Report: company, address and "Punch Report for the day of … to …" on the first page only, then on every
// page a boxed Card No. / Name / Date / Description bar carrying "Page n of m", a bold department line before its employees
// and one ruled line per employee day. Landscape.
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MP_FIRST=40,MP_NEXT=45;
function multiPunchPages(ctx:ReportContext):ReportPage[]{
 const {rows,from,to}=multiPunchRows(ctx);const [y,m]=ctx.month.split('-').map(Number);
 const long=(d:number)=>`${String(d).padStart(2,'0')}/${MONTHS[m-1]}/${y} ${WEEKDAYS[new Date(Date.UTC(y,m-1,d)).getUTCDay()]}`;
 type Line={dep:string}|{card:string;name:string;date:string;text:string};const lines:Line[]=[];let last:string|null=null;
 for(const r of rows){const dep=r.e.department||'(no department)';if(dep!==last){last=dep;lines.push({dep});}lines.push({card:r.e.cardNo||r.e.paycode,name:r.e.name,date:r.date,text:r.text});}
 // A department heading is never the last line of a page (it moves to the next page with its employees).
 const parts:Line[][]=[];let at=0;
 do{const size=parts.length?MP_NEXT:MP_FIRST;let end=Math.min(lines.length,at+size);if(end<lines.length&&end-1>at&&'dep' in lines[end-1])end--;parts.push(lines.slice(at,end));at=end;}while(at<lines.length);
 // Group tree: the departments that start on the page; Find also looks through the card numbers and names printed on it.
 return parts.map((part,p)=>{const deps=part.flatMap(l=>'dep' in l?[l.dep]:[]);return {key:'mp-'+p,orientation:'landscape' as const,trees:deps,find:part.flatMap(l=>'dep' in l?[]:[`${l.card} ${l.name}`]).join(' | '),node:<div className="mp">
  {p===0&&<div className="mp-title"><b className="mp-co">{ctx.company.name}</b>{ctx.company.address&&<b className="mp-adr">{ctx.company.address}</b>}<b className="mp-for">Punch Report for the day of {long(from)} to {long(to)}</b></div>}
  <table className="mp-table"><colgroup><col style={{width:'6.5%'}}/><col style={{width:'18%'}}/><col style={{width:'9%'}}/><col/></colgroup>
   <thead><tr><th>Card No.</th><th>Name</th><th>Date</th><th className="mp-desc"><span>Description</span><span className="mp-page">Page {p+1} of {parts.length}</span></th></tr></thead>
   <tbody>{part.map((l,i)=>'dep' in l?<tr key={i}><td/><td className="mp-dep">{l.dep}</td><td/><td/></tr>:<tr key={i}><td>{l.card}</td><td>{l.name}</td><td>{l.date}</td><td className="mp-text">{l.text}</td></tr>)}</tbody></table></div>};});
}
export const dailyConfig:ReportConfig={quick:true,period:'date',filters:[...ALL_FILTERS],sex:true,withLeft:true,fields:[{key:'mpFrom',label:'Punch From',kind:'date',place:'left',default:''},{key:'mpTo',label:'Punch To',kind:'date',place:'left',default:''}],options:[dailyOption('all','Daily Attendance'),dailyOption('present','Present Report'),dailyOption('absent','Absent Report'),dailyOption('late','Late Arrival Report'),{value:'multipunch',label:'Multi Punch Report',needs:['attendance','rawpunches'],note:'Prints every punch of each day exactly as the machines recorded it, for the month of the selected Date (read from the Biometric Attendance app; if it is not running, the punches saved in Time Updation are printed). Leave Punch From / Punch To blank for the whole month, or set them to print only those days.',build:multiPunchPages,excel:ctx=>[['Card No.','Name','Date','Description'],...multiPunchRows(ctx).rows.map(r=>[r.e.cardNo||r.e.paycode,r.e.name,r.date,r.text])]}]};

// Time Attendence > Periodically Reports
type PeriodRow={e:Employee;c:Record<string,number>;late:number;ot:number;work:number};
function periodRows(ctx:ReportContext):PeriodRow[]{const byEmp=new Map<string,PeriodRow>(ctx.employees.map(e=>[e.id,{e,c:{},late:0,ot:0,work:0}]));
 for(const a of ctx.period){const row=byEmp.get(a.employeeId);if(!row)continue;for(const d of a.days){const date=`${a.month}-${String(d.day).padStart(2,'0')}`;if(date<ctx.from||date>ctx.to)continue;for(const h of halves(d))if(h)row.c[h]=(row.c[h]||0)+0.5;row.late+=minutes(d.late||d.sourceLateHours);row.ot+=minutes(d.ot);row.work+=minutes(d.workHours);}}
 return [...byEmp.values()];}
const periodTitle=(ctx:ReportContext)=>`From ${dmy(ctx.from)} To ${dmy(ctx.to)}`;
// One row per employee-day inside the From–To range, with the in / out times (manual entry before machine punch).
type PeriodDay={e:Employee;date:string;shift:string;in:string;out:string;first:string;second:string;work:number;late:number;ot:number};
function periodDays(ctx:ReportContext):PeriodDay[]{const order=new Map(ctx.employees.map((e,i)=>[e.id,i]));const out:PeriodDay[]=[];
 for(const a of ctx.period){const i=order.get(a.employeeId);if(i===undefined)continue;const e=ctx.employees[i];for(const d of a.days){const date=`${a.month}-${String(d.day).padStart(2,'0')}`;if(date<ctx.from||date>ctx.to)continue;
  out.push({e,date,shift:d.shift,in:d.manualIn||d.machineIn||'',out:d.manualOut||d.machineOut||'',first:d.first,second:d.second,work:minutes(d.workHours),late:minutes(d.late||d.sourceLateHours),ot:minutes(d.ot)});}}
 return out.sort((x,y)=>order.get(x.e.id)!-order.get(y.e.id)!||x.date.localeCompare(y.date));}
const weekday=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short'});
const dayList=(value:string,label:string,keep:(r:PeriodDay)=>boolean,head:string[],cells:(r:PeriodDay)=>(string|number)[]):ReportOption=>({value,label,needs:['period'],
 build:ctx=>tablePages(ctx,{key:'p'+value,title:label,subtitle:periodTitle(ctx),perPage:32,columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Department'},...head.map(h=>({h,cls:'c'}))],rows:periodDays(ctx).filter(keep).map((r,i)=>[i+1,r.e.paycode,r.e.name,r.e.department,...cells(r)])}),
 excel:ctx=>[['Sno','Paycode','Employee Name','Department',...head],...periodDays(ctx).filter(keep).map((r,i)=>[i+1,r.e.paycode,r.e.name,r.e.department,...cells(r)])]});
const absentMark=(m:string)=>m==='A'||m==='MS'||m==='LWP';
function performanceRows(ctx:ReportContext){const rows=periodRows(ctx);const lateDays=new Map<string,number>();for(const d of periodDays(ctx))if(d.late)lateDays.set(d.e.id,(lateDays.get(d.e.id)||0)+1);
 return rows.map(r=>{const present=(r.c.P||0)+(r.c.OD||0);return {...r,present,lateDays:lateDays.get(r.e.id)||0,average:present?Math.round(r.work/present):0};});}
async function otExport(ctx:ReportContext){const days=periodDays(ctx).filter(r=>r.ot>0);if(!days.length)throw new Error('No overtime for the ticked employees in this period.');
 const totals=new Map<string,{e:Employee;ot:number;days:number}>();for(const d of days){const t=totals.get(d.e.id)||{e:d.e,ot:0,days:0};t.ot+=d.ot;t.days++;totals.set(d.e.id,t);}
 await exportExcel(`OT_Export_${ctx.from}_${ctx.to}.xlsx`,[{name:'OT Summary',rows:[['Sno','Paycode','Card No.','Employee Name','Department','OT Days','OT Hrs','OT Minutes'],...[...totals.values()].map((t,i)=>[i+1,t.e.paycode,t.e.cardNo,t.e.name,t.e.department,t.days,hhmm(t.ot),t.ot])]},
  {name:'OT Detail',rows:[['Sno','Paycode','Employee Name','Date','In','Out','OT Hrs'],...days.map((d,i)=>[i+1,d.e.paycode,d.e.name,dmy(d.date),d.in,d.out,hhmm(d.ot)])]}]);toast.success('Export Successfully');}
const presentOf=(rows:PeriodDay[])=>rows.reduce((s,r)=>s+(['P','OD'].includes(r.first)?.5:0)+(['P','OD'].includes(r.second)?.5:0),0);
const perEmployee=(ctx:ReportContext)=>{const by=new Map<string,PeriodDay[]>();for(const d of periodDays(ctx))by.set(d.e.id,[...(by.get(d.e.id)||[]),d]);return ctx.employees.map(e=>({e,days:by.get(e.id)||[]}));};
const num=(v:string|undefined)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
// Fooding / Night / Tea allowance days: days present (P / OD halves 0.5) of employees whose allowance is on in the employee master.
function allowanceRows(ctx:ReportContext,kinds:{label:string;on:keyof NonNullable<ReturnType<typeof extraOf>>;rate:keyof NonNullable<ReturnType<typeof extraOf>>}[]){
 return perEmployee(ctx).map(({e,days})=>{const x=extraOf(ctx,e);const present=presentOf(days);return {e,present,items:kinds.map(k=>{const on=x?.[k.on]==='1';const rate=num(x?.[k.rate] as string|undefined);return {on,rate,amount:on?Math.round(rate*present*100)/100:0};})};}).filter(r=>r.items.some(i=>i.on));}
const opt=(value:string,label:string,needs:ReportOption['needs'],columns:{h:string;cls?:string}[],rows:(ctx:ReportContext)=>(string|number)[][],perPage=30):ReportOption=>({value,label,needs,
 build:ctx=>{const list=rows(ctx);return tablePages(ctx,{key:'mp'+value,title:label,subtitle:periodTitle(ctx),perPage,columns:[{h:'Sno',cls:'c'},...columns],rows:list.map((r,i)=>[i+1,...r]),footer:!list.length?<p>No records for the ticked employees in this period.</p>:undefined});},
 excel:ctx=>[['Sno',...columns.map(c=>c.h)],...rows(ctx).map((r,i)=>[i+1,...r])]});
const performanceCols=[{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Present',cls:'num'},{h:'Absent',cls:'num'},{h:'WO',cls:'num'},{h:'Leave',cls:'num'},{h:'Late Days',cls:'num'},{h:'Late Hrs',cls:'num'},{h:'Work Hrs',cls:'num'},{h:'Avg/Day',cls:'num'},{h:'OT Hrs',cls:'num'}];
// Attendence Special: the punches of every day side by side (in over out), one row per employee.
function specialPages(ctx:ReportContext){const dates:string[]=[];for(let d=new Date(ctx.from+'T00:00:00Z');d.toISOString().slice(0,10)<=ctx.to&&dates.length<31;d.setUTCDate(d.getUTCDate()+1))dates.push(d.toISOString().slice(0,10));
 const rows=perEmployee(ctx).map(({e,days})=>{const by=new Map(days.map(d=>[d.date,d]));return [e.paycode,e.name,...dates.map(dt=>{const d=by.get(dt);return d?(d.in||d.out?<span key={dt}>{d.in||'--'}<br/>{d.out||'--'}</span>:dayMark({day:0,first:d.first,second:d.second,shift:'',manualIn:'',manualOut:'',ot:'',late:''} as Parameters<typeof dayMark>[0])):'';})];});
 return tablePages(ctx,{key:'sp',title:'Attendence Special',subtitle:periodTitle(ctx),perPage:14,columns:[{h:'Paycode'},{h:'Employee Name'},...dates.map(d=>({h:d.slice(8,10),cls:'c'}))],rows});}
// Costing: man-days and the month's saved gross salary, department by department. The gross is the whole month's, so
// Cost / Man-day is only worked out when the whole month is chosen.
function costingRows(ctx:ReportContext){const by=new Map<string,{n:number;days:number;ot:number;gross:number}>();for(const {e,days} of perEmployee(ctx)){const k=e.department||'(no department)';const r=by.get(k)||{n:0,days:0,ot:0,gross:0};r.n++;r.days+=presentOf(days);r.ot+=days.reduce((s,d)=>s+d.ot,0);r.gross+=ctx.salaries.get(e.id)?.gross||0;by.set(k,r);}
 return [...by.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([dep,r])=>[dep,r.n,nz(r.days),hhmm(r.ot),n2(r.gross),fullMonth(ctx)&&r.days?n2(r.gross/r.days):'']);}

// Time Attendence > Monthly/Periodically — the original's "Attendence Report Periodic" (Month Name, Day From / To).
export const monthlyAttendanceConfig:ReportConfig={period:'month-days',filters:[...ALL_FILTERS],sex:true,withLeft:true,columns:3,note:'Counts are added up from the saved day marks (each half day = 0.5). In / Out are the manual times, or the machine punches.',extraButtons:[{label:'OT Exports',option:'otexport'}],options:[
 {value:'register',label:'Attendence Register',needs:['attendance'],build:monthlyRegister,excel:musterExcel},
 opt('performance','Performance',['period'],performanceCols,ctx=>performanceRows(ctx).map(r=>[r.e.paycode,r.e.name,r.e.department,nz(r.present),nz(r.c.A||0),nz(r.c.WO||0),nz(LEAVE.reduce((s,k)=>s+(r.c[k]||0),0)),nz(r.lateDays),hhmm(r.late),hhmm(r.work),hhmm(r.average),hhmm(r.ot)])),
 dayList('late','Late Coming',r=>r.late>0,['Date','Day','Shift','In','Late Hrs'],r=>[dmy(r.date),weekday(r.date),r.shift,r.in,hhmm(r.late)]),
 opt('late1','Late Coming 1',['period'],[{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Late Days',cls:'num'},{h:'Late Hrs',cls:'num'}],ctx=>performanceRows(ctx).filter(r=>r.lateDays).map(r=>[r.e.paycode,r.e.name,r.e.department,r.lateDays,hhmm(r.late)])),
 dayList('absent','Absent',r=>absentMark(r.first)||absentMark(r.second),['Date','Day','1st','2nd'],r=>[dmy(r.date),weekday(r.date),r.first,r.second]),
 dayList('overtime','Overtime Register',r=>r.ot>0,['Date','Day','In','Out','Work Hrs','OT Hrs'],r=>[dmy(r.date),weekday(r.date),r.in,r.out,hhmm(r.work),hhmm(r.ot)]),
 opt('night','Only Night/Fooding',['period'],[{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Present',cls:'num'},{h:'Fooding Rate',cls:'num'},{h:'Fooding Amt',cls:'num'},{h:'Night Rate',cls:'num'},{h:'Night Amt',cls:'num'}],
  ctx=>allowanceRows(ctx,[{label:'Fooding',on:'foodAlw',rate:'food1'},{label:'Night',on:'nightAlw',rate:'night1'}]).map(r=>[r.e.paycode,r.e.name,r.e.department,nz(r.present),...r.items.flatMap(i=>i.on?[n2(i.rate),n2(i.amount)]:['',''])])),
 {value:'special',label:'Attendence Special',needs:['period'],build:specialPages},
 opt('costing','Costing',['period','salaries'],[{h:'Department'},{h:'Employees',cls:'num'},{h:'Man-days',cls:'num'},{h:'OT Hrs',cls:'num'},{h:'Gross Salary',cls:'num'},{h:'Cost / Man-day',cls:'num'}],costingRows),
 dayList('mispunch','Mispunch',r=>(!!r.in!==!!r.out)||r.first==='MS'||r.second==='MS',['Date','Day','Shift','In','Out','1st','2nd'],r=>[dmy(r.date),weekday(r.date),r.shift,r.in,r.out,r.first,r.second]),
 opt('tea','Tea Monthly',['period'],[{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Present',cls:'num'},{h:'Tea Rate',cls:'num'},{h:'Tea Amount',cls:'num'}],
  ctx=>allowanceRows(ctx,[{label:'Tea',on:'teaAlw',rate:'tea1'}]).map(r=>[r.e.paycode,r.e.name,r.e.department,nz(r.present),n2(r.items[0].rate),n2(r.items[0].amount)])),
 opt('summary','Attendance Summary',['period'],[{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Present',cls:'num'},{h:'OD',cls:'num'},{h:'Absent',cls:'num'},{h:'WO',cls:'num'},{h:'HD',cls:'num'},{h:'Leave',cls:'num'},{h:'LWP',cls:'num'}],
  ctx=>periodRows(ctx).map(r=>[r.e.paycode,r.e.name,r.e.department,nz(r.c.P||0),nz(r.c.OD||0),nz(r.c.A||0),nz(r.c.WO||0),nz(r.c.HD||0),nz(LEAVE.reduce((s,k)=>s+(r.c[k]||0),0)),nz(r.c.LWP||0)])),
 {value:'otexport',label:'OT Exports',needs:['period'],hidden:true,build:()=>[],action:otExport},
]};

// Time Attendence > Periodically Reports — the original's "Periodcaly Detail" (Date Select / To Date, Weekly / Fortnighty).
const blockOf=(ctx:ReportContext,date:string)=>{const len=ctx.options.fields.span==='fortnightly'?14:7;const n=Math.floor((Date.parse(date)-Date.parse(ctx.from))/864e5/len);const s=new Date(Date.parse(ctx.from)+n*len*864e5).toISOString().slice(0,10);const e=new Date(Math.min(Date.parse(s)+(len-1)*864e5,Date.parse(ctx.to))).toISOString().slice(0,10);return {n,label:`${len===7?'Week':'Fortnight'} ${n+1} (${dmy(s)} – ${dmy(e)})`};};
function detailPages(ctx:ReportContext){
 // "Attendance" ticked: only the day marks, one line per employee; otherwise every day with its times, block by block.
 if(ctx.options.fields.attendance==='1')return specialMarks(ctx);
 const rows:(string|number|ReactNode)[][]=[];
 for(const {e,days} of perEmployee(ctx)){if(!days.length)continue;let current=-1;let block:PeriodDay[]=[];const flush=()=>{if(!block.length)return;const b=blockOf(ctx,block[0].date);rows.push(['','',<b key={'t'+e.id+b.n}>{b.label}</b>,'','','','',`Present ${nz(presentOf(block))}`,hhmm(block.reduce((s,d)=>s+d.work,0)),hhmm(block.reduce((s,d)=>s+d.ot,0))]);block=[];};
  for(const d of days){const b=blockOf(ctx,d.date).n;if(b!==current){flush();current=b;}block.push(d);rows.push([e.paycode,e.name,dmy(d.date),weekday(d.date),d.in,d.out,d.first,d.second,hhmm(d.work),hhmm(d.ot)]);}flush();}
 return tablePages(ctx,{key:'pd',title:'Attendance Detail',subtitle:`${periodTitle(ctx)} · ${ctx.options.fields.span==='fortnightly'?'Fortnighty':'Weekly'}`,perPage:34,columns:[{h:'Paycode'},{h:'Employee Name'},{h:'Date',cls:'c'},{h:'Day'},{h:'In',cls:'c'},{h:'Out',cls:'c'},{h:'1st',cls:'c'},{h:'2nd',cls:'c'},{h:'Work Hrs',cls:'c'},{h:'OT Hrs',cls:'c'}],rows});}
// A range longer than 31 days is printed in blocks of 31 dates, each with Present counted over its own dates.
function specialMarks(ctx:ReportContext){const all:string[]=[];for(let d=new Date(ctx.from+'T00:00:00Z');d.toISOString().slice(0,10)<=ctx.to;d.setUTCDate(d.getUTCDate()+1))all.push(d.toISOString().slice(0,10));const emps=perEmployee(ctx);
 return chunk(all,31).flatMap((dates,b)=>{const first=dates[0],last=dates.at(-1)!;
  const rows=emps.map(({e,days})=>{const inBlock=days.filter(d=>d.date>=first&&d.date<=last);const by=new Map(inBlock.map(d=>[d.date,d]));return [e.paycode,e.name,...dates.map(dt=>{const d=by.get(dt);return d?(d.first===d.second?d.first:`${d.first||'-'}/${d.second||'-'}`):'';}),nz(presentOf(inBlock))];});
  return tablePages(ctx,{key:'pa'+b,title:'Attendance',subtitle:`From ${dmy(first)} To ${dmy(last)}`,perPage:24,columns:[{h:'Paycode'},{h:'Employee Name'},...dates.map(d=>({h:all.length>31?<>{d.slice(8,10)}<br/>{d.slice(5,7)}</>:d.slice(8,10),cls:'c'})),{h:'Present',cls:'num'}],rows});});}
// Salary Generate and Exports: wages for each week / fortnight of the period = paid days × daily rate (+ OT for OT-allowed
// employees at twice the hourly rate, 8 hours a day). Daily rate = total salary rate for daily-rated staff, rate ÷ 30 for monthly.
async function periodSalaryExport(ctx:ReportContext){
 const [rates,empsal]=await Promise.all(['tbsal','tbempsal'].map(table=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset:ctx.dataset,table}))));const heads=new Map<string,number>();for(const r of rates.rows)heads.set(trimCell(r.values.emp_code)+'|'+trimCell(r.values.e_code),num(trimCell(r.values.rt1)));
 const total=new Map<string,number>();for(const [k,v] of heads){const emp=k.slice(0,k.lastIndexOf('|'));total.set(emp,(total.get(emp)||0)+v);}
 // Employee salary settings replace the employee master's salary mode and OT tick, as in the salary calculation.
 const over=new Map(empsal.rows.map(r=>[trimCell(r.values.emp_code),r.values]));
 const out:(string|number)[][]=[];const paid=(d:PeriodDay)=>[d.first,d.second].reduce((s,m)=>s+(['P','OD','WO','HD','EL','PL','CL','SL','CO','MT','SP'].includes(m)?.5:0),0);
 for(const {e,days} of perEmployee(ctx)){if(!days.length)continue;const x=extraOf(ctx,e);const key=String(e.sourceKey||e.id);const o=over.get(key);const val=(col:string,fb?:string)=>o&&trimCell(o[col])!==''?trimCell(o[col]):(fb||'');
  const salMode=val('sal_mode',x?.salMode),otAlw=val('ot_alw',x?.otAlw);const rate=total.get(key)||0;const daily=salMode==='1'||salMode==='2'?rate:rate/30;const blocks=new Map<number,{label:string;days:number;ot:number}>();
  for(const d of days){const b=blockOf(ctx,d.date);const r=blocks.get(b.n)||{label:b.label,days:0,ot:0};r.days+=paid(d);r.ot+=d.ot;blocks.set(b.n,r);}
  for(const b of blocks.values()){const wages=Math.round(daily*b.days);const otAmt=otAlw==='1'?Math.round(daily/8*2*b.ot/60):0;out.push([b.label,e.paycode,e.name,e.department,nz(b.days),n2(daily),wages,hhmm(b.ot),otAmt,wages+otAmt]);}}
 if(!out.length)throw new Error('No attendance for the ticked employees in this period.');
 await exportExcel(`Period_Salary_${ctx.from}_${ctx.to}.xlsx`,[{name:'Salary',rows:[['Period','Paycode','Employee Name','Department','Paid Days','Daily Rate','Wages','OT Hrs','OT Amount','Total'],...out]}]);toast.success('Export Successfully');}
export const periodicConfig:ReportConfig={period:'range',periodLabels:{from:'Date Select',to:'To Date'},filters:ALL_FILTERS.filter(f=>f!=='company'),sex:true,withLeft:true,
 fields:[{key:'attendance',label:'Attendance',kind:'check',place:'middle',default:'0'},{key:'span',label:'Period',kind:'radio',place:'middle',default:'weekly',options:[{value:'weekly',label:'Weekly'},{value:'fortnightly',label:'Fortnighty'}]}],
 extraButtons:[{label:'Salary Generate and Exports',option:'salaryexport'}],options:[
 {value:'detail',label:'Attendance Detail',needs:['period'],build:detailPages,excel:ctx=>[['Paycode','Employee Name','Date','Day','In','Out','1st','2nd','Work Hrs','OT Hrs'],...periodDays(ctx).map(d=>[d.e.paycode,d.e.name,dmy(d.date),weekday(d.date),d.in,d.out,d.first,d.second,hhmm(d.work),hhmm(d.ot)])]},
 {value:'salaryexport',label:'Salary Generate and Exports',needs:['period'],hidden:true,build:()=>[],action:periodSalaryExport},
]};

// Time Attendence > Combined Reports — the month's attendance totals and saved salary side by side.
const combinedRows=(ctx:ReportContext)=>ctx.employees.map(e=>{const a=ctx.attendance.get(e.id);const c=markCounts(a,1,31);const s=ctx.salaries.get(e.id);const lv=LEAVE.reduce((x,k)=>x+(c[k]||0),0);
 const ot=(a?.days||[]).reduce((x,d)=>x+minutes(d.ot),0);return [e.paycode,e.name,e.department,nz((c.P||0)+(c.OD||0)),nz(c.WO||0),nz(c.HD||0),nz(lv),nz(c.A||0),nz(typeof a?.totals.payable==='number'?a.totals.payable:0),hhmm(ot),n2(s?.gross),n2(s?.totalDeductions),n2(s?.net)];});
export const combinedConfig:ReportConfig={period:'month',filters:[...ALL_FILTERS],sex:true,withLeft:true,options:[
 {value:'combined',label:'Attendance and Salary',needs:['attendance','salaries'],build:ctx=>tablePages(ctx,{key:'cb',title:'Combined Report',subtitle:`For the month of ${monthLabel(ctx.month)}`,perPage:30,
  columns:[{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'W.Day',cls:'num'},{h:'WO',cls:'num'},{h:'HD',cls:'num'},{h:'LV',cls:'num'},{h:'AB',cls:'num'},{h:'P.Day',cls:'num'},{h:'OT Hrs',cls:'num'},{h:'Gross',cls:'num'},{h:'Deduction',cls:'num'},{h:'Net',cls:'num'}],rows:combinedRows(ctx)}),
  excel:ctx=>[['Paycode','Employee Name','Department','W.Day','WO','HD','LV','AB','P.Day','OT Hrs','Gross','Deduction','Net'],...combinedRows(ctx).map(r=>r.map(v=>v??''))]},
 {value:'department',label:'Department Summary',needs:['attendance','salaries'],build:ctx=>{const by=new Map<string,{n:number;days:number;net:number}>();for(const e of ctx.employees){const k=e.department||'(no department)';const r=by.get(k)||{n:0,days:0,net:0};const a=ctx.attendance.get(e.id);r.n++;r.days+=typeof a?.totals.payable==='number'?a.totals.payable:0;r.net+=ctx.salaries.get(e.id)?.net||0;by.set(k,r);}
  return tablePages(ctx,{key:'cd',title:'Department Summary',subtitle:`For the month of ${monthLabel(ctx.month)}`,perPage:34,columns:[{h:'Department'},{h:'Employees',cls:'num'},{h:'P.Days',cls:'num'},{h:'Net Salary',cls:'num'}],rows:[...by.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,r])=>[d,r.n,nz(r.days),n2(r.net)])});}},
]};
