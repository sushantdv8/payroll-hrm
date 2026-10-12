'use client';
import './time-office.css';
import './biometric.css';
import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {Employee} from '@/lib/payroll';
import {requestJson} from '@/lib/client-api';
import {monthLabel,realResignDate} from '@/lib/report-utils';
import {DEFAULT_BIO_URL,matchAll,type BioMap,type BioSettings,type BioState,type BioUser,type Match} from '@/lib/biometric';

// Transaction › Biometric Machine Setup: where the punches come from (the Biometric Attendance app), which machines
// belong to this company, which machine user ID is which employee, and the fetch history. The punches themselves are
// copied into Time Updation with its Biometric Fetch button.
type Tab='machines'|'match'|'history';
type Filter='all'|'none'|'auto'|'manual'|'ignored';
const post=<T,>(body:object)=>requestJson<T>('/api/biometric',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const when=(v:string|null|undefined)=>v?v.replace('T',' ').slice(0,16):'—';
const HOW:Record<Match['how'],string>={manual:'Chosen',ignored:'Not an employee',card:'Card No.',paycode:'Paycode',none:'Not matched'};

export function BiometricSetup({dataset,employees,title,onOpen}:{dataset:string;employees:Employee[];title:string;onOpen?:(screen:string)=>boolean}){
 const client=useQueryClient();
 const settingsQ=useQuery({queryKey:['biometric',dataset,'settings'],queryFn:({signal})=>requestJson<BioSettings>('/api/biometric?'+new URLSearchParams({dataset,view:'settings'}),{signal})});
 const stateQ=useQuery({queryKey:['biometric',dataset,'state'],queryFn:({signal})=>requestJson<BioState&{url:string}>('/api/biometric?'+new URLSearchParams({dataset,view:'state'}),{signal}),enabled:settingsQ.isSuccess,retry:false});
 const [tab,setTab]=useState<Tab>('machines');
 const [url,setUrl]=useState<string|null>(null);const [devices,setDevices]=useState<number[]|null>(null);const [busy,setBusy]=useState('');
 const [test,setTest]=useState<{ok:boolean;text:string}|null>(null);
 const settings=settingsQ.data;const shownUrl=url??settings?.config.url??DEFAULT_BIO_URL;const chosen=devices??settings?.config.devices??[];
 const byNum=(a:number,b:number)=>a-b;
 const configDirty=!!settings&&(shownUrl!==settings.config.url||JSON.stringify([...chosen].sort(byNum))!==JSON.stringify([...settings.config.devices].sort(byNum)));

 async function refresh(){await client.invalidateQueries({queryKey:['biometric',dataset]});}
 async function saveConfig(){if(!settings)return;setBusy('save');
  try{await post({action:'save-config',dataset,revision:settings.revisions.config,config:{url:shownUrl,devices:chosen}});setUrl(null);setDevices(null);await refresh();toast.success('Biometric settings saved');}
  catch(e){toast.error((e as Error).message);}finally{setBusy('');}}
 async function testUrl(){setBusy('test');setTest(null);
  try{const s=await requestJson<BioState>('/api/biometric?'+new URLSearchParams({dataset,view:'state',url:shownUrl}));setTest({ok:true,text:`Connected: ${s.devices.length} machines, ${s.totals.logs.toLocaleString('en-IN')} punches saved (${when(s.totals.first)} to ${when(s.totals.last)}).`});}
  catch(e){setTest({ok:false,text:(e as Error).message});}finally{setBusy('');}}
 async function download(ids:number[]){if(!ids.length){toast.error('No machine to download.');return;}setBusy('download');const done:string[]=[];const failed:string[]=[];
  for(const id of ids){const d=stateQ.data?.devices.find(x=>x.id===id);try{const r=await post<{logs:number;newLogs:number}>({action:'download',dataset,deviceId:id});done.push(`${d?.name}: ${r.newLogs} new of ${r.logs}`);}catch(e){failed.push((e as Error).message);}}
  setBusy('');await client.invalidateQueries({queryKey:['biometric',dataset,'state']});
  if(done.length)toast.success('Downloaded. '+done.join('; '));if(failed.length)toast.error(failed.join(' '));}
 async function setAuto(minutes:number){setBusy('auto');try{await post({action:'auto',dataset,minutes});await client.invalidateQueries({queryKey:['biometric',dataset,'state']});toast.success(minutes?`The app now downloads every ${minutes} minutes while it is open.`:'Auto download is off.');}catch(e){toast.error((e as Error).message);}finally{setBusy('');}}

 const state=stateQ.data;const used=(id:number)=>!chosen.length||chosen.includes(id);
 const toDownload=(state?.devices||[]).filter(d=>used(d.id)).map(d=>d.id);
 const chosenNames=(state?.devices||[]).filter(d=>chosen.includes(d.id)).map(d=>d.name);
 const nameCount=new Map<string,number>();for(const d of state?.devices||[])nameCount.set(d.name,(nameCount.get(d.name)||0)+1);
 return <div className="to-window bio-window">
  <div className="to-titlebar"><strong>{title}</strong>{busy&&<span className="to-status" role="status">Please wait…</span>}</div>
  <div className="bio-body">
   <fieldset className="to-fieldset bio-connect"><legend>Biometric Attendance app</legend>
    <label className="bio-url">Address<input className="to-input" value={shownUrl} onChange={e=>{setUrl(e.target.value);setTest(null);}} spellCheck={false} placeholder={DEFAULT_BIO_URL}/></label>
    <button type="button" className="to-btn" disabled={!!busy} onClick={()=>void testUrl()}>Test</button>
    <button type="button" className="to-btn is-primary" disabled={!!busy||!configDirty} onClick={()=>void saveConfig()}>Save</button>
    {settings&&configDirty&&<button type="button" className="to-btn" disabled={!!busy} onClick={()=>{setUrl(null);setDevices(null);setTest(null);}}>Cancel</button>}
    <a className="to-btn bio-link" href={shownUrl} target="_blank" rel="noreferrer">Open the app</a>
    {test&&<p className={'bio-msg '+(test.ok?'is-ok':'is-bad')} role="status">{test.text}</p>}
    <p className="to-note">The Biometric Attendance app (installed with BiometricAttendance_Setup) downloads the machines and keeps every punch. Start it on the computer that is on the machines&apos; network; this screen reads it from there. Use http://127.0.0.1:5180 when it runs on this computer.</p>
   </fieldset>
   <div className="bio-tabs" role="tablist">{([['machines','Machines'],['match','Employee Match'],['history','Fetch History']] as const).map(([v,l])=><button key={v} type="button" role="tab" aria-selected={tab===v} className={tab===v?'is-active':''} onClick={()=>setTab(v)}>{l}</button>)}
    {onOpen&&<button type="button" className="to-btn bio-go" onClick={()=>onOpen('transaction/time')}>Go to Time Updation</button>}</div>
   {settingsQ.error&&<p className="bio-msg is-bad">{settingsQ.error.message}</p>}
   {tab==='machines'&&<section className="bio-pane">
    {stateQ.isPending&&settingsQ.isSuccess&&<p className="to-note">Connecting to the Biometric Attendance app…</p>}
    {stateQ.error&&<div className="bio-msg is-bad">{stateQ.error.message} <button type="button" className="to-btn" onClick={()=>void stateQ.refetch()}>Try again</button></div>}
    {state&&<>
     <div className="to-row bio-bar">
      <button type="button" className="to-btn is-primary" disabled={!!busy||!toDownload.length} onClick={()=>void download(toDownload)}>{busy==='download'?'Downloading…':chosen.length?'Download this company’s machines':'Download all machines'}</button>
      <button type="button" className="to-btn" disabled={!!busy} onClick={()=>void stateQ.refetch()}>Refresh</button>
      <label>Auto download<select className="to-input" value={state.autoMinutes} disabled={!!busy} onChange={e=>void setAuto(Number(e.target.value))}>{[[0,'Off'],[15,'Every 15 min'],[30,'Every 30 min'],[60,'Every hour'],[120,'Every 2 hours']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <span className="to-note">{state.totals.logs.toLocaleString('en-IN')} punches saved in the app · last {when(state.totals.last)}</span>
     </div>
     <div className="bio-scroll"><table className="bio-table"><thead><tr><th title="Machines of this company">Use</th><th>Machine</th><th>IP : Port</th><th>Status</th><th className="num">Punches</th><th>Last punch</th><th>Last download</th><th/></tr></thead>
      <tbody>{state.devices.map(d=><tr key={d.id} className={used(d.id)?'':'is-off'}>
       <td className="c"><input type="checkbox" aria-label={`Use ${d.name} for this company`} checked={chosen.includes(d.id)} disabled={!!busy} onChange={e=>setDevices(e.target.checked?[...chosen,d.id]:chosen.filter(n=>n!==d.id))}/></td>
       <td><b>{d.name}</b>{(nameCount.get(d.name)||0)>1&&<div className="bio-small">Same name as another machine: rename one in the app.</div>}</td><td>{d.ip}:{d.port}{!d.sameNetwork&&<span className="bio-warn" title="This computer is not on that machine's network"> (other network)</span>}</td>
       <td className={d.status==='online'?'bio-ok':d.status==='error'?'bio-bad':''} title={d.message||''}>{d.busy?`Busy (${d.busy})`:d.status==='online'?'Online':d.status==='error'?'Not connected':'Not checked'}{d.status==='error'&&d.message&&<div className="bio-small">{d.message}</div>}</td>
       <td className="num">{d.storedLogs.toLocaleString('en-IN')}</td><td>{when(d.lastPunch)}</td><td>{when(d.syncedAt)}</td>
       <td><button type="button" className="to-btn" disabled={!!busy||!!d.busy} onClick={()=>void download([d.id])}>Download</button></td></tr>)}</tbody></table></div>
     <p className="to-note">{chosen.length?`Only the ticked machines (${chosenNames.join(', ')||'none found'}) are used for this company.`:'No machine is ticked, so the punches of every machine are used. Tick the machines of this company if other companies use the other machines.'} Press Save after changing the ticks. Machines are added or edited in the app itself.</p>
    </>}
   </section>}
   {tab==='match'&&settings&&<MatchPane dataset={dataset} employees={employees} settings={settings} onSaved={refresh}/>}
   {tab==='history'&&<section className="bio-pane">{!settings?.history.length?<p className="to-note">Nothing has been fetched yet. Use Biometric Fetch on Time Updation.</p>:
    <div className="bio-scroll"><table className="bio-table"><thead><tr><th>Fetched at</th><th>Month</th><th>Days</th><th className="num">Employees</th><th className="num">Punch days</th><th className="num">Unknown IDs</th><th>Calculated</th></tr></thead>
     <tbody>{settings.history.map((h,i)=><tr key={i}><td>{new Date(h.at).toLocaleString('en-IN')}</td><td>{h.month?monthLabel(h.month):''}</td><td>{h.from}–{h.to}</td><td className="num">{h.employees}</td><td className="num">{h.days}</td><td className="num">{h.unmatched}</td><td>{h.calculated?'Yes':'No'}</td></tr>)}</tbody></table></div>}</section>}
  </div>
 </div>;
}

// Machine user ID ↔ employee. Automatic by card number / paycode; a different employee, or "not an employee", can be chosen.
function MatchPane({dataset,employees,settings,onSaved}:{dataset:string;employees:Employee[];settings:BioSettings;onSaved:()=>Promise<void>}){
 const usersQ=useQuery({queryKey:['biometric',dataset,'users',settings.config.url,settings.config.devices.join(',')],queryFn:({signal})=>requestJson<{users:BioUser[]}>('/api/biometric?'+new URLSearchParams({dataset,view:'users'}),{signal}),retry:false});
 const [draft,setDraft]=useState<BioMap|null>(null);const [filter,setFilter]=useState<Filter>('none');const [search,setSearch]=useState('');const [limit,setLimit]=useState(200);const [saving,setSaving]=useState(false);
 const map=draft??settings.map;const byId=useMemo(()=>new Map(employees.map(e=>[e.id,e])),[employees]);
 const byCode=useMemo(()=>new Map(employees.map(e=>[e.paycode.trim().toLowerCase(),e])),[employees]);
 const rows=useMemo(()=>{const users=usersQ.data?.users||[];const m=matchAll(employees,map,users.map(u=>u.userId));
  return users.map(u=>({u,m:m.get(u.userId)!})).sort((a,b)=>a.u.userId.localeCompare(b.u.userId,undefined,{numeric:true}));},[usersQ.data,employees,map]);
 const counts={all:rows.length,none:rows.filter(r=>r.m.how==='none').length,auto:rows.filter(r=>r.m.how==='card'||r.m.how==='paycode').length,manual:rows.filter(r=>r.m.how==='manual').length,ignored:rows.filter(r=>r.m.how==='ignored').length};
 const matchedIds=new Set(rows.map(r=>r.m.employeeId).filter(Boolean));const missing=employees.filter(e=>!realResignDate(e)&&!matchedIds.has(e.id)).length;
 const q=search.trim().toLowerCase();
 const shown=rows.filter(r=>(filter==='all'||(filter==='auto'?r.m.how==='card'||r.m.how==='paycode':r.m.how===filter))&&(!q||[r.u.userId,r.u.name,r.m.employeeId?byId.get(r.m.employeeId)?.name||'':'',r.m.employeeId?byId.get(r.m.employeeId)?.paycode||'':''].join(' ').toLowerCase().includes(q)));
 const set=(userId:string,value:string|null)=>setDraft(d=>{const next={...(d??settings.map)};if(value===null)delete next[userId];else next[userId]=value;return next;});
 function choose(userId:string,text:string){const code=text.split(/\s/)[0]?.trim().toLowerCase()||'';if(!code)return;const e=byCode.get(code);if(!e){toast.error(`No employee with paycode ${text.split(/\s/)[0]}.`);return;}set(userId,e.id);}
 async function save(){setSaving(true);try{await post({action:'save-map',dataset,revision:settings.revisions.map,map});setDraft(null);await onSaved();toast.success('Employee match saved');}catch(e){toast.error((e as Error).message);}finally{setSaving(false);}}
 const dirty=draft!==null&&JSON.stringify(draft)!==JSON.stringify(settings.map);
 if(usersQ.isPending)return <section className="bio-pane"><p className="to-note">Reading the machine users from the Biometric Attendance app…</p></section>;
 if(usersQ.error)return <section className="bio-pane"><div className="bio-msg is-bad">{usersQ.error.message} <button type="button" className="to-btn" onClick={()=>void usersQ.refetch()}>Try again</button></div></section>;
 return <section className="bio-pane">
  <div className="to-row bio-bar">
   {([['none','Not matched'],['auto','Matched by card / paycode'],['manual','Chosen'],['ignored','Not employees'],['all','All']] as const).map(([v,l])=><label key={v}><input type="radio" name={'bio-filter-'+dataset} checked={filter===v} onChange={()=>{setFilter(v);setLimit(200);}}/>{l} ({counts[v]})</label>)}
   <input className="to-input bio-search" placeholder="Find ID / name / paycode" value={search} onChange={e=>{setSearch(e.target.value);setLimit(200);}}/>
   <button type="button" className="to-btn is-primary" disabled={!dirty||saving} onClick={()=>void save()}>{saving?'Saving…':'Save'}</button>
   {dirty&&<button type="button" className="to-btn" disabled={saving} onClick={()=>setDraft(null)}>Cancel</button>}
  </div>
  <p className="to-note">{rows.length} user IDs punched on {settings.config.devices.length?'this company’s machines':'the machines'} in the last two months. A machine user ID is matched to the employee whose Card No. (or paycode) is the same; type a paycode to choose another employee. {missing?`${missing} working employees have no machine ID matched.`:'Every working employee has a machine ID.'}</p>
  <datalist id={'bio-emps-'+dataset}>{employees.map(e=><option key={e.id} value={`${e.paycode} ${e.name}`}/>)}</datalist>
  <div className="bio-scroll"><table className="bio-table"><thead><tr><th>Machine User ID</th><th>Name on machine</th><th className="num">Punches</th><th>Machines</th><th>Last punch</th><th>Employee</th><th>How</th><th>Change</th></tr></thead>
   <tbody>{shown.slice(0,limit).map(({u,m})=>{const e=m.employeeId?byId.get(m.employeeId):undefined;return <tr key={u.userId} className={m.how==='none'?'is-bad':m.how==='ignored'?'is-off':''}>
    <td><b>{u.userId}</b></td><td>{u.name}</td><td className="num">{u.punches}</td><td>{u.devices.join(', ')}</td><td>{when(u.lastPunch)}</td>
    <td>{e?`${e.paycode} · ${e.name}`:''}</td><td>{HOW[m.how]}</td>
    <td className="bio-change"><input className="to-input" list={'bio-emps-'+dataset} placeholder="Paycode" aria-label={`Employee for machine user ${u.userId}`} onKeyDown={ev=>{if(ev.key==='Enter'){choose(u.userId,(ev.target as HTMLInputElement).value);(ev.target as HTMLInputElement).value='';}}} onBlur={ev=>{if(ev.target.value){choose(u.userId,ev.target.value);ev.target.value='';}}}/>
     <button type="button" className="to-btn" title="Not an employee: never matched" onClick={()=>set(u.userId,'-')}>Ignore</button>
     {(m.how==='manual'||m.how==='ignored')&&<button type="button" className="to-btn" title="Back to the automatic match" onClick={()=>set(u.userId,null)}>Auto</button>}</td></tr>;})}</tbody></table></div>
  {shown.length>limit&&<button type="button" className="to-btn" onClick={()=>setLimit(l=>l+300)}>Show more ({shown.length-limit} more)</button>}
 </section>;
}
