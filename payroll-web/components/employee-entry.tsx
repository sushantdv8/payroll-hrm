'use client';
import {useMemo,useRef,useState} from 'react';
import {useQueries,useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,Ban,Download,FilePlus2,ImagePlus,Pencil,Save,Search,Trash2,X} from 'lucide-react';
import {toast} from 'sonner';
import {emptyEmployee,educationOptions,type Employee} from '@/lib/payroll';
import {masterDef,trimCell,dateOnly,type MasterRow,type MasterValues} from '@/lib/masters';
import {realResignDate,dmy,type Extra} from '@/lib/report-utils';
import {deleteRecord,exportExcel,requestJson,saveRecord} from '@/lib/client-api';
import {Button} from '@/components/ui/button';
import {ConfirmDelete,ErrorMessage} from './payroll-controls';
import './employee-entry.css';

type Row=Record<string,string>;
type Draft={app:Employee;emp:Row;exp:Row;ref:Row;fam:Row;nom:Row;rates:Record<string,{rt1:string;rt2:string}>};
type Opt={value:string;label:string};
const o=(...labels:string[]):Opt[]=>labels.map((label,value)=>({value:String(value),label}));
// Code lists follow the order of the original combo boxes (checked against the data where possible: 0 = Male / Hindu / Active).
const SEX=o('Male','Female'),MARITAL=o('Married','Unmarried','Other'),BLOOD=o('None','A+','A-','B+','B-','AB+','AB-','O+','O-'),RELIGION=o('Hindu','Muslim','Other'),ACTIVE=o('Active','Left');
const WEEKDAY=o('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'),EXTRA_OFF=o('None','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday');
const SHIFT_TYPE=o('Within'),PUNCH=o('General'),EMP_STATUS=o('Permanant'),SAL_MODE=o('Monthly','Daily','Daily (2)'),PAY_MODE=o('Bank','Cheque','Cash'),OT_TYPE=o('None');
const SIDE_TABLES=['tbemp','tbemp_exp','tbemp_ref','tbemp_fam','tbemp_nom'] as const;
const LIST_TABLES=['tbsubcmp','tblocation','tbdephead','tbdep','tbdes','tbcat','tbsalg','tblvgrade','tbshift','tbbank','tbearn','tbmisc'] as const;
const numeric=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true});
// The original lists paycodes in text order (24029 before 5033), like SQL ORDER BY on its char paycode column.
const ordinal=(a:string,b:string)=>a<b?-1:a>b?1:0;
const masters=(dataset:string,table:string,key?:string)=>({queryKey:key==null?['masters',dataset,table]:['masters',dataset,table,'key',key],queryFn:({signal}:{signal:AbortSignal})=>requestJson<{rows:MasterRow[]}>('/api/masters?'+new URLSearchParams(key==null?{dataset,table}:{dataset,table,key}),{signal}),refetchOnWindowFocus:false});
const toRow=(v:MasterValues|undefined,table:string)=>{const def=masterDef(table)!;return Object.fromEntries(def.fields.map(f=>[f.col,f.type==='date'?dateOnly(v?.[f.col]):trimCell(v?.[f.col]??def.defaults?.[f.col]??'')]));};
const keyOf=(e:Employee)=>String(e.sourceKey||e.id);
const SORTS:[string,string,(e:Employee)=>string][]=[['paycode','Paycode',e=>e.paycode],['card','Card No.',e=>e.cardNo],['name','Employee name',e=>e.name],['father','Father name',e=>e.fatherName],['doj','D.O.J',e=>e.doj],['designation','Designation',e=>e.designation],['department','Department',e=>e.department],['location','Location',e=>e.location],['subcompany','Subcompany',e=>e.subCompany]];

