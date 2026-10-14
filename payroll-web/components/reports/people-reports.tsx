import {Fragment,type ReactNode} from 'react';
import {useQueries} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {trimCell,type MasterRow} from '@/lib/masters';
import {dmy,employeePayMode,employeeSex,monthLabel,realResignDate} from '@/lib/report-utils';
import {exportExcel,requestJson} from '@/lib/client-api';
import type {ReportConfig,ReportContext,ReportOption,ReportPage} from './report-form';
import {appointmentHindiPage,dutyJoinPage,personalFormOptions} from './personal-forms';
import {Header,extraOf,listName,n2,ownerOf,tablePages,type Column} from './report-parts';
import {Sections,masterQuery} from './salary-reports';

const ALL_FILTERS=['company','subCompany','location','dhead','department','designation','category','salaryGrade','leaveGrade','shift'] as const;
const today=(ctx:ReportContext)=>dmy(ctx.printDate||new Date().toISOString().slice(0,10));
const age=(dob:string,on:string)=>{if(!dob||dob>='2099')return '';const a=new Date(on||Date.now()),b=new Date(dob);let y=a.getFullYear()-b.getFullYear();if(a<new Date(a.getFullYear(),b.getMonth(),b.getDate()))y--;return y>0&&y<120?String(y):'';};

function Kv({items}:{items:[string,string][]}){return <div className="rpt-kv">{items.map(([k,v])=><Fragment key={k}><b>{k}</b><span>{v||'—'}</span></Fragment>)}</div>;}
function biodata(ctx:ReportContext,e:Employee){const x=extraOf(ctx,e);return <><Header ctx={ctx} title="Personal Detail / Biodata"/>
 <div className="rpt-section-title">Personal</div><Kv items={[['Paycode',e.paycode],['Attn. Card No.',e.cardNo],['Employee Name',e.name],['Father / Husband Name',e.fatherName],['Mother Name',e.motherName],['Wife Name',e.wifeName],['Date Of Birth',dmy(e.dob)],['Sex',employeeSex(e,x)],['Marital Status',e.maritalStatus],['Blood Group',e.bloodGroup],['Religion',e.religion],['Phone No.',e.phone],['Email',e.email],['Education Quali.',e.education],['Technical Quali.',e.technicalQualification],['Height / Weight',[e.height,e.weight].filter(Boolean).join(' / ')]]}/>
 <div className="rpt-section-title">Identity</div><Kv items={[['PAN No.',e.pan],['Adhar No.',e.aadhaar],['D.L. No.',e.dlNo],['Passport No.',e.passport],['PF No.',x?.pfNo||''],['ESI No.',x?.esiNo||'']]}/>
 <div className="rpt-section-title">Work</div><Kv items={[['Date Of Join',dmy(e.doj)],['Resign Date',dmy(realResignDate(e))],['Company / Sub Company',e.subCompany],['Location',e.location],['Department',e.department],['Designation',e.designation],['Category',listName(ctx,'tbcat',x?.cat)],['Salary Grade',listName(ctx,'tbsalg',x?.salg)],['Leave Grade',listName(ctx,'tblvgrade',x?.lvg)],['Shift',listName(ctx,'tbshift',x?.sft)]]}/>
 <div className="rpt-section-title">Payment</div><Kv items={[['Payment Mode',employeePayMode(e,x)],['Bank Name',e.bankName],['Account No.',e.accountNo],['IFSC',e.ifsc]]}/>
 <div className="rpt-section-title">Address</div><Kv items={[['Local Address',e.localAddress],['Permanant Address',e.permanentAddress]]}/>
 <div style={{display:'flex',justifyContent:'space-between',marginTop:'30mm',fontSize:'12px'}}><span>Signature of Employee</span><span>Authorised Signatory</span></div></>;}
