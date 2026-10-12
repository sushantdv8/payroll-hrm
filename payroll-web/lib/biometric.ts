import {alternatingPunches,type Punch} from './multi-punch';
import type {Employee} from './payroll';

// Attendance fetch from the "Biometric Attendance" app (work_copy/biometric-web), which downloads the punches of the
// eSSL / ZKTeco machines into its own database and serves them on http://127.0.0.1:5180. The payroll server reads
// them from there; nothing here talks to a machine directly.
export const DEFAULT_BIO_URL='http://127.0.0.1:5180';
// Per company (dataset): the app's address and the machines (the app's machine ids) whose punches belong to this
// company (none chosen = all). Ids, not names: a machine can be renamed in the app.
export type BioConfig={url:string;devices:number[]};
// Machine user ID -> employee id ('-' = not an employee, never matched).
export type BioMap=Record<string,string>;
export type BioHistoryEntry={at:string;month:string;from:number;to:number;employees:number;days:number;unmatched:number;calculated:boolean};
export type BioSettings={config:BioConfig;map:BioMap;history:BioHistoryEntry[];revisions:{config:number;map:number}};
export type BioDevice={id:number;name:string;ip:string;port:number;status:string;message:string|null;syncedAt:string|null;checkedAt:string|null;storedLogs:number;lastPunch:string|null;storedUsers:number;busy:string|null;sameNetwork:boolean};
export type BioState={devices:BioDevice[];autoMinutes:number;totals:{logs:number;people:number;first:string|null;last:string|null}};
// Machine users seen in the punches of the last two months (the app's own user list is too slow to read on a big database).
export type BioUser={userId:string;name:string;devices:string[];lastPunch:string|null;punches:number};
// Raw punches of each machine user, 'YYYY-MM-DD HH:MM' sorted, from the day before the range to the day after it.
export type BioPunches={users:Record<string,{name:string;t:string[]}>;punches:number;from:string;to:string};

export function cleanBioUrl(value:string){const s=value.trim().replace(/\/+$/,'');return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(s)?s:null;}

