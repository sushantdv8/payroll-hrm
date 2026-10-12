'use client';

import {useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Download,FileSpreadsheet,LockKeyhole,Search} from 'lucide-react';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {formatMonth} from '@/lib/payroll';
import type {SalarySnapshot} from '@/lib/backup';
import {exportExcel,requestJson} from '@/lib/client-api';
import {employeePayMode,type Extra} from '@/lib/report-utils';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {ErrorMessage,Picker} from './payroll-controls';
import './salary-history.css';

const pageSize=20;
const numberFormat=new Intl.NumberFormat('en-IN',{maximumFractionDigits:20});

function storedNumber(value:number|null,currency=false){
  return value===null?'Not recorded':`${currency?'₹':''}${numberFormat.format(value)}`;
}

function Components({title,items}:{title:string;items:SalarySnapshot['earnings']}){
  return <section className="panel">
    <h3 className="salary-component-heading">{title}</h3>
    {items.length?<Table>
      <TableHeader><TableRow><TableHead>Saved component</TableHead><TableHead className="salary-number">Amount (₹)</TableHead></TableRow></TableHeader>
      <TableBody>{items.map((item,index)=><TableRow key={`${index}:${item.label}`}>
        <TableCell>{item.label||'Unnamed component'}</TableCell>
        <TableCell className="salary-number">{storedNumber(item.amount)}</TableCell>
      </TableRow>)}</TableBody>
    </Table>:<p className="inline-empty">No {title.toLowerCase()} components were saved for this record.</p>}
  </section>;
}