function letter(ctx:ReportContext,title:string,paragraphs:string[]){return <div className="rpt-letter"><Header ctx={ctx} title=""/><div style={{display:'flex',justifyContent:'space-between'}}><span>Ref. No. ____________</span><span>Date : {today(ctx)}</span></div><h2 style={{margin:'10mm 0 8mm',textDecoration:'underline'}}>{title}</h2>{paragraphs.map((p,i)=><p key={i}>{p}</p>)}<div style={{marginTop:'22mm'}}><p>For {ctx.company.name}</p><p style={{marginTop:'16mm'}}>Authorised Signatory</p></div></div>;}
const to=(e:Employee)=>`${e.name}${e.fatherName?`, ${e.fatherName}`:''}`;
// label: the viewer's group-tree entry of the page; by default the paycode, the Personal File letters list the page under its employee.
const ofEmployee=(e:Employee):Pick<ReportPage,'owners'>=>({owners:[ownerOf(e)]});
const perEmployee=(key:string,make:(ctx:ReportContext,e:Employee)=>ReactNode,label:(e:Employee)=>Pick<ReportPage,'tree'|'owners'>=e=>({tree:e.paycode}))=>(ctx:ReportContext):ReportPage[]=>ctx.employees.map(e=>({key:key+e.id,orientation:'portrait',...label(e),node:make(ctx,e)}));
// Reports › Personal File forms. The forms the original lists but this file does not build itself live in personal-forms.tsx.
const legacy=(value:string)=>personalFormOptions.find(o=>o.value===value)!;
const english=(ctx:ReportContext)=>ctx.options.choice==='english';
const appointmentEnglish=perEmployee('ap',(ctx,e)=>letter(ctx,'APPOINTMENT LETTER',[`To, ${to(e)}`,`${e.localAddress||''}`,`Dear ${e.name},`,`We are pleased to appoint you as ${e.designation||'________'} in the ${e.department||'________'} department of ${ctx.company.name} with effect from ${dmy(e.doj)||'__________'}.`,'Your terms of employment, salary and other conditions will be as per the rules of the company as amended from time to time.','Please sign the duplicate copy of this letter in token of your acceptance.']),ofEmployee);
const dutyJoinEnglish=perEmployee('dje',(ctx,e)=>letter(ctx,'DUTY JOINING REPORT',[`To, The Manager, ${ctx.company.name}`,`I, ${to(e)}, report for duty as ${e.designation||'________'} in the ${e.department||'________'} department on ${dmy(e.doj)||'__________'}.`,`Paycode : ${e.paycode}      Card No. : ${e.cardNo||'—'}`,'Signature of Employee : ____________________']),ofEmployee);
const personalOverride:Record<string,Partial<ReportOption>>={
 appointment:{build:ctx=>english(ctx)?appointmentEnglish(ctx):appointmentHindiPage(ctx)},
 join:{build:ctx=>english(ctx)?dutyJoinEnglish(ctx):dutyJoinPage(ctx)},
};
export const personalFileConfig:ReportConfig={period:'none',filters:[...ALL_FILTERS],sex:true,withLeft:true,columns:2,multi:true,
 choices:{label:'Appointment / Duty Join in',values:[{value:'hindi',label:'Hindi'},{value:'english',label:'English'}]},
 fields:[{key:'showPhoto',label:'SHOW PHOTO',kind:'check',place:'left',default:'1'},{key:'showDoj',label:'Show D.O.J',kind:'check',place:'left',default:'1'}],
 note:'Form 16 and the back of ESI Form 1 / Form F were not opened in the demonstration; their layout is a standard one and should be checked against the original print.',
 options:personalFormOptions.map(o=>({...o,...(personalOverride[o.value]||{})}))};
export const adultConfig:ReportConfig={period:'none',filters:[...ALL_FILTERS],sex:true,withLeft:true,options:[{value:'adult',label:'Register of Adult Workers',
 build:ctx=>tablePages(ctx,{key:'aw',title:'Register of Adult Workers',perPage:18,tree:rows=>ctx.employees[rows[0]]?.paycode||'',columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Name'},{h:'Father / Husband'},{h:'Sex'},{h:'Date of Birth',cls:'c'},{h:'Age',cls:'c'},{h:'Date of Join',cls:'c'},{h:'Designation'},{h:'Department'},{h:'Address'},{h:'Resign Date',cls:'c'}],
  rows:ctx.employees.map((e,i)=>[i+1,e.paycode,e.name,e.fatherName,employeeSex(e,extraOf(ctx,e)),dmy(e.dob),age(e.dob,ctx.printDate),dmy(e.doj),e.designation,e.department,e.permanentAddress||e.localAddress,dmy(realResignDate(e))])}),
 excel:ctx=>[['Sno','Paycode','Name','Father / Husband','Sex','Date of Birth','Age','Date of Join','Designation','Department','Address','Resign Date'],...ctx.employees.map((e,i)=>[i+1,e.paycode,e.name,e.fatherName,employeeSex(e,extraOf(ctx,e)),dmy(e.dob),age(e.dob,ctx.printDate),dmy(e.doj),e.designation,e.department,e.permanentAddress||e.localAddress,dmy(realResignDate(e))])]}]};

