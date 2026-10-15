export type Punch={time:string;kind:'IN'|'OUT';dayOffset?:number};
export type PunchResult={pairs:{start:number;end:number}[];first:number|null;last:number|null;inside:number;outside:number;issues:string[]};
export const clockMinute=(s:string)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)?Number(s.slice(0,2))*60+Number(s.slice(3)):null;
export function analysePunches(punches:Punch[]):PunchResult{
 const issues:string[]=[],pairs:{start:number;end:number}[]=[];let open:number|null=null,previous=-1;
 for(const p of punches){const c=clockMinute(p.time);if(c===null||![0,1].includes(p.dayOffset||0)){issues.push('Invalid punch time');continue;}
  const m=c+1440*(p.dayOffset||0);if(m<previous){issues.push('Punches must be in chronological order');continue;}previous=m;
  if(p.kind==='IN'){if(open!==null)issues.push('IN without the preceding OUT');else open=m;}
  else if(open===null)issues.push('OUT without an IN');else {if(m<=open)issues.push('OUT must be after IN');else pairs.push({start:open,end:m});open=null;}
 }
 if(open!==null)issues.push('Missing final OUT');
 const first=pairs[0]?.start??null,last=pairs.at(-1)?.end??null,inside=pairs.reduce((s,p)=>s+p.end-p.start,0);
 if(first!==null&&last!==null&&last-first>1440)issues.push('A duty day must not span more than 24 hours');
 return {pairs,first,last,inside,outside:first!==null&&last!==null?Math.max(0,last-first-inside):0,issues:[...new Set(issues)]};
}
// A day whose punches do not alternate IN / OUT (an odd number of punches: one is missing in the middle) still has its first and last punch: the original takes such a
// day as one stretch from the first to the last punch - the punches in between are ignored, only the lunch comes off the hours (checked on the machines' raw punches
// of 2026-09-23, the one day of them in its archive: 4 of 4 days with 3 or 5 punches, even counts are paired as usual, 48 of 48). null: this is not such a day (a bad
// time, punches out of order, fewer than two punches). The caller keeps the issues, so the day is still reported as incomplete.
const ALTERNATION=new Set(['IN without the preceding OUT','OUT without an IN','Missing final OUT']);
export function lenientPunches(punches:Punch[],strict:PunchResult):PunchResult|null{
 if(!strict.issues.length||strict.issues.some(i=>!ALTERNATION.has(i)))return null;
 const minutes=punches.map(p=>{const c=clockMinute(p.time);return c===null?null:c+1440*(p.dayOffset||0);}).filter((m):m is number=>m!==null);
 if(minutes.length<2||minutes[minutes.length-1]<=minutes[0])return null;
 const first=minutes[0],last=minutes[minutes.length-1];
 return {pairs:[{start:first,end:last}],first,last,inside:last-first,outside:0,issues:strict.issues};
}
export function alternatingPunches(times:string[]):Punch[]{
 let day=0,last=-1;return times.map((time,i)=>{const m=clockMinute(time)??0;if(m<last)day++;last=m;return {time,kind:i%2?'OUT':'IN',dayOffset:day};});
}
export function parsePunchText(text:string):Punch[]{
 return text.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean).map((s,i)=>{const m=/^(?:(IN|OUT)\s+)?((?:[01]\d|2[0-3]):[0-5]\d)(?:\s*\+(1))?$/i.exec(s);if(!m)throw new Error('Use IN 09:00, OUT 11:00, IN 13:00, OUT 18:00. Add +1 after next-day times.');return {time:m[2],kind:(m[1]?.toUpperCase()||(i%2?'OUT':'IN')) as Punch['kind'],dayOffset:m[3]?1:0};});
}
export const punchText=(punches:Punch[])=>punches.map(p=>`${p.kind} ${p.time}${p.dayOffset?' +1':''}`).join(', ');
