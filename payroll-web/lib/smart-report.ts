// Pure helpers of the smart report view (the table view of the report screens): the text of a cell, sorting like a person expects, sums of columns, and how a day's marks are read.
// No imports and only plain TypeScript, so scripts/test-smart-report.mjs can run it with node.
export type Tone='ok'|'bad'|'warn'|'info'|'mute';

// The text of a table cell: strings and numbers as they are, React elements by their children (<br/> and the like give a space).
export function nodeText(n:unknown):string{
 if(n==null||typeof n==='boolean')return '';
 if(typeof n==='string')return n;
 if(typeof n==='number'||typeof n==='bigint')return String(n);
 if(Array.isArray(n))return n.map(nodeText).join('').replace(/\s+/g,' ').trim();
 if(typeof n==='object'){const el=n as {type?:unknown;props?:{children?:unknown}};
  if(el.type==='br')return ' ';
  return nodeText(el.props?.children);}
 return '';
}

// What a value sorts by: times (8:05), dates (31/08/2026, 31-08-2026, 2026-08-31) and numbers (1,234.50) by their value, everything else as text; empty values sort last.
export type SortKey={k:'empty'}|{k:'num';n:number}|{k:'text';s:string};
export function sortKey(text:string):SortKey{
 const t=text.trim();if(!t)return {k:'empty'};
 let m=/^(\d{1,3}):([0-5]\d)$/.exec(t);if(m)return {k:'num',n:Number(m[1])*60+Number(m[2])};
 m=/^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(t);if(m)return {k:'num',n:Number(m[3])*10000+Number(m[2])*100+Number(m[1])};
 m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(t);if(m)return {k:'num',n:Number(m[1])*10000+Number(m[2])*100+Number(m[3])};
 if(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(t)||/^-?\d+(\.\d+)?$/.test(t))return {k:'num',n:Number(t.replace(/,/g,''))};
 return {k:'text',s:t.toLowerCase()};
}
// -1 / 0 / 1 like Array#sort; dir -1 turns it round but empty values stay last.
export function compareKeys(a:SortKey,b:SortKey,dir:1|-1=1):number{
 if(a.k==='empty'||b.k==='empty')return a.k===b.k?0:a.k==='empty'?1:-1;
 if(a.k==='num'&&b.k==='num')return (a.n-b.n)*dir;
 const x=a.k==='num'?String(a.n):a.s,y=b.k==='num'?String(b.n):b.s;
 return x.localeCompare(y,undefined,{numeric:true,sensitivity:'base'})*dir;
}

// How a column adds up: every filled value a time (8:05) -> hours and minutes, every one a number -> the sum; otherwise it does not.
export function sumColumn(values:string[]):{kind:'time'|'num';text:string}|null{
 const filled=values.map(v=>v.trim()).filter(Boolean);if(!filled.length)return null;
 if(filled.every(v=>/^\d{1,3}:[0-5]\d$/.test(v))){const mins=filled.reduce((s,v)=>{const [h,m]=v.split(':').map(Number);return s+h*60+m;},0);return {kind:'time',text:`${Math.floor(mins/60)}:${String(mins%60).padStart(2,'0')}`};}
 if(filled.every(v=>/^-?\d+(\.\d+)?$/.test(v.replace(/,/g,'')))){const sum=filled.reduce((s,v)=>s+Number(v.replace(/,/g,'')),0);return {kind:'num',text:String(Math.round(sum*100)/100)};}
 return null;
}

export const LEAVE_CODES=['EL','PL','CL','SL','CO','MT','SP'];
export type DayKind='present'|'half'|'absent'|'leave'|'off'|'mispunch'|'none';
const worked=(c:string)=>c==='P'||c==='OD'||c==='WO*'||c==='HD*';
const unpaid=(c:string)=>c==='A'||c==='LWP';
const offDay=(c:string)=>c==='WO'||c==='HD';
const CODE_NAME:Record<string,string>={P:'Present',OD:'On duty','WO*':'Worked on weekly off','HD*':'Worked on holiday',A:'Absent',LWP:'Absent (LWP)',WO:'Weekly off',HD:'Holiday',MS:'Mispunch',NJ:'Not joined',LF:'Left'};
// Reads the two half-day marks of a day (and whether it has a punch): what kind of day it is, its text and its colour.
export function classifyDay(first:string,second:string,punched:boolean):{kind:DayKind;label:string;tone:Tone|''}{
 const a=first||'',b=second||'';
 if(a===b){
  if(!a)return punched?{kind:'none',label:'Not processed',tone:''}:{kind:'none',label:'No entry',tone:''};
  if(worked(a))return {kind:'present',label:CODE_NAME[a],tone:'ok'};
  if(unpaid(a))return {kind:'absent',label:CODE_NAME[a],tone:'bad'};
  if(LEAVE_CODES.includes(a))return {kind:'leave',label:'Leave '+a,tone:'info'};
  if(offDay(a))return {kind:'off',label:CODE_NAME[a],tone:'mute'};
  if(a==='MS')return {kind:'mispunch',label:CODE_NAME.MS,tone:'warn'};
  return {kind:'none',label:CODE_NAME[a]||a,tone:'mute'};
 }
 const marks=`${a||'-'}/${b||'-'}`;
 if(worked(a)||worked(b))return {kind:'half',label:`Half day (${marks})`,tone:'warn'};
 if(unpaid(a)||unpaid(b))return {kind:'absent',label:marks,tone:'bad'};
 if(LEAVE_CODES.includes(a)||LEAVE_CODES.includes(b))return {kind:'leave',label:`Leave ${marks}`,tone:'info'};
 if(a==='MS'||b==='MS')return {kind:'mispunch',label:marks,tone:'warn'};
 return {kind:'off',label:marks,tone:'mute'};
}
// Tone of a row that has several things to say: absent beats mispunch / late / half day, those beat leave, leave beats off, off beats a plain present.
const RANK:Record<string,number>={bad:5,warn:4,info:3,mute:2,ok:1,'':0};
export const worstTone=(...tones:(Tone|'')[]):Tone|''=>tones.reduce((w,t)=>RANK[t]>RANK[w]?t:w,'' as Tone|'');
