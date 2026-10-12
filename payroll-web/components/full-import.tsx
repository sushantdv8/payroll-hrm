'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {CheckCircle2,Database,FileArchive,Loader2,Pause,Play,RotateCw,Upload} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ErrorMessage} from './payroll-controls';
import './full-import.css';

const MAX_LINE_BYTES=8*1024*1024;
const MAX_PACKETS=100_000;
const MAX_RETRIES=3;
const countKeys=['employees','attendance','salaries','rawParts'] as const;
type ImportCounts=Record<typeof countKeys[number],number>;
type ImportManifest={
  format:'payroll-full-v1';
  dataset:{key:string;companyName:string;year:number;[key:string]:unknown};
  expected:ImportCounts;
  packetCount:number;
  [key:string]:unknown;
};
type ImportPacket={sequence:number;kind:'employees'|'attendance'|'salaries'|'source';rows:unknown[];[key:string]:unknown};
type ImportStatus='reading'|'ready'|'checking'|'importing'|'finishing'|'paused'|'complete'|'error';
type ImportFile={id:string;file:File;manifest:ImportManifest|null;status:ImportStatus;saved:number;error:string;note:string;counts?:ImportCounts};

class ImportFailure extends Error{
  constructor(message:string,readonly retryable=false){super(message);this.name='ImportFailure';}
}

