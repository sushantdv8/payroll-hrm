'use client';
import './hr-workspace.css';
import './users-admin.css';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {toast} from 'sonner';
import {requestJson,exportExcel} from '@/lib/client-api';
import {activityKinds,kindLabel,type ActivityRow} from '@/lib/activity-types';
import {roleLabel,type Role} from '@/lib/access';
import {findItem,groupOf} from '@/lib/menu';
import {useIdentity} from './access-context';

// Utilities › Activity Log. Every login has one; the Super Admin reads everybody's, an Admin the Users' and its own, a User its own.
type Response={rows:ActivityRow[];truncated:boolean;users:{username:string;name:string;role:Role}[];me:{username:string;role:Role;roleLabel:string}};
type Filters={user:string;from:string;to:string;kind:string;q:string;limit:string};
const none:Filters={user:'',from:'',to:'',kind:'',q:'',limit:'500'};
const localDay=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const when=(iso:string)=>new Date(iso).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'medium'});
const screenName=(screen:string)=>{if(!screen)return '';const item=findItem(screen),group=groupOf(screen);return item?`${group?.label?group.label+' › ':''}${item.label}`:screen;};
const query=(f:Filters)=>{const p=new URLSearchParams();if(f.user)p.set('user',f.user);if(f.kind)p.set('kind',f.kind);if(f.q.trim())p.set('q',f.q.trim());p.set('limit',f.limit);
 if(f.from)p.set('from',new Date(f.from+'T00:00:00').toISOString());if(f.to)p.set('to',new Date(f.to+'T23:59:59.999').toISOString());return p.toString();};

export function ActivityLog(){
 const me=useIdentity();
 const [draft,setDraft]=useState<Filters>(none),[applied,setApplied]=useState<Filters>(none);
 // The old rows (and the User box) stay on screen while a new choice loads.
 const q=useQuery({queryKey:['activity',applied],queryFn:()=>requestJson<Response>('/api/activity?'+query(applied)),refetchOnWindowFocus:false,placeholderData:prev=>prev});
 const rows=q.data?.rows||[],role=q.data?.me.role,mine=q.data?.me.username;
 const range=(days:number|null)=>{const to=new Date(),from=new Date();from.setDate(from.getDate()-(days||0));const f=days===null?{...draft,from:'',to:''}:{...draft,from:localDay(from),to:localDay(to)};setDraft(f);setApplied(f);};
 const title=role==='superadmin'?'Everybody’s activity':role==='admin'?'Activity of the Users and yours':'Your activity';
 async function download(){
  if(!rows.length)return;
  await exportExcel('Activity_log.xlsx',[{name:'Activity',rows:[['Date and time','Login ID','Name','Role','Company','Type','Screen','Details','Result'],...rows.map(r=>[when(r.ts),r.actor,r.name||'',roleLabel[r.role as Role]||r.role,r.dataset,kindLabel[r.kind]||r.kind,screenName(r.screen),r.summary,r.ok?'OK':'Refused'])]}]);
  toast.success('Excel file created');
 }
 return <section className="hr-page"><h1>Activity Log</h1>
  <p className="ua-note">{title}. Every sign-in, screen opened, record added, changed or deleted, report generated, print, export and refused attempt is written here; nobody can change or delete the log.</p>
  <form className="ua-filters" onSubmit={e=>{e.preventDefault();setApplied(draft);}}>
   {(q.data?.users.length||0)>1&&<label>User<select value={draft.user} onChange={e=>{const f={...draft,user:e.target.value};setDraft(f);setApplied(f);}}><option value="">{role==='user'?'Me':'All users'}</option>{q.data!.users.map(u=><option key={u.username} value={u.username}>{u.username}{u.name&&u.name!==u.username?' · '+u.name:''} ({roleLabel[u.role]})</option>)}</select></label>}
   <label>From<input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
   <label>To<input type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
   <label>Type<select value={draft.kind} onChange={e=>{const f={...draft,kind:e.target.value};setDraft(f);setApplied(f);}}><option value="">All</option>{activityKinds.map(k=><option key={k} value={k}>{kindLabel[k]}</option>)}</select></label>
   <label>Find<input placeholder="screen, record, login" value={draft.q} onChange={e=>setDraft({...draft,q:e.target.value})}/></label>
   <label>Show<select value={draft.limit} onChange={e=>setDraft({...draft,limit:e.target.value})}>{['200','500','1000','5000'].map(n=><option key={n} value={n}>last {n}</option>)}</select></label>
   <div className="ua-quick"><button>Show</button><button type="button" onClick={()=>range(0)}>Today</button><button type="button" onClick={()=>range(6)}>7 days</button><button type="button" onClick={()=>range(29)}>30 days</button><button type="button" onClick={()=>range(null)}>All</button></div>
  </form>
  <div className="hr-actions"><button type="button" onClick={()=>void q.refetch()} disabled={q.isFetching}>{q.isFetching?'Loading…':'Refresh'}</button><button type="button" disabled={!rows.length} onClick={()=>void download()}>Excel</button><span>{rows.length} row{rows.length===1?'':'s'}</span></div>
  {me?.readonly&&<p className="hr-note">This is the original workspace (read only); nothing is written to its activity log. Sign in to the editable workspace to see the activity.</p>}
  {q.error&&<p className="hr-error" role="alert">{q.error.message}</p>}
  {q.data?.truncated&&<p className="ua-trunc">Only the latest {applied.limit} rows are shown. Narrow the dates or the user, or show more.</p>}
  <div className="hr-scroll"><table className="ua-log"><thead><tr><th>Date and time</th><th>User</th><th>Role</th><th>Company</th><th>Type</th><th>Screen</th><th>What happened</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.id} className={r.ok?'':'bad'}><td className="when">{when(r.ts)}</td><td><b>{r.actor}</b>{r.name&&r.name!==r.actor&&<small>{r.name}</small>}{r.actor===mine&&<small>you</small>}</td>
    <td>{r.role?<span className={'ua-badge '+r.role}>{roleLabel[r.role as Role]||r.role}</span>:'—'}</td><td>{r.dataset||'—'}</td>
    <td><span className={'ua-badge'+(r.ok?'':' denied')}>{kindLabel[r.kind]||r.kind}</span></td><td>{screenName(r.screen)||'—'}</td><td className="what">{r.summary}</td></tr>)}
    {!rows.length&&!q.isPending&&<tr><td colSpan={7}>Nothing was recorded for this choice.</td></tr>}</tbody></table></div>
 </section>;
}
