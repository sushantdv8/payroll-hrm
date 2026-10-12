'use client';
import {useMemo,useState} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import {Database,Download,Search} from 'lucide-react';
import {toast} from 'sonner';
import type {SourceRef} from '@/lib/menu';
import {exportExcel,requestJson} from '@/lib/client-api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ErrorMessage} from './payroll-controls';

type Page={columns:{name:string;type:string}[];rows:(string|null)[][];total:number;offset:number;nextOffset:number|null};
const binaryTypes=new Set(['image','varbinary','binary','timestamp']);
const words:Record<string,string>={cmp:'Company',scmp:'Subcompany',sub:'Subcompany',dep:'Department',des:'Designation',loc:'Location',cat:'Category',emp:'Employee',sft:'Shift',sf:'Shift',lv:'Leave',hol:'Holiday',h:'Holiday',ern:'Earning',ded:'Deduction',reim:'Reimbursement',salg:'Salary grade',bank:'Bank',tdh:'Department head',dh:'Department head',misc:'Misc',ref:'Reference',exp:'Export',flds:'Fields',no:'No.',dt:'Date',tdate:'Date',amt:'Amount',rt:'Rate',nm:'Name',grd:'Grade',yr:'Year',mon:'Month',month:'Month',tmp:'Temp',alw:'Allowed',hindi:'Hindi name',short:'Short name'};
function columnLabel(name:string){const parts=name.toLowerCase().split('_');const tail=parts.at(-1);if(parts.length===2&&(tail==='code'||tail==='name'))return (words[parts[0]]||parts[0].toUpperCase())+' '+tail;return parts.map(p=>words[p]||p).join(' ').replace(/^./,c=>c.toUpperCase());}
function display(value:string|null,type:string){if(value===null)return '—';if(binaryTypes.has(type))return '[stored file]';const text=value.replace(/\s+$/,'');if(/datetime|date/.test(type)&&/^\d{4}-\d{2}-\d{2}/.test(text)){const d=text.slice(0,10);return d==='1900-01-01'?'—':d.split('-').reverse().join('/');}return text||'—';}

function SourceGrid({dataset,source}:{dataset:string;source:SourceRef}){
 const [search,setSearch]=useState('');const [exporting,setExporting]=useState(false);
 const query=useInfiniteQuery({queryKey:['source',dataset,source.table],initialPageParam:0,
  queryFn:({pageParam,signal})=>requestJson<Page>('/api/source?'+new URLSearchParams({dataset,table:source.table,offset:String(pageParam)}),{signal}),
  getNextPageParam:last=>last.nextOffset??undefined,refetchOnWindowFocus:false,retry:false});
 const first=query.data?.pages[0];const columns=useMemo(()=>first?.columns||[],[first]);
 const rows=useMemo(()=>(query.data?.pages||[]).flatMap(p=>p.rows),[query.data]);
 const visibleColumns=columns.map((c,i)=>({...c,i})).filter(c=>!binaryTypes.has(c.type));
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return rows;return rows.filter(r=>r.some(v=>v!==null&&v.toLowerCase().includes(q)));},[rows,search]);
 async function exportAll(){setExporting(true);try{let pages=query.data?.pages.length||0;while(query.hasNextPage&&pages<400){const r=await query.fetchNextPage();pages=r.data?.pages.length||pages+1;if(r.error)throw r.error;}const all=(query.data?.pages||[]).flatMap(p=>p.rows);await exportExcel(`${dataset}_${source.table}.xlsx`,[{name:source.title||source.table,rows:[visibleColumns.map(c=>columnLabel(c.name)),...all.map(r=>visibleColumns.map(c=>display(r[c.i],c.type)))]}]);toast.success('Excel file created');}catch(e){toast.error((e as Error).message||'Export failed');}finally{setExporting(false);}}
 if(query.isPending)return <section className="panel loading-state" role="status">Loading {source.title||source.table}…</section>;
 if(query.error){const message=query.error.message;return /not found/i.test(message)?<section className="panel empty-state"><div className="empty-icon"><Database size={28}/></div><h2>No {source.title||source.table} records</h2><p>This company database does not contain the “{source.table}” table.</p></section>:<ErrorMessage message={message} retry={()=>query.refetch()}/>;}
 if(!first||!first.columns.length)return <section className="panel empty-state"><div className="empty-icon"><Database size={28}/></div><h2>Import this company first</h2><p>Choose an imported company in the header, or load its records from Import Master.</p></section>;
 return <section className="panel">
  <div className="panel-toolbar"><div><h2>{source.title||source.table}</h2><p className="subtle">{first.total} {first.total===1?'record':'records'} · original table {source.table}</p></div>
   <div className="heading-actions"><div className="picker-search"><Search size={16}/><Input aria-label={'Search '+(source.title||source.table)} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search loaded rows"/></div><Button variant="outline" disabled={exporting||!first.total} onClick={exportAll}><Download size={16}/>{exporting?'Exporting…':'Excel export'}</Button></div></div>
  {first.total===0?<div className="inline-note">No records were saved in the original software for this entry.</div>:<div className="table-scroll source-table"><Table><TableHeader><TableRow><TableHead>#</TableHead>{visibleColumns.map(c=><TableHead key={c.name} title={c.name}>{columnLabel(c.name)}</TableHead>)}</TableRow></TableHeader>
   <TableBody>{filtered.map((r,index)=><TableRow key={index}><TableCell className="muted-cell">{index+1}</TableCell>{visibleColumns.map(c=><TableCell key={c.name} className="nowrap">{display(r[c.i],c.type)}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
  {first.total>0&&<div className="section-help">Showing {filtered.length} of {rows.length} loaded ({first.total} total). {query.hasNextPage&&<Button variant="outline" size="sm" className="space-top" disabled={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>{query.isFetchingNextPage?'Loading…':'Load more'}</Button>}</div>}
 </section>;
}

export function SourceTables({dataset,tables,title,note}:{dataset:string;tables:SourceRef[];title:string;note?:string}){
 const body=tables.length===1?<SourceGrid dataset={dataset} source={tables[0]}/>:<Tabs defaultValue={tables[0]?.table}><TabsList className="inner-tabs">{tables.map(t=><TabsTrigger key={t.table} value={t.table}>{t.title||t.table}</TabsTrigger>)}</TabsList>{tables.map(t=><TabsContent key={t.table} value={t.table}><SourceGrid dataset={dataset} source={t}/></TabsContent>)}</Tabs>;
 return <><div className="page-heading"><div><p className="eyebrow">ORIGINAL RECORDS</p><h1>{title}</h1><p>Records imported from the original software for the selected company.</p></div></div>{note&&<div className="inline-note">{note}</div>}{dataset==='manual'?<section className="panel empty-state"><div className="empty-icon"><Database size={28}/></div><h2>Choose an imported company</h2><p>Select a company in the header to see the records saved in the original software.</p></section>:body}</>;
}