// The app's "Punch logs" CSV: User ID,Name,Date Time,Machine,Verify Mode,Punch (quoted cells, '=' / '+' / '@' prefixed with ').
export function parseLogsCsv(text:string){
 const out:{userId:string;name:string;ts:string;machine:string}[]=[];let row:string[]=[],cell='',quoted=false,header=true;
 const s=text.replace(/^﻿/,'');
 const unquote=(v:string)=>/^'[=+@]/.test(v)?v.slice(1):v;
 const end=()=>{row.push(cell);cell='';if(header){header=false;}else if(row.length>=4&&row[0]){out.push({userId:unquote(row[0]).trim(),name:unquote(row[1]||'').trim(),ts:row[2].trim(),machine:unquote(row[3]).trim()});}row=[];};
 for(let i=0;i<s.length;i++){const c=s[i];
  if(quoted){if(c==='"'){if(s[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;continue;}
  if(c==='"')quoted=true;else if(c===',' ){row.push(cell);cell='';}else if(c==='\n'){end();}else if(c!=='\r')cell+=c;}
 if(cell||row.length)end();
 return out;
}

// Machine user ID -> employee. A saved choice wins; then the employee whose Card No. equals the ID (the machine ID is
// normally the card number), then the paycode; leading zeros are ignored (machine ID 5 = card 00005).
// - A card or paycode used by more than one employee goes to the one still working (latest joining first), not to
//   someone who has left.
// - Paycode is only a fallback: an employee already matched by a manual choice or a card keeps that one machine ID,
//   so a second person's ID that happens to equal the paycode is not merged into the same attendance.
export type Match={employeeId:string|null;how:'manual'|'ignored'|'card'|'paycode'|'none'};
const leftOf=(e:Employee)=>{const d=(e.resignDate||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)&&d<'2099';};
export function matchAll(employees:Employee[],map:BioMap,userIds:string[]):Map<string,Match>{
 const ids=new Set(employees.map(e=>e.id));const bare=(v:string)=>v.trim().toLowerCase().replace(/^0+(?=.)/,'');
 const order=[...employees].sort((a,b)=>Number(leftOf(a))-Number(leftOf(b))||(b.doj||'').localeCompare(a.doj||''));
 const card=new Map<string,string>(),code=new Map<string,string>();
 for(const e of order){const c=bare(e.cardNo||''),p=bare(e.paycode);if(c&&!card.has(c))card.set(c,e.id);if(p&&!code.has(p))code.set(p,e.id);}
 const out=new Map<string,Match>();const claimed=new Set<string>();const later:string[]=[];
 for(const u of userIds){const m=map[u];if(m==='-'){out.set(u,{employeeId:null,how:'ignored'});continue;}if(m&&ids.has(m)){out.set(u,{employeeId:m,how:'manual'});claimed.add(m);continue;}
  const c=card.get(bare(u));if(c){out.set(u,{employeeId:c,how:'card'});claimed.add(c);continue;}later.push(u);}
 for(const u of later){const p=code.get(bare(u));out.set(u,p&&!claimed.has(p)?{employeeId:p,how:'paycode'}:{employeeId:null,how:'none'});}
 return out;
}
// Single-ID form (the IDs seen together are not known): same order of preference.
export function matcher(employees:Employee[],map:BioMap){return (userId:string):Match=>matchAll(employees,map,[userId]).get(userId)!;}

// The machines' punches of each employee per calendar day, exactly as recorded (Multi Punch Report): no duty-day
// shifting, so a punch after midnight stays on its own date, and repeats a minute or more apart are kept; only a
// punch with the very same minute (two machines, or the machine's own double record) is listed once.
// Returns employee id -> 'YYYY-MM-DD' -> 'HH:MM' list (ascending), for the days from..to.
export function rawPunchDays(employees:Employee[],map:BioMap,data:BioPunches,from:string,to:string){
 const match=matchAll(employees,map,Object.keys(data.users));const sets=new Map<string,Map<string,Set<string>>>();
 for(const [userId,u] of Object.entries(data.users)){const id=match.get(userId)?.employeeId;if(!id)continue;
  const days=sets.get(id)||new Map<string,Set<string>>();sets.set(id,days);
  for(const t of u.t){const date=t.slice(0,10);if(date<from||date>to)continue;const set=days.get(date)||new Set<string>();set.add(t.slice(11,16));days.set(date,set);}}
 const out=new Map<string,Map<string,string[]>>();
 for(const [id,days] of sets){const list=new Map<string,string[]>();for(const [date,set] of days)list.set(date,[...set].sort());out.set(id,list);}
 return out;
}

// Punches -> one in / out per duty day, by the shift of each day (Monthly Shift Change included):
// - a punch earlier than 4 hours before that day's shift start belongs to the previous day's duty, so overtime past
//   midnight stays on the day it started (shift 09:00: punches before 05:00 go back a day);
// - after a night shift (end before start, e.g. 20:00-08:00), punches up to 4 hours after its end are still that night's.
// Every punch is placed on its own, so a missing in or out punch only affects its own day.
// The first punch is the in time and the last one the out time; punches within 2 minutes of the in are repeats.
// Returns duty date -> {in,out,n}; dates outside the range asked for are dropped by the caller.
type ShiftTimes={start:number;end:number};
const REPEAT=2,EARLY=240,AFTER_NIGHT=240;
const dayMinutes=(t:string)=>Date.UTC(+t.slice(0,4),+t.slice(5,7)-1,+t.slice(8,10))/60000+(+t.slice(11,13))*60+(+t.slice(14,16));
const dateOf=(m:number)=>new Date(m*60000).toISOString().slice(0,10);
const hm=(m:number)=>{const x=((m%1440)+1440)%1440;return String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');};
export function dutyDays(times:string[],shiftFor:(date:string)=>ShiftTimes):Map<string,{in:string;out:string;n:number;punches:Punch[]}>{
 const list=[...new Set(times)].map(dayMinutes).sort((a,b)=>a-b);const groups=new Map<string,{first:number;last:number;n:number;all:number[]}>();
 for(const m of list){const today=dateOf(m),yesterday=dateOf(m-1440),tod=((m%1440)+1440)%1440;const cur=shiftFor(today),prev=shiftFor(yesterday);
  const afterNight=prev.end<=prev.start&&tod<prev.end+AFTER_NIGHT;const beforeStart=cur.start>=EARLY&&tod<cur.start-EARLY;
  const date=afterNight||beforeStart?yesterday:today;const g=groups.get(date);if(g){g.last=m;g.n++;g.all.push(m);}else groups.set(date,{first:m,last:m,n:1,all:[m]});}
 const out=new Map<string,{in:string;out:string;n:number;punches:Punch[]}>();
 for(const [date,g] of groups)out.set(date,{in:hm(g.first),out:g.last-g.first>REPEAT?hm(g.last):'',n:g.n,punches:alternatingPunches(g.all.filter((m,i,all)=>!i||m-all[i-1]>REPEAT).map(hm))});
 return out;
}
