'use client';
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Upload,Database,CheckCircle2} from 'lucide-react';
import {toast} from 'sonner';
import {backupBundleSchema,BackupBundle,BackupSettings} from '@/lib/backup';
import {requestJson} from '@/lib/client-api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ErrorMessage} from './payroll-controls';

export function BackupImport({settings,onChange}:{settings?:BackupSettings;onChange:()=>Promise<unknown>}){
 const [preview,setPreview]=useState<BackupBundle|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const client=useQueryClient();
 async function choose(file?:File){setError('');setPreview(null);if(!file)return;try{if(file.size>2_000_000)throw new Error('This sample file is too large.');setPreview(backupBundleSchema.parse(JSON.parse(await file.text())));}catch{setError('Choose a valid prepared payroll sample JSON file (up to 2 MB).');}}
 async function load(){if(!preview)return;setBusy(true);setError('');try{await requestJson('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(preview)});setPreview(null);await onChange();await client.invalidateQueries({queryKey:['backup']});await client.invalidateQueries({queryKey:['salary-history']});toast.success('Backup sample loaded successfully');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <><div className="page-heading"><div><p className="eyebrow">SOURCE RECORDS</p><h1>Backup sample</h1><p>Use saved employee and monthly records from your original software.</p></div><Database size={32}/></div>
 {settings?<section className="panel"><div className="panel-toolbar"><div><h2><CheckCircle2 size={19} className="inline"/> {settings.companyName}</h2><p className="subtle">{settings.sourceDataset} · Sample loaded{settings.importedAt?' on '+new Date(settings.importedAt).toLocaleDateString('en-IN'):''}</p></div></div><div className="section-help">Employee suggestions and saved monthly history are available in the other tabs. Imported attendance and salary amounts retain the saved values.</div><div className="totals-grid">{Object.entries(settings.masters).map(([name,items])=><div key={name}><strong>{items.length}</strong><p>{name==='subCompanies'?'Sub companies':name.charAt(0).toUpperCase()+name.slice(1)}</p></div>)}</div></section>:<section className="panel"><div className="panel-toolbar"><div><h2>Load prepared sample data</h2><p className="subtle">Select the sample file prepared from the database backup.</p></div></div><div className="section-help"><label>Sample data file<Input type="file" accept=".json,application/json" disabled={busy} aria-label="Backup sample file" onChange={e=>void choose(e.target.files?.[0])}/></label></div>{preview&&<div className="section-help"><h2>{preview.settings.companyName}</h2><p>{preview.settings.sourceDataset}</p><p>{preview.employees.length} employees · {preview.attendance.length} attendance months · {preview.salaries.length} salary months · {preview.holidays.length} holidays</p><p>Existing records are kept. A matching paycode stops the import for review.</p><Button className="space-top" disabled={busy} onClick={load}><Upload size={16}/>{busy?'Loading sample…':'Load sample data'}</Button></div>}</section>}
 {error&&<ErrorMessage message={error}/>}<p className="section-help">Saved salary history is available for review and Excel export. New salary calculations and machine punch processing need confirmed rules.</p></>;
}
