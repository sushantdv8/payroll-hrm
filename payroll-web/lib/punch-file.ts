import {alternatingPunches,type Punch} from './multi-punch';
import type {Employee} from './payroll';

// "Machine Data Copy": reads an attendance-machine punch export (CSV / TXT, one punch or one day per line) such as
//   101,2026-09-01 09:02:11      101<TAB>01/09/2026<TAB>09:02<TAB>18:05      "101","Ram","01-09-2026","09:02 AM"
// Each line needs the employee's card number (or paycode), a date and one or more times. When the file has a header
// row naming the employee column (EnrollNo, Card No, Emp Code, User ID, Paycode…) only that column is used; otherwise
// the first value on the line that is a known card number / paycode. The first punch of a day is the in time and the
// last one the out time.
export type PunchCopy={byEmployee:Map<string,Map<number,{in:string;out:string;punches:Punch[]}>>;days:number;lines:number;unmatched:number};
const pad=(n:number)=>String(n).padStart(2,'0');
const clock=(m:number)=>pad(Math.floor(m/60))+':'+pad(m%60);
const DATE=/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})/;
const TIME=/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s*([AaPp])\.?[Mm]\.?)?(?![\d:])/g;
const ID_HEADER=/enrol|card|emp.?(code|no|id)|user.?id|pay.?code|badge|ac.?no|staff/i;
const bare=(v:string)=>v.trim().toLowerCase().replace(/^0+(?=.)/,'');
const cells=(line:string)=>(/[,;\t|]/.test(line)?line.split(/[,;\t|]/):line.split(/\s+/)).map(c=>c.trim().replace(/^"|"$/g,''));

export function readPunchFile(text:string,month:string,employees:Employee[]):PunchCopy{
 const card=new Map<string,string>(),cardBare=new Map<string,string>(),code=new Map<string,string>();
 for(const e of employees){code.set(bare(e.paycode),e.id);if(e.cardNo){cardBare.set(bare(e.cardNo),e.id);}}
 for(const e of employees){card.set(e.paycode.trim().toLowerCase(),e.id);if(e.cardNo)card.set(e.cardNo.trim().toLowerCase(),e.id);}
 // Leading zeros are ignored only for values of 3 or more characters, so a serial number such as "5" is not taken for card 00005.
 const find=(tokens:string[])=>tokens.map(t=>card.get(t)).find(Boolean)||tokens.filter(t=>t.length>=3).map(t=>cardBare.get(bare(t))||code.get(bare(t))).find(Boolean);
 const minutes=new Map<string,Map<number,number[]>>();let lines=0,unmatched=0;let idColumn=-1;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line)continue;const dm=DATE.exec(line);
  if(!dm){if(idColumn<0)idColumn=cells(line).findIndex(c=>ID_HEADER.test(c));continue;}
  let y:number,mo:number,d:number;if(dm[1]){y=+dm[1];mo=+dm[2];d=+dm[3];}else{d=+dm[4];mo=+dm[5];y=+dm[6];if(y<100)y+=2000;}
  if(`${y}-${pad(mo)}`!==month||d<1||d>31)continue;
  const rest=line.slice(0,dm.index)+' '+line.slice(dm.index+dm[0].length);
  const times=[...rest.matchAll(TIME)].map(t=>{let h=+t[1];const ap=(t[3]||'').toLowerCase();if(ap==='p'&&h<12)h+=12;if(ap==='a'&&h===12)h=0;return h*60+ +t[2];});
  if(!times.length)continue;lines++;
  const column=idColumn>=0?cells(line)[idColumn]:undefined;
  const tokens=(column!==undefined?[column]:(rest.replace(TIME,' ').match(/[A-Za-z0-9_-]+/g)||[]).filter(t=>/\d/.test(t))).map(t=>t.trim().toLowerCase()).filter(Boolean);
  const id=find(tokens);if(!id){unmatched++;continue;}
  let days=minutes.get(id);if(!days)minutes.set(id,days=new Map());days.set(d,[...(days.get(d)||[]),...times]);
 }
 const byEmployee=new Map<string,Map<number,{in:string;out:string;punches:Punch[]}>>();let count=0;
 for(const [id,days] of minutes){const out=new Map<number,{in:string;out:string;punches:Punch[]}>();for(const [d,list] of days){const first=Math.min(...list),last=Math.max(...list);out.set(d,{in:clock(first),out:last>first?clock(last):'',punches:alternatingPunches([...new Set(list)].sort((a,b)=>a-b).map(clock))});count++;}byEmployee.set(id,out);}
 return {byEmployee,days:count,lines,unmatched};
}
