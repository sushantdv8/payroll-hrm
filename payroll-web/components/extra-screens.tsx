'use client';
import {useMemo,useState} from 'react';
import {Building2,CheckCircle2,Clock,Download} from 'lucide-react';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import type {DatasetSummary} from '@/lib/full-import';
import type {SourceRef} from '@/lib/menu';
import {exportExcel} from '@/lib/client-api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Picker} from './payroll-controls';
import {SourceTables} from './source-table';

const numberFormat=new Intl.NumberFormat('en-IN');
const showDate=(value:string)=>value?value.split('-').reverse().join('/'):'—';

export function JoinResignReport({employees,title}:{employees:Employee[];title:string}){
 const [kind,setKind]=useState('both');const [from,setFrom]=useState('2026-04-01');const [to,setTo]=useState('2027-03-31');
 const rows=useMemo(()=>employees.flatMap(e=>{const out:{e:Employee;event:'Joined'|'Resigned';date:string}[]=[];if(kind!=='resign'&&e.doj&&e.doj>=from&&e.doj<=to)out.push({e,event:'Joined',date:e.doj});if(kind!=='join'&&e.resignDate&&e.resignDate>=from&&e.resignDate<=to)out.push({e,event:'Resigned',date:e.resignDate});return out;}).sort((a,b)=>a.date.localeCompare(b.date)||a.e.paycode.localeCompare(b.e.paycode)),[employees,kind,from,to]);
 const joined=rows.filter(r=>r.event==='Joined').length;
 async function download(){await exportExcel('join_resign.xlsx',[{name:'Join and Resign',rows:[['Event','Date','Paycode','Card no.','Name','Father / Husband','Department','Designation','Location'],...rows.map(r=>[r.event,showDate(r.date),r.e.paycode,r.e.cardNo,r.e.name,r.e.fatherName,r.e.department,r.e.designation,r.e.location])]}]);toast.success('Excel file created');}
 return <><div className="page-heading"><div><p className="eyebrow">REPORT</p><h1>{title}</h1><p>Employees who joined or resigned in the selected period.</p></div><Button variant="outline" disabled={!rows.length} onClick={download}><Download size={16}/>Excel export</Button></div>
  <section className="panel"><div className="leave-toolbar"><label>Show<Picker label="Join or resign" value={kind} onChange={setKind} options={[{value:'both',label:'Join and resign'},{value:'join',label:'Joined only'},{value:'resign',label:'Resigned only'}]}/></label><label>From<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
  <div className="inline-note">{joined} joined · {rows.length-joined} resigned</div>
  {rows.length?<div className="table-scroll"><Table><TableHeader><TableRow>{['Event','Date','Paycode','Name','Father / Husband','Department','Designation','Location'].map(h=><TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((r,i)=><TableRow key={i}><TableCell><strong>{r.event}</strong></TableCell><TableCell className="nowrap">{showDate(r.date)}</TableCell><TableCell>{r.e.paycode}</TableCell><TableCell>{r.e.name}</TableCell><TableCell>{r.e.fatherName||'—'}</TableCell><TableCell>{r.e.department||'—'}</TableCell><TableCell>{r.e.designation||'—'}</TableCell><TableCell>{r.e.location||'—'}</TableCell></TableRow>)}</TableBody></Table></div>:<p className="section-help">No employees joined or resigned in this period.</p>}</section></>;
}

export function DatasetScreen({datasets,current,onChoose,title}:{datasets:DatasetSummary[];current:string;onChoose:(key:string)=>void;title:string}){
 return <><div className="page-heading"><div><p className="eyebrow">COMPANY</p><h1>{title}</h1><p>Every company and year loaded into this workspace. Records of different companies are kept separate.</p></div><Building2 size={32}/></div>
  <div className="dataset-grid">{datasets.map(d=><section key={d.key} className={'panel dataset-card'+(d.key===current?' is-current':'')}><div className="panel-toolbar"><div><h2>{d.companyName}</h2><p className="subtle">{d.key}{d.year?' · '+d.year:''}</p></div>{d.key===current&&<span className="subtle"><CheckCircle2 size={16} className="inline"/> Selected</span>}</div>
   {d.counts?<div className="totals-grid">{([['employees','Employees'],['attendance','Attendance months'],['salaries','Salary months'],['rawParts','Original data parts']] as const).map(([k,label])=><div key={k}><strong>{numberFormat.format(d.counts![k])}</strong><p>{label}</p></div>)}</div>:<p className="section-help">{d.status==='manual'?'Records entered directly in this application.':'Sample records.'}</p>}
   <div className="section-help"><Button disabled={d.key===current} onClick={()=>onChoose(d.key)}>{d.key===current?'Currently selected':'Work in this company'}</Button></div></section>)}</div></>;
}

export function PendingScreen({title,note,dataset,tables}:{title:string;note:string;dataset:string;tables?:SourceRef[]}){
 if(tables?.length)return <SourceTables dataset={dataset} tables={tables} title={title} note={note}/>;
 return <><div className="page-heading"><div><p className="eyebrow">AWAITING CONFIRMATION</p><h1>{title}</h1></div><Clock size={32}/></div><section className="panel empty-state"><div className="empty-icon"><Clock size={28}/></div><h2>{title}</h2><p>{note}</p></section></>;
}
