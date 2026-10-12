'use client';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useQueries,useQuery,useQueryClient} from '@tanstack/react-query';
import {ChevronLeft,ChevronRight,Printer,Save} from 'lucide-react';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {dateOnly,masterDef,trimCell,type MasterFieldType,type MasterRow,type MasterValues} from '@/lib/masters';
import {exportExcel,requestJson,saveRecord} from '@/lib/client-api';
import {dmy,isLeft,type Extra} from '@/lib/report-utils';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {ErrorMessage} from './payroll-controls';
import {sortEmployees} from './employee-pick';
import {ageOn,csvCell,downloadText,estCode,leftOn,localDay,pfCodeOf} from './reports/pf-reports';
import type {Lists} from './reports/report-form';
import './reports/reports.css';
import './pf-forms.css';

// Reports › P.F.Detail › "PF 19  10 C Reports" (P.F 19 & 10 C Form) and "PF KYC UPLOAD" (PF Data Upload).
type Props={dataset:string;employees:Employee[];companyName:string;onClose:()=>void};
type Page={key:string;label:string;node:ReactNode};
const keyOf=(e:Employee)=>String(e.sourceKey||e.id);
const ordinal=(a:string,b:string)=>a<b?-1:a>b?1:0;
const today=()=>localDay(new Date());
const clean=(v:string|null|undefined)=>trimCell(v).trim();
const mastersQuery=(dataset:string,table:string,key?:string)=>({queryKey:key==null?['masters',dataset,table]:['masters',dataset,table,'key',key],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams(key==null?{dataset,table}:{dataset,table,key}),{signal}),refetchOnWindowFocus:false});
const LIST_TABLES=['tbcmp','tbsubcmp','tblocation','tbpfmast'] as const;
const combineLists=(rs:{data?:{rows:MasterRow[]}}[]):Lists=>Object.fromEntries(LIST_TABLES.map((t,k)=>{const def=masterDef(t)!;return [t,(rs[k]?.data?.rows||[]).map(r=>({code:clean(r.values[def.key[0]]),name:def.nameCol?clean(r.values[def.nameCol]):'',values:r.values})).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true}))];}));
function usePfData(dataset:string){
 const extrasQuery=useQuery({queryKey:['employee-extras',dataset],queryFn:({signal})=>requestJson<{extras:Record<string,Extra>}>('/api/employee-extras?'+new URLSearchParams({dataset}),{signal}),refetchOnWindowFocus:false,staleTime:600000});
 const extras=useMemo(()=>extrasQuery.data?.extras||{},[extrasQuery.data]);
 const lists=useQueries({queries:LIST_TABLES.map(t=>mastersQuery(dataset,t)),combine:combineLists});
 return {extras,lists};
}
// Values typed on these screens that have no column in the database are kept in this browser only.
function readStore<T>(key:string):Record<string,T>{try{const raw=typeof window==='undefined'?null:window.localStorage.getItem(key);const v=raw?JSON.parse(raw) as unknown:null;return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,T>:{};}catch{return {};}}
function writeStore(key:string,value:unknown){try{window.localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function companyOf(lists:Lists,companyName:string,addressPrint:string,e?:Employee){const c=lists.tbcmp?.[0]?.values;const loc=e?(lists.tblocation||[]).find(l=>l.name.toLowerCase()===e.location.trim().toLowerCase()):undefined;
 return {name:clean(c?.cmp_name)||companyName,address:addressPrint==='none'?'':addressPrint==='location'&&loc?clean(loc.values.loc_add1):[clean(c?.cmp_add1),clean(c?.cmp_add2)].filter(Boolean).join(', ')};}
const estOf=(lists:Lists,e:Employee)=>{const code=pfCodeOf(lists,e);return estCode((lists.tbpfmast||[]).find(p=>p.code===code)?.values);};

function Tabs({tab,setTab,canReport,title}:{tab:'sel'|'rep';setTab:(t:'sel'|'rep')=>void;canReport:boolean;title:string}){
 return <div className="rpt-tabs no-print"><button type="button" className={tab==='sel'?'is-active':''} onClick={()=>setTab('sel')}>Selecion</button><button type="button" className={tab==='rep'?'is-active':''} disabled={!canReport} onClick={()=>setTab('rep')}>Report</button><span className="rpt-title">{title}</span></div>;}
// Page viewer with Print (same paper and print rules as the report screens).
function Preview({pages,title}:{pages:Page[];title:string}){
 const [page,setPage]=useState(0);const [printing,setPrinting]=useState(false);const [zoom,setZoom]=useState(0.8);
 useEffect(()=>{if(!printing)return;const done=()=>setPrinting(false);window.addEventListener('afterprint',done,{once:true});const t=setTimeout(()=>window.print(),300);return()=>{clearTimeout(t);window.removeEventListener('afterprint',done);};},[printing]);
 if(!pages.length)return <div className="rpt-empty">Nothing to show. Make the selection and press Generate.</div>;
 const cur=Math.min(page,pages.length-1);
 return <div className="rpt-viewer">
  <div className="rpt-toolbar no-print"><button type="button" title="Print" onClick={()=>setPrinting(true)}><Printer size={16}/></button><span className="rpt-sep"/>
   <button type="button" title="Previous page" disabled={cur===0} onClick={()=>setPage(cur-1)}><ChevronLeft size={16}/></button><span className="rpt-page-no">{cur+1} of {pages.length}</span><button type="button" title="Next page" disabled={cur>=pages.length-1} onClick={()=>setPage(cur+1)}><ChevronRight size={16}/></button>
   <select aria-label="Zoom" value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[0.5,0.65,0.8,1,1.25].map(z=><option key={z} value={z}>{Math.round(z*100)}%</option>)}</select></div>
  <div className="rpt-body"><ul className="rpt-tree no-print">{pages.map((p,i)=><li key={p.key}><button type="button" className={i===cur?'is-active':''} onClick={()=>setPage(i)}>{p.label}</button></li>)}</ul>
   <div className="rpt-canvas"><div className="rpt-tab-label">Main Report</div><div style={{zoom}}><div className="rpt-paper portrait">{pages[cur].node}</div></div></div></div>
  {printing&&createPortal(<div className="rpt-print-root" aria-label={title}>{pages.map(p=><div key={p.key} className="rpt-paper portrait">{p.node}</div>)}</div>,document.body)}
 </div>;}

// ================= P.F 19 & 10 C Form =================
// Claim details per employee (Save keeps them in this browser); Generate prints the composite claim form (Form 19 & 10C,
// Aadhaar / non-Aadhaar) and Form 15G / 15H for the ticked employees of the grid (Refresh = employees who left between From and To).
type Claim={nonAdhar:boolean;claimType:string;purpose:string;chequeFavour:string;mobile:string;ifsc:string;bankName:string;bankAc:string;bankAddress:string;bankBranch:string;partAmt:string;formGH:boolean;expiry:string;reason:string;adharSeeding:string};
type Kind='adhar'|'nonAdhar'|'formG'|'formH';
const KINDS:[Kind,string][]=[['adhar','Adhar'],['nonAdhar','Non-Adhar'],['formG','Form G'],['formH','Form H']];
const CLAIM_TYPES=['Full PF Settlement (Form 19)','Pension Withdrawal Benefit (Form 10C)','PF Settlement & Pension Withdrawal (Form 19 & 10C)','Part Withdrawal (Form 31)'];
const PURPOSES=['Illness','Marriage','Education','Purchase of site / house / flat','Construction of house','Addition / alteration of house','Repayment of housing loan','Natural calamity','Lockout / closure of establishment','Purchase of handicap equipment','Withdrawal at 54 years (pre-retirement)','Unemployment'];
const reasonText=(v?:MasterValues)=>{const r=clean(v?.reason);return /^unresigned$/i.test(r)?'':r;};
const masterMobile=(e:Employee,v?:MasterValues)=>clean(v?.mob)||e.phone.trim();
const masterIfsc=(e:Employee,v?:MasterValues)=>clean(v?.pfb_ifsc)||e.ifsc.trim();
// A claim not saved yet starts from the employee master (mobile, PF bank account, reason for leaving).
const blankClaim=(e:Employee,v?:MasterValues):Claim=>({nonAdhar:!e.aadhaar.trim(),claimType:'',purpose:'',chequeFavour:e.name,mobile:masterMobile(e,v),ifsc:masterIfsc(e,v),bankName:e.bankName,bankAc:clean(v?.pf_bank_no)||e.accountNo.trim(),bankAddress:'',bankBranch:e.bankBranch,partAmt:'',formGH:false,expiry:'',reason:reasonText(v),adharSeeding:''});
const fyOf=(d:string)=>{const y=Number(d.slice(0,4)),m=Number(d.slice(5,7));const s=m>=4?y:y-1;return `${s}-${String(s+1).slice(2)}`;};
type PrintCtx={company:{name:string;address:string};printDate:string;est:string};
function printHead(p:PrintCtx){return <div className="rpt-meta"><span>{p.company.name}{p.company.address?', '+p.company.address:''}</span><span>{p.printDate?'Print Date : '+dmy(p.printDate):''}</span></div>;}
function claimNode(kind:'adhar'|'nonAdhar',e:Employee,x:Extra|undefined,c:Claim,p:PrintCtx):ReactNode{const left=leftOn(e,x);
 const rows:[string,ReactNode][]=[['Name of the member',e.name],["Father's / Husband's name",e.fatherName],['Date of birth',dmy(e.dob)],['Universal Account Number (UAN)',x?.pfNo||''],['Establishment code & name',`${p.est} ${p.company.name}`.trim()],
  ['Date of joining',dmy(e.doj)],['Date of leaving service',dmy(left)],['Age on the date of leaving',left?ageOn(e.dob,left)??'':''],['Reason for leaving service',c.reason],['Mobile No.',c.mobile],
  [kind==='adhar'?'Aadhaar No.':'Aadhaar No. (if any) / Non-Aadhaar claim',kind==='adhar'?e.aadhaar:`${e.aadhaar||''}${c.nonAdhar?'  (Non-Aadhaar)':''}`],['PAN',e.pan],['Bank account No.',c.bankAc],['IFSC',c.ifsc],['Bank name & branch',[c.bankName,c.bankBranch].filter(Boolean).join(', ')],['Bank address',c.bankAddress],
  ['Claim type',c.claimType],['Purpose of part withdrawal / amount',[c.purpose,c.partAmt&&`Rs. ${c.partAmt}`].filter(Boolean).join(' · ')],['Form 15G / 15H submitted',c.formGH?`Yes${c.expiry?` (valid till ${dmy(c.expiry)||c.expiry})`:''}`:'No'],
  ['Payment / cheque in favour of',c.chequeFavour],['Aadhaar seeding',c.adharSeeding],['Address for communication',e.permanentAddress||e.localAddress]];
 return <div className="pf-print">{printHead(p)}
  <h2>COMPOSITE CLAIM FORM ({kind==='adhar'?'AADHAAR':'NON-AADHAAR'})</h2>
  <h3>Form 19 (Provident Fund final settlement) &amp; Form 10C (Pension withdrawal benefit)</h3>
  <table><tbody>{rows.map(([l,v],i)=><tr key={l}><td style={{width:'24px'}}>{i+1}.</td><td style={{width:'40%'}}>{l}</td><td><b>{v}</b></td></tr>)}</tbody></table>
  <p>I certify that the particulars given above are true to the best of my knowledge and request that the amount due to me be paid into the bank account given above.</p>
  <div className="pf-sign"><span>Date :</span><span>Place :</span><span>Signature / thumb impression of the member</span></div>
  {kind==='nonAdhar'&&<div className="pf-box"><b>Certificate by the employer</b><p>Certified that the above member was employed with us from {dmy(e.doj)||'—'} to {dmy(left)||'—'} and that the particulars given above are correct as per our records.</p><div className="pf-sign"><span>Establishment code : {p.est}</span><span>Signature of the employer with office seal</span></div></div>}
 </div>;}
function form15Node(kind:'G'|'H',e:Employee,x:Extra|undefined,c:Claim,p:PrintCtx):ReactNode{
 const rows:[string,ReactNode][]=[['Name of the assessee (declarant)',e.name],['PAN of the assessee',e.pan],...(kind==='H'?[['Date of birth',dmy(e.dob)] as [string,ReactNode]]:[]),['Status','Individual'],['Previous year (P.Y.) for which the declaration is made',fyOf(p.printDate||today())],['Residential status','Resident'],
  ['Address',e.permanentAddress||e.localAddress],['Email',e.email],['Telephone / mobile No.',c.mobile],['Whether assessed to tax',''],['Estimated income for which this declaration is made',c.partAmt],['Estimated total income of the P.Y.',''],
  ['Nature of income','Withdrawal of Provident Fund accumulations (section 192A)'],['UAN',x?.pfNo||'']];
 return <div className="pf-print">{printHead(p)}
  <h2>FORM No. 15{kind}</h2><h3>{kind==='G'?'[See section 197A(1) and 197A(1A) and rule 29C]':'[See section 197A(1C) and rule 29C]'}</h3>
  <h3>{kind==='G'?'Declaration by a resident individual (below 60 years) claiming receipt of income without deduction of tax':'Declaration by a resident individual of 60 years or more claiming receipt of income without deduction of tax'}</h3>
  <p><b>PART I</b></p><table><tbody>{rows.map(([l,v],i)=><tr key={l}><td style={{width:'24px'}}>{i+1}.</td><td style={{width:'45%'}}>{l}</td><td><b>{v}</b></td></tr>)}</tbody></table>
  <div className="pf-sign"><span>Date :</span><span>Place :</span><span>Signature of the declarant</span></div>
  <div className="pf-box"><b>PART II</b> (for use by the person to whom the declaration is furnished)<p>Name of the person responsible for paying : Employees&apos; Provident Fund Organisation</p><p>Date on which the declaration is received : ____________ &nbsp; Amount of income paid : ____________</p></div>
 </div>;}

export function Pf19Form({dataset,employees,companyName,onClose}:Props){
 const client=useQueryClient();const {extras,lists}=usePfData(dataset);const storeKey='pf19:'+dataset;
 const [tab,setTab]=useState<'sel'|'rep'>('sel');
 const [pfCode,setPfCode]=useState('');const [subCmp,setSubCmp]=useState('');const [loc,setLoc]=useState('');const [sortOn,setSortOn]=useState<'paycode'|'card'|'name'>('paycode');
 const [addressPrint,setAddressPrint]=useState('main');const [printDate,setPrintDate]=useState(today);const [printDateShow,setPrintDateShow]=useState(true);
 const [search,setSearch]=useState('');const [selectedId,setSelectedId]=useState('');
 const [saved,setSaved]=useState(()=>readStore<Claim>(storeKey));const [drafts,setDrafts]=useState<Record<string,Claim>>({});
 const [kinds,setKinds]=useState<Record<Kind,boolean>>({adhar:false,nonAdhar:true,formG:false,formH:false});
 const [from,setFrom]=useState(today);const [to,setTo]=useState(today);const [listed,setListed]=useState<string[]>([]);
 const [allChecked,setAllChecked]=useState(true);const [exceptions,setExceptions]=useState<Set<string>>(()=>new Set());const [gridFind,setGridFind]=useState('');
 const [pages,setPages]=useState<Page[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const filtered=useMemo(()=>sortEmployees(employees.filter(e=>(!pfCode||pfCodeOf(lists,e)===pfCode)&&(!subCmp||e.subCompany.trim().toLowerCase()===subCmp.toLowerCase())&&(!loc||e.location.trim().toLowerCase()===loc.toLowerCase())),sortOn),[employees,lists,pfCode,subCmp,loc,sortOn]);
 const q=search.trim().toLowerCase();const matches=(q?filtered.filter(e=>[e.paycode,e.cardNo,e.name].join(' ').toLowerCase().includes(q)):filtered);
 const sel=employees.find(e=>e.id===selectedId);const selKey=sel?keyOf(sel):'';
 const rowQuery=useQuery({...mastersQuery(dataset,'tbemp',selKey),enabled:!!selKey});const selRow=rowQuery.data?.rows[0]?.values;
 const claim=sel?(drafts[selKey]??saved[selKey]??blankClaim(sel,selRow)):null;
 const edit=(patch:Partial<Claim>)=>{if(sel&&claim)setDrafts(d=>({...d,[selKey]:{...claim,...patch}}));};
 const byId=useMemo(()=>new Map(employees.map(e=>[e.id,e])),[employees]);
 const gq=gridFind.trim().toLowerCase();const grid=listed.flatMap(id=>{const e=byId.get(id);return e&&(!gq||[e.name,e.paycode,e.cardNo].join(' ').toLowerCase().includes(gq))?[e]:[];});
 const isChecked=(id:string)=>allChecked?!exceptions.has(id):exceptions.has(id);
 const toggle=(id:string)=>setExceptions(p=>{const n=new Set(p);if(n.has(id))n.delete(id);else n.add(id);return n;});
 const list=(ids:string[])=>{setListed(ids);setAllChecked(true);setExceptions(new Set());setGridFind('');};
 function refresh(){if(from>to){setError('From date must be on or before To date.');return;}setError('');const ids=filtered.filter(e=>{const l=leftOn(e,extras[keyOf(e)]);return !!l&&l>=from&&l<=to;}).map(e=>e.id);list(ids);if(!ids.length)toast.info('No employee left between these dates.');}
 // Datenul: employees marked as left whose leaving date is blank (they never fall between From and To).
 function dateNull(){const ids=filtered.filter(e=>{const x=extras[keyOf(e)];return isLeft(e,x)&&!leftOn(e,x);}).map(e=>e.id);list(ids);toast.info(ids.length?`${ids.length} left employees have no leaving date.`:'Every left employee has a leaving date.');}
 function save(){if(!sel||!claim){toast.error('Choose an employee in the Employee Name list.');return;}const next={...saved,[selKey]:claim};
  if(!writeStore(storeKey,next)){toast.error('This browser does not allow saving here.');return;}setSaved(next);setDrafts(d=>{const n={...d};delete n[selKey];return n;});toast.success('Saved Successfully');}
 async function generate(){setError('');const ticked=grid.filter(e=>isChecked(e.id));const chosen=ticked.length?ticked:sel?[sel]:[];const wanted=KINDS.filter(([k])=>kinds[k]).map(([k])=>k);
  if(!chosen.length){setError('Press Refresh to list the employees who left between the dates and tick them (or choose an employee in the Employee Name list).');return;}
  if(!wanted.length){setError('Tick Adhar, Non-Adhar, Form G or Form H.');return;}
  setBusy(true);try{const all=await client.fetchQuery({...mastersQuery(dataset,'tbemp'),staleTime:60000});const rows=new Map(all.rows.map(r=>[clean(r.values.emp_code),r.values]));
   const out:Page[]=chosen.flatMap(e=>{const k=keyOf(e);const x=extras[k];const c=drafts[k]??saved[k]??blankClaim(e,rows.get(k));const p:PrintCtx={company:companyOf(lists,companyName,addressPrint,e),printDate:printDateShow?printDate:'',est:estOf(lists,e)};
    return wanted.map(kind=>({key:kind+e.id,label:`${e.paycode} ${KINDS.find(([v])=>v===kind)![1]}`,node:kind==='formG'||kind==='formH'?form15Node(kind==='formG'?'G':'H',e,x,c,p):claimNode(kind,e,x,c,p)}));});
   setPages(out);setTab('rep');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 const field=(label:string,k:'chequeFavour'|'mobile'|'ifsc'|'bankName'|'bankAc'|'bankBranch'|'reason'|'adharSeeding',extra?:ReactNode)=><label className="pf-line"><span>{label}</span><span className="kyc-inline"><input value={claim?.[k]??''} disabled={!claim} onChange={e=>edit({[k]:e.target.value} as Partial<Claim>)}/>{extra}</span></label>;
 const copyBox=(master:string,same:boolean,label:string,k:'mobile'|'ifsc')=><div className="pf-pair"><span/><input aria-label={'Master '+label} value={master} disabled/><label className="pf-check"><input type="checkbox" disabled={!claim||!master} checked={same} onChange={e=>edit({[k]:e.target.checked?master:''} as Partial<Claim>)}/>{label}</label></div>;
 const mm=sel?masterMobile(sel,selRow):'',mi=sel?masterIfsc(sel,selRow):'';
 return <div className="pf-win">
  <Tabs tab={tab} setTab={setTab} canReport={pages.length>0} title="P.F 19 & 10 C Form"/>
  {tab==='rep'?<Preview pages={pages} title="P.F 19 & 10 C Form"/>:<div className="pf19">
   <div className="pf19-left">
    <label className="pf-line"><b>P.F.No.</b><select value={pfCode} onChange={e=>setPfCode(e.target.value)}><option value=""/>{(lists.tbpfmast||[]).map(p=><option key={p.code} value={p.code}>{p.code}  {estCode(p.values)}</option>)}</select></label>
    <label className="pf-line"><b>Sub Company Name</b><select value={subCmp} onChange={e=>setSubCmp(e.target.value)}><option value="">All</option>{(lists.tbsubcmp||[]).map(s=><option key={s.code} value={s.name}>{s.name}</option>)}</select></label>
    <label className="pf-line"><b>Location Name</b><select value={loc} onChange={e=>setLoc(e.target.value)}><option value="">All</option>{(lists.tblocation||[]).map(s=><option key={s.code} value={s.name}>{s.name}</option>)}</select></label>
    <fieldset><legend>Sort On</legend>{([['paycode','Paycode'],['card','Card No.'],['name','Employee Name']] as const).map(([v,l])=><label key={v} className="pf-check"><input type="radio" name="pf19-sort" checked={sortOn===v} onChange={()=>setSortOn(v)}/>{l}</label>)}</fieldset>
    <label className="pf-line"><b>Address Print</b><select value={addressPrint} onChange={e=>setAddressPrint(e.target.value)}><option value="main">Main Company Address</option><option value="location">Location Address</option><option value="none">No Address</option></select></label>
    <div className="pf-line"><b>Print Date</b><span className="kyc-inline"><input type="date" aria-label="Print Date" value={printDate} onChange={e=>setPrintDate(e.target.value)}/><label className="pf-check"><input type="checkbox" checked={printDateShow} onChange={e=>setPrintDateShow(e.target.checked)}/>Print Date Show</label></span></div>
    <div><button type="button" className="pf-btn pf-grey" title="List the left employees who have no leaving date" onClick={dateNull}>Datenul</button></div>
   </div>
   <div className="pf19-mid">
    <h3>Employee Name</h3>
    <input aria-label="Find employee" value={search} placeholder="Type paycode, card no. or name" onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&matches[0])setSelectedId(matches[0].id);}}/>
    <div className="pf-list" style={{height:'110px'}} role="listbox" aria-label="Employees">{matches.slice(0,300).map(e=><button type="button" role="option" aria-selected={e.id===selectedId} key={e.id} className={e.id===selectedId?'is-on':''} onClick={()=>setSelectedId(e.id)}>{e.paycode}  {e.name}{drafts[keyOf(e)]?' *':''}</button>)}{!matches.length&&<p>No employees.</p>}</div>
    <label className="pf-check"><input type="checkbox" disabled={!claim} checked={!!claim?.nonAdhar} onChange={e=>edit({nonAdhar:e.target.checked})}/>Non Adhar</label>
    <label className="pf-line"><span>Claim Type</span><select value={claim?.claimType??''} disabled={!claim} onChange={e=>edit({claimType:e.target.value})}><option value=""/>{CLAIM_TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
    <label className="pf-line"><span>Part With.Purp.</span><select value={claim?.purpose??''} disabled={!claim} onChange={e=>edit({purpose:e.target.value})}><option value=""/>{PURPOSES.map(t=><option key={t}>{t}</option>)}</select></label>
    {field('Cheque favour','chequeFavour')}
    {copyBox(mm,!!claim&&!!mm&&claim.mobile===mm,'Same Mobile','mobile')}
    {field('Mobile No','mobile')}
    {copyBox(mi,!!claim&&!!mi&&claim.ifsc===mi,'Same Ifsc','ifsc')}
    {field('Ifsc','ifsc')}{field('Bank Name','bankName')}{field('Bank A/c No.','bankAc')}
    <label className="pf-line"><span>Bank Address</span><textarea value={claim?.bankAddress??''} disabled={!claim} onChange={e=>edit({bankAddress:e.target.value})}/></label>
    {field('Bank Branch','bankBranch')}
    <div className="pf-line"><span>Part Amt.</span><span className="kyc-inline"><input aria-label="Part Amt." inputMode="decimal" value={claim?.partAmt??''} disabled={!claim} onChange={e=>edit({partAmt:e.target.value.replace(/[^\d.]/g,'')})}/><label className="pf-check"><input type="checkbox" disabled={!claim} checked={!!claim?.formGH} onChange={e=>edit({formGH:e.target.checked})}/>Form GH</label></span></div>
    <label className="pf-line"><span>Expiry Date</span><input type="date" value={claim?.expiry??''} disabled={!claim} onChange={e=>edit({expiry:e.target.value})}/></label>
    {field('Reason For Leaving','reason')}{field('Adhar Seeding','adharSeeding')}
    <div className="pf19-save">{sel&&drafts[selKey]&&<span className="pf-dirty">Not saved</span>}<button type="button" className="pf-btn" disabled={!claim} onClick={save}><Save size={18} color="#1d5fc4"/>Save</button></div>
    <p className="pf-note">Claim details are kept in this browser (they are not part of the original database).</p>
   </div>
   <div className="pf19-right">
    <div className="pf19-top">
     <div><label className="pf-check"><input type="checkbox" checked={KINDS.every(([k])=>kinds[k])} onChange={e=>setKinds({adhar:e.target.checked,nonAdhar:e.target.checked,formG:e.target.checked,formH:e.target.checked})}/>Checked ALL</label>
      <div className="pf19-kinds">{KINDS.map(([k,l])=><label key={k} className="pf-check"><input type="checkbox" checked={kinds[k]} onChange={e=>setKinds(p=>({...p,[k]:e.target.checked}))}/>{l}</label>)}</div></div>
     <div className="pf19-buttons"><button type="button" className="pf-btn pf-green" disabled={busy} onClick={()=>void generate()}>{busy?'Please Wait…':'Generate'}</button><button type="button" className="pf-btn pf-pink" onClick={onClose}>Close</button></div>
    </div>
    <div className="pf19-range"><span>From</span><input type="date" aria-label="Left from" value={from} onChange={e=>setFrom(e.target.value)}/><span>To</span><input type="date" aria-label="Left to" value={to} onChange={e=>setTo(e.target.value)}/><button type="button" className="pf-btn pf-grey" onClick={refresh}>Refresh</button></div>
    <div className="pf19-range"><label className="pf-check"><input type="checkbox" checked={allChecked&&exceptions.size===0} onChange={e=>{setAllChecked(e.target.checked);setExceptions(new Set());}}/>Checked For All Employee</label><input className="pf-find" aria-label="Find in the list" value={gridFind} onChange={e=>setGridFind(e.target.value)}/>{listed.length>0&&<span className="subtle">{listed.filter(isChecked).length} of {listed.length} ticked</span>}</div>
    {error&&<ErrorMessage message={error}/>}
    <div className="pf-grid"><table><thead><tr><th/><th>Employee Name</th><th>Paycode</th><th>Card No.</th></tr></thead><tbody>{grid.map(e=><tr key={e.id}><td><input type="checkbox" aria-label={'Include '+e.name} checked={isChecked(e.id)} onChange={()=>toggle(e.id)}/></td><td>{e.name}</td><td>{e.paycode}</td><td>{e.cardNo}</td></tr>)}</tbody></table></div>
   </div>
  </div>}
 </div>;
}

// ================= PF Data Upload (KYC) =================
// Form field → original employee master (tbemp) column. PAN, Aadhaar and passport numbers are kept in the employee record
// (Employee Entry). Columns the employee-details master (lib/masters tbemp) does not list yet are kept in this browser.
type KycText='uan'|'oldCode'|'bankAc'|'ifsc'|'kycName'|'pan'|'panKyc'|'aadhaar'|'adharKyc'|'passport'|'passFrom'|'passTo'|'election'|'ration'|'npr'|'edu'|'handi'|'handiType'|'intl'|'submitted'|'oldLeft';
type DocKey='bank'|'adhar'|'pan'|'dl'|'passport'|'election'|'ration'|'npr';
type Docs=Record<DocKey,{on:boolean;date:string}>;
type Kyc=Record<KycText,string>&{docs:Docs};
type LocalKyc={cols?:Record<string,string>;docs?:Docs};
const COLS:[KycText,string][]=[['uan','pf_no'],['oldCode','old_empr_no'],['bankAc','pf_bank_no'],['ifsc','pfb_ifsc'],['kycName','kyc_name'],['panKyc','pan_kyc'],['adharKyc','adhar_kyc'],['passFrom','pass_dtf'],['passTo','pass_dtt'],
 ['election','elc_card'],['ration','ration_card'],['npr','npr_no'],['edu','edu_id'],['handi','handi_yn'],['handiType','handi_id'],['intl','intw_wo'],['submitted','submit_yn'],['oldLeft','dtl_oldemp']];
const DATE_KEYS=new Set<KycText>(['passFrom','passTo','oldLeft']);const YN_KEYS=new Set<KycText>(['handi','intl']);
const BOTTOM:[DocKey,string][]=[['bank','Bank'],['adhar','Adhar'],['pan','Pan'],['dl','DLNo'],['passport','Passport'],['election','Election'],['ration','Ration'],['npr','NPR']];
// EPFO KYC document types.
const DOCS:{code:string;label:string}[]=[{code:'N',label:'National Population Register'},{code:'A',label:'AADHAR'},{code:'P',label:'Permanent Account Number'},{code:'B',label:'Bank Account Number'},{code:'T',label:'Passport'},{code:'D',label:'Driving License'},{code:'E',label:'Election Card'},{code:'R',label:'Ration Card'}];
// EPFO education and handicap lists (edu_id / handi_id are the positions in these lists).
const EDUCATION=[['I','Illiterate'],['N','Non Matric'],['M','Matric'],['S','Senior Secondary'],['G','Graduate'],['P','Post Graduate'],['D','Doctor'],['T','Technical / Professional']];
const HANDICAP=[['','None'],['L','Locomotive'],['H','Hearing'],['V','Visual']];
const SEX=['Male','Female'],MARITAL=['Married','Unmarried','Other'];
const emptyDocs=():Docs=>Object.fromEntries(BOTTOM.map(([k])=>[k,{on:false,date:''}])) as Docs;
const tbempDef=()=>masterDef('tbemp')!;
const stored=(col:string)=>tbempDef().fields.some(f=>f.col===col&&!f.virtual);
function fromCol(k:KycText,raw:string|null|undefined){if(DATE_KEYS.has(k))return dateOnly(raw);if(YN_KEYS.has(k))return clean(raw)==='1'?'Y':'N';if(k==='submitted')return clean(raw)==='1'?'1':'0';if(k==='edu'||k==='handiType')return clean(raw)||'0';return clean(raw);}
function toCol(k:KycText,v:string,type:MasterFieldType){const s=v.trim();if(YN_KEYS.has(k))return s==='Y'?'1':'0';if(type==='date')return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';return k==='ifsc'||k==='uan'?s.toUpperCase():s;}
function kycOf(e:Employee,v:MasterValues|undefined,local:LocalKyc|undefined):Kyc{
 const get=(col:string)=>stored(col)?v?.[col]:(local?.cols?.[col]??v?.[col]);
 const k=Object.fromEntries(COLS.map(([key,col])=>[key,fromCol(key,get(col))])) as Record<KycText,string>;
 // PAN / Aadhaar / passport live on the employee record only, so a number cleared there stays cleared.
 return {...k,pan:e.pan.trim(),aadhaar:e.aadhaar.trim(),passport:e.passport.trim(),docs:{...emptyDocs(),...local?.docs}};}
const digits=(s:string)=>s.replace(/\s+/g,'');
function docNumber(code:string,e:Employee,k:Kyc){switch(code){case 'N':return k.npr;case 'A':return digits(k.aadhaar);case 'P':return k.pan.toUpperCase();case 'B':return digits(k.bankAc);case 'T':return k.passport;case 'D':return e.dlNo.trim();case 'E':return k.election;case 'R':return k.ration;default:return '';}}
const docName=(code:string,e:Employee,k:Kyc)=>(code==='A'?k.adharKyc:code==='P'?k.panKyc:code==='B'?k.kycName:'')||e.name.trim();
function kycWarnings(k:Kyc){const w:string[]=[];if(k.uan&&!/^\d{12}$/.test(k.uan))w.push('UAN No should have 12 digits.');if(k.ifsc&&!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(k.ifsc.toUpperCase()))w.push('IFSC Code should look like ABCD0123456.');
 if(k.pan&&!/^[A-Z]{5}\d{4}[A-Z]$/.test(k.pan.toUpperCase()))w.push('Pan No should look like ABCDE1234F.');if(k.aadhaar&&!/^\d{12}$/.test(digits(k.aadhaar)))w.push('Aadhar No should have 12 digits.');if(k.passFrom&&k.passTo&&k.passFrom>k.passTo)w.push('Passport From is after To.');return w;}
const KYC_HEAD=['UAN','DOCUMENT TYPE','DOCUMENT NUMBER','NAME AS PER DOCUMENT','IFSC'];
const REG_HEAD=['UAN','PREVIOUS MEMBER ID','MEMBER NAME','GENDER','DATE OF BIRTH','DATE OF JOINING','FATHER/HUSBAND NAME','RELATION WITH MEMBER','MOBILE NUMBER','EMAIL ID','NATIONALITY','WAGES AS ON JOINING','QUALIFICATION','MARITAL STATUS','IS INTERNATIONAL WORKER','COUNTRY OF ORIGIN','PASSPORT NUMBER','PASSPORT VALID FROM','PASSPORT VALID TILL','IS PHYSICALLY HANDICAPPED','HANDICAP CATEGORY','AADHAAR NUMBER','NAME AS PER AADHAAR','PAN','NAME AS PER PAN','BANK ACCOUNT NUMBER','IFSC','NAME AS PER BANK'];

export function PfKycUpload({dataset,employees,onClose}:Props){
 const client=useQueryClient();const {extras}=usePfData(dataset);const storeKey='pfkyc:'+dataset;
 const [tab,setTab]=useState<'sel'|'rep'>('sel');const [report,setReport]=useState<{title:string;rows:string[][]}|null>(null);
 const [orderBy,setOrderBy]=useState<'paycode'|'pfno'|'name'>('pfno');const [withLeft,setWithLeft]=useState(false);const [search,setSearch]=useState('');const [selectedId,setSelectedId]=useState('');const [photoFor,setPhotoFor]=useState('');
 // A draft remembers the revision of the employee-details row it was started from (base), so Save can tell when another window changed it.
 const [drafts,setDrafts]=useState<Record<string,Kyc&{base?:number}>>({});const [local,setLocal]=useState(()=>readStore<LocalKyc>(storeKey));
 const [status,setStatus]=useState<'all'|'unsub'|'sub'>('all');const [selectEmp,setSelectEmp]=useState(false);const [subRange,setSubRange]=useState(false);const [subFrom,setSubFrom]=useState(today);const [subTo,setSubTo]=useState(today);
 const [allEmp,setAllEmp]=useState(false);const [pfNoOn,setPfNoOn]=useState(false);const [pfNoText,setPfNoText]=useState('');const [docSel,setDocSel]=useState<Set<string>>(()=>new Set());
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [asking,setAsking]=useState(false);
 const pfNoOf=(e:Employee)=>extras[keyOf(e)]?.pfNo?.trim()||'';
 const list=useMemo(()=>{const q=search.trim().toLowerCase();const pf=(e:Employee)=>extras[keyOf(e)]?.pfNo?.trim()||'';
  const xs=employees.filter(e=>(withLeft||!isLeft(e,extras[keyOf(e)]))&&(!q||[e.paycode,e.cardNo,e.name,pf(e)].join(' ').toLowerCase().includes(q)));
  return [...xs].sort((a,b)=>orderBy==='name'?a.name.localeCompare(b.name):orderBy==='pfno'?((pf(a)?0:1)-(pf(b)?0:1)||pf(a).localeCompare(pf(b),undefined,{numeric:true})||ordinal(a.paycode,b.paycode)):ordinal(a.paycode,b.paycode));},[employees,extras,withLeft,search,orderBy]);
 const sel=employees.find(e=>e.id===selectedId);const selKey=sel?keyOf(sel):'';
 const rowQuery=useQuery({...mastersQuery(dataset,'tbemp',selKey),enabled:!!selKey});const row=rowQuery.data?.rows[0];
 const kyc=sel?(drafts[selKey]??(rowQuery.isSuccess?kycOf(sel,row?.values,local[selKey]):null)):null;
 const edit=(patch:Partial<Kyc>)=>{if(sel&&kyc)setDrafts(d=>({...d,[selKey]:{base:row?.revision??0,...kyc,...patch}}));};
 const setDoc=(k:DocKey,patch:Partial<{on:boolean;date:string}>)=>{if(kyc)edit({docs:{...kyc.docs,[k]:{...kyc.docs[k],...patch}}});};
 const sameBank=!!kyc&&!!sel?.accountNo.trim()&&kyc.bankAc===sel.accountNo.trim()&&kyc.ifsc===sel.ifsc.trim();
 const off=!kyc||busy;
 // Saves the tbemp columns through the generic masters API (every column of the employee-details master is sent, as Employee Entry does),
 // the PAN / Aadhaar / passport numbers through the employee record, and the rest in this browser.
 async function persist(e:Employee,k:Kyc,message:string,base:number){const key=keyOf(e);const def=tbempDef();
  const fresh=(await client.fetchQuery({...mastersQuery(dataset,'tbemp',key),staleTime:0})).rows[0];
  // Every column is sent, so values read before another window's change would undo it: stop and reload instead.
  if((fresh?.revision??0)!==base){setDrafts(d=>{const n={...d};delete n[key];return n;});await client.invalidateQueries({queryKey:['masters',dataset,'tbemp']});
   throw new Error("This employee's details were changed in another window. They have been reloaded; enter your change again.");}
  const values:Record<string,string>=Object.fromEntries(def.fields.filter(f=>!f.virtual).map(f=>[f.col,f.col==='emp_code'?key:f.type==='date'?dateOnly(fresh?.values[f.col]):trimCell(fresh?.values[f.col]??def.defaults?.[f.col]??'')]));
  const cols:Record<string,string>={};for(const [name,col] of COLS){const f=def.fields.find(x=>x.col===col);if(f)values[col]=toCol(name,k[name],f.type);else cols[col]=toCol(name,k[name],DATE_KEYS.has(name)?'date':'text');}
  const savedRow=(await requestJson<{row:MasterRow}>('/api/masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'master-save',table:'tbemp',dataset,key:fresh?fresh.key:null,revision:fresh?fresh.revision:0,values})})).row;
  // This screen's own write moves the draft's base on, so a retry after a later step fails is not taken for another window's change.
  setDrafts(d=>d[key]?{...d,[key]:{...d[key],base:savedRow.revision}}:d);
  const changedApp=k.pan.trim()!==e.pan.trim()||k.aadhaar.trim()!==e.aadhaar.trim()||k.passport.trim()!==e.passport.trim();
  if(changedApp)await saveRecord<Employee>('employee-save',{...e,pan:k.pan.trim().toUpperCase(),aadhaar:k.aadhaar.trim(),passport:k.passport.trim()});
  const next={...local,[key]:{cols,docs:k.docs}};const kept=writeStore(storeKey,next);setLocal(next);
  await Promise.all([client.invalidateQueries({queryKey:['masters',dataset]}),client.invalidateQueries({queryKey:['employee-extras',dataset]}),changedApp?client.invalidateQueries({queryKey:['records',dataset]}):null]);
  setDrafts(d=>{const n={...d};delete n[key];return n;});toast.success(message);if(!kept&&Object.keys(cols).length)toast.warning('This browser did not keep the values that have no database column.');}
 async function save(){if(!sel||!kyc){toast.error('Choose an employee in the list first.');return;}setBusy(true);setError('');
  try{const w=kycWarnings(kyc);await persist(sel,kyc,'Saved Successfully',drafts[selKey]?.base??row?.revision??0);if(w.length)toast.warning(w.join(' '));}catch(e){setError((e as Error).message);void client.invalidateQueries({queryKey:['masters',dataset,'tbemp']});}finally{setBusy(false);}}
 // Delete clears the KYC record (bank KYC, names as per documents, cards, passport dates, Submitted and the document ticks);
 // the UAN and the PAN / Aadhaar / passport numbers of the employee master stay.
 // It starts from the saved values, not from unsaved edits on the screen.
 async function remove(){if(!sel||!rowQuery.isSuccess)return;const saved=kycOf(sel,row?.values,local[selKey]);setAsking(false);setBusy(true);setError('');
  try{await persist(sel,{...saved,bankAc:'',ifsc:'',kycName:'',panKyc:'',adharKyc:'',passFrom:'',passTo:'',election:'',ration:'',npr:'',submitted:'0',docs:emptyDocs()},'KYC details deleted',row?.revision??0);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 // Employees for the upload files: Select Employee = the one shown; otherwise P.F. members (All Employee = everybody), then the
 // Submitted radio, Submitted From / To (a ticked document dated in the range) and PF No filters.
 async function chosen(){
  if(selectEmp&&!sel)throw new Error('Choose an employee in the list (Select Employee is ticked).');
  const all=await client.fetchQuery({...mastersQuery(dataset,'tbemp'),staleTime:60000});const rows=new Map(all.rows.map(r=>[clean(r.values.emp_code),r.values]));
  const base=selectEmp?[sel!]:employees.filter(e=>{const x=extras[keyOf(e)];return (withLeft||!isLeft(e,x))&&(allEmp||x?.pfAlw==='1'||!!x?.pfNo?.trim());});
  const out=base.map(e=>{const key=keyOf(e);return {e,v:rows.get(key),k:drafts[key]??kycOf(e,rows.get(key),local[key])};}).filter(({k})=>selectEmp||((status==='all'||(status==='sub')===(k.submitted==='1'))
   &&(!subRange||BOTTOM.some(([d])=>k.docs[d].on&&k.docs[d].date>=subFrom&&k.docs[d].date<=subTo))&&(!pfNoOn||!pfNoText.trim()||k.uan.includes(pfNoText.trim()))));
  if(!out.length)throw new Error('No employee matches the selection.');return out;}
 async function kycFile(kind:'txt'|'xls'){setError('');if(!docSel.size){setError('Tick at least one document in Document Name.');return;}setBusy(true);
  try{const people=await chosen();const lines:string[][]=[];let noUan=0;
   for(const {e,k} of people){if(!k.uan){noUan++;continue;}for(const d of DOCS){if(!docSel.has(d.code))continue;const n=docNumber(d.code,e,k).trim();if(n)lines.push([k.uan,d.code,n,docName(d.code,e,k).toUpperCase(),d.code==='B'?k.ifsc.toUpperCase():'']);}}
   if(!lines.length)throw new Error(`None of the ${people.length} employees has a UAN and a number for the ticked documents.`);
   const name=`KYC_UPLOAD_${today()}`;if(kind==='txt')downloadText(name+'.txt',lines.map(l=>l.map(csvCell).join(',')).join('\r\n'));else await exportExcel(name+'.xlsx',[{name:'KYC',rows:[KYC_HEAD,...lines]}]);
   setReport({title:'KYC Upload',rows:[KYC_HEAD,...lines]});toast.success(`${lines.length} KYC lines created`);if(noUan)toast.warning(`${noUan} employees have no UAN No and were left out.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function registration(){setError('');setBusy(true);
  try{const people=await chosen();const rows=people.map(({e,v,k})=>{const old=clean(v?.old_pfno);const sex=clean(v?.emp_sex),mar=clean(v?.emp_marital);
    return [k.uan,old&&old!==k.uan?old:'',e.name.toUpperCase(),sex==='1'||/^f/i.test(e.sex)?'F':'M',dmy(e.dob),dmy(e.doj),e.fatherName.toUpperCase(),'F',clean(v?.mob)||e.phone,e.email,'INDIAN','',EDUCATION[Number(k.edu)]?.[0]||'',mar==='0'?'M':mar==='1'?'U':'',k.intl,k.intl==='Y'?'':'INDIA',k.passport,dmy(k.passFrom),dmy(k.passTo),k.handi,k.handi==='Y'?HANDICAP[Number(k.handiType)]?.[0]||'':'',digits(k.aadhaar),k.adharKyc||(k.aadhaar?e.name.toUpperCase():''),k.pan.toUpperCase(),k.panKyc||(k.pan?e.name.toUpperCase():''),digits(k.bankAc),k.ifsc.toUpperCase(),k.kycName||(k.bankAc?e.name.toUpperCase():'')];});
   downloadText(`Member_Registration_${today()}.csv`,[REG_HEAD,...rows].map(l=>l.map(csvCell).join(',')).join('\r\n'),'text/csv');setReport({title:'Member Registration',rows:[REG_HEAD.slice(0,9),...rows.map(r=>r.slice(0,9))]});toast.success(`Member registration file created (${rows.length} employees)`);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const reportPages:Page[]=report?Array.from({length:Math.max(1,Math.ceil((report.rows.length-1)/40))},(_,p)=>({key:'k'+p,label:`Page ${p+1}`,node:<><h2 style={{textAlign:'center',fontSize:'14px',margin:'0 0 6px'}}>{report.title}</h2>
  <table><thead><tr>{report.rows[0].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.rows.slice(1+p*40,1+(p+1)*40).map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></>})):[];
 const text=(label:string,k:KycText,cls?:string)=><><b>{label}</b><input aria-label={label} className={cls} value={kyc?.[k]??''} disabled={off} onChange={e=>edit({[k]:e.target.value} as Partial<Kyc>)}/></>;
 const v=row?.values;
 return <div className="pf-win kyc">
  <Tabs tab={tab} setTab={setTab} canReport={!!report} title="PF Data Upload"/>
  {tab==='rep'?<Preview pages={reportPages} title="PF Data Upload"/>:<div className="kyc-body">
   <div className="kyc-main">
    <div className="kyc-top"><div className="kyc-order" role="radiogroup" aria-label="Order By"><span>Order By</span>{([['paycode','Paycode'],['pfno','PF NO'],['name','Employee Name']] as const).map(([o,l])=><label key={o} className="pf-check"><input type="radio" name="kyc-order" checked={orderBy===o} onChange={()=>setOrderBy(o)}/>{l}</label>)}</div>
     <label className="pf-check"><input type="checkbox" checked={withLeft} onChange={e=>setWithLeft(e.target.checked)}/>With Left Employee</label>
     <button type="button" className="pf-btn pf-grey" disabled={!sel} onClick={()=>{if(sel?.photoKey)setPhotoFor(sel.id);else toast.info('No photo is saved for this employee (Employee Entry › Load Photo).');}}>Load Photo</button></div>
    <div className="kyc-pick"><div className="kyc-photo">{sel&&photoFor===sel.id&&sel.photoKey?<span role="img" aria-label={'Photo of '+sel.name} className="kyc-photo-img" style={{backgroundImage:`url("/api/images?key=${encodeURIComponent(sel.photoKey)}")`}}/>:'Photo'}</div>
     <div><b>Employee Name</b><input aria-label="Find employee" value={search} placeholder="Type paycode, name or PF No" onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&list[0])setSelectedId(list[0].id);}}/>
      <div className="pf-list" role="listbox" aria-label="Employees">{list.slice(0,300).map(e=><button type="button" role="option" aria-selected={e.id===selectedId} key={e.id} className={e.id===selectedId?'is-on':''} onClick={()=>setSelectedId(e.id)}>{e.paycode}  {e.name}{pfNoOf(e)?`  [${pfNoOf(e)}]`:''}{drafts[keyOf(e)]?' *':''}</button>)}{!list.length&&<p>No employees.</p>}{list.length>300&&<p>{list.length-300} more — type to narrow the list.</p>}</div></div></div>
    {sel&&rowQuery.isPending&&<p className="pf-note">Loading the employee&apos;s details…</p>}
    <div className="kyc-fields">
     {text('UAN No','uan')}{text('Old Emplr Code','oldCode')}
     <span/><input aria-label="Bank A/c No. in the employee master" value={sel?.accountNo??''} disabled/><label className="pf-check"><input type="checkbox" disabled={off||!sel?.accountNo.trim()} checked={sameBank} onChange={e=>edit(e.target.checked&&sel?{bankAc:sel.accountNo.trim(),ifsc:sel.ifsc.trim(),kycName:kyc?.kycName||sel.name.trim()}:{bankAc:'',ifsc:''})}/>Same Bank</label><input aria-label="IFSC in the employee master" value={sel?.ifsc??''} disabled/>
     {text('Bank AC/No','bankAc')}{text('IFSC Code','ifsc')}
     <b>Bank Kyc Name</b><input aria-label="Bank Kyc Name" className="span3" value={kyc?.kycName??''} disabled={off} onChange={e=>edit({kycName:e.target.value})}/>
     {text('Pan No','pan')}{text('KYC Pan','panKyc')}
     {text('Aadhar No','aadhaar')}{text('KYC Adhar','adharKyc')}
     {text('Pass Port No.','passport')}<span className="kyc-inline span2"><b>From</b><input type="date" aria-label="Passport valid from" value={kyc?.passFrom??''} disabled={off} onChange={e=>edit({passFrom:e.target.value})}/><b>To</b><input type="date" aria-label="Passport valid to" value={kyc?.passTo??''} disabled={off} onChange={e=>edit({passTo:e.target.value})}/></span>
     {text('Election Card','election')}<span className="kyc-inline span2"><b>Ration Card</b><input aria-label="Ration Card" value={kyc?.ration??''} disabled={off} onChange={e=>edit({ration:e.target.value})}/><b>NPR</b><input aria-label="NPR" value={kyc?.npr??''} disabled={off} onChange={e=>edit({npr:e.target.value})}/></span>
     <b>Education</b><select aria-label="Education" className="span3" value={kyc?.edu??'0'} disabled={off} onChange={e=>edit({edu:e.target.value})}>{EDUCATION.map(([c,l],i)=><option key={c} value={String(i)}>{c} {l}</option>)}</select>
     <b>Is Handicapped(Y/N)</b><span className="kyc-inline span3"><select aria-label="Is Handicapped" style={{width:'60px',flex:'none'}} value={kyc?.handi??'N'} disabled={off} onChange={e=>edit({handi:e.target.value})}><option>N</option><option>Y</option></select><select aria-label="Handicap category" value={kyc?.handiType??'0'} disabled={off||kyc?.handi!=='Y'} onChange={e=>edit({handiType:e.target.value})}>{HANDICAP.map(([c,l],i)=><option key={l} value={String(i)}>{c?`${c} ${l}`:l}</option>)}</select></span>
     <b>Is International Worker(Y/N)</b><span className="kyc-inline span3"><select aria-label="Is International Worker" style={{width:'60px',flex:'none'}} value={kyc?.intl??'N'} disabled={off} onChange={e=>edit({intl:e.target.value})}><option>N</option><option>Y</option></select></span>
     <b>Gender</b><select aria-label="Gender" disabled value={clean(v?.emp_sex)}><option value=""/>{SEX.map((l,i)=><option key={l} value={String(i)}>{l}</option>)}</select><b>Marital Status</b><select aria-label="Marital Status" disabled value={clean(v?.emp_marital)}><option value=""/>{MARITAL.map((l,i)=><option key={l} value={String(i)}>{l}</option>)}</select>
     <b>Document Image Name</b><input aria-label="Document Image Name" className="span3" value={clean(v?.edu_doc_sym)} disabled/>
     <label className="pf-check"><input type="checkbox" checked={kyc?.submitted==='1'} disabled={off} onChange={e=>edit({submitted:e.target.checked?'1':'0'})}/>Submitted</label><span/><b>Old Emplr Leaving Dt</b><input type="date" aria-label="Old Emplr Leaving Dt" value={kyc?.oldLeft??''} disabled={off} onChange={e=>edit({oldLeft:e.target.value})}/>
    </div>
    <div className="kyc-docs">{BOTTOM.map(([k,l])=><div key={k}><label className="pf-check"><input type="checkbox" checked={!!kyc?.docs[k].on} disabled={off} onChange={e=>setDoc(k,{on:e.target.checked,date:kyc?.docs[k].date||(e.target.checked?today():'')})}/>{l}</label><input type="date" aria-label={l+' date'} value={kyc?.docs[k].date??''} disabled={off} onChange={e=>setDoc(k,{date:e.target.value})}/></div>)}</div>
    {sel&&drafts[selKey]&&<span className="pf-dirty">Changes not saved — press Save.</span>}
    {COLS.some(([,c])=>!stored(c))&&<p className="pf-note">KYC Pan / KYC Adhar, Education, Handicapped, International Worker, Submitted, Old Emplr Leaving Dt and the document ticks are kept in this browser until the employee-details master stores them.</p>}
   </div>
   <div className="kyc-side">
    <div className="kyc-buttons">
     <button type="button" className="pf-btn pf-dark" disabled={off} onClick={()=>void save()}>{busy?'Please Wait…':'Save'}</button><button type="button" className="pf-btn pf-lime" disabled={busy} onClick={()=>void kycFile('txt')}>Genrate Kyc Txt</button>
     <button type="button" className="pf-btn pf-orange" disabled={off||!rowQuery.isSuccess} onClick={()=>setAsking(true)}>Delete</button><button type="button" className="pf-btn pf-dark" disabled={busy} onClick={()=>void kycFile('xls')}>Genrate Kyc xls</button>
     <button type="button" className="pf-btn pf-dark" onClick={onClose}>Close</button><button type="button" className="pf-btn pf-deep" disabled={busy} onClick={()=>void registration()}>Member Registration</button></div>
    {error&&<ErrorMessage message={error}/>}
    <div className="kyc-opts">
     <div className="row" role="radiogroup" aria-label="Submitted">{([['all','ALL'],['unsub','UnSubmitted'],['sub','Submitted']] as const).map(([s,l])=><label key={s} className="pf-check"><input type="radio" name="kyc-status" checked={status===s} onChange={()=>setStatus(s)}/>{l}</label>)}</div>
     <div className="row"><label className="pf-check"><input type="checkbox" checked={selectEmp} onChange={e=>setSelectEmp(e.target.checked)}/>Select Employee</label><span>Sel. ID <b>{sel?.paycode||''}</b></span></div>
     <div className="row"><label className="pf-check"><input type="checkbox" checked={subRange} onChange={e=>setSubRange(e.target.checked)}/>Submitted From</label><input type="date" aria-label="Submitted from" value={subFrom} onChange={e=>setSubFrom(e.target.value)}/><span>To</span><input type="date" aria-label="Submitted to" value={subTo} onChange={e=>setSubTo(e.target.value)}/></div>
     <div className="row"><label className="pf-check"><input type="checkbox" checked={allEmp} onChange={e=>setAllEmp(e.target.checked)}/>All Employee</label><label className="pf-check"><input type="checkbox" checked={pfNoOn} onChange={e=>setPfNoOn(e.target.checked)}/>PF No</label><input className="pfno" aria-label="PF No" value={pfNoText} onChange={e=>setPfNoText(e.target.value)}/></div>
    </div>
    <div><label className="pf-check"><input type="checkbox" checked={docSel.size===DOCS.length} onChange={e=>setDocSel(new Set(e.target.checked?DOCS.map(d=>d.code):[]))}/>ALL</label>
     <div className="pf-list kyc-doclist" aria-label="Document Name"><b style={{display:'block',padding:'2px 6px'}}>Document Name</b>{DOCS.map(d=><label key={d.code}><input type="checkbox" checked={docSel.has(d.code)} onChange={e=>setDocSel(p=>{const n=new Set(p);if(e.target.checked)n.add(d.code);else n.delete(d.code);return n;})}/>{d.code} {d.label}</label>)}</div></div>
    <p className="pf-note">Kyc Txt / xls: one line per employee and ticked document (UAN, document type, number, name as per document, IFSC for the bank). Employees: the shown one with Select Employee, else P.F. members (All Employee = everybody).</p>
   </div>
  </div>}
  <AlertDialog open={asking} onOpenChange={setAsking}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete KYC details?</AlertDialogTitle>
   <AlertDialogDescription>The bank KYC, names as per documents, Election / Ration / NPR, passport dates, Submitted and the document ticks of {sel?.name||'this employee'} are cleared. The UAN and the PAN, Aadhaar and passport numbers stay.</AlertDialogDescription></AlertDialogHeader>
   <AlertDialogFooter><AlertDialogCancel>No</AlertDialogCancel><AlertDialogAction onClick={()=>void remove()}>Yes, delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>;
}
