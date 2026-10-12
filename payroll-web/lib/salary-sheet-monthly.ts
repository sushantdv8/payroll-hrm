import membershipConfig from './salary-sheet-membership.json';
import {sheetTemplates,defaultSheetRules,footerFields,previousMonth,type SheetDocument,type SheetTemplate,type InputRow,type SheetCell} from './salary-sheets';
import type {Employee,AttendanceMonth} from './payroll';
import {monthDays} from './payroll';
import type {SalarySnapshot} from './backup';
import type {Calculated} from './salary-calc-core';
import {realResignDate,employeeSex,type Extra} from './report-utils';

type Membership={members:{dataset:string;key:string;sourceRow?:number;rate?:number}[];sampleCount:number};
const membership=membershipConfig as Record<string,Membership>;
export type MonthlyBasis={employee:Employee;attendance?:AttendanceMonth;salary?:SalarySnapshot;calculated:Calculated;rate:number;extra?:Extra;divisor:number;rateEdited?:boolean};
export type MonthlyStats={employees:number;saved:number;calculated:number;missing:number;unmatchedSample:number;excluded:{card:string;name:string;reason:string}[]};
const num=(v:number|null|undefined)=>v??0;
const isOt=(s:string)=>/\bOT\b|O\.T\.|OVERTIME/i.test(s);
const normalize=(s:string)=>s.trim().toLowerCase().replace(/\.0$/,'').replace(/\s+/g,' ');
export function monthEligible(e:Employee,month:string,hasRecord=false){
 const end=month+'-'+monthDays(month),start=month+'-01',left=realResignDate(e);
 return hasRecord||(!e.doj||e.doj<=end)&&(!left||left>=start)&&e.active!==false;
}
function members(t:SheetTemplate,dataset:string,reference?:SheetDocument){
 const original=(membership[t.id]?.members||[]).filter(m=>m.dataset===dataset);
 const byKey=new Map(original.map(m=>[m.key,m.sourceRow]));
 const byIdentity=new Map((reference?.rows||[]).map(r=>[normalize(r.card)+'|'+normalize(String(r.values[t.group==='comparison'?'D':'C']||'')),r.sourceRow]));
 return {byKey,byIdentity,original};
}
export function generateMonthlySheets(dataset:string,month:string,current:MonthlyBasis[],previous:MonthlyBasis[],scope='format',references:Record<string,SheetDocument>={},compareMonth=previousMonth(month)){
 const documents:Record<string,SheetDocument>={},stats:Record<string,MonthlyStats>={};
 const previousById=new Map(previous.map(b=>[b.employee.id,b]));
 for(const t of sheetTemplates){
  const reference=references[t.id],group=members(t,dataset,reference);
  const referenceIdentities=new Map((reference?.rows||[]).map(r=>[normalize(r.card)+'|'+normalize(String(r.values[t.group==='comparison'?'D':'C']||'')),r]));
  const referenceSourceRows=new Map((reference?.rows||[]).filter(r=>r.sourceRow!==undefined).map(r=>[r.sourceRow,r]));
  const selected=current.filter(b=>{
   const e=b.employee;if(!monthEligible(e,month,!!b.attendance||!!b.salary))return false;
   if(scope==='all'||t.group==='comparison'&&scope==='format')return true;
   if(scope.startsWith('department:'))return e.department===scope.slice(11);
   if(scope.startsWith('subCompany:'))return e.subCompany===scope.slice(11);
   return group.byKey.has(String(e.sourceKey||e.id))||group.byIdentity.has(normalize(e.cardNo||e.paycode)+'|'+normalize(e.name));
  });
  const s:MonthlyStats={employees:0,saved:0,calculated:0,missing:0,unmatchedSample:scope==='format'&&t.group!=='comparison'?Math.max(0,(reference?.rows.length??membership[t.id]?.sampleCount??0)-selected.length):0,excluded:[]};
  const rules={...defaultSheetRules(t,month),...reference?.rules,comparisonMonth:compareMonth};
  const rows:InputRow[]=[];selected.forEach(b=>{
   const e=b.employee,key=String(e.sourceKey||e.id),identity=normalize(e.cardNo||e.paycode)+'|'+normalize(e.name);
   const referenceRow=referenceIdentities.get(identity)??(group.byKey.has(key)?referenceSourceRows.get(group.byKey.get(key)):undefined);
   const knownRate=typeof referenceRow?.values.D==='number'?referenceRow.values.D:group.original.find(m=>m.key===key)?.rate;
   const refRate=b.rateEdited||b.salary?.sourceDataset==='manual'?knownRate!==undefined?b.rate:undefined:knownRate;
   const available=t.group==='unit'?!!(b.attendance||b.salary)&&((refRate??b.rate)>0||b.salary?.gross===0):actual(b).ready&&actual(b).paid!=null;
   if(!available){s.missing++;s.excluded.push({card:e.cardNo||e.paycode,name:e.name,reason:!b.attendance&&!b.salary?'No attendance or salary for '+month:'Salary rate / payable days missing for '+month});return;}
   const row=monthlyRow(t,month,b,previousById.get(e.id),rules.divisor,refRate,referenceRow);
   row.sourceRow=group.byKey.get(key)??group.byIdentity.get(identity);
   if(b.salary)s.saved++;else if(b.attendance)s.calculated++;else s.missing++;
   rows.push(row);
  });
  s.employees=rows.length;
  documents[t.id]={templateId:t.id,month,revision:0,rows,rules,formulaEdits:reference?.formulaEdits,sourceFile:'Application monthly records',generation:{scope},footerValues:Object.fromEntries((footerFields[t.id]||[]).map(f=>[f.address,f.identifier?null:0]))};stats[t.id]=s;
 }
 return {documents,stats};
}

