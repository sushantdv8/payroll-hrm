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
export function alternatingPunches(times:string[]):Punch[]{
 let day=0,last=-1;return times.map((time,i)=>{const m=clockMinute(time)??0;if(m<last)day++;last=m;return {time,kind:i%2?'OUT':'IN',dayOffset:day};});
}
export function parsePunchText(text:string):Punch[]{
 return text.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean).map((s,i)=>{const m=/^(?:(IN|OUT)\s+)?((?:[01]\d|2[0-3]):[0-5]\d)(?:\s*\+(1))?$/i.exec(s);if(!m)throw new Error('Use IN 09:00, OUT 11:00, IN 13:00, OUT 18:00. Add +1 after next-day times.');return {time:m[2],kind:(m[1]?.toUpperCase()||(i%2?'OUT':'IN')) as Punch['kind'],dayOffset:m[3]?1:0};});
}
export const punchText=(punches:Punch[])=>punches.map(p=>`${p.kind} ${p.time}${p.dayOffset?' +1':''}`).join(', ');
