import type {XlCell} from './client-api';

// "Unit salary sheets": the manual sheets of the units (UNIT-2, KISHOR, WARE HOUSE, Training) are all the same pattern:
//   Basic = Rate x paid days, extra buckets (days at the full rate, hours at rate/8), minus advance / late / camera deductions.
// The report fills what the database knows (card, name, rate master, paid days, single-punch days) and leaves the typed
// columns (hours, advance, PF, ESI ...) empty. Excel gets live formulas, so the typed numbers are worked out in Excel.
export type Spec=
 |{kind:'sno'|'card'|'name'|'text'}
 |{kind:'in'}
 |{kind:'mul';a:string;b:string;round:boolean}
 |{kind:'hrs';rate:string;hours:string}
 |{kind:'sum';of:string[];round:boolean}
 |{kind:'diff';from:string;minus:string[]}
 |{kind:'pct';of:string;pct:number};
export type SheetCol={key:string;head:string;spec:Spec;total:boolean};
export type Vals=Record<string,number|null>;

const col=(key:string,head:string,spec:Spec,total=true):SheetCol=>({key,head,spec,total});
const inp=(key:string,head:string)=>col(key,head,{kind:'in'});
const mul=(key:string,head:string,a:string,b:string,round:boolean)=>col(key,head,{kind:'mul',a,b,round});
const hrs=(key:string,head:string,hours:string)=>col(key,head,{kind:'hrs',rate:'rate',hours});
const sum=(key:string,head:string,of:string[],round=true)=>col(key,head,{kind:'sum',of,round});
const diff=(key:string,head:string,from:string,minus:string[])=>col(key,head,{kind:'diff',from,minus});
const head=(code:string)=>[col('sno','S.No',{kind:'sno'},false),col('card',code,{kind:'card'},false),col('name','EMP.NAME',{kind:'name'},false)];
const remark=col('remark','',{kind:'text'},false);

// title(month): the sheet's own heading for a month written like AUGUST-2026; sheetName: the Excel tab it came from.
export type UnitStyle={value:string;label:string;title:(month:string)=>string;sheetName:string;totalLabel?:string;cols:SheetCol[]};
export const unitStyles:UnitStyle[]=[
 {value:'unit2',label:'Unit Salary Sheet (UNIT-2 style)',title:m=>'UNIT 2 SALARY SHEET '+m.replace(/-\d\d(\d\d)$/,'-$1'),sheetName:'UNIT-2',cols:[...head('Card No.'),inp('rate','Rate Total'),inp('days','Pday'),mul('basic','Basic','rate','days',true),
  inp('np','New Presant'),mul('npAmt','Amt','rate','np',false),inp('hp','Holiday Presant'),mul('hpAmt','Amt','rate','hp',false),inp('lunch','Lunch'),hrs('lunchAmt','Amt','lunch'),
  inp('qc','Q/C Presant'),mul('qcAmt','Amt','rate','qc',false),inp('gate','Gate Presant'),mul('gateAmt','Amt','rate','gate',false),
  sum('total','Total Salary',['basic','npAmt','hpAmt','lunchAmt','qcAmt','gateAmt']),inp('adv','Advance'),inp('late','Late Hours'),hrs('lateAmt','Amt','late'),inp('cam','Camra Abs'),mul('camAmt','Amt','rate','cam',false),
  diff('net','Net Salary','total',['adv','lateAmt','camAmt']),inp('pf','PF'),inp('esi','ESI'),diff('earn','Earn Salary','net',['pf','esi']),remark]},
 {value:'kishor',label:'Unit Salary Sheet (KISHOR style)',title:m=>'Kishor Salary Sheet Month Of '+m,sheetName:'KISHOR SALARY SHEET',totalLabel:'Total & Amt',cols:[...head('Card No'),inp('rate','Rate Total'),inp('days','Paid day'),mul('basic','Basic','rate','days',true),
  inp('hp','Holiday Presant'),mul('hpAmt','Amt','rate','hp',true),inp('np','New Presant'),mul('npAmt','Amt','rate','np',true),inp('lunch','Lunch Hours'),hrs('lunchAmt','Amt','lunch'),
  inp('qual','Quality Presant'),mul('qualAmt','Amt','rate','qual',true),inp('gp','G/P Presant'),mul('gpAmt','Amt','rate','gp',true),inp('dprp','DP&RP'),mul('dprpAmt','Amt','rate','dprp',true),
  sum('total','Total Salary',['basic','hpAmt','npAmt','lunchAmt','qualAmt','gpAmt','dprpAmt']),inp('adv','Adv'),inp('late','Late Hours'),hrs('lateAmt','Amt','late'),inp('night','Night Hours'),hrs('nightAmt','Amt','night'),
  inp('cam','Camera Absent'),mul('camAmt','Amt','rate','cam',true),diff('earn','Earn Salary','total',['adv','lateAmt','nightAmt','camAmt']),remark]},
 {value:'warehouse',label:'Unit Salary Sheet (WARE HOUSE style)',title:m=>'WARE HOUSE AGRA EPIP SHEET '+m,sheetName:'WARE HOUSE',totalLabel:'TOTAL & AMT',cols:[...head('Paycode'),inp('rate','Rate Total'),inp('days','P day'),mul('basic','Basic','rate','days',true),
  inp('np','New Presant'),mul('npAmt','Amt','rate','np',false),inp('hp','Holiday Presant'),mul('hpAmt','Amt','rate','hp',true),inp('lunch','Lunch'),hrs('lunchAmt','Amt','lunch'),inp('delhi','Delhi Presant'),mul('delhiAmt','Amt','rate','delhi',true),
  sum('total','Total Salary',['basic','npAmt','hpAmt','lunchAmt','delhiAmt']),inp('abs','ABS'),mul('absAmt','Amt','rate','abs',true),diff('net','Net Salary','total',['absAmt']),remark]},
 {value:'training',label:'Unit Salary Sheet (Training style)',title:m=>'TRANING SALARY SHEET MONTH OF '+m.replace('-',' -'),sheetName:'Traning',cols:[...head('Card No'),inp('rate','Rate Total'),inp('days','P Day'),mul('basic','Basic','rate','days',true),
  inp('hp','Holiday Presant'),mul('hpAmt','Amt','rate','hp',false),inp('lunch','Lunch'),hrs('lunchAmt','Amt','lunch'),sum('total','Total Salary',['basic','hpAmt','lunchAmt'],false),
  col('esi','ESI Dedu.',{kind:'pct',of:'total',pct:0.0075}),diff('net','Net Salary','total',['esi']),remark]},
];