function actual(b:MonthlyBasis){
 const salary=b.salary,calc=b.calculated;
 const ready=!!salary||!!b.attendance&&calc.hasRates;
 const gross=ready?salary?salary.gross:calc.result.gross:null;
 const paid=salary?salary.payableDays:b.attendance?calc.payableDays:null;
 const deductions=salary?.deductions??calc.result.deductions;
 const deduction=(label:string)=>deductions.filter(d=>d.label.trim().toUpperCase()===label).reduce((s,d)=>s+num(d.amount),0);
 const ot=ready?salary?num(salary.otAmount)||salary.earnings.filter(h=>isOt(h.label)).reduce((s,h)=>s+num(h.amount),0):calc.result.ot.amount:null;
 return {ready,gross,paid,pf:ready?deduction('PF'):null,esi:ready?deduction('ESI'):null,advance:ready?deduction('ADVANCE'):null,other:ready?deductions.filter(d=>!['PF','ESI','ADVANCE'].includes(d.label.trim().toUpperCase())).reduce((s,d)=>s+num(d.amount),0):null,ot,otHours:ready?salary?num(salary.otHours):calc.otHours:null};
}
function monthlyRow(t:SheetTemplate,month:string,b:MonthlyBasis,old:MonthlyBasis|undefined,divisor:string,referenceRate?:number,referenceRow?:InputRow):InputRow{
 const e=b.employee,x=b.extra,a=actual(b),values:Record<string,SheetCell>={},formulas:Record<string,string>={},overrides:Record<string,number>={};
 const card=e.cardNo||e.paycode||e.id;
 // Monthly extras are absent until entered in this month's sheet; never copy old attendance or adjustments.
 for(const c of t.columns)if(c.numeric&&!c.formula&&!t.links[c.key])values[c.key]=0;
 const days=divisor==='calendar'?monthDays(month):Number(divisor),daily=b.calculated.salMode==='1'||b.calculated.salMode==='2',dailyRate=daily?b.rate:b.rate/b.divisor;
 const label=b.salary?'Saved salary for '+month:b.attendance&&b.calculated.hasRates?'Calculated from '+month+' attendance and salary rates':'Missing '+(!b.attendance?'attendance':'salary rate')+' for '+month;
 if(t.group==='comparison'){
  Object.assign(values,{B:e.paycode,C:card,D:e.name,E:e.department,F:e.designation});
  const originalPast=old?actual(old):undefined,past=originalPast?.ready?originalPast:undefined;
  for(const [basis,data,cols] of [[old,past,['G','H','I','J','K','L']],[b,a,['M','N','O','P','Q','R']]] as const){
   values[cols[0]]=basis?.rate??0;values[cols[1]]=data?.ready?data.paid:cols[0]==='G'?0:null;
   values[cols[2]]=data?.ready?data.otHours:cols[0]==='G'?0:null;
   values[cols[3]]=data?.gross!=null?data.gross-num(data.ot):cols[0]==='G'?0:null;
   values[cols[4]]=data?.ready?data.ot:cols[0]==='G'?0:null;values[cols[5]]=data?.gross??(cols[0]==='G'?0:null);
  }
 }else if(t.group==='unit'){
  // These samples explicitly use a daily rate. Their maintained rates are reference inputs, not imported monthly earnings.
  const rate=referenceRate??(b.rate>0?dailyRate:b.salary?.gross===0?0:null),paid=b.attendance?b.calculated.payableDays:a.paid;
  Object.assign(values,{B:t.id==='unit-ware-house'?e.paycode:card,C:e.name,D:rate,E:paid});
  if(t.id==='unit-unit-2'){Object.assign(values,{R:a.advance??0,X:a.pf??(b.calculated.pf?null:0),Y:a.esi??(b.calculated.esi?null:0)});if(a.other)formulas.Z='ROUND(W-X-Y,0)-'+a.other;}
  else if(t.id==='unit-kishor-salary-sheet'){values.T=a.advance;formulas.AA='ROUND(S-T-V-X-Z,0)-'+(num(a.pf)+num(a.esi)+num(a.other));}
  else if(t.id==='unit-ware-house')formulas.R='ROUND(O-Q,0)-'+(num(a.pf)+num(a.esi)+num(a.advance)+num(a.other));
  else{if(a.esi!=null)overrides.L=a.esi;formulas.M='ROUND(K-L,0)-'+(num(a.pf)+num(a.advance)+num(a.other));}
  const remark=t.columns.filter(c=>/Remarks/.test(c.label)).at(-1)?.key;if(remark)values[remark]=(referenceRate!==undefined?'Sample daily rate; '+month+' attendance':label)+(a.ot?' · recorded OT '+a.ot+'; enter paid OT adjustment':'')+(a.other?' · other deductions '+a.other:'');
 }else{
  const monthlyRate=daily?b.rate*days:b.rate,sex=employeeSex(e,x),from=month+'-01',to=month+'-'+monthDays(month);
  if(t.group==='unit3'){
   Object.assign(values,{B:card,C:e.name,D:e.department,E:e.designation,F:e.fatherName,G:sex,H:x?.cat||'',I:e.aadhaar,J:e.doj,K:e.active===false?'N':'Y',L:from,M:to,N:1,O:b.calculated.pf?'Y':'N',P:'',Q:x?.pfNo||'',R:b.calculated.esi?'Y':'N',S:x?.esiNo||'',T:referenceRow?.values.T??null,U:monthlyRate||null,V:a.ready?a.paid:null});
   const long=t.id==='unit3-complaince-sheet';values[long?'AR':'AL']=a.advance;
   if(!b.calculated.pf)for(const k of long?['AK','AL']:['AH','AI'])overrides[k]=0;
   if(!b.calculated.esi)for(const k of long?['AM','AN']:['AJ','AK'])overrides[k]=0;
   if(t.id.startsWith('unit3-nats')&&a.pf!=null)values.AH=a.pf;
   const gross=long?'AJ':'AG',net=long?'AT':'AN';
   if(a.ready&&a.gross!=null&&a.paid!=null){const base=Math.round(monthlyRate/days*a.paid),adjust=a.gross-base;if(adjust)formulas[gross]=(long?'ROUND(AI/DAYS*AG,0)':'ROUND(AF/DAYS*AD,0)')+(adjust<0?'':'+')+adjust;}
   if(a.other)formulas[net]=(long?'AJ-AS':'AG-AM')+'-'+a.other;
   // Category-specific compliance rates cannot be inferred from actual salary: only a matching reference supplies them.
  }else{
   Object.assign(values,{B:card,C:e.name,D:e.designation,E:sex,F:x?.cat||'',G:e.aadhaar,H:e.doj,I:e.active===false?'N':'Y',J:from,K:to,L:1,M:b.calculated.pf?'YES':'NO',N:'',O:x?.pfNo||'',P:a.pf,T:b.calculated.esi?'YES':'NO',U:x?.esiNo||'',X:e.pan,Y:a.ready?a.paid:null,Z:monthlyRate||null,AD:a.advance,AF:a.ready?num(b.salary?.net??b.calculated.result.net):null,AG:null,AI:e.paymentMode||'',AJ:'',AK:Number(month.slice(0,4)),AL:new Date(month+'-01T00:00:00Z').toLocaleString('en-US',{month:'long',timeZone:'UTC'})});
   if(!b.calculated.esi){overrides.V=0;overrides.W=0;}
  }
 }
 return {card,values,formulas,overrides,note:label};
}
