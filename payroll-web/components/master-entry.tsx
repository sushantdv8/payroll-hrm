'use client';
import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Ban,Download,FilePlus2,Lock,Pencil,Save,Search,Trash2,X} from 'lucide-react';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {masterDef,dateOnly,trimCell,type MasterDef,type MasterField,type MasterRow,type MasterValues} from '@/lib/masters';
import {exportExcel,requestJson} from '@/lib/client-api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Checkbox} from '@/components/ui/checkbox';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ConfirmDelete,ErrorMessage} from './payroll-controls';
import {mayWriteTable,employeeKeyed,isSuper} from '@/lib/access';
import {useIdentity} from './access-context';
import './master-entry.css';

type Mode='view'|'edit'|'new';
type MasterResponse={table:string;columns:string[];rows:MasterRow[]};
const originLabel={original:'Original',edited:'Edited',new:'Added here'} as const;

function useMaster(dataset:string,table:string,enabled=true){return useQuery({queryKey:['masters',dataset,table],queryFn:({signal})=>requestJson<MasterResponse>('/api/masters?'+new URLSearchParams({dataset,table}),{signal}),enabled,refetchOnWindowFocus:false});}
function formValue(field:MasterField,value:string|null|undefined){const v=trimCell(value);return field.type==='date'?dateOnly(v):v;}
function saveMaster(body:object){return requestJson<{row?:MasterRow}>('/api/masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}

// Referenced masters (at most three per table) are loaded so codes can be shown and chosen by name.
function useLookups(dataset:string,def:MasterDef){
 const [first,second,third]=Array.from(new Set(def.fields.filter(f=>f.type==='lookup'&&f.lookup).map(f=>f.lookup!)));
 const a=useMaster(dataset,first||'tbdep',!!first);const b=useMaster(dataset,second||'tbdep',!!second);const c=useMaster(dataset,third||'tbdep',!!third);
 return useMemo(()=>{const map=new Map<string,{value:string;label:string}[]>();for(const [table,data] of [[first,a.data],[second,b.data],[third,c.data]] as const){if(!table)continue;const ref=masterDef(table)!;map.set(table,(data?.rows||[]).map(r=>{const code=trimCell(r.values[ref.key[0]]);return {value:code,label:`${code} · ${ref.nameCol?trimCell(r.values[ref.nameCol]):''}`};}));}return map;},[first,second,third,a.data,b.data,c.data]);
}

function FieldInput({field,value,disabled,onChange,options,employees}:{field:MasterField;value:string;disabled:boolean;onChange:(v:string)=>void;options?:{value:string;label:string}[];employees:Employee[]}){
 const id='mf-'+field.col;
 if(field.type==='flag'&&(value===''||value==='0'||value==='1'))return <label htmlFor={id} className="check-label master-flag"><Checkbox id={id} disabled={disabled} checked={value==='1'} onCheckedChange={v=>onChange(v===true?'1':'0')}/>{field.label}</label>;
 let control;
 if(field.type==='textarea')control=<Textarea id={id} disabled={disabled} maxLength={field.max} value={value} onChange={e=>onChange(e.target.value)}/>;
 else if(field.type==='select'||field.type==='lookup'||field.type==='employee'){
  const list=field.type==='employee'?employees.map(e=>({value:String(e.sourceKey||e.id),label:`${e.paycode} · ${e.name}`})):options||[];
  const withCurrent=value&&!list.some(o=>o.value===value)?[{value,label:`${value} (not in list)`},...list]:list;
  control=<NativeSelect id={id} className="master-select" disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}><NativeSelectOption value="">—</NativeSelectOption>{withCurrent.map(o=><NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>)}</NativeSelect>;
 }
 else control=<Input id={id} disabled={disabled} value={value} maxLength={field.max} type={field.type==='int'||field.type==='number'||field.type==='flag'?'number':field.type==='time'?'time':field.type==='date'?'date':'text'} step={field.type==='number'?'any':field.type==='int'||field.type==='flag'?1:undefined} onChange={e=>onChange(e.target.value)}/>;
 return <label htmlFor={id} className={field.type==='textarea'?'span-2':''}>{field.label}{field.required&&' *'}{control}{field.hint&&<small className="subtle">{field.hint}</small>}</label>;
}

function MasterTable({dataset,table,employees,onClose}:{dataset:string;table:string;employees:Employee[];onClose?:()=>void}){
 const def=masterDef(table)!;const client=useQueryClient();const query=useMaster(dataset,table);const lookups=useLookups(dataset,def);
 // New / Modify / Delete are rights of the screen this table belongs to (the server checks them again).
 const me=useIdentity();const mayAdd=!me||mayWriteTable(me,table,'add'),mayEdit=!me||mayWriteTable(me,table,'edit'),mayDelete=!me||mayWriteTable(me,table,'delete');const limitedSetup=!!me&&!isSuper(me)&&!employeeKeyed(table)&&!me.permissions.units.includes('*');const setupNote='This is a set-up of the whole company: only a login that has All locations can change it.';const noRight=(ok:boolean,what:string)=>ok?undefined:limitedSetup?setupNote:`You do not have ${what} permission here.`;
 const [selectedKey,setSelectedKey]=useState<string|null>(null);const [mode,setMode]=useState<Mode>('view');const [draft,setDraft]=useState<Record<string,string>>({});
 // The original lists records by name until Code or Name is chosen under Sort On.
 const [sort,setSort]=useState<'none'|'code'|'name'>(def.classic?'none':'code');const [search,setSearch]=useState('');const [limit,setLimit]=useState(300);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [removing,setRemoving]=useState(false);
 const employeeNames=useMemo(()=>new Map(employees.map(e=>[String(e.sourceKey||e.id),`${e.paycode} ${e.name}`])),[employees]);
 const display=(col:string,value:string|null)=>{const field=def.fields.find(f=>f.col===col);const v=trimCell(value);if(!field||!v)return v||'—';if(field.type==='date')return dateOnly(v).split('-').reverse().join('/')||'—';if(field.type==='employee')return employeeNames.get(v)||v;if(field.type==='select')return field.options?.find(o=>o.value===v)?.label||v;if(field.type==='lookup'){const o=lookups.get(field.lookup!)?.find(x=>x.value===v);return o?o.label.split(' · ').slice(1).join(' · ')||v:v;}if(field.type==='flag')return v==='1'?'Yes':v==='0'?'No':v;return v;};
 const rows=useMemo(()=>{const q=search.trim().toLowerCase();const list=(query.data?.rows||[]).filter(r=>!q||def.list.some(c=>display(c,r.values[c]).toLowerCase().includes(q)));
  const num=(r:MasterRow)=>def.key.map(c=>trimCell(r.values[c]).padStart(12,'0')).join('|');
  const byName=(a:MasterRow,b:MasterRow)=>{const x=trimCell(a.values[def.nameCol!]).toUpperCase(),y=trimCell(b.values[def.nameCol!]).toUpperCase();return x<y?-1:x>y?1:num(a).localeCompare(num(b));};
  return list.sort((a,b)=>sort!=='code'&&def.nameCol?(sort==='none'?byName(a,b):trimCell(a.values[def.nameCol]).localeCompare(trimCell(b.values[def.nameCol]))):num(a).localeCompare(num(b)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[query.data,search,sort,def,lookups,employeeNames]);
 const editing=mode!=='view';
 // A classic window opens on its first record, as the original does.
 const selected=(query.data?.rows||[]).find(r=>r.key===selectedKey)||(def.classic&&!editing&&selectedKey===null?rows[0]||null:null);
 function fill(values:MasterValues){setDraft(Object.fromEntries(def.fields.map(f=>[f.col,f.virtual?'':formValue(f,values[f.col])])));}
 function choose(row:MasterRow){if(editing){toast.error('Save or cancel the current entry first.');return;}setSelectedKey(row.key);fill(row.values);setError('');}
 function startNew(){setMode('new');setSelectedKey(null);fill(Object.fromEntries(def.fields.map(f=>[f.col,def.defaults?.[f.col]??''])));setError('');}
 function startEdit(){if(!selected)return;fill(selected.values);setMode('edit');setError('');}
 function cancel(){setMode('view');setError('');if(selected)fill(selected.values);else setDraft({});}
 async function refresh(){await client.invalidateQueries({queryKey:['masters',dataset,table]});await client.invalidateQueries({queryKey:['master-names',dataset]});}
 async function save(){
  // Confirmation boxes (never stored) must repeat the password they confirm when it is new or changed.
  for(const f of def.fields.filter(x=>x.virtual&&x.confirms)){const target=def.fields.find(x=>x.col===f.confirms)!;const changed=mode==='new'||trimCell(selected?.values[target.col])!==(draft[target.col]??'');if(changed&&(draft[target.col]??'')!==(draft[f.col]??'')){setError(`${f.label} does not match ${target.label}.`);return;}}
  setBusy(true);setError('');try{const values=Object.fromEntries(def.fields.filter(f=>!f.virtual&&!(mode==='new'&&f.col===def.auto&&!draft[f.col])).map(f=>[f.col,draft[f.col]??'']));const result=await saveMaster({action:'master-save',table,dataset,key:mode==='edit'?selected?.key:null,revision:mode==='edit'?selected?.revision:0,values});await refresh();if(result.row){setSelectedKey(result.row.key);fill(result.row.values);}setMode('view');toast.success(`${def.title} saved successfully`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function remove(){if(!selected)return;setBusy(true);try{await saveMaster({action:'master-delete',table,dataset,key:selected.key,revision:selected.revision});await refresh();setSelectedKey(null);setDraft({});setRemoving(false);toast.success(`${def.title} deleted`);}catch(e){setError((e as Error).message);setRemoving(false);}finally{setBusy(false);}}
 async function download(){await exportExcel(`${dataset}_${table}.xlsx`,[{name:def.title,rows:[def.fields.map(f=>f.label),...rows.map(r=>def.fields.map(f=>display(f.col,r.values[f.col])))]}]);toast.success('Excel file created');}
 if(query.isPending)return <section className="panel loading-state" role="status">Loading {def.title.toLowerCase()}…</section>;
 if(query.error)return <ErrorMessage message={query.error.message} retry={()=>query.refetch()}/>;
 if(def.classic){
  // In view mode the form shows the chosen (or first) record; New / Modify edit a copy until Save or Cancel.
  const shownValue=(f:MasterField)=>editing?(f.col===def.auto&&mode==='new'&&!draft[f.col]?'':draft[f.col]??''):f.virtual||!selected?'':formValue(f,selected.values[f.col]);
  const classicOptions=(f:MasterField)=>f.type==='lookup'?(lookups.get(f.lookup!)||[]).map(o=>{const [code,...name]=o.label.split(' · ');return {value:o.value,label:`${name.join(' · ')||code} [${code}]`};}):f.options;
  const rowsOfForm:MasterField[][]=[];for(const f of def.fields){if(f.inline&&rowsOfForm.length)rowsOfForm[rowsOfForm.length-1].push(f);else rowsOfForm.push([f]);}
  const control=(f:MasterField)=>{const isKey=def.key.includes(f.col);const locked=!editing||(mode==='edit'&&isKey)||f.col===def.auto;const value=shownValue(f);const set=(v:string)=>setDraft(d=>({...d,[f.col]:v}));const id=`cm-${table}-${f.col}`;
   if(f.type==='flag')return <label key={f.col} className="cm-flag" htmlFor={id}><input id={id} type="checkbox" disabled={locked} checked={value==='1'} onChange={e=>set(e.target.checked?'1':'0')}/>{f.label}</label>;
   if(f.type==='select'||f.type==='lookup'){const list=classicOptions(f)||[];const all=value&&!list.some(o=>o.value===value)?[{value,label:value},...list]:list;return <select key={f.col} id={id} className="cm-input cm-select" disabled={locked} value={value} onChange={e=>set(e.target.value)}><option value=""/>{all.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>;}
   return <input key={f.col} id={id} className={'cm-input'+(f.type==='date'?' cm-date':f.col===def.key[0]?' cm-code':'')} disabled={locked} type={f.type==='password'?'password':f.type==='date'?'date':f.type==='int'||f.type==='number'?'number':'text'} maxLength={f.max} value={value} placeholder={f.col===def.auto&&mode==='new'?'Auto':undefined} onChange={e=>set(e.target.value)}/>;};
  return <div className="cm-window" role="dialog" aria-label={def.classic.title}>
   <div className="cm-titlebar"><span>{def.classic.title}</span>{onClose&&<button type="button" className="cm-x" aria-label="Close" disabled={editing||busy} onClick={onClose}>✕</button>}</div>
   <div className="cm-body">
    <div className="cm-left">
     <div className="cm-grid"><table><thead><tr><th>Code</th><th>{def.classic.nameHeader}</th></tr></thead>
      <tbody>{rows.slice(0,limit).map(r=><tr key={r.key} className={r.key===selected?.key?'is-selected':''} onClick={()=>choose(r)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')choose(r);}}><td>{trimCell(r.values[def.key[0]])}</td><td>{def.nameCol?trimCell(r.values[def.nameCol]):''}</td></tr>)}</tbody></table>
       {rows.length>limit&&<button type="button" className="cm-more" onClick={()=>setLimit(l=>l+500)}>Show more ({rows.length-limit})</button>}</div>
     {def.nameCol&&<fieldset className="cm-sort"><legend>Sort On</legend><label><input type="radio" name={'cm-sort-'+table} checked={sort==='code'} onChange={()=>setSort('code')}/>Code</label><label><input type="radio" name={'cm-sort-'+table} checked={sort==='name'} onChange={()=>setSort('name')}/>Name</label></fieldset>}
    </div>
    <div className="cm-right">
     <fieldset className="cm-form" disabled={busy}>{rowsOfForm.map(group=><div key={group[0].col} className="cm-row"><label htmlFor={`cm-${table}-${group[0].col}`}>{group[0].type==='flag'?'':group[0].label}</label><div className="cm-cell">{group.map(control)}</div></div>)}</fieldset>
     {error&&<p className="cm-error" role="alert">{error}</p>}
     {limitedSetup&&<p className="section-help">{setupNote}</p>}
     <div className="cm-buttons">
      <button type="button" disabled={editing||busy||!mayAdd||(def.singleton&&!!query.data?.rows.length)} title={noRight(mayAdd,'Add')} onClick={startNew}><FilePlus2 size={18} className="ic-new"/>New</button>
      <button type="button" disabled={editing||busy||!mayEdit||!selected} title={noRight(mayEdit,'Edit')} onClick={startEdit}><Pencil size={18} className="ic-mod"/>Modify</button>
      <button type="button" disabled={!editing||busy} onClick={save}><Save size={18} className="ic-save"/>{busy?'Saving…':'Save'}</button>
      <button type="button" disabled={!editing||busy} onClick={cancel}><Ban size={18} className="ic-cancel"/>Cancel</button>
      <button type="button" disabled={editing||busy||!mayDelete||!selected} title={noRight(mayDelete,'Delete')} onClick={()=>setRemoving(true)}><X size={18} className="ic-del"/>Delete</button>
      <button type="button" disabled={editing||busy||!onClose} onClick={onClose}><Lock size={18} className="ic-close"/>Close</button>
     </div>
    </div>
   </div>
   <ConfirmDelete open={removing} name={selected?display(def.nameCol||def.key[0],selected.values[def.nameCol||def.key[0]]):def.title} busy={busy} onClose={()=>setRemoving(false)} onConfirm={remove}/>
  </div>;
 }
 const sections=Array.from(new Set(def.fields.map(f=>f.section||'')));
 const showForm=editing||selected;
 return <div className="master-layout">
  <section className="panel master-list">
   <div className="panel-toolbar"><div><h2>{def.title}</h2><p className="subtle">{rows.length} of {query.data?.rows.length||0} records</p></div><Button variant="outline" size="sm" disabled={!rows.length} onClick={download}><Download size={15}/>Excel</Button></div>
   <div className="master-list-tools">{def.nameCol&&<fieldset className="master-sort"><legend>Sort On</legend><label><input type="radio" name={'sort-'+table} checked={sort==='code'} onChange={()=>setSort('code')}/> Code</label><label><input type="radio" name={'sort-'+table} checked={sort==='name'} onChange={()=>setSort('name')}/> Name</label></fieldset>}<div className="picker-search"><Search size={16}/><Input aria-label={'Search '+def.title} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search"/></div></div>
   <div className="table-scroll master-grid"><Table><TableHeader><TableRow>{def.list.map(c=><TableHead key={c}>{def.fields.find(f=>f.col===c)?.label||c}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{rows.slice(0,limit).map(r=><TableRow key={r.key} className={(r.key===selectedKey?'is-selected ':'')+'master-row'} onClick={()=>choose(r)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')choose(r);}}>{def.list.map(c=><TableCell key={c} className="nowrap">{display(c,r.values[c])}</TableCell>)}</TableRow>)}</TableBody></Table>
    {!rows.length&&<p className="section-help">{search?'No records match your search.':'No records yet. Use New to add the first one.'}</p>}
    {rows.length>limit&&<div className="section-help"><Button variant="outline" size="sm" onClick={()=>setLimit(l=>l+500)}>Show more ({rows.length-limit} more)</Button></div>}</div>
  </section>
  <section className="panel master-detail">
   <div className="panel-toolbar"><div><h2>{mode==='new'?'New '+def.title.toLowerCase():selected?display(def.nameCol||def.key[0],selected.values[def.nameCol||def.key[0]]):def.title}</h2>{selected&&mode!=='new'&&<span className={'master-origin origin-'+selected.origin}>{originLabel[selected.origin]}</span>}</div>{editing&&<span className="unsaved-badge">{mode==='new'?'New entry':'Modifying'}</span>}</div>
   {showForm?<fieldset className="editing-surface" disabled={busy}>{sections.map(section=><div key={section||'main'}>{section&&<h3 className="master-section">{section}</h3>}<div className="form-grid">{def.fields.filter(f=>(f.section||'')===section).map(f=>{const isKey=def.key.includes(f.col);const locked=!editing||(mode==='edit'&&isKey)||(f.col===def.auto&&mode==='new');const value=f.col===def.auto&&mode==='new'&&!draft[f.col]?'':draft[f.col]??'';
     return f.col===def.auto&&mode==='new'?<label key={f.col}>{f.label}<Input disabled value="" placeholder="Auto number"/></label>:<FieldInput key={f.col} field={f} value={value} disabled={locked} onChange={v=>setDraft(d=>({...d,[f.col]:v}))} options={f.type==='lookup'?lookups.get(f.lookup!):f.options} employees={employees}/>;})}</div></div>)}</fieldset>
    :<div className="empty-state"><h2>Select a record</h2><p>Choose a row on the left, or use New to add one.</p></div>}
   {error&&<ErrorMessage message={error}/>}
   {limitedSetup&&<p className="section-help">{setupNote}</p>}
   <div className="master-toolbar">
    <Button variant="outline" disabled={editing||busy||!mayAdd||(def.singleton&&!!query.data?.rows.length)} title={noRight(mayAdd,'Add')} onClick={startNew}><FilePlus2 size={16}/>New</Button>
    <Button variant="outline" disabled={editing||busy||!mayEdit||!selected} title={noRight(mayEdit,'Edit')} onClick={startEdit}><Pencil size={16}/>Modify</Button>
    <Button disabled={!editing||busy} onClick={save}><Save size={16}/>{busy?'Saving…':'Save'}</Button>
    <Button variant="outline" disabled={!editing||busy} onClick={cancel}><Ban size={16}/>Cancel</Button>
    <Button variant="outline" disabled={editing||busy||!mayDelete||!selected} title={noRight(mayDelete,'Delete')} onClick={()=>setRemoving(true)}><Trash2 size={16}/>Delete</Button>
    <Button variant="ghost" disabled={editing||busy} onClick={()=>{setSelectedKey(null);setDraft({});}}><X size={16}/>Close</Button>
   </div>
  </section>
  <ConfirmDelete open={removing} name={selected?display(def.nameCol||def.key[0],selected.values[def.nameCol||def.key[0]]):def.title} busy={busy} onClose={()=>setRemoving(false)} onConfirm={remove}/>
 </div>;
}

export function MasterEntry({dataset,tables,title,employees,note,eyebrow='MASTER ENTRY',bare=false,onClose}:{dataset:string;tables:string[];title:string;employees:Employee[];note?:string;eyebrow?:string;bare?:boolean;onClose?:()=>void}){
 const defs=tables.map(masterDef).filter((d):d is MasterDef=>!!d);
 // A master with the original's own window is shown as that window alone.
 if(!bare&&defs.length===1&&defs[0].classic)return <div className="cm-page">{note&&<div className="inline-note">{note}</div>}<MasterTable key={dataset+defs[0].table} dataset={dataset} table={defs[0].table} employees={employees} onClose={onClose}/></div>;
 if(bare)return <>{note&&<div className="inline-note">{note}</div>}{defs.map(d=><div key={d.table} className="space-top"><MasterTable key={dataset+d.table} dataset={dataset} table={d.table} employees={employees}/></div>)}</>;
 return <><div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{defs.some(d=>d.global)?'Shared by every company in this workspace.':'Original records from the selected company plus entries added here. Imported originals are kept unchanged in the archive.'}</p></div></div>
  {note&&<div className="inline-note">{note}</div>}
  {defs.length===1?<MasterTable key={dataset+defs[0].table} dataset={dataset} table={defs[0].table} employees={employees}/>:<Tabs defaultValue={defs[0]?.table}><TabsList className="inner-tabs">{defs.map(d=><TabsTrigger key={d.table} value={d.table}>{d.title}</TabsTrigger>)}</TabsList>{defs.map(d=><TabsContent key={d.table} value={d.table}><MasterTable key={dataset+d.table} dataset={dataset} table={d.table} employees={employees}/></TabsContent>)}</Tabs>}</>;
}