function isObject(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function isCount(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
function isShortText(value:unknown,max:number):value is string{return typeof value==='string'&&value.trim().length>0&&value.length<=max;}
function validCounts(value:unknown):value is ImportCounts{return isObject(value)&&countKeys.every(key=>isCount(value[key]));}
function throwIfAborted(signal:AbortSignal){if(signal.aborted)throw new DOMException('Import stopped','AbortError');}

function parseManifest(line:string):ImportManifest{
  let value:unknown;
  try{value=JSON.parse(line);}catch{throw new ImportFailure('This file could not be read. Choose a prepared .payroll file.');}
  if(!isObject(value)||value.format!=='payroll-full-v1'||!isObject(value.dataset)||
    !isShortText(value.dataset.key,200)||!isShortText(value.dataset.companyName,300)||
    !isCount(value.dataset.year)||value.dataset.year<1||value.dataset.year>9999||
    !validCounts(value.expected)||!isCount(value.packetCount)||value.packetCount>MAX_PACKETS){
    throw new ImportFailure('This file does not contain valid company details and record totals. Choose a newly prepared .payroll file.');
  }
  // Keep every manifest field: the server also needs its source settings and table details.
  return value as ImportManifest;
}

function parsePacket(line:string,sequence:number,total:number):ImportPacket{
  let value:unknown;
  try{value=JSON.parse(line);}catch{throw new ImportFailure(`The file could not be read at batch ${sequence+1}. Choose a newly prepared copy of this file.`);}
  if(sequence>=total||!isObject(value)||value.sequence!==sequence||typeof value.kind!=='string'||
    !['employees','attendance','salaries','source'].includes(value.kind)||!Array.isArray(value.rows)){
    throw new ImportFailure(`The file has an incomplete or out-of-order batch at position ${sequence+1}. Choose a newly prepared copy.`);
  }
  return value as ImportPacket;
}

async function* readLines(file:File,signal:AbortSignal):AsyncGenerator<string>{
  const reader=file.stream().getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let line='';
  let bytes=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      throwIfAborted(signal);
      const result=await reader.read();
      throwIfAborted(signal);
      if(result.done)break;
      let start=0;
      while(start<result.value.length){
        const newline=result.value.indexOf(10,start);
        const end=newline<0?result.value.length:newline;
        bytes+=end-start;
        if(bytes>MAX_LINE_BYTES)throw new ImportFailure('A data batch in this file is too large. Prepare the file again with smaller batches.');
        try{line+=decoder.decode(result.value.subarray(start,end),{stream:true});}
        catch{throw new ImportFailure('The file contains unreadable text. Choose a newly prepared .payroll file.');}
        if(newline<0)break;
        try{line+=decoder.decode();}
        catch{throw new ImportFailure('The file contains unreadable text. Choose a newly prepared .payroll file.');}
        yield line.endsWith('\r')?line.slice(0,-1):line;
        line='';bytes=0;start=newline+1;
        throwIfAborted(signal);
      }
    }
    try{line+=decoder.decode();}
    catch{throw new ImportFailure('The file ends with unreadable text. Choose a newly prepared .payroll file.');}
    if(bytes>0||line.length>0)yield line.endsWith('\r')?line.slice(0,-1):line;
  }finally{
    signal.removeEventListener('abort',cancel);
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

function waitForRetry(milliseconds:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    throwIfAborted(signal);
    const cancel=()=>{clearTimeout(timer);reject(new DOMException('Import stopped','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},milliseconds);
    signal.addEventListener('abort',cancel,{once:true});
  });
}

async function postImport(body:unknown,signal:AbortSignal,onRetry:(attempt:number)=>void):Promise<Record<string,unknown>>{
  const serialized=JSON.stringify(body);
  for(let attempt=0;attempt<=MAX_RETRIES;attempt++){
    throwIfAborted(signal);
    const requestController=new AbortController();
    const cancel=()=>requestController.abort();
    signal.addEventListener('abort',cancel,{once:true});
    const timeout=setTimeout(()=>requestController.abort(),60_000);
    let failure:ImportFailure;
    try{
      const response=await fetch('/api/full-import',{
        method:'POST',headers:{'Content-Type':'application/json'},body:serialized,
        cache:'no-store',signal:requestController.signal,
      });
      let data:unknown;
      try{data=await response.json();}catch(error){
        if(response.ok){
          if(error instanceof TypeError||requestController.signal.aborted)throw error;
          throw new ImportFailure('The import service returned an incomplete reply. Your saved progress is kept. Please try again.');
        }
      }
      if(!response.ok){
        const message=isObject(data)&&isShortText(data.error,600)?data.error:'The import could not continue. Your saved progress is kept. Please try again.';
        throw new ImportFailure(message,[408,429,502,503,504].includes(response.status));
      }
      if(!isObject(data))throw new ImportFailure('The import service returned an unexpected reply. Please try again.');
      onRetry(0);
      return data;
    }catch(error){
      throwIfAborted(signal);
      failure=error instanceof ImportFailure?error:new ImportFailure('The connection was interrupted. Your saved progress is kept. Please try again.',true);
    }finally{
      clearTimeout(timeout);
      signal.removeEventListener('abort',cancel);
    }
    if(!failure.retryable||attempt===MAX_RETRIES)throw failure;
    onRetry(attempt+1);
    await waitForRetry(750*2**attempt,signal);
  }
  throw new ImportFailure('The import could not continue. Please try again.');
}

function describeError(error:unknown):string{
  return error instanceof ImportFailure?error.message:'The file could not be read. Keep it available on this computer and try again.';
}
function formatSize(bytes:number):string{return bytes>=1024*1024?`${(bytes/(1024*1024)).toFixed(1)} MB`:`${Math.max(1,Math.ceil(bytes/1024))} KB`;}
const numberFormat=new Intl.NumberFormat('en-IN');
const statusNames:Record<ImportStatus,string>={reading:'Reading details',ready:'Ready',checking:'Checking saved progress',importing:'Importing',finishing:'Finishing import',paused:'Paused',complete:'Complete',error:'Needs attention'};

export function FullImport({onChange,onBusy}:{onChange:()=>Promise<unknown>;onBusy?:(busy:boolean)=>void}){
  const inputId=useId();
  const client=useQueryClient();
  const [files,setFiles]=useState<ImportFile[]>([]);
  const [reading,setReading]=useState(false);
  const [running,setRunning]=useState(false);
  const [pauseRequested,setPauseRequested]=useState(false);
  const [refreshError,setRefreshError]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const filesRef=useRef<ImportFile[]>([]);
  const runningRef=useRef(false);
  const pauseRef=useRef(false);
  const mounted=useRef(true);
  const generation=useRef(0);
  const controllerRef=useRef<AbortController|null>(null);

  useEffect(()=>{
    mounted.current=true;
    const warn=(event:BeforeUnloadEvent)=>{
      if(runningRef.current){event.preventDefault();event.returnValue='';}
    };
    window.addEventListener('beforeunload',warn);
    return ()=>{
      mounted.current=false;
      controllerRef.current?.abort();
      window.removeEventListener('beforeunload',warn);
    };
  },[]);

  useEffect(()=>{
    onBusy?.(running);
    return ()=>onBusy?.(false);
  },[running,onBusy]);

  function update(id:string,patch:Partial<ImportFile>){
    if(!mounted.current)return;
    filesRef.current=filesRef.current.map(file=>file.id===id?{...file,...patch}:file);
    setFiles(filesRef.current);
  }

  async function choose(selected:File[]){
    if(!selected.length||runningRef.current)return;
    controllerRef.current?.abort();
    const controller=new AbortController();
    controllerRef.current=controller;
    const selection=++generation.current;
    const next=selected.map((file,index):ImportFile=>({id:`${selection}:${index}`,file,manifest:null,status:'reading',saved:0,error:'',note:''}));
    filesRef.current=next;setFiles(next);setReading(true);setRefreshError('');setPauseRequested(false);
    try{
      for(const item of next){
        try{
          if(!/\.payroll$/i.test(item.file.name))throw new ImportFailure('Choose a prepared file ending in .payroll.');
          const lines=readLines(item.file,controller.signal);
          let first:IteratorResult<string>;
          try{first=await lines.next();}finally{await lines.return(undefined);}
          if(first.done)throw new ImportFailure('This file is empty. Choose a prepared .payroll file.');
          const manifest=parseManifest(first.value);
          if(selection!==generation.current)return;
          update(item.id,{manifest,status:'ready'});
        }catch(error){
          if(controller.signal.aborted||selection!==generation.current)return;
          update(item.id,{status:'error',error:describeError(error)});
        }
      }
    }finally{
      if(mounted.current&&selection===generation.current){setReading(false);controllerRef.current=null;}
    }
  }

  async function refreshRecords(){
    if(mounted.current){setRefreshError('');setRefreshing(true);}
    const result=await Promise.allSettled([client.invalidateQueries(),Promise.resolve().then(()=>onChange())]);
    if(mounted.current){
      setRefreshing(false);
      if(result.some(item=>item.status==='rejected'))setRefreshError('The import is complete, but the record lists could not refresh. Refresh the lists to see the imported records.');
    }
  }

  async function importFile(item:ImportFile,signal:AbortSignal):Promise<boolean>{
    const preview=item.manifest!;
    update(item.id,{status:'checking',error:'',note:''});
    const lines=readLines(item.file,signal);
    const retry=(attempt:number)=>update(item.id,{note:attempt?`Connection interrupted. Trying again (${attempt} of ${MAX_RETRIES})…`:''});
    try{
      const first=await lines.next();
      if(first.done)throw new ImportFailure('This file is empty. Choose the same prepared file again.');
      const manifest=parseManifest(first.value);
      if(manifest.dataset.key!==preview.dataset.key||manifest.dataset.companyName!==preview.dataset.companyName||
        manifest.dataset.year!==preview.dataset.year||manifest.packetCount!==preview.packetCount||
        countKeys.some(key=>manifest.expected[key]!==preview.expected[key])){
        throw new ImportFailure('The file details have changed. Select the file again to review its updated totals.');
      }
      if(pauseRef.current){update(item.id,{status:'paused',note:''});return false;}
      const begin=await postImport({action:'begin',manifest},signal,retry);
      if(!isShortText(begin.sessionId,500)||typeof begin.status!=='string'||!['staging','complete'].includes(begin.status)||
        !isCount(begin.nextSequence)||begin.nextSequence>manifest.packetCount){
        throw new ImportFailure('The saved import position could not be checked. Please try again.');
      }
      const sessionId=begin.sessionId;
      if(begin.status==='complete'){
        update(item.id,{status:'complete',saved:manifest.packetCount,note:'',counts:validCounts(begin.counts)?begin.counts:undefined});
        return true;
      }
      let nextSequence=begin.nextSequence;
      let sequence=0;
      update(item.id,{saved:nextSequence,note:nextSequence?'Finding the saved position in this file…':''});
      for await(const line of lines){
        throwIfAborted(signal);
        if(pauseRef.current){update(item.id,{status:'paused',note:''});return false;}
        const packet=parsePacket(line,sequence,manifest.packetCount);
        sequence++;
        if(packet.sequence<nextSequence)continue;
        if(packet.sequence!==nextSequence)throw new ImportFailure('The saved import position does not match this file. Please try again.');
        update(item.id,{status:'importing',note:''});
        const result=await postImport({action:'packet',sessionId,packet},signal,retry);
        if(result.nextSequence!==packet.sequence+1)throw new ImportFailure('This batch could not be confirmed. Your saved progress is kept. Please try again.');
        nextSequence=result.nextSequence as number;
        update(item.id,{saved:nextSequence});
      }
      if(sequence!==manifest.packetCount||nextSequence!==manifest.packetCount){
        throw new ImportFailure('This file ends before all its records are present. Choose a complete prepared copy; saved progress is kept.');
      }
      if(pauseRef.current){update(item.id,{status:'paused',note:''});return false;}
      update(item.id,{status:'finishing',note:''});
      const finish=await postImport({action:'finish',sessionId},signal,retry);
      if(finish.complete!==true||!validCounts(finish.counts))throw new ImportFailure('The final import totals could not be confirmed. Please try again to check the saved result.');
      update(item.id,{status:'complete',counts:finish.counts,error:'',note:''});
      return true;
    }finally{await lines.return(undefined);}
  }

  async function start(){
    if(runningRef.current||reading)return;
    const queue=filesRef.current.filter(item=>item.manifest&&item.status!=='complete');
    if(!queue.length)return;
    runningRef.current=true;pauseRef.current=false;setRunning(true);setPauseRequested(false);
    const controller=new AbortController();controllerRef.current=controller;
    let current:ImportFile|undefined;
    try{
      for(const item of queue){
        current=item;
        if(pauseRef.current){update(item.id,{status:'paused',note:''});break;}
        if(!await importFile(item,controller.signal))break;
        await refreshRecords();
        throwIfAborted(controller.signal);
      }
    }catch(error){
      if(!controller.signal.aborted&&current)update(current.id,{status:'error',error:describeError(error),note:''});
    }finally{
      runningRef.current=false;
      if(mounted.current){setRunning(false);setPauseRequested(false);controllerRef.current=null;}
    }
  }

  const valid=files.filter(item=>item.manifest);
  const completed=valid.filter(item=>item.status==='complete').length;
  const pending=valid.filter(item=>item.status!=='complete');
  const failed=pending.some(item=>item.status==='error');
  const resumable=pending.some(item=>item.saved>0||item.status==='paused');
  const totalBatches=valid.reduce((total,item)=>total+(item.manifest?.packetCount||0),0);
  const savedBatches=valid.reduce((total,item)=>total+item.saved,0);
  const active=files.find(item=>['checking','importing','finishing'].includes(item.status));

  return <div className="full-import">
    <div className="page-heading"><div><p className="eyebrow">SOURCE RECORDS</p><h1>Import full records</h1><p>Bring in the complete prepared records for each company and year.</p></div><Database size={32}/></div>
    <section className="panel" aria-labelledby={`${inputId}-heading`}>
      <div className="panel-toolbar"><div><h2 id={`${inputId}-heading`}>Choose your payroll files</h2><p className="subtle">Review the company names and totals before starting.</p></div><FileArchive size={23}/></div>
      <div className="full-import-picker">
        <label htmlFor={inputId}>Prepared payroll files</label>
        <Input id={inputId} type="file" accept=".payroll" multiple disabled={running||reading} aria-describedby={`${inputId}-help`}
          onClick={event=>{event.currentTarget.value='';}}
          onChange={event=>void choose(Array.from(event.target.files||[]))}/>
        <p id={`${inputId}-help`}>Choose one or more .payroll files. Files are imported one at a time. Keep this page open while the import is running.</p>
      </div>
      {reading&&<p className="full-import-reading" role="status"><Loader2 className="full-import-spin" size={17}/>Reading company details…</p>}
      {files.length>0&&<div className="full-import-files">
        {files.map(item=>{
          const details=item.manifest;
          const counts=item.counts||details?.expected;
          return <article key={item.id} className={`full-import-file full-import-file-${item.status}`}>
            <div className="full-import-file-heading"><div><h3>{details?.dataset.companyName||item.file.name}</h3>
              <p>{details?`${details.dataset.year} · `:''}{item.file.name} · {formatSize(item.file.size)}</p></div>
              <span className={`full-import-status full-import-status-${item.status}`}>
                {item.status==='complete'?<CheckCircle2 size={15}/>:['reading','checking','importing','finishing'].includes(item.status)?<Loader2 size={15} className="full-import-spin"/>:null}{statusNames[item.status]}
              </span>
            </div>
            {counts&&<dl className="full-import-counts">
              <div><dt>Employees</dt><dd>{numberFormat.format(counts.employees)}</dd></div>
              <div><dt>Attendance records</dt><dd>{numberFormat.format(counts.attendance)}</dd></div>
              <div><dt>Salary records</dt><dd>{numberFormat.format(counts.salaries)}</dd></div>
              <div><dt>Original data parts</dt><dd>{numberFormat.format(counts.rawParts)}</dd></div>
            </dl>}
            {details&&<div className="full-import-progress">
              <div><span>{item.status==='complete'?'Import complete':`${numberFormat.format(item.saved)} of ${numberFormat.format(details.packetCount)} batches saved`}</span>
                {details.packetCount>0&&<span>{Math.floor(item.saved/details.packetCount*100)}%</span>}</div>
              {details.packetCount>0&&<progress max={details.packetCount} value={item.saved} aria-label={`Saved batches for ${details.dataset.companyName}`}/>}
              {item.note&&<p className="full-import-note" role="status">{item.note}</p>}
              {item.status==='paused'&&<p className="full-import-note">Saved progress is kept. Resume when you are ready.</p>}
            </div>}
            {item.error&&<ErrorMessage message={item.error}/>}
          </article>;
        })}
      </div>}
      {valid.length>0&&<div className="full-import-actions">
        <div role="status" aria-live="polite"><strong>{completed} of {valid.length} files complete</strong>
          <p>{running?(pauseRequested?'Pausing after the current batch…':refreshing?'Refreshing your records…':active?`${statusNames[active.status]}: ${active.manifest?.dataset.companyName}`:'Preparing the next file…'):
            completed===valid.length?'All selected valid files have been imported.':`${numberFormat.format(savedBatches)} of ${numberFormat.format(totalBatches)} batches saved`}</p>
        </div>
        {running?<Button type="button" variant="outline" disabled={pauseRequested} onClick={()=>{pauseRef.current=true;setPauseRequested(true);}}><Pause size={16}/>{pauseRequested?'Pausing…':'Pause import'}</Button>:
          pending.length>0&&<Button type="button" disabled={reading||refreshing} onClick={()=>void start()}>
            {failed?<RotateCw size={16}/>:resumable?<Play size={16}/>:<Upload size={16}/>}{failed?'Retry import':resumable?'Resume import':'Start import'}
          </Button>}
      </div>}
    </section>
    {refreshError&&<div className="full-import-refresh" role="alert"><p>{refreshError}</p><Button type="button" variant="outline" disabled={refreshing||running} onClick={()=>void refreshRecords()}><RotateCw size={16}/>{refreshing?'Refreshing…':'Refresh records'}</Button></div>}
    <p className="full-import-help">If the connection is interrupted, retry to continue from the last saved batch. After reopening this page, select the same files to resume.</p>
  </div>;
}