// Excel's ROUND (half away from zero).
const xround=(v:number)=>Math.sign(v)*Math.round(Math.abs(v)+1e-9);
const num=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?0:v;

// Fills the calculated columns (left to right) from the typed / prefilled ones.
export function computeRow(cols:SheetCol[],input:Vals):Vals{
 const v:Vals={...input};
 for(const c of cols){const s=c.spec;
  if(s.kind==='mul'){const x=num(v[s.a])*num(v[s.b]);v[c.key]=s.round?xround(x):x;}
  else if(s.kind==='hrs')v[c.key]=xround(num(v[s.hours])*num(v[s.rate])/8);
  else if(s.kind==='sum'){const x=s.of.reduce((a,k)=>a+num(v[k]),0);v[c.key]=s.round?xround(x):x;}
  else if(s.kind==='diff')v[c.key]=xround(s.minus.reduce((a,k)=>a-num(v[k]),num(v[s.from])));
  else if(s.kind==='pct')v[c.key]=xround(num(v[s.of])*s.pct);}
 return v;
}
export const colLetter=(i:number)=>{let n=i,s='';do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s;};

export type SheetRow={card:string;name:string;input:Vals};
// Title, header, one row per employee (row 3 on) and a totals row; calculated cells are live formulas.
export function excelRows(cols:SheetCol[],title:string,rows:SheetRow[],totalLabel?:string):XlCell[][]{
 const L=(k:string)=>colLetter(cols.findIndex(c=>c.key===k));const first=3,last=2+rows.length;
 const out:XlCell[][]=[[title],cols.map(c=>c.head)];
 rows.forEach((r,i)=>{const n=first+i;const v=computeRow(cols,r.input);
  out.push(cols.map(c=>{const s=c.spec;const at=(k:string)=>L(k)+n;
   if(s.kind==='sno')return i+1;if(s.kind==='card')return r.card;if(s.kind==='name')return r.name;if(s.kind==='text')return null;
   if(s.kind==='in')return v[c.key]??null;
   if(s.kind==='mul')return {f:s.round?`ROUND(${at(s.a)}*${at(s.b)},0)`:`${at(s.a)}*${at(s.b)}`,v:num(v[c.key])};
   if(s.kind==='hrs')return {f:`ROUND(${at(s.hours)}*${at(s.rate)}/8,0)`,v:num(v[c.key])};
   if(s.kind==='sum'){const body=s.of.map(at).join('+');return {f:s.round?`ROUND(${body},0)`:body,v:num(v[c.key])};}
   if(s.kind==='diff')return {f:`ROUND(${at(s.from)}${s.minus.map(k=>'-'+at(k)).join('')},0)`,v:num(v[c.key])};
   if(s.kind==='pct')return {f:`ROUND(${at(s.of)}*${s.pct},0)`,v:num(v[c.key])};
   return null;}));});
 if(rows.length){const sums:XlCell[]=cols.map((c):XlCell=>{if(!c.total)return null;const all=rows.map(r=>num(computeRow(cols,r.input)[c.key])).reduce((a,b)=>a+b,0);return {f:`SUM(${L(c.key)}${first}:${L(c.key)}${last})`,v:all};});if(totalLabel)sums[0]=totalLabel;out.push(sums);}
 return out;
}
