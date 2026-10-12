import {analysePunches,type Punch} from './multi-punch';
import {monthDays,type AttendanceDay,type AttendanceMonth} from './payroll';
import {roundOtMinutes} from './salary-engine';

// Time Updation rules, checked against the original software's processed attendance (KISHOR EXPORT om_01_26, Aug-2026;
// the same rules give within 0.5% of these rates for Jul-2026):
//  work hours  out − in − the part of the shift's lunch break inside the punches − its tea breaks − the day's break
//              deduction (lunch sits in the middle of the shift: GN 09:00–18:00, 60 min → 13:00–14:00)   5983/5987 days
//  late        in − shift start, when more than the grace minutes (GN: 15) and less than half-day − grace   5954/5987 days
//  marks       both punches: time inside them (before the break deduction) ≥ full-day minutes → P/P (A/P when the
//              start was half-day minutes late), ≥ half-day minutes → each half the punches reach into, otherwise
//              A/A (5896/5987 days); one punch only → MS/MS (207/207); no punch → A/A, weekly off WO, holiday HD,
//              before joining NJ (45476/45514 days)
//  weekly off  daily-wage employees (salary mode 1, 2) get WO* (unpaid); monthly staff get WO when present at least
//              3 of the 6 working days before it (the days after it at the start of a month), otherwise WO*
//  OT          only for employees with OT allowed: minutes after shift end, rounded by the shift's OT slabs
//              (Shift Ot Setup, day type 0); work on a weekly off / holiday uses the day type 1 slabs
export type Mark=AttendanceDay['first'];
export type Band={min:number;max:number;paid:number};
export type ShiftRule={code:string;name:string;start:number;end:number;lunch:number;tea:number;grace:number;halfDay:number;fullDay:number;otBands:Band[];offBands:Band[];breakPolicy?:'actual'|'fixed';earlyGrace?:number;requiredMinutes?:number};
export const defaultShift:ShiftRule={code:'1',name:'GN',start:540,end:1080,lunch:60,tea:0,grace:15,halfDay:180,fullDay:360,otBands:[],offBands:[]};
type Row={values:Record<string,string|null>};