export function SalaryHistory({employees,companyName,dataset='manual',title='Salary history'}:{employees:Employee[];companyName:string;dataset?:string;title?:string}){
  const [month,setMonth]=useState('2026-08');
  const [employeeId,setEmployeeId]=useState('all');
  const [search,setSearch]=useState('');
  const [paymode,setPaymode]=useState('all');
  const [selectedKey,setSelectedKey]=useState<string|null>(null);
  const [page,setPage]=useState(0);
  const [exporting,setExporting]=useState(false);
  const [exportError,setExportError]=useState('');
  const query=useQuery({
    queryKey:['backup','salaries',dataset,month],
    queryFn:({signal})=>requestJson<{salaries:SalarySnapshot[]}>('/api/backup?'+new URLSearchParams({view:'salaries',dataset,month}),{signal}),
    refetchOnWindowFocus:false,
  });
  const employeeMap=useMemo(()=>new Map(employees.map(employee=>[employee.id,employee])),[employees]);
  const rows=useMemo(()=>{
    const savedEmployeeIds=Array.from(new Set((query.data?.salaries||[]).map(record=>record.employeeId))).sort();
    const missingNames=new Map(savedEmployeeIds.filter(id=>!employeeMap.has(id)).map((id,index)=>[id,`Saved employee ${index+1}`]));
    return (query.data?.salaries||[]).map((record,index)=>{
      const employee=employeeMap.get(record.employeeId);
      return {
        record,
        key:JSON.stringify([record.sourceDataset,record.employeeId,record.month,index]),
        name:employee?.name||missingNames.get(record.employeeId)||'Saved employee',
        paycode:employee?.paycode||'',
        cardNo:employee?.cardNo||'',
        employee,
        inRegister:!!employee,
      };
    });
  },[query.data,employeeMap]);
  const employeeOptions=useMemo(()=>{
    const options=new Map<string,{value:string;label:string}>();
    for(const row of rows){
      options.set(row.record.employeeId,{value:row.record.employeeId,label:row.paycode?`${row.name} · ${row.paycode}`:row.name});
    }
    if(employeeId!=='all'&&!options.has(employeeId)){
      const employee=employeeMap.get(employeeId);
      options.set(employeeId,{value:employeeId,label:employee?`${employee.name} · ${employee.paycode}`:'Selected saved employee'});
    }
    return [{value:'all',label:'All employees with saved history'},...Array.from(options.values()).sort((a,b)=>a.label.localeCompare(b.label))];
  },[rows,employeeId,employeeMap]);
  const filtered=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase();
    return rows.filter(row=>row.record.month===month&&(employeeId==='all'||row.record.employeeId===employeeId)&&(paymode==='all'||row.employee?.paymentMode===paymode)&&
      [row.name,row.paycode,row.cardNo].join(' ').toLocaleLowerCase().includes(term))
      .sort((a,b)=>a.paycode.localeCompare(b.paycode,undefined,{numeric:true})||a.name.localeCompare(b.name)||a.record.sourceDataset.localeCompare(b.record.sourceDataset));
  },[rows,month,employeeId,search,paymode]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
  const currentPage=Math.min(page,pageCount-1);
  const pageRows=filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const selected=pageRows.find(row=>row.key===selectedKey)||pageRows[0]||null;
  const sources=Array.from(new Set(rows.map(row=>row.record.sourceDataset))).filter(Boolean);

  function resetSelection(){setPage(0);setSelectedKey(null);setExportError('');}
  function clearFilters(){setEmployeeId('all');setSearch('');resetSelection();}

  async function exportRows(){
    if(!filtered.length||exporting)return;
    setExporting(true);setExportError('');
    const summary:(string|number)[][]=[['Company','Source backup','Month','Paycode','Employee','Payable days (recorded)','Gross (recorded)','Total deductions (recorded)','Net (recorded)']];
    const components:(string|number)[][]=[['Company','Source backup','Month','Paycode','Employee','Type','Saved component','Amount (recorded)']];
    for(const row of filtered){
      const record=row.record;
      summary.push([companyName,record.sourceDataset,record.month,row.paycode,row.name,record.payableDays??'',record.gross??'',record.totalDeductions??'',record.net??'']);
      for(const [type,items] of [['Earning',record.earnings],['Deduction',record.deductions]] as const){
        for(const item of items){components.push([companyName,record.sourceDataset,record.month,row.paycode,row.name,type,item.label,item.amount??'']);}
      }
    }
    try{
      await exportExcel(`Saved_Salary_History_${month}.xlsx`,[
        {name:'Monthly summary',rows:summary},
        {name:'Saved components',rows:components},
        {name:'About this export',rows:[
          ['Item','Description'],
          ['Company',companyName],
          ['Month',month],
          ['Records exported',filtered.length],
          ['Content','Saved monthly salary history from the imported backup.'],
          ['Amounts','Numeric values are exported as recorded. No amounts are recalculated.'],
          ['Blank cells','The value was not recorded. Zero is a recorded value.'],
          ['Selection','Includes all records matching the month, employee and search filters, across all table pages.'],
        ]},
      ]);
      toast.success('Saved salary history exported to Excel');
    }catch(error){setExportError(error instanceof Error?error.message:'The export could not be prepared. Please try again.');}
    finally{setExporting(false);}
  }

  // Same sheet as Reports > Salary Sheet/Overtime > Salary Export: the original's column order (PF No. and ESI No. included), rows in paycode order.
  async function salaryExport(){
    if(!filtered.length||exporting)return;
    setExporting(true);setExportError('');
    try{
      const {extras}=await requestJson<{extras:Record<string,Extra>}>('/api/employee-extras?'+new URLSearchParams({dataset}));
      const rows=[...filtered].sort((a,b)=>a.paycode<b.paycode?-1:a.paycode>b.paycode?1:0);
      const earnLabels:string[]=[];const dedLabels:string[]=[];
      for(const {record} of rows){for(const e of record.earnings)if(!earnLabels.includes(e.label))earnLabels.push(e.label);for(const d of record.deductions)if(!dedLabels.includes(d.label))dedLabels.push(d.label);}
      const amount=(items:SalarySnapshot['earnings'],label:string)=>items.find(i=>i.label===label)?.amount??'';
      const header=['Sno','Paycode','Card No.','EMP.NAME','Father.Name','Department','Designation','Location','D.O.J.','PF No.','ESI No.','Bank Ac No','Paymode','Pday',...earnLabels,'Earn Total',...dedLabels,'Ded Total','Net Salary'];
      const body=rows.map((row,index)=>{const e=row.employee;const r=row.record;const x=e?extras[String(e.sourceKey||e.id)]:undefined;return [index+1,row.paycode,row.cardNo,row.name,e?.fatherName||'',e?.department||'',e?.designation||'',e?.location||'',e?.doj?e.doj.split('-').reverse().join('/'):'',x?.pfNo||'',x?.esiNo||'',e?.accountNo||'',e?employeePayMode(e,x):'',r.payableDays??'',...earnLabels.map(l=>amount(r.earnings,l)),r.gross??'',...dedLabels.map(l=>amount(r.deductions,l)),r.totalDeductions??'',r.net??''];});
      await exportExcel(`Salary_Export_${month}.xlsx`,[{name:'Sheet1',rows:[header,...body]}]);toast.success('Export Successfully');}
    catch(error){setExportError(error instanceof Error?error.message:'The export could not be prepared. Please try again.');}
    finally{setExporting(false);}
  }

  return <div className="salary-history">
    <div className="page-heading">
      <div><p className="eyebrow">SAVED RECORDS</p><h1>{title}</h1><p>Review saved monthly salary results{companyName?` for ${companyName}`:''}.</p></div>
      <div className="heading-actions">
        <Button onClick={salaryExport} disabled={exporting||!filtered.length}><FileSpreadsheet/>{exporting?'Please Wait…':'Salary Export'}</Button>
        <Button variant="outline" onClick={exportRows} disabled={exporting||!filtered.length}>
          <Download/>{exporting?'Preparing Excel…':'Excel export'}
        </Button>
      </div>
    </div>
    <div className="salary-source-note">
      <span className="salary-history-badge"><LockKeyhole size={14}/>Read-only history</span>
      <span>Amounts and component names are shown as saved. “Not recorded” is different from zero.</span>
      {sources.length>0&&<span className="salary-source-value">Source {sources.length===1?'backup':'backups'}: {sources.join(', ')}</span>}
    </div>
    <section className="panel">
      <h2 className="panel-title">Find saved salary records</h2>
      <div className="salary-filter-grid">
        <label>Month<Input type="month" aria-label="Salary history month" value={month} onChange={event=>{
          if(/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)){setMonth(event.target.value);resetSelection();}
        }}/></label>
        <label>Payment Mode<Picker label="Payment mode" value={paymode} onChange={value=>{setPaymode(value);resetSelection();}} options={[{value:'all',label:'All'},{value:'Bank',label:'Bank'},{value:'Cheque',label:'Cheque'},{value:'Cash',label:'Cash'}]}/></label>
        <label>Employee<Picker label="Salary history employee" value={employeeId} onChange={value=>{setEmployeeId(value);resetSelection();}} options={employeeOptions}/></label>
        <label>Search employees<div className="search-field"><Search/><Input aria-label="Search salary history employees" placeholder="Name, paycode or card number" value={search} onChange={event=>{setSearch(event.target.value);resetSelection();}}/></div></label>
      </div>
    </section>
    {query.error&&<ErrorMessage message={query.error.message} retry={()=>query.refetch()}/>}
    {exportError&&<ErrorMessage message={exportError}/>}
    {query.isPending&&!query.data?<section className="panel loading-state space-top" role="status">Loading saved salary history…</section>:
      query.data&&(!rows.length?<section className="panel empty-state space-top">
        <div className="empty-icon"><FileSpreadsheet size={28}/></div><h2>No saved salary history</h2>
        <p>No saved monthly salary records have been loaded.</p>
      </section>:!filtered.length?<section className="panel empty-state salary-empty-search space-top">
        <div className="empty-icon"><Search size={28}/></div><h2>No matching salary records</h2>
        <p>No saved records match {formatMonth(month)} and the selected employee or search. Choose another month or clear the employee filters.</p>
        {(employeeId!=='all'||search)&&<Button variant="outline" onClick={clearFilters}>Clear employee filters</Button>}
      </section>:<>
        <section className="panel space-top">
          <div className="panel-toolbar"><div><h2>{formatMonth(month)} · Saved monthly summary</h2><p className="subtle">Choose an employee row to see its saved components.</p></div><span className="subtle">{filtered.length} {filtered.length===1?'record':'records'}</span></div>
          <div className="table-scroll"><Table className="salary-summary-table">
            <TableHeader><TableRow><TableHead>Employee / Paycode</TableHead><TableHead className="salary-number">Payable days</TableHead><TableHead className="salary-number">Gross (₹)</TableHead><TableHead className="salary-number">Deductions (₹)</TableHead><TableHead className="salary-number">Net (₹)</TableHead><TableHead>Source backup</TableHead></TableRow></TableHeader>
            <TableBody>{pageRows.map(row=><TableRow key={row.key} className={selected?.key===row.key?'salary-selected-row':''}>
              <TableCell><button type="button" className="salary-row-button" aria-label={`View saved salary details for ${row.name}`} aria-pressed={selected?.key===row.key} onClick={()=>setSelectedKey(row.key)}>
                {row.name}<small>{row.paycode||'Paycode not available'}{!row.inRegister?' · Not in current register':''}</small>
              </button></TableCell>
              <TableCell className="salary-number">{storedNumber(row.record.payableDays)}</TableCell>
              <TableCell className="salary-number">{storedNumber(row.record.gross)}</TableCell>
              <TableCell className="salary-number">{storedNumber(row.record.totalDeductions)}</TableCell>
              <TableCell className="salary-number"><strong>{storedNumber(row.record.net)}</strong></TableCell>
              <TableCell className="salary-source-value">{row.record.sourceDataset||'Not recorded'}</TableCell>
            </TableRow>)}</TableBody>
          </Table></div>
          <div className="table-footer"><span>Showing {currentPage*pageSize+1}–{Math.min((currentPage+1)*pageSize,filtered.length)} of {filtered.length} saved records</span>
            <div><Button variant="outline" size="sm" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setSelectedKey(null);}}>Previous</Button><Button variant="outline" size="sm" disabled={currentPage>=pageCount-1} onClick={()=>{setPage(currentPage+1);setSelectedKey(null);}}>Next</Button></div>
          </div>
        </section>
        {selected&&<section className="space-top" aria-label="Selected saved salary details">
          <div className="panel">
            <div className="salary-details-heading"><div><h2>{selected.name} · Saved salary details</h2><p>{formatMonth(selected.record.month)}{selected.paycode?` · ${selected.paycode}`:''}</p></div><p className="salary-source-value">Source backup: {selected.record.sourceDataset||'Not recorded'}</p></div>
            <dl className="salary-metrics">
              <div><dt>Payable days</dt><dd>{storedNumber(selected.record.payableDays)}</dd></div>
              <div><dt>Recorded gross</dt><dd>{storedNumber(selected.record.gross,true)}</dd></div>
              <div><dt>Recorded deductions</dt><dd>{storedNumber(selected.record.totalDeductions,true)}</dd></div>
              <div><dt>Recorded net</dt><dd>{storedNumber(selected.record.net,true)}</dd></div>
            </dl>
            <p className="inline-note">These totals and component amounts are separate saved values. They are displayed without recalculation.</p>
          </div>
          <div className="salary-components space-top"><Components title="Earnings" items={selected.record.earnings}/><Components title="Deductions" items={selected.record.deductions}/></div>
        </section>}
      </>)}
  </div>;
}