function Sel({value,options,onChange,disabled,label}:{value:string;options:Opt[];onChange:(v:string)=>void;disabled:boolean;label:string}){
 const list=value!==''&&!options.some(x=>x.value===value)?[...options,{value,label:`Code ${value}`}]:options;
 return <select aria-label={label} className="ee-input" disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{list.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select>;
}

export function EmployeeEntry({dataset,employees,companyName,onChange}:{dataset:string;employees:Employee[];companyName:string;onChange:()=>Promise<unknown>}){
 const client=useQueryClient();
 const [mode,setMode]=useState<'grid'|'detail'>('grid');const [selectedId,setSelectedId]=useState<string|null>(null);const [editing,setEditing]=useState(false);const [isNew,setIsNew]=useState(false);
 const [serch,setSerch]=useState('paycode');const [findText,setFindText]=useState('');const [foundSno,setFoundSno]=useState('');const [location,setLocation]=useState('all');const [filterOn,setFilterOn]=useState('all');const [sortOn,setSortOn]=useState('paycode');const [limit,setLimit]=useState(300);
 const [tab,setTab]=useState('personal');const [editDraft,setDraft]=useState<Draft|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [removing,setRemoving]=useState(false);const [uploading,setUploading]=useState(false);
 const extras=useQuery({queryKey:['employee-extras',dataset],queryFn:({signal})=>requestJson<{extras:Record<string,Extra>}>('/api/employee-extras?'+new URLSearchParams({dataset}),{signal}),refetchOnWindowFocus:false,staleTime:600000});
 const lists=useQueries({queries:LIST_TABLES.map(t=>masters(dataset,t)),combine:rs=>Object.fromEntries(LIST_TABLES.map((t,k)=>{const def=masterDef(t)!;return [t,(rs[k].data?.rows||[]).map(r=>({code:trimCell(r.values[def.key[def.key.length-1]]),name:def.nameCol?trimCell(r.values[def.nameCol]):'',values:r.values})).sort((a,b)=>numeric(a.code,b.code))];})) as Record<string,{code:string;name:string;values:MasterValues}[]>});
 const rates=useQuery(masters(dataset,'tbsal'));
 const selected=employees.find(e=>e.id===selectedId)||null;const empKey=selected?keyOf(selected):'';
 const side=useQueries({queries:SIDE_TABLES.map(t=>({...masters(dataset,t,empKey),enabled:mode==='detail'&&!!empKey&&!isNew}))});
 const sideRows=side.map(q=>q.data?.rows[0]);const sideReady=isNew||side.every(q=>!q.isPending);
 const history=useQuery({queryKey:['rate-history',dataset,empKey],queryFn:({signal})=>requestJson<{history:{month:string;total:number;rates:{label:string;rate:number}[]}[]}>('/api/rate-history?'+new URLSearchParams({dataset,emp:empKey}),{signal}),enabled:mode==='detail'&&tab==='salary'&&/^\d+$/.test(empKey),refetchOnWindowFocus:false});
 const heads=lists.tbearn||[];
 // This employee's saved rate for each earning head (first row when the original has duplicates).
 const empRates=new Map<string,MasterRow>();for(const r of rates.data?.rows||[])if(trimCell(r.values.emp_code)===empKey&&!empRates.has(trimCell(r.values.e_code)))empRates.set(trimCell(r.values.e_code),r);

 const extraMap=extras.data?.extras;
 const shown=useMemo(()=>{const get=SORTS.find(s=>s[0]===sortOn)![2];const x=extraMap||{};
  return employees.filter(e=>{const left=!!realResignDate(e)||x[keyOf(e)]?.act==='1';return (location==='all'||e.location===location)&&(filterOn==='all'||(filterOn==='working'?!left:left));}).sort((a,b)=>['paycode','card','doj'].includes(sortOn)?ordinal(get(a)||'',get(b)||''):get(a).localeCompare(get(b)));},[employees,extraMap,location,filterOn,sortOn]);
 const locations=useMemo(()=>Array.from(new Set(employees.map(e=>e.location).filter(Boolean))).sort(),[employees]);

 const buildDraft=(e:Employee,rows:(MasterRow|undefined)[]):Draft=>({app:{...e},emp:toRow(rows[0]?.values,'tbemp'),exp:toRow(rows[1]?.values,'tbemp_exp'),ref:toRow(rows[2]?.values,'tbemp_ref'),fam:toRow(rows[3]?.values,'tbemp_fam'),nom:toRow(rows[4]?.values,'tbemp_nom'),
  rates:Object.fromEntries(heads.map(h=>{const r=empRates.get(h.code);return [h.code,{rt1:trimCell(r?.values.rt1)||'0',rt2:trimCell(r?.values.rt2)||'0'}];}))});
 const initial=useRef('');
 // View mode shows the saved data directly; Modify / New work on an editable copy.
 const viewDraft=mode==='detail'&&selected&&sideReady&&!isNew?buildDraft(selected,sideRows):null;
 const draft=editing?editDraft:viewDraft;
 function modify(){if(!viewDraft)return;initial.current=JSON.stringify(viewDraft);setDraft(viewDraft);setEditing(true);setError('');}

 function open(id:string){setSelectedId(id);setIsNew(false);setEditing(false);setError('');setMode('detail');setTab('personal');setDraft(null);}
 function startNew(){const e=emptyEmployee();e.paycode='';e.name='';e.dataset=dataset;e.active=true;const d=buildDraft(e,[]);d.emp.emp_code=e.id;
  // A new employee starts without rates (buildDraft would otherwise take the rates of the employee shown before).
  d.rates=Object.fromEntries(heads.map(h=>[h.code,{rt1:'0',rt2:'0'}]));initial.current='';setDraft(d);setSelectedId(null);setIsNew(true);setEditing(true);setMode('detail');setTab('personal');setError('');}
 function cancel(){setError('');setDraft(null);setEditing(false);if(isNew){setIsNew(false);setMode('grid');}}
 function back(){if(editing){toast.error('Save or cancel the current entry first.');return;}setMode('grid');}
 function find(next:boolean){const q=findText.trim().toLowerCase();if(!q)return;const get:(e:Employee)=>string=serch==='card'?e=>e.cardNo:serch==='name'?e=>e.name:serch==='father'?e=>e.fatherName:e=>e.paycode;
  const start=next&&selectedId?shown.findIndex(e=>e.id===selectedId)+1:0;const hit=[...shown.slice(start),...shown.slice(0,start)].find(e=>get(e).toLowerCase().includes(q));
  if(!hit){toast.error('Not found');return;}const index=shown.indexOf(hit);if(index>=limit)setLimit(index+50);setSelectedId(hit.id);setFoundSno(String(index+1));setTimeout(()=>document.getElementById('ee-row-'+hit.id)?.scrollIntoView({block:'center'}),50);}

 const set=(part:keyof Omit<Draft,'app'|'rates'>,col:string,value:string)=>setDraft(d=>d?{...d,[part]:{...d[part],[col]:value}}:d);
 const setApp=<K extends keyof Employee>(k:K,v:Employee[K])=>setDraft(d=>d?{...d,app:{...d.app,[k]:v}}:d);
 const ro=!editing||busy;
 async function upload(file:File|undefined,key:'photoKey'|'signatureKey'){if(!file)return;setUploading(true);try{const data=new FormData();data.append('file',file);const r=await requestJson<{key:string}>('/api/images',{method:'POST',body:data});setApp(key,r.key);}catch(e){setError((e as Error).message);}finally{setUploading(false);}}

 async function saveMaster(table:string,existing:MasterRow|undefined,values:Row,key:string){const def=masterDef(table)!;const body=Object.fromEntries(def.fields.map(f=>[f.col,f.col==='emp_code'?key:values[f.col]??'']));
  if(!existing&&def.fields.every(f=>f.col==='emp_code'||!values[f.col]||values[f.col]==='0'||values[f.col]===(def.defaults?.[f.col]??'')))return;
  await requestJson('/api/masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'master-save',table,dataset,key:existing?existing.key:null,revision:existing?existing.revision:0,values:body})});}
 async function save(){if(!draft)return;setBusy(true);setError('');
  try{
   const e=draft.emp;const label=(list:Opt[],v:string)=>list.find(x=>x.value===v)?.label||'';
   const before=initial.current?JSON.parse(initial.current) as Draft:null;
   // Imported employees keep "not confirmed" (null) until the Active field is actually changed.
   const active=draft.app.active===null&&before?.emp.emp_act===e.emp_act?null:e.emp_act!=='1';
   const app:Employee={...draft.app,sex:label(SEX,e.emp_sex),maritalStatus:label(MARITAL,e.emp_marital),bloodGroup:e.emp_bg==='0'?'':label(BLOOD,e.emp_bg),religion:label(RELIGION,e.emp_relg),
    salaryMode:e.sal_mode==='0'?'Monthly':'',paymentMode:(label(PAY_MODE,e.pay_mode)||'') as Employee['paymentMode'],active};
   const saved=await saveRecord<Employee>('employee-save',app);const key=keyOf(saved);
   for(const [k,table] of [['emp','tbemp'],['exp','tbemp_exp'],['ref','tbemp_ref'],['fam','tbemp_fam'],['nom','tbemp_nom']] as const){if(before&&JSON.stringify(before[k])===JSON.stringify(draft[k]))continue;await saveMaster(table,isNew?undefined:sideRows[SIDE_TABLES.indexOf(table)],draft[k],key);}
   for(const h of heads){const r=draft.rates[h.code];const old=empRates.get(h.code);const changed=!old?(Number(r.rt1)||Number(r.rt2)):(trimCell(old.values.rt1)!==r.rt1||trimCell(old.values.rt2)!==r.rt2);
    if(changed)await requestJson('/api/masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'master-save',table:'tbsal',dataset,key:old?old.key:null,revision:old?old.revision:0,values:{emp_code:key,e_code:h.code,rt1:r.rt1||'0',rt2:r.rt2||'0'}})});}
   await Promise.all([client.invalidateQueries({queryKey:['masters',dataset]}),client.invalidateQueries({queryKey:['employee-extras',dataset]}),onChange()]);
   setSelectedId(saved.id);setIsNew(false);setEditing(false);setDraft(null);toast.success('Employee saved successfully');
  }catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 async function remove(){if(!selected)return;setBusy(true);try{await deleteRecord('employee-delete',selected.id,selected.revision);await onChange();setRemoving(false);setSelectedId(null);setMode('grid');toast.success('Employee removed');}catch(e){setError((e as Error).message);setRemoving(false);}finally{setBusy(false);}}
 async function download(){await exportExcel('Employee_Entry.xlsx',[{name:'Employees',rows:[['Sno','Paycode','Card No.','Employee Name','Father/Husband Name','D.O.J.','Resign Dt','Designation','Department','Location','Sub Company'],...shown.map((e,i)=>[i+1,e.paycode,e.cardNo,e.name,e.fatherName,dmy(e.doj),dmy(realResignDate(e)),e.designation,e.department,e.location,e.subCompany])]}]);toast.success('Excel file created');}

 // Field helpers --------------------------------------------------------------
 const text=(label:string,k:keyof Employee,extra:{type?:string;wide?:boolean;required?:boolean}={})=><label className={extra.wide?'ee-wide':''}><span>{label}{extra.required?' *':''}</span><input className="ee-input" type={extra.type||'text'} disabled={ro} value={String(draft?.app[k]??'')} onChange={e=>setApp(k,e.target.value as Employee[typeof k])}/></label>;
 const area=(label:string,k:keyof Employee)=><label className="ee-wide"><span>{label}</span><textarea className="ee-input" rows={2} disabled={ro} value={String(draft?.app[k]??'')} onChange={e=>setApp(k,e.target.value as Employee[typeof k])}/></label>;
 const eText=(label:string,part:keyof Omit<Draft,'app'|'rates'>,col:string,type='text')=><label><span>{label}</span><input className="ee-input" type={type} disabled={ro} value={draft?.[part][col]??''} onChange={e=>set(part,col,e.target.value)}/></label>;
 const eSel=(label:string,col:string,options:Opt[])=><label><span>{label}</span><Sel label={label} value={draft?.emp[col]??''} options={options} disabled={ro} onChange={v=>set('emp',col,v)}/></label>;
 const flag=(label:string,part:keyof Omit<Draft,'app'|'rates'>,col:string)=><label className="ee-check"><input type="checkbox" disabled={ro} checked={draft?.[part][col]==='1'} onChange={e=>set(part,col,e.target.checked?'1':'0')}/>{label}</label>;
 const lookup=(label:string,col:string,table:string,appKey?:keyof Employee)=>{const opts=(lists[table]||[]).map(x=>({value:x.code,label:x.name||x.code}));
  return <label><span>{label}</span><Sel label={label} value={draft?.emp[col]??''} options={[{value:'',label:appKey&&draft?.app[appKey]?String(draft.app[appKey]):'—'},...opts]} disabled={ro} onChange={v=>{set('emp',col,v);if(appKey){const name=opts.find(x=>x.value===v)?.label||'';setApp(appKey,name as Employee[typeof appKey]);}}}/></label>;};
 const pair=(label:string,c1:string,c2:string)=><label><span>{label}</span><span className="ee-pair"><input className="ee-input" type="number" step="any" disabled={ro} value={draft?.emp[c1]??''} onChange={e=>set('emp',c1,e.target.value)}/><input className="ee-input" type="number" step="any" disabled={ro} value={draft?.emp[c2]??''} onChange={e=>set('emp',c2,e.target.value)}/></span></label>;
 const eduOptions=useMemo(()=>{const misc=(lists.tbmisc||[]).filter(x=>trimCell(x.values.misc_code)==='0').map(x=>x.name);return Array.from(new Set(['',...misc,...educationOptions]));},[lists.tbmisc]);
 const techOptions=useMemo(()=>Array.from(new Set(['',...(lists.tbmisc||[]).filter(x=>trimCell(x.values.misc_code)==='1').map(x=>x.name)])),[lists.tbmisc]);
 const grid=(part:'exp'|'ref'|'fam'|'nom',rows:number[],cols:[string,string,string?][])=><div className="ee-grid-wrap"><table className="ee-grid"><thead><tr><th>Sno</th>{cols.map(([,h])=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(k=><tr key={k}><td>{k}</td>{cols.map(([pattern,h,type])=>{const col=pattern.replace('#',String(k));return <td key={h}>{type==='flag'?<input type="checkbox" aria-label={h+' '+k} disabled={ro} checked={draft?.[part][col]==='1'} onChange={e=>set(part,col,e.target.checked?'1':'0')}/>:<input className="ee-cell" aria-label={h+' '+k} type={type||'text'} disabled={ro} value={draft?.[part][col]??''} onChange={e=>set(part,col,e.target.value)}/>}</td>;})}</tr>)}</tbody></table></div>;

 const header=<div className="ee-serch"><fieldset><legend>Serch</legend>{[['paycode','Paycode'],['card','Card No'],['name','Employee Name'],['father','Father Name']].map(([v,l])=><label key={v}><input type="radio" name="ee-serch" checked={serch===v} onChange={()=>setSerch(v)}/>{l}</label>)}</fieldset>
  <input className="ee-input ee-find" aria-label="Search value" value={findText} onChange={e=>setFindText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')find(false);}} placeholder="Please Enter For Search"/>
  <Button size="sm" variant="outline" onClick={()=>find(false)}><Search size={14}/>Find</Button><Button size="sm" variant="outline" onClick={()=>find(true)}>Find Next</Button><input className="ee-input ee-sno" aria-label="Found row" value={foundSno} readOnly/>
  <label className="ee-inline">Location Name<select className="ee-input" value={location} onChange={e=>setLocation(e.target.value)}><option value="all">All Location</option>{locations.map(l=><option key={l} value={l}>{l}</option>)}</select></label></div>;

 if(mode==='grid')return <div className="ee-window">
  <div className="ee-title"><h1>Employee Entry</h1><span className="subtle">{companyName}</span></div>
  {header}
  <div className="ee-main-grid"><table className="ee-list"><thead><tr>{['Sno','Paycode','Card No.','Employee Name','Father/Husband  Name','D. O. J.','Resign Dt','Designation','Department','Location','Sub Company'].map(h=><th key={h}>{h}</th>)}</tr></thead>
   <tbody>{shown.slice(0,limit).map((e,i)=><tr key={e.id} id={'ee-row-'+e.id} className={e.id===selectedId?'is-selected':''} onClick={()=>setSelectedId(e.id)} onDoubleClick={()=>open(e.id)} tabIndex={0} onKeyDown={ev=>{if(ev.key==='Enter')open(e.id);}}><td className="ee-sno-cell">{i+1}</td><td>{e.paycode}</td><td>{e.cardNo}</td><td>{e.name}</td><td>{e.fatherName}</td><td>{dmy(e.doj)}</td><td>{dmy(realResignDate(e))}</td><td>{e.designation}</td><td>{e.department}</td><td>{e.location}</td><td>{e.subCompany}</td></tr>)}</tbody></table>
   {shown.length>limit&&<button type="button" className="ee-more" onClick={()=>setLimit(l=>l+500)}>Show more ({shown.length-limit} more)</button>}</div>
  <div className="ee-bottom"><fieldset><legend>Filter On</legend>{[['all','All Employee'],['working','Only Working'],['resign','Only Resign']].map(([v,l])=><label key={v}><input type="radio" name="ee-filter" checked={filterOn===v} onChange={()=>setFilterOn(v)}/>{l}</label>)}</fieldset>
   <fieldset className="ee-sorting"><legend>Sorting On</legend>{SORTS.map(([v,l])=><label key={v}><input type="radio" name="ee-sort" checked={sortOn===v} onChange={()=>setSortOn(v)}/>{l}</label>)}</fieldset>
   <div className="ee-grid-actions"><span className="subtle">{shown.length} employees · double-click a row to open it</span><Button onClick={startNew}><FilePlus2 size={16}/>New</Button><Button variant="outline" disabled={!selectedId} onClick={()=>selectedId&&open(selectedId)}><Pencil size={16}/>Open</Button><Button variant="outline" onClick={download}><Download size={16}/>Excel</Button></div></div>
 </div>;

 const tabs:[string,string][]=[['personal','Personal'],['professional','Professional'],['salary','Salary'],['pfesi','PF  &  ESI'],['others','Others']];
 const hist=history.data?.history||[];const histLabels=Array.from(new Set(hist.flatMap(h=>h.rates.map(r=>r.label))));
 const d=draft;
 return <div className="ee-window">
  <div className="ee-title"><h1>Employee Entry</h1><span className="subtle">{isNew?'New employee':selected?`${selected.name} · ${selected.paycode}`:''}</span>{editing&&<span className="unsaved-badge">{isNew?'New entry':'Modifying'}</span>}</div>
  {!d?<div className="ee-page"><p role="status">Loading employee…</p></div>:<>
  <div className="ee-tabs" role="tablist">{tabs.map(([v,l])=><button key={v} type="button" role="tab" aria-selected={tab===v} className={tab===v?'is-active':''} onClick={()=>setTab(v)}>{l}</button>)}</div>
  <fieldset className="ee-page" disabled={busy}>
   {tab==='personal'&&<div className="ee-personal"><div className="ee-cols">
    <label><span>Seq No.</span><input className="ee-input" disabled value={isNew?'(new)':String(selected?.sourceKey||'')}/></label>{text('Paycode','paycode',{required:true})}{text('Attn.Card No.','cardNo')}{text('Employee Name','name',{required:true})}{text('Father/Hus. Name','fatherName')}{text('Mother Name','motherName')}{text('Wife Name','wifeName')}{text('Date Of Birth','dob',{type:'date'})}{text('Phone No.','phone')}{text('Email','email')}{text('Pan No.','pan')}{text('D.L. No.','dlNo')}{text('Passport No.','passport')}{text('Adhar no.','aadhaar')}{text('Handicaped','disability')}{text('Emergency contact','emergencyName')}{text('Emergency phone','emergencyPhone')}{text('Emergency relation','emergencyRelation')}
   </div><div className="ee-cols">
    {eSel('Sex','emp_sex',SEX)}{eSel('Marital Status','emp_marital',MARITAL)}{eSel('Blood Group','emp_bg',BLOOD)}{eSel('Religion','emp_relg',RELIGION)}{text('Height','height')}{text('Weight','weight')}
    <label><span>Education Quali.</span><select className="ee-input" disabled={ro} value={d.app.education} onChange={e=>setApp('education',e.target.value)}>{eduOptions.map(x=><option key={x} value={x}>{x||'—'}</option>)}</select></label>
    <label><span>Technical  Quali.</span><select className="ee-input" disabled={ro} value={d.app.technicalQualification} onChange={e=>setApp('technicalQualification',e.target.value)}>{Array.from(new Set([...techOptions,d.app.technicalQualification])).map(x=><option key={x} value={x}>{x||'—'}</option>)}</select></label>
    {eSel('Active','emp_act',ACTIVE)}{eText('Spl.Value','emp','emp_spl','number')}
   </div><div className="ee-photo">{(['photoKey','signatureKey'] as const).map(k=><div key={k} className="ee-image">{d.app[k]?<img src={'/api/images?key='+encodeURIComponent(d.app[k])} alt={k==='photoKey'?'Employee photo':'Signature'}/>:<ImagePlus size={28}/>}<label className="ee-upload">{k==='photoKey'?'Load Photo':'Load Sign.'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={ro||uploading} onChange={e=>upload(e.target.files?.[0],k)}/></label></div>)}</div>
   <div className="ee-address">{area('Local Address','localAddress')}<label className="ee-check"><input type="checkbox" disabled={ro} checked={!!d.app.localAddress&&d.app.localAddress===d.app.permanentAddress} onChange={e=>{if(e.target.checked)setApp('permanentAddress',d.app.localAddress);}}/>As Per Same Address</label>{area('Permanant  Address','permanentAddress')}{area('Remarks If Any','remarks')}</div></div>}

   {tab==='professional'&&<><div className="ee-prof"><div className="ee-cols">{text('Date Of Join','doj',{type:'date'})}<div className="ee-inline-row">{flag('If PF JOIN is Diff.','emp','doj_p')}</div>{eText('Date Of Confirm','emp','emp_doc','date')}{text('Confirmation Date','confirmationDate',{type:'date'})}{text('Employment Type','employmentType')}<label><span>Reporting Manager</span><select className="ee-input" disabled={ro} value={d.app.reportingManagerId||''} onChange={ev=>setApp('reportingManagerId',ev.target.value)}><option value="">—</option>{employees.filter(x=>x.id!==d.app.id).map(x=><option key={x.id} value={x.id}>{x.paycode} — {x.name}</option>)}</select></label>{text('Resign Date','resignDate',{type:'date'})}{flag('VIP','emp','emp_vip')}</div>
    <div className="ee-cols"><label><span>Company Name</span><input className="ee-input" disabled value={companyName}/></label>{lookup('Sub Comp.Name','sub_code','tbsubcmp','subCompany')}{lookup('Location Name','loc_code','tblocation','location')}{lookup('Department head','dhead_code','tbdephead')}{lookup('Department Name','dep_code','tbdep','department')}{lookup('Designation Name','des_code','tbdes','designation')}{lookup('Category Name','cat_code','tbcat')}</div>
    <div className="ee-cols">{lookup('Salary Grade','sal_code','tbsalg')}{lookup('Leave  Grade','leave_code','tblvgrade')}{lookup('Shift Name','shift_code','tbshift')}{eSel('Shift Type','shift_type',SHIFT_TYPE)}{eSel('Weekly off day','wk_off',WEEKDAY)}{eSel('Extra Off Day','ext_off',EXTRA_OFF)}{eSel('Punch Type','punch_type',PUNCH)}{eText('Realation If Any','emp','rel_any')}{eSel('Employee type','stype',EMP_STATUS)}</div></div>
    <h3 className="ee-grid-title">Last Experiance In Diffrent Companies</h3>{grid('exp',[1,2,3],[['ecomp_name#','Company'],['dof#','From','date'],['dot#','To','date'],['exp_time#','Period'],['designation#','Designation'],['res_resign#','Reason of resign'],['ecomp_add#','Address']])}
    <h3 className="ee-grid-title">Refrences</h3><div className="ee-grid-wrap"><table className="ee-grid"><thead><tr><th>Sno</th>{['Ref.Name','Address','Phone','Designation','Relation','No Of Year'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{[1,2].map(k=><tr key={k}><td>{k}</td>{['ref_name','ref_add','ref_ph','ref_desig','ref_rel',k===1?'ref_year':'ref_yer'].map(c=>{const col=c+k;return <td key={col}><input className="ee-cell" aria-label={col} disabled={ro} value={d.ref[col]??''} onChange={e=>set('ref',col,e.target.value)}/></td>;})}</tr>)}</tbody></table></div></>}

   {tab==='salary'&&<><h3 className="ee-grid-title">Salary Rate History</h3><div className="ee-grid-wrap ee-history">{hist.length?<table className="ee-grid"><thead><tr><th>Month-Year</th><th>Total</th>{histLabels.map(l=><th key={l}>{l}</th>)}</tr></thead><tbody>{hist.map(h=><tr key={h.month}><td>{h.month.slice(5)}-{h.month.slice(0,4)}</td><td className="num">{h.total}</td>{histLabels.map(l=><td key={l} className="num">{h.rates.find(r=>r.label===l)?.rate??''}</td>)}</tr>)}</tbody></table>:<p className="subtle">{history.isFetching?'Loading…':'No saved salary rates for this employee.'}</p>}</div>
    <div className="ee-salary"><div><table className="ee-grid ee-rates"><thead><tr><th>Head</th><th>Rate 1</th><th>Rate 2</th></tr></thead><tbody>{heads.map(h=><tr key={h.code}><th>{h.name}</th>{(['rt1','rt2'] as const).map(c=><td key={c}><input className="ee-cell" type="number" step="any" aria-label={h.name+' '+c} disabled={ro} value={d.rates[h.code]?.[c]??'0'} onChange={e=>setDraft(x=>x?{...x,rates:{...x.rates,[h.code]:{...(x.rates[h.code]||{rt1:'0',rt2:'0'}),[c]:e.target.value}}}:x)}/></td>)}</tr>)}
      <tr><th>Total</th><td className="num">{heads.reduce((s,h)=>s+(Number(d.rates[h.code]?.rt1)||0),0)}</td><td className="num">{heads.reduce((s,h)=>s+(Number(d.rates[h.code]?.rt2)||0),0)}</td></tr></tbody></table></div>
     <div className="ee-cols">{pair('Fooding Rate 1 or 2','food1','food2')}{pair('Tea  1 or 2','tea1','tea2')}{pair('Incentive  1 or 2','incent1','incent2')}{pair('Conv.Rate 1 or 2','conv1','conv2')}{pair('Add.Salary 1 or 2','add_s1','add_s2')}{pair('Night 1 or 2','night1','night2')}{pair('Sales Ince. 1 or 2','sales1','sales2')}{pair('O.T.Rate / OT limit','ot_rate','ot_limit')}{eText('Bus Fare/Cab','emp','bus_amt','number')}{eSel('Overtime Type','ot_type',OT_TYPE)}</div>
     <div className="ee-cols ee-flags">{flag('Food Allow','emp','food_alw')}{flag('Tea Allow','emp','tea_alw')}{flag('Inc. Allow','emp','incent_alw')}{flag('Conv.Allow','emp','conv_alw')}{flag('Add. Allow','emp','add_s_alw')}{flag('Night Allow','emp','night_alw')}{flag('Sales In. Alw.','emp','sales_alw')}{flag('Bus Ded App.','emp','bus_alw')}{flag('Over time  Allow','emp','ot_alw')}</div>
     <div className="ee-cols">{eSel('Salary Mode','sal_mode',SAL_MODE)}{eSel('Payment Mode','pay_mode',PAY_MODE)}{lookup('Bank Name','bank_code','tbbank','bankName')}{text('Account No.','accountNo')}{text('Bank Branch','bankBranch')}{text('IFSC','ifsc')}{eText('C.I.D.','emp','cid_no')}</div>
     <div className="ee-cols ee-flags">{flag('LWF Cut','emp','lwf_app')}{flag('Late Ded.','emp','late_app')}{flag('P.Tax','emp','ptax_app')}{flag('Bonus Allow','emp','bonus_alw')}{flag('Bonus Exg.','emp','ex_gratia')}{eText('Bonus %','emp','bonus_per','number')}</div></div></>}

   {tab==='pfesi'&&<><div className="ee-prof"><div className="ee-cols"><h3 className="ee-grid-title">PF</h3>{flag('PF Applicable','emp','pf_alw')}{flag('PF (2)','emp','pf1_alw')}{eText('PF No. / UAN','emp','pf_no')}{eText('Old PF No.','emp','old_pfno')}{eText('EPF Nominee','emp','epf_nomm')}{eText('Nominee Address','emp','epf_nommadd')}{eText('PF Bank A/c No.','emp','pf_bank_no')}{eText('PF Bank IFSC','emp','pfb_ifsc')}</div>
    <div className="ee-cols"><h3 className="ee-grid-title">PF limits</h3>{flag('Ignore employee wage limit','emp','pfel_lmt_ignr')}{eText('Employee wage limit','emp','pf_el_lmt','number')}{flag('Own employee PF %','emp','pfper_elignr')}{eText('Employee PF %','emp','pfper_el','number')}{flag('Ignore employer wage limit','emp','pfer_lmt_ignr')}{eText('Employer wage limit','emp','pf_er_lmt','number')}{flag('Own employer PF %','emp','pfper_erignr')}{eText('Employer PF %','emp','pfper_er','number')}</div>
    <div className="ee-cols"><h3 className="ee-grid-title">ESI</h3>{flag('ESI Applicable','emp','esi_alw')}{flag('ESI (2)','emp','esi1_alw')}{eText('ESI No.','emp','esi_no')}{eText('ESI limit','emp','esi_lmt','number')}{flag('ESI on OT','emp','esi_ot')}{eText('ESI Dispensary','emp','disp_esi')}</div></div>
    <h3 className="ee-grid-title">Nominees</h3>{grid('nom',[1,2,3,4],[['n_name#','Name'],['n_add#','Address'],['n_rel#','Relation'],['n_dob#','Date Of Birth','date'],['n_age#','Age'],['n_pf#','PF','flag'],['ns_pf#','PF %','number'],['n_esi#','ESI','flag'],['ns_esi#','ESI %','number'],['n_grat#','Gratuity','flag'],['ns_grat#','Grat. %','number']])}
    <p className="ee-note">This tab was not opened in the video; its fields are the PF / ESI fields kept in the original employee master.</p></>}

   {tab==='others'&&<><div className="ee-prof"><div className="ee-cols">{eText('Mobile','emp','mob')}{eText('Ident. Marks','emp','emp_marks')}{eText('Election Card','emp','elc_card')}{eText('Ration Card','emp','ration_card')}{eText('NPR No.','emp','npr_no')}{eText('KYC Name','emp','kyc_name')}{eText('Old Employer No.','emp','old_empr_no')}</div>
    <div className="ee-cols"><h3 className="ee-grid-title">Permanent address details</h3>{eText('Address 1','emp','pad1')}{eText('Address 2','emp','pad2')}{eText('City','emp','pcity')}{eText('District','emp','pdist')}{eText('State','emp','pstate')}{eText('PIN','emp','ppin')}</div>
    <div className="ee-cols"><h3 className="ee-grid-title">Documents / leave</h3>{eText('Passport valid from','emp','pass_dtf','date')}{eText('Passport valid to','emp','pass_dtt','date')}{eText('D.L. valid to','emp','dl_exp_dt','date')}{pair('Opening EL / CL','oel','ocl')}{eText('Opening SL','emp','osl','number')}</div></div>
    <h3 className="ee-grid-title">Family</h3>{grid('fam',[1,2,3,4,5,6,7,8],[['f#_name','Name'],['f#_rel','Relation'],['f#_dob','Date Of Birth','date'],['f#_add','Address'],['f#_res','Residing','flag'],['f#_esi','ESI','flag'],['f#_pf','PF','flag']])}
    <p className="ee-note">This tab was not opened in the video; its fields are the other details kept in the original employee master.</p></>}
  </fieldset>
  {error&&<ErrorMessage message={error}/>}
  <div className="ee-toolbar"><Button variant="outline" disabled={editing||busy} onClick={startNew}><FilePlus2 size={16}/>New</Button><Button variant="outline" disabled={editing||busy||!selected} onClick={modify}><Pencil size={16}/>Modify</Button><Button disabled={!editing||busy||uploading} onClick={save}><Save size={16}/>{busy?'Saving…':'Save'}</Button><Button variant="outline" disabled={!editing||busy} onClick={cancel}><Ban size={16}/>Cancel</Button><Button variant="outline" disabled={editing||busy||!selected} onClick={()=>setRemoving(true)}><Trash2 size={16}/>Delete</Button><Button variant="ghost" disabled={editing||busy} onClick={back}><X size={16}/>Close</Button><span className="ee-spacer"/><Button variant="outline" disabled={editing} onClick={back}><ArrowLeft size={16}/>Return to Gird</Button></div></>}
  <ConfirmDelete open={removing} name={selected?.name||'employee'} busy={busy} onClose={()=>setRemoving(false)} onConfirm={remove}/>
 </div>;
}