export function toMin(value:string|null|undefined){const m=/^(\d{1,3}):([0-5]\d)$/.exec((value||'').trim());return m?Number(m[1])*60+Number(m[2]):null;}
export function hhmm(minutes:number){if(!Number.isFinite(minutes)||minutes<=0)return '';const m=Math.round(minutes);return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
const clock=(minutes:number)=>{const m=((Math.round(minutes)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
const dayDuration=(minutes:number)=>hhmm(Math.min(minutes,1440));
const cell=(r:Row,c:string)=>(r.values[c]??'').trim();

export function shiftRulesFrom(shifts:Row[],settings:Row[]):ShiftRule[]{
 return shifts.map(r=>{const code=cell(r,'sft_code');const n=(c:string,d:number)=>{const v=Number(cell(r,c));return cell(r,c)!==''&&Number.isFinite(v)&&v>=0?v:d;};
  const bands=(type:string)=>settings.filter(s=>cell(s,'sft_code')===code&&(cell(s,'day_type')||'0')===type).map(s=>({min:Number(cell(s,'mintime'))||0,max:Number(cell(s,'maxtime'))||0,paid:Number(cell(s,'ret_time'))||0})).sort((a,b)=>a.min-b.min);
  return {code,name:cell(r,'sft_name')||code,start:toMin(cell(r,'sft_bg'))??defaultShift.start,end:toMin(cell(r,'sft_en'))??defaultShift.end,lunch:Number(cell(r,'sft_lunch'))||0,tea:Number(cell(r,'sft_tea'))||0,grace:n('sft_lateg',15),halfDay:n('hf_day',180)||180,fullDay:n('fl_day',360)||360,earlyGrace:n('sft_earlyg',0),requiredMinutes:n('req_work',0)||undefined,otBands:bands('0'),offBands:bands('1')};});
}

// Half-day codes from the original attendance dictionary (tbattd).
const workMarks=new Set<string>(['P','OD']);
export const leaveMarks=new Set<string>(['EL','PL','CL','SL','CO','MT','SP']);
const unpaidMarks=new Set<string>(['A','LWP','MS','LF','WO*','HD*']);
// Marks entered by hand (leave, on duty, leave without pay) are kept when punches are processed again.
const enteredMarks=new Set<string>([...leaveMarks,'OD','LWP']);

export type DayResult={first:Mark;second:Mark;late:string;ot:string;workHours:string;outsideHours?:string;earlyHours?:string;shortHours?:string;extraHours?:string;punchIssues?:string[]};
export function calcPunchDay(x:{in:string;out:string;shift:ShiftRule;off:boolean;holiday:boolean;otAllowed:boolean;deduct:number;punches?:Punch[]}):DayResult{
 if(x.punches?.length){
  const p=analysePunches(x.punches),s=x.shift;const rest:Mark|null=x.off?'WO':x.holiday?'HD':null;
  if(p.issues.length||p.first===null||p.last===null)return {first:rest||'MS',second:rest||'MS',late:'',ot:'',workHours:'',outsideHours:hhmm(p.outside),punchIssues:p.issues};
  const end=s.end<=s.start?s.end+1440:s.end,start=s.start;const lunchStart=start+Math.floor((end-start-s.lunch)/2),lunchEnd=lunchStart+s.lunch;
  const fixed=s.breakPolicy==='fixed'?p.pairs.reduce((n,v)=>n+Math.max(0,Math.min(v.end,lunchEnd)-Math.max(v.start,lunchStart)),0)+s.tea:0;
  const work=Math.max(0,p.inside-fixed-x.deduct),required=s.requiredMinutes??Math.max(0,end-start-s.lunch-s.tea);
  const late=Math.max(0,p.first-start),early=Math.max(0,end-p.last),short=Math.max(0,required-work),extra=Math.max(0,work-required);
  const first:Mark=work>=s.fullDay?'P':work>=s.halfDay&&p.first<lunchEnd?'P':'A',second:Mark=work>=s.fullDay?'P':work>=s.halfDay&&p.last>lunchStart?'P':'A';
  return {first:rest||first,second:rest||second,workHours:dayDuration(work),outsideHours:dayDuration(p.outside),late:dayDuration(late>s.grace?late:0),earlyHours:dayDuration(early>(s.earlyGrace??0)?early:0),shortHours:dayDuration(rest?0:short),extraHours:dayDuration(extra),ot:x.otAllowed?dayDuration(roundOtMinutes(rest?work:extra,rest?s.offBands:s.otBands)):'',punchIssues:[]};
 }
 const i=toMin(x.in),o=toMin(x.out);const rest:Mark|null=x.off?'WO':x.holiday?'HD':null;
 if(i==null||o==null){const m:Mark=rest||(i==null&&o==null?'A':'MS');return {first:m,second:m,late:'',ot:'',workHours:''};}
 const s=x.shift;const start=s.start;let end=s.end;if(end<=start)end+=1440;
 const a=i;let b=o;if(b<=a)b+=1440;
 const lunchStart=start+Math.max(0,Math.floor((end-start-s.lunch)/2)),lunchEnd=lunchStart+s.lunch;
 const tea=(a<lunchStart?s.tea:0)+(b>lunchEnd?s.tea:0);
 // The marks go by the time inside the punches; the break deduction only shortens the work hours shown.
 const inside=Math.max(0,b-a-Math.max(0,Math.min(b,lunchEnd)-Math.max(a,lunchStart))-tea);const work=Math.max(0,inside-(x.deduct||0));
 if(rest)return {first:rest,second:rest,late:'',ot:x.otAllowed?dayDuration(roundOtMinutes(work,s.offBands)):'',workHours:dayDuration(work)};
 const lateBy=a-start;
 // Short of a full day, each half counts when the punches reach into it: in before lunch (and less than half-day minutes
 // late) for the 1st half, out after lunch for the 2nd.
 const [first,second]:Mark[]=inside>=s.fullDay?(lateBy>=s.halfDay?['A','P']:['P','P']):inside>=s.halfDay?[a<lunchStart&&lateBy<s.halfDay?'P':'A',b>lunchEnd?'P':'A']:['A','A'];
 // No late hours once the delay reaches half-day minutes less the grace (GN: 2:45 — Jul–Aug 2026: 561 of 561 such days).
 const late=first==='P'&&lateBy>s.grace&&lateBy<s.halfDay-s.grace?lateBy:0;const ot=x.otAllowed&&b>end?roundOtMinutes(b-end,s.otBands):0;
 return {first,second,late:dayDuration(late),ot:dayDuration(ot),workHours:dayDuration(work),earlyHours:dayDuration(Math.max(0,end-b)>(s.earlyGrace??0)?Math.max(0,end-b):0),shortHours:dayDuration(Math.max(0,(s.requiredMinutes??end-start-s.lunch-s.tea)-work)),extraHours:dayDuration(Math.max(0,work-(s.requiredMinutes??end-start-s.lunch-s.tea))),outsideHours:''};
}

// Minutes the original deducted from a day (breaks recorded by the machine), recovered from its saved work hours.
export function impliedDeduct(inTime:string,outTime:string,workHours:string|undefined,shift:ShiftRule){
 const w=toMin(workHours);if(w==null)return 0;const r=calcPunchDay({in:inTime,out:outTime,shift,off:false,holiday:false,otAllowed:false,deduct:0});const full=toMin(r.workHours);return full==null?0:Math.max(0,full-w);
}

const paidPresence=(d:AttendanceDay)=>[d.first,d.second].reduce((s,m)=>s+(workMarks.has(m)||leaveMarks.has(m)||m==='HD'?0.5:0),0);
export function resolveWeeklyOffs(days:AttendanceDay[],offDays:Set<number>,daily:boolean,minimum=3){
 return days.map((d,idx)=>{
  if(!offDays.has(d.day)||!(d.first==='WO'||d.first==='WO*')||!(d.second==='WO'||d.second==='WO*'))return d;
  let mark:Mark='WO*';
  if(!daily){const window:AttendanceDay[]=[];for(let k=idx-1;k>=0&&window.length<6;k--)if(!offDays.has(days[k].day))window.push(days[k]);for(let k=idx+1;k<days.length&&window.length<6;k++)if(!offDays.has(days[k].day))window.push(days[k]);
   if(window.reduce((s,w)=>s+paidPresence(w),0)>=minimum)mark='WO';}
  return {...d,first:mark,second:mark};});
}

export type Employment={doj:string;dol:string;daily:boolean;otAllowed:boolean;shiftName:string;offDays:Set<number>;holidays:Set<number>;weeklyOffMinimum?:number};
export const dateOf=(month:string,day:number)=>`${month}-${String(day).padStart(2,'0')}`;
export function blankDay(day:number):AttendanceDay{return {day,manualIn:'',manualOut:'',shift:'',first:'',second:'',ot:'',late:''};}

// "Machine Download": works the month out again from the punches (manual times take precedence over machine times).
export function processMonth(month:string,days:AttendanceDay[],job:Employment,shiftOf:(name:string)=>ShiftRule):AttendanceDay[]{
 const n=monthDays(month);const byDay=new Map(days.map(d=>[d.day,d]));
 const out=Array.from({length:n},(_,k):AttendanceDay=>{const d=k+1;const base=byDay.get(d)||blankDay(d);const shift=base.shift||job.shiftName;const date=dateOf(month,d);
  const clean:AttendanceDay={...base,shift,sourceStatus:undefined,sourceFirstCode:undefined,sourceSecondCode:undefined,sourceLateHours:undefined};
  if(job.doj&&date<job.doj)return {...clean,first:'NJ',second:'NJ',late:'',ot:'',workHours:''};
  if(job.dol&&date>job.dol)return {...clean,first:'LF',second:'LF',late:'',ot:'',workHours:''};
  const r=calcPunchDay({in:base.manualIn||base.machineIn||'',out:base.manualOut||base.machineOut||'',shift:shiftOf(shift),off:job.offDays.has(d),holiday:job.holidays.has(d),otAllowed:job.otAllowed,deduct:base.deduct||0,punches:base.manualIn||base.manualOut?undefined:base.punches});
  const keepFirst=enteredMarks.has(base.first),keepSecond=enteredMarks.has(base.second);
  return {...clean,first:keepFirst?base.first:r.first,second:keepSecond?base.second:r.second,late:keepFirst?'':r.late,ot:r.ot,workHours:r.workHours||undefined,earlyHours:r.earlyHours,shortHours:r.shortHours,extraHours:r.extraHours,outsideHours:r.outsideHours,punchIssues:r.punchIssues};});
 return resolveWeeklyOffs(out,job.offDays,job.daily,job.weeklyOffMinimum);
}

export type MonthFigures={worked:number;weeklyOff:number;holiday:number;leave:number;payable:number;absent:number;late:number;ot:number;work:number};
export function monthFigures(days:AttendanceDay[]):MonthFigures{
 const t:MonthFigures={worked:0,weeklyOff:0,holiday:0,leave:0,payable:0,absent:0,late:0,ot:0,work:0};
 for(const d of days){for(const m of [d.first,d.second]){if(workMarks.has(m))t.worked+=.5;else if(m==='WO')t.weeklyOff+=.5;else if(m==='HD')t.holiday+=.5;else if(leaveMarks.has(m))t.leave+=.5;else if(unpaidMarks.has(m))t.absent+=.5;}
  t.late+=toMin(d.late)||0;t.ot+=toMin(d.ot)||0;t.work+=toMin(d.workHours)||0;}
 t.payable=t.worked+t.weeklyOff+t.holiday+t.leave;return t;
}
export function withTotals(m:AttendanceMonth):AttendanceMonth{const f=monthFigures(m.days);
 const takenMonth=(code:string)=>m.days.reduce((s,d)=>s+(d.first===code?.5:0)+(d.second===code?.5:0),0);
 const ledger=m.leaveLedger.map(l=>{const taken=takenMonth(l.code);const open=typeof l.opening==='number'?l.opening:0;const year=typeof l.takenYear==='number'?l.takenYear:0;return {...l,takenMonth:Math.min(31,taken),balance:Math.max(-10000,Math.min(10000,open+(typeof l.earning==='number'?l.earning:0)-year-taken))};});
 return {...m,totals:{worked:f.worked,weeklyOff:f.weeklyOff,holiday:f.holiday,leave:f.leave,payable:f.payable,absent:f.absent},leaveLedger:ledger};}

// Seeded random numbers so a generated register comes out the same each time for the same employee and month.
function seeded(seed:string){let h=1779033703^seed.length;for(let i=0;i<seed.length;i++){h=Math.imul(h^seed.charCodeAt(i),3432918353);h=h<<13|h>>>19;}
 return ()=>{h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);h^=h>>>16;return (h>>>0)/4294967296;};}
const between=(rand:()=>number,from:number,to:number)=>from+Math.floor(rand()*(to-from+1));
function shuffle<T>(items:T[],rand:()=>number){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

// "T.Download" in Times: the register takes the Time Updation marks, with regular times on the days worked.
export function registerFromDaily(month:string,daily:AttendanceDay[],job:Employment,shiftOf:(name:string)=>ShiftRule,seed:string):AttendanceDay[]{
 const rand=seeded(seed+'|T|'+month);const byDay=new Map(daily.map(d=>[d.day,d]));
 return Array.from({length:monthDays(month)},(_,k)=>{const d=k+1;const src=byDay.get(d)||blankDay(d);const shift=src.shift||job.shiftName;const s=shiftOf(shift);
  const fallback:Mark=job.offDays.has(d)?'WO*':'A';const first:Mark=src.first||fallback;const second:Mark=src.second||first;
  let end=s.end;if(end<=s.start)end+=1440;const lunchStart=s.start+Math.max(0,Math.floor((end-s.start-s.lunch)/2)),lunchEnd=lunchStart+s.lunch;
  const am=workMarks.has(first),pm=workMarks.has(second);
  const inTime=am?clock(between(rand,s.start-5,s.start+4)):pm?clock(between(rand,lunchEnd-5,lunchEnd+4)):'';
  const outTime=pm?clock(between(rand,end,end+5)):am?clock(between(rand,lunchStart,lunchStart+5)):'';
  return {day:d,machineIn:'',machineOut:'',manualIn:inTime,manualOut:outTime,shift,first,second,ot:'',late:''};});
}

// "Day" in Times: builds a register month for the given paid days (Pd) with EL / CL / SL leave days and Hr overtime hours.
export function generateRegister(month:string,target:{pd:number;el:number;cl:number;sl:number;hr:number},job:Employment,shiftOf:(name:string)=>ShiftRule,seed:string):AttendanceDay[]{
 const rand=seeded(seed+'|D|'+month);const n=monthDays(month);const s=shiftOf(job.shiftName);
 const days:AttendanceDay[]=Array.from({length:n},(_,k)=>({...blankDay(k+1),machineIn:'',machineOut:'',shift:job.shiftName}));
 const working:number[]=[];let paidRest=0;
 for(const d of days){const date=dateOf(month,d.day);
  if(job.doj&&date<job.doj){d.first=d.second='NJ';continue;}if(job.dol&&date>job.dol){d.first=d.second='LF';continue;}
  if(job.offDays.has(d.day)){d.first=d.second='WO';paidRest++;continue;}if(job.holidays.has(d.day)){d.first=d.second='HD';paidRest++;continue;}
  working.push(d.day);}
 const leaves=[...Array(Math.max(0,Math.floor(target.el))).fill('EL'),...Array(Math.max(0,Math.floor(target.cl))).fill('CL'),...Array(Math.max(0,Math.floor(target.sl))).fill('SL')].slice(0,working.length) as Mark[];
 const present=Math.max(0,Math.min(working.length-leaves.length,Math.floor(target.pd)-paidRest-leaves.length));
 const order=shuffle(working,rand);const presentDays=new Set(order.slice(0,present));const leaveDays=order.slice(present,present+leaves.length);
 leaveDays.forEach((day,i)=>{const d=days[day-1];d.first=d.second=leaves[i];});
 const otDays=shuffle([...presentDays],rand);let otLeft=Math.max(0,Math.round(target.hr*60));const otOf=new Map<number,number>();
 for(let i=0;otLeft>0&&otDays.length&&i<otDays.length*4;i++){const day=otDays[i%otDays.length];const add=Math.min(60,otLeft);otOf.set(day,(otOf.get(day)||0)+add);otLeft-=add;}
 for(const day of working){const d=days[day-1];if(presentDays.has(day)){const ot=otOf.get(day)||0;d.first=d.second='P';d.machineIn=clock(between(rand,s.start-10,s.start+4));d.machineOut=clock(between(rand,s.end,s.end+5)+ot);d.ot=dayDuration(ot);}else if(!leaveDays.includes(day)){d.first=d.second='A';}}
 return days;
}
