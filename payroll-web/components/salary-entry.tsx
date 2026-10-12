'use client';
import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Trash2} from 'lucide-react';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {formatMonth} from '@/lib/payroll';
import {MANUAL_SALARY,type SalarySnapshot} from '@/lib/backup';
import {requestJson} from '@/lib/client-api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ConfirmDelete,ErrorMessage} from './payroll-controls';
import {MasterEntry} from './master-entry';
import {SalaryRulesPanel} from './salary-calc';
import {SalaryForm} from './salary-prep';
import './master-entry.css';

const money=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
function post(body:object){return requestJson<{record?:SalarySnapshot;deleted?:number}>('/api/salaries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
function useSalaries(dataset:string,month:string){return useQuery({queryKey:['backup','salaries',dataset,month],queryFn:({signal})=>requestJson<{salaries:SalarySnapshot[]}>('/api/backup?'+new URLSearchParams({view:'salaries',dataset,month}),{signal}),refetchOnWindowFocus:false});}

export function SalaryPreparation({dataset,employees,title,month,setMonth,onDirty,onClose}:{dataset:string;employees:Employee[];title:string;month:string;setMonth:(m:string)=>void;onDirty?:(v:boolean)=>void;onClose?:()=>void}){
 return <><div className="page-heading"><div><p className="eyebrow">TRANSACTION</p><h1>{title}</h1><p>Prepare the month&apos;s salary with the rules recovered from the original software.</p></div></div>
  <Tabs defaultValue="prepare"><TabsList className="inner-tabs"><TabsTrigger value="prepare">Salary Preparation</TabsTrigger><TabsTrigger value="rates">Salary rates</TabsTrigger><TabsTrigger value="settings">Employee salary settings</TabsTrigger><TabsTrigger value="rules">Salary rules</TabsTrigger></TabsList>
  {/* Kept mounted on the other tabs so an unsaved change or a running Generate All is not lost. */}
  <TabsContent value="prepare" forceMount className="data-[state=inactive]:hidden"><SalaryForm dataset={dataset} employees={employees} month={month} setMonth={setMonth} onDirty={onDirty} onClose={onClose}/></TabsContent>
  <TabsContent value="rates"><MasterEntry bare dataset={dataset} employees={employees} title="Salary rates" tables={['tbsal']} note="Rate 1 is the salary rate of each earning head (monthly or per day, by the employee's salary mode). Rate 2 limits the PF wages."/></TabsContent>
  <TabsContent value="settings"><MasterEntry bare dataset={dataset} employees={employees} title="Employee salary settings" tables={['tbempsal']} note="Without an entry here the salary mode and PF / ESI flags saved in the original employee master are used."/></TabsContent>
  <TabsContent value="rules"><SalaryRulesPanel dataset={dataset} employees={employees}/></TabsContent></Tabs></>;
}

export function SalaryDeletion({dataset,employees,title}:{dataset:string;employees:Employee[];title:string}){
 const client=useQueryClient();const [month,setMonth]=useState('2026-08');const [busy,setBusy]=useState(false);const [confirm,setConfirm]=useState(false);const [error,setError]=useState('');
 const query=useSalaries(dataset,month);const names=useMemo(()=>new Map(employees.map(e=>[e.id,e])),[employees]);
 const manual=(query.data?.salaries||[]).filter(s=>s.sourceDataset===MANUAL_SALARY);const imported=(query.data?.salaries.length||0)-manual.length;
 async function removeAll(){setBusy(true);setError('');try{const r=await post({action:'salary-delete-month',dataset,month});await client.invalidateQueries({queryKey:['backup','salaries',dataset,month]});setConfirm(false);toast.success(`${r.deleted||0} salary records deleted`);}catch(e){setError((e as Error).message);setConfirm(false);}finally{setBusy(false);}}
 return <><div className="page-heading"><div><p className="eyebrow">TRANSACTION</p><h1>{title}</h1><p>Delete salary entered in this application for a month so it can be prepared again. Imported salary history is kept.</p></div><label className="month-control">Month<Input type="month" aria-label="Salary deletion month" value={month} onChange={e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))setMonth(e.target.value);}}/></label></div>
  <section className="panel"><div className="panel-toolbar"><div><h2>{formatMonth(month)}</h2><p className="subtle">{manual.length} entered here · {imported} imported (kept)</p></div><Button variant="outline" disabled={!manual.length||busy} onClick={()=>setConfirm(true)}><Trash2 size={16}/>Delete entered salary</Button></div>
   {query.error&&<ErrorMessage message={query.error.message} retry={()=>query.refetch()}/>}{error&&<ErrorMessage message={error}/>}
   {manual.length?<div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Paycode</TableHead><TableHead>Employee</TableHead><TableHead className="salary-number">Payable days</TableHead><TableHead className="salary-number">Net (₹)</TableHead></TableRow></TableHeader><TableBody>{manual.map(s=>{const e=names.get(s.employeeId);return <TableRow key={s.employeeId}><TableCell>{e?.paycode||'—'}</TableCell><TableCell>{e?.name||'Employee'}</TableCell><TableCell className="salary-number">{s.payableDays??'—'}</TableCell><TableCell className="salary-number">{s.net==null?'—':money.format(s.net)}</TableCell></TableRow>;})}</TableBody></Table></div>:<p className="section-help">{query.isPending?'Loading…':'No salary was entered in this application for this month.'}</p>}</section>
  <ConfirmDelete open={confirm} name={`${manual.length} salary records for ${formatMonth(month)}`} busy={busy} onClose={()=>setConfirm(false)} onConfirm={removeAll}/></>;
}
