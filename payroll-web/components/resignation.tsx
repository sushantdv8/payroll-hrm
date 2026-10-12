'use client';
import {useMemo,useState} from 'react';
import {Ban,Pencil,Save,Search,UserX} from 'lucide-react';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {saveRecord} from '@/lib/client-api';
import {realResignDate} from '@/lib/report-utils';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {ErrorMessage,Picker} from './payroll-controls';
import './master-entry.css';

const showDate=(v:string)=>v?v.split('-').reverse().join('/'):'—';

// Transaction > Resignation: records or clears an employee's resignation date on the employee record.
export function Resignation({employees,onChange,title}:{employees:Employee[];onChange:()=>Promise<unknown>;title:string}){
 const [filter,setFilter]=useState('working');const [search,setSearch]=useState('');const [selectedId,setSelectedId]=useState('');const [limit,setLimit]=useState(60);
 const [editing,setEditing]=useState(false);const [resignDate,setResignDate]=useState('');const [remarks,setRemarks]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const list=useMemo(()=>{const q=search.trim().toLowerCase();return employees.filter(e=>(filter==='all'||(filter==='resigned'?!!realResignDate(e):!realResignDate(e)))&&(!q||[e.name,e.paycode,e.cardNo].join(' ').toLowerCase().includes(q)));},[employees,filter,search]);
 const employee=employees.find(e=>e.id===selectedId);
 function choose(id:string){if(editing){toast.error('Save or cancel the current change first.');return;}setSelectedId(id);setError('');}
 function start(){if(!employee)return;setResignDate(realResignDate(employee)||new Date().toISOString().slice(0,10));setRemarks(employee.remarks);setEditing(true);setError('');}
 async function save(clear=false){if(!employee)return;const date=clear?'':resignDate;if(!clear&&!date){setError('Enter the resignation date.');return;}if(date&&employee.doj&&date<employee.doj){setError('Resignation date cannot be before the date of joining.');return;}
  setBusy(true);setError('');try{await saveRecord<Employee>('employee-save',{...employee,resignDate:date,remarks:clear?employee.remarks:remarks});await onChange();setEditing(false);toast.success(clear?'Resignation cleared':'Resignation saved successfully');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <><div className="page-heading"><div><p className="eyebrow">TRANSACTION</p><h1>{title}</h1><p>Record the date an employee left. The employee stays in the register as resigned.</p></div><UserX size={30}/></div>
  <div className="master-layout">
   <section className="panel master-list"><div className="panel-toolbar"><div><h2>Employees</h2><p className="subtle">{list.length} shown</p></div></div>
    <div className="master-list-tools"><Picker label="Employee filter" value={filter} onChange={v=>{setFilter(v);setLimit(60);}} options={[{value:'working',label:'Only Working'},{value:'resigned',label:'Only Resign'},{value:'all',label:'All Employee'}]}/><div className="picker-search"><Search size={16}/><Input aria-label="Find employee" value={search} onChange={e=>{setSearch(e.target.value);setLimit(60);}} placeholder="Name, paycode or card"/></div></div>
    <div className="table-scroll master-grid"><Table><TableHeader><TableRow><TableHead>Paycode</TableHead><TableHead>Employee Name</TableHead><TableHead>D.O.J.</TableHead><TableHead>Resign Dt</TableHead></TableRow></TableHeader><TableBody>{list.slice(0,limit).map(e=><TableRow key={e.id} tabIndex={0} className={'master-row'+(e.id===selectedId?' is-selected':'')} onClick={()=>choose(e.id)} onKeyDown={ev=>{if(ev.key==='Enter')choose(e.id);}}><TableCell>{e.paycode}</TableCell><TableCell>{e.name}</TableCell><TableCell className="nowrap">{showDate(e.doj)}</TableCell><TableCell className="nowrap">{showDate(realResignDate(e))}</TableCell></TableRow>)}</TableBody></Table>
     {list.length>limit&&<div className="section-help"><Button variant="outline" size="sm" onClick={()=>setLimit(l=>l+60)}>Load 60 more ({list.length-limit} left)</Button></div>}</div></section>
   <section className="panel master-detail"><div className="panel-toolbar"><div><h2>{employee?`${employee.name} · ${employee.paycode}`:'Select an employee'}</h2>{employee&&<p className="subtle">{employee.designation||'—'} · {employee.department||'—'} · joined {showDate(employee.doj)}</p>}</div>{editing&&<span className="unsaved-badge">Modifying</span>}</div>
    {employee?<fieldset className="editing-surface" style={{display:'block',padding:'0 18px'}} disabled={busy}><div className="form-grid"><label>Resign Date{editing?<Input type="date" value={resignDate} onChange={e=>setResignDate(e.target.value)}/>:<strong>{showDate(realResignDate(employee))}</strong>}</label><label>Status<strong>{realResignDate(employee)?'Resigned':'Working'}</strong></label><label className="span-2">Remarks If Any{editing?<Textarea maxLength={2000} value={remarks} onChange={e=>setRemarks(e.target.value)}/>:<span>{employee.remarks||'—'}</span>}</label></div></fieldset>
     :<div className="empty-state"><h2>Select an employee</h2><p>Choose a person on the left.</p></div>}
    {error&&<ErrorMessage message={error}/>}
    <div className="master-toolbar">
     <Button variant="outline" disabled={!employee||editing||busy} onClick={start}><Pencil size={16}/>Modify</Button>
     <Button disabled={!editing||busy} onClick={()=>save()}><Save size={16}/>{busy?'Saving…':'Save'}</Button>
     <Button variant="outline" disabled={!editing||busy} onClick={()=>{setEditing(false);setError('');}}><Ban size={16}/>Cancel</Button>
     <Button variant="outline" disabled={!employee||!realResignDate(employee)||editing||busy} onClick={()=>save(true)}><UserX size={16}/>Clear resignation</Button>
    </div></section>
  </div></>;
}