function joinRows(ctx:ReportContext,kind:'join'|'resign'|'both'){return ctx.employees.flatMap(e=>{const out:{e:Employee;event:string;date:string}[]=[];const r=realResignDate(e);if(kind!=='resign'&&e.doj&&e.doj>=ctx.from&&e.doj<=ctx.to)out.push({e,event:'Joined',date:e.doj});if(kind!=='join'&&r&&r>=ctx.from&&r<=ctx.to)out.push({e,event:'Resigned',date:r});return out;}).sort((a,b)=>a.date.localeCompare(b.date));}
const joinOption=(value:'join'|'resign'|'both',label:string)=>({value,label,build:(ctx:ReportContext)=>tablePages(ctx,{key:'jr'+value,title:label,subtitle:`From ${dmy(ctx.from)} To ${dmy(ctx.to)}`,perPage:30,columns:[{h:'Sno',cls:'c'},{h:'Event'},{h:'Date',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Father / Husband'},{h:'Department'},{h:'Designation'},{h:'Location'}] as Column[],
 rows:joinRows(ctx,value).map((r,i)=>[i+1,r.event,dmy(r.date),r.e.paycode,r.e.name,r.e.fatherName,r.e.department,r.e.designation,r.e.location])}),
 excel:(ctx:ReportContext)=>[['Sno','Event','Date','Paycode','Employee Name','Father / Husband','Department','Designation','Location'],...joinRows(ctx,value).map((r,i)=>[i+1,r.event,dmy(r.date),r.e.paycode,r.e.name,r.e.fatherName,r.e.department,r.e.designation,r.e.location])]});
export const joinResignConfig:ReportConfig={period:'range',filters:[...ALL_FILTERS],sex:true,withLeft:true,note:'Leaving dates of 01/01/2100 in the original mean "not resigned" and are not listed.',options:[joinOption('both','Join and Resign Register'),joinOption('join','Joining Register'),joinOption('resign','Resign Register')]};

export const letterConfig:ReportConfig={period:'none',filters:[...ALL_FILTERS],sex:true,withLeft:true,options:[{value:'experience',label:'Experience Letter',build:perEmployee('ex',(ctx,e)=>{const r=realResignDate(e);return letter(ctx,'TO WHOM IT MAY CONCERN',[`This is to certify that ${to(e)} was employed with ${ctx.company.name} as ${e.designation||'________'} in the ${e.department||'________'} department from ${dmy(e.doj)||'__________'} ${r?`to ${dmy(r)}`:'till date'}.`,`During this period we found ${e.name} sincere and hardworking.`,'We wish all the best for the future.']);})}]};

// Registers of transaction entries (Arear / Bonus / Loan), limited to the ticked employees.
function register(table:string,title:string,columns:Column[],make:(v:MasterRow['values'],e:Employee|undefined)=>ReactNode[]):ReportConfig{
 const rows=(ctx:ReportContext)=>{const byKey=new Map(ctx.employees.filter(e=>e.sourceKey).map(e=>[String(e.sourceKey),e]));return ctx.rows.filter(r=>byKey.has(trimCell(r.values.emp_code))).map(r=>({v:r.values,e:byKey.get(trimCell(r.values.emp_code))}));};
 return {period:'none',filters:[...ALL_FILTERS],withLeft:true,options:[{value:table,label:title,table,build:ctx=>{const list=rows(ctx);return tablePages(ctx,{key:table,title,perPage:28,columns,rows:list.map(({v,e})=>make(v,e)),footer:!list.length?<p>No {title.toLowerCase()} entries for the ticked employees.</p>:undefined});}}]};
}
// month_no 1..15 = Jan-2026 .. Mar-2027 (the original's month list); 0 / blank = not set.
const mname=(v:string|null|undefined)=>{const k=Number(trimCell(v));return k>=1&&k<=15?monthLabel(`${2026+Math.floor((k-1)/12)}-${String(((k-1)%12)+1).padStart(2,'0')}`):'';};
const monthNo=(month:string)=>(Number(month.slice(0,4))-2026)*12+Number(month.slice(5,7));
const num=(v:string|null|undefined)=>Number(trimCell(v))||0;

// Reports › Arear: arrears of the chosen month for the ticked employees —
//  tbarrs1 entries of that month (month_no), tbarrs2 lines paid in that month (pmonth, else month_no) and, for employees with
//  neither, the arrears saved on the month's salary (Salary Preparation › Arear), so one arrear is not counted twice.
type ArrearEntry={e:Employee;forMonth:string;desc:string;days:number;heads:{label:string;amount:number}[];total:number;pf:number;esi:number;net:number;row?:{table:string;key:string;revision:number;origin:MasterRow['origin']}};
function arrearEntries(ctx:ReportContext,t1:MasterRow[],t2:MasterRow[],earn:MasterRow[]):ArrearEntry[]{
 const no=monthNo(ctx.month);const names=new Map(earn.map(r=>[num(r.values.ern_code),trimCell(r.values.ern_name)]));const byKey=new Map(ctx.employees.map(e=>[String(e.sourceKey||e.id),e]));
 const entry=(table:string,r:MasterRow,e:Employee):ArrearEntry=>{const v=r.values;const heads=Array.from({length:15},(_,k)=>({label:names.get(k+1)||`Earning ${k+1}`,amount:num(v['earn'+(k+1)])})).filter(h=>h.amount);
  const total=num(v.totearn)||heads.reduce((s,h)=>s+h.amount,0);const pf=num(v.pf_amt),esi=num(v.esi_amt);
  return {e,forMonth:mname(table==='tbarrs2'&&num(v.pmonth)?v.month_no:v.arr_month),desc:trimCell(v.ar_desc),days:num(v.arr_day),heads,total,pf,esi,net:num(v.netearn)||total-pf-esi,row:{table,key:r.key,revision:r.revision,origin:r.origin}};};
 const out:ArrearEntry[]=[];
 for(const r of t1){const e=byKey.get(trimCell(r.values.emp_code));if(e&&num(r.values.month_no)===no)out.push(entry('tbarrs1',r,e));}
 for(const r of t2){const e=byKey.get(trimCell(r.values.emp_code));if(e&&(num(r.values.pmonth)||num(r.values.month_no))===no)out.push(entry('tbarrs2',r,e));}
 const entered=new Set(out.map(x=>x.e.id));
 for(const e of ctx.employees){if(entered.has(e.id))continue;const heads=(ctx.salaries.get(e.id)?.earnings||[]).filter(l=>l.arrear).map(l=>({label:l.label,amount:l.arrear||0}));
  if(heads.length){const total=heads.reduce((s,h)=>s+h.amount,0);out.push({e,forMonth:'',desc:'Salary arrear',days:0,heads,total,pf:0,esi:0,net:total});}}
 const order=new Map(ctx.employees.map((e,i)=>[e.id,i]));return out.sort((a,b)=>(order.get(a.e.id)??0)-(order.get(b.e.id)??0));
}
// Summary: one line per employee (all the month's entries added up).
function arrearSummary(list:ArrearEntry[]){const out=new Map<string,ArrearEntry>();const join=(a:string,b:string)=>[...new Set([...a.split(', '),b])].filter(Boolean).join(', ');
 for(const x of list){const o=out.get(x.e.id);out.set(x.e.id,o?{...o,forMonth:join(o.forMonth,x.forMonth),desc:join(o.desc,x.desc),days:o.days+x.days,heads:[...o.heads,...x.heads],total:o.total+x.total,pf:o.pf+x.pf,esi:o.esi+x.esi,net:o.net+x.net}:x);}return [...out.values()];}
const arrTotal=(list:ArrearEntry[],k:'total'|'pf'|'esi'|'net')=>list.reduce((s,x)=>s+x[k],0);
function arrearPages(ctx:ReportContext,list:ArrearEntry[],detail:boolean):ReportPage[]{
 const sub=`Arrear for the month of ${monthLabel(ctx.month)}`;const empty=!list.length?<p>No arrear for {monthLabel(ctx.month)} for the ticked employees.</p>:undefined;const tall=ctx.options.otExtraSpace;
 const dept=(rows:ReactNode[][],width:number,e:Employee,prev?:Employee)=>{if(ctx.options.groupByDept&&e.department!==prev?.department)rows.push(['',<b key="d">{e.department||'—'}</b>,...Array(width-2).fill('')]);};
 if(!detail){const lines=arrearSummary(list);const rows:ReactNode[][]=[];lines.forEach((x,i)=>{dept(rows,12,x.e,lines[i-1]?.e);rows.push([i+1,x.e.paycode,x.e.name,x.e.department,x.forMonth,x.desc,x.days||'',n2(x.total),n2(x.pf),n2(x.esi),<b key="n">{n2(x.net)}</b>,'']);});
  return tablePages(ctx,{key:'ars',title:'Arrear Register',subtitle:sub,perPage:tall?14:24,columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Department'},{h:'Arrear For'},{h:'Description'},{h:'Arr. Days',cls:'num'},{h:'Arrear Amount',cls:'num'},{h:'PF',cls:'num'},{h:'ESI',cls:'num'},{h:'Net Arrear',cls:'num'},{h:'Signature',w:'90px'}],
   rows,totals:['','Total','','','','','',n2(arrTotal(lines,'total')),n2(arrTotal(lines,'pf')),n2(arrTotal(lines,'esi')),n2(arrTotal(lines,'net')),''],footer:empty});}
 // Detail: each earning head of each entry, then the entry's total with its PF / ESI and net.
 const rows:ReactNode[][]=[];let sno=0;list.forEach((x,i)=>{dept(rows,9,x.e,list[i-1]?.e);const first=list[i-1]?.e.id!==x.e.id;if(first)sno++;
  (x.heads.length?x.heads:[{label:'',amount:0}]).forEach((h,k)=>rows.push([first&&!k?sno:'',first&&!k?x.e.paycode:'',first&&!k?x.e.name:'',k?'':[x.forMonth,x.desc].filter(Boolean).join(' · '),h.label,h.amount?n2(h.amount):'','','','']));
  rows.push(['','','','',<b key="t">Total</b>,<b key="a">{n2(x.total)}</b>,n2(x.pf),n2(x.esi),<b key="n">{n2(x.net)}</b>]);});
 return tablePages(ctx,{key:'ard',title:'Arrear Register (Detail)',subtitle:sub,perPage:tall?18:30,columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Employee Name'},{h:'Arrear For'},{h:'Earning Head'},{h:'Arrear Amount',cls:'num'},{h:'PF',cls:'num'},{h:'ESI',cls:'num'},{h:'Net Arrear',cls:'num'}],
  rows,totals:['','Grand Total','','','',n2(arrTotal(list,'total')),n2(arrTotal(list,'pf')),n2(arrTotal(list,'esi')),n2(arrTotal(list,'net'))],footer:empty});
}
const ARREAR_TABLES=['tbarrs1','tbarrs2','tbearn'];
// The entries are read when the page is shown (always fresh, so a deletion shows at once).
function ArrearSheet({ctx,detail}:{ctx:ReportContext;detail:boolean}){
 const [t1,t2,earn]=useQueries({queries:ARREAR_TABLES.map(t=>({...masterQuery(ctx.dataset,t),staleTime:0}))});
 if(t1.isPending||t2.isPending||earn.isPending)return <p className="rpt-loading">Loading the arrear entries…</p>;
 const failed=t1.error||t2.error||earn.error;if(failed)return <p>The arrear entries could not be loaded: {failed.message}</p>;
 return <Sections pages={arrearPages(ctx,arrearEntries(ctx,t1.data?.rows||[],t2.data?.rows||[],earn.data?.rows||[]),detail)}/>;}
const loadArrears=(ctx:ReportContext)=>Promise.all(ARREAR_TABLES.map(table=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams({dataset:ctx.dataset,table})))).then(([t1,t2,earn])=>arrearEntries(ctx,t1.rows,t2.rows,earn.rows));
async function arrearExport(ctx:ReportContext){const list=await loadArrears(ctx);if(!list.length)throw new Error(`No arrear for ${monthLabel(ctx.month)} for the ticked employees.`);
 await exportExcel(`Arear_${ctx.month}.xlsx`,[{name:'Summary',rows:[['Sno','Paycode','Card No.','Employee Name','Department','Arrear For','Description','Arr. Days','Arrear Amount','PF','ESI','Net Arrear'],...arrearSummary(list).map((x,i)=>[i+1,x.e.paycode,x.e.cardNo,x.e.name,x.e.department,x.forMonth,x.desc,x.days,x.total,x.pf,x.esi,x.net])]},
  {name:'Detail',rows:[['Paycode','Employee Name','Arrear For','Description','Earning Head','Arrear Amount'],...list.flatMap(x=>(x.heads.length?x.heads:[{label:'',amount:x.total}]).map(h=>[x.e.paycode,x.e.name,x.forMonth,x.desc,h.label,h.amount]))]}]);toast.success('Export Successfully');}
// Delete Arear: only entries added in this application are deleted; entries imported from the original software stay.
async function arrearDelete(ctx:ReportContext){const list=(await loadArrears(ctx)).filter(x=>x.row);const label=monthLabel(ctx.month);
 if(!list.length)throw new Error(`No arrear entry for ${label} for the ticked employees.`);const mine=list.filter(x=>x.row!.origin==='new');const kept=list.length-mine.length;
 if(!mine.length)throw new Error(`The ${list.length} arrear entries of ${label} were imported from the original software and cannot be deleted.`);
 if(!window.confirm(`Delete ${mine.length} arrear ${mine.length===1?'entry':'entries'} of ${label} (${new Set(mine.map(x=>x.e.id)).size} employees)?${kept?` ${kept} imported ${kept===1?'entry is':'entries are'} kept.`:''}`))return;
 let done=0;const failed:string[]=[];
 for(const x of mine){try{await requestJson('/api/masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'master-delete',table:x.row!.table,dataset:ctx.dataset,key:x.row!.key,revision:x.row!.revision})});done++;}catch(e){failed.push(`${x.e.paycode}: ${(e as Error).message}`);}}
 if(done)toast.success(`${done} arrear ${done===1?'entry':'entries'} of ${label} deleted`);if(failed.length)throw new Error(`${failed.length} not deleted. ${failed[0]}`);}
export const arrearConfig:ReportConfig={period:'month',filters:['company','subCompany','location','department','category','salaryGrade'],otExtraSpace:true,paymentMode:true,resignMode:true,options:[
 {value:'summary',label:'Arrear Sheet1 (Summary)',needs:['salaries'],build:ctx=>[{key:'ars',orientation:'landscape',tree:monthLabel(ctx.month),node:<ArrearSheet ctx={ctx} detail={false}/>}]},
 {value:'detail',label:'Arrear Sheet2 (Detail)',needs:['salaries'],build:ctx=>[{key:'ard',orientation:'landscape',tree:monthLabel(ctx.month),node:<ArrearSheet ctx={ctx} detail/>}]},
 {value:'delete',label:'Delete Arear',hidden:true,build:()=>[],action:arrearDelete},
 {value:'export',label:'Arear Export',hidden:true,needs:['salaries'],build:()=>[],action:arrearExport}],
 extraButtons:[{label:'Delete Arear',option:'delete'},{label:'Arear Export',option:'export'}]};
export const bonusConfig=register('tbbon','Bonus Register',[{h:'Paycode'},{h:'Employee Name'},{h:'Bonus %',cls:'num'},{h:'Ex-gratia %',cls:'num'},{h:'Total Bonus',cls:'num'},{h:'Total Ex-gratia',cls:'num'},{h:'Paid'}],(v,e)=>{const s=(p:string)=>Array.from({length:12},(_,k)=>Number(v[p+(k+4)])||0).reduce((a,b)=>a+b,0);return [e?.paycode,e?.name,trimCell(v.bonp),trimCell(v.exgp),n2(s('bon')),n2(s('exg')),trimCell(v.bpaid)==='1'?'Yes':'No'];});
export const loanConfig=register('tbloan','Loan Register',[{h:'Loan No.'},{h:'Paycode'},{h:'Employee Name'},{h:'Loan Date',cls:'c'},{h:'Amount',cls:'num'},{h:'Interest %',cls:'num'},{h:'EMI',cls:'num'},{h:'Balance',cls:'num'},{h:'Remarks'}],(v,e)=>[trimCell(v.ln_no),e?.paycode,e?.name,dmy(trimCell(v.ln_date)),n2(Number(v.ln_amt)),trimCell(v.ln_per),n2(Number(v.ln_emi)),n2(Number(v.lbal)),trimCell(v.ln_rem)]);
