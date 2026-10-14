'use client';
import './hr-workspace.css';
import './users-admin.css';
import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {requestJson} from '@/lib/client-api';
import {accessSections,accessRows,rightLabel,roleLabel,roleOf,isSuper,type Role} from '@/lib/access';
import type {HrPermissions} from '@/lib/hrm';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useIdentity} from './access-context';

// Utilities › Users & Roles. The Super Admin makes Admins and Users; an Admin makes Users. Each login gets the companies, locations and the
// View / Add / Edit / Delete of the screens ticked here - an Admin can tick only what the Admin has. A login is made inactive, never deleted.
type UserRow={username:string;name:string;role:Role;active:boolean;createdBy:string;createdAt:string;lastLogin:string;revision:number;manageable:boolean;permissions:HrPermissions};
type UsersResponse={me:{username:string;name:string;role:Role};users:UserRow[];superAdmin:{username:string;lastLogin:string}|null};
type Draft={username:string;name:string;role:'admin'|'user';password:string;active:boolean;revision:number;permissions:HrPermissions};
const post=(body:object)=>requestJson<{ok:boolean}>('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const when=(iso:string)=>iso?new Date(iso).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
const blank=(role:'admin'|'user',dataset:string):Draft=>({username:'',name:'',role,password:'',active:true,revision:0,permissions:{datasets:[dataset],units:['*'],modules:{}}});

export function UsersAdmin({dataset,companies,workspace}:{dataset:string;companies:{key:string;label:string}[];workspace?:string}){
 const client=useQueryClient(),me=useIdentity(),superAdmin=!me||isSuper(me);
 const q=useQuery({queryKey:['users'],queryFn:()=>requestJson<UsersResponse>('/api/users')});
 const names=useQuery({queryKey:['master-names',dataset],queryFn:()=>requestJson<{names:{locations:string[]}}>('/api/masters?'+new URLSearchParams({dataset,names:'1'}))});
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [reset,setReset]=useState<{user:UserRow;password:string;again:string}|null>(null),[companyFind,setCompanyFind]=useState('');
 const locations=names.data?.names.locations||[];
 // What the signed-in login may hand on (the Super Admin: everything).
 const own=me?.permissions;
 // (An Admin always has the Activity Log, so it may give its View to a User.)
 const canRight=(key:string,right:string)=>superAdmin||!!own?.modules[key]?.includes(right)||!!own?.modules['*']?.includes(right)||(key==='utilities/activity'&&right==='view'&&!!me&&roleOf(me)==='admin');
 const canCompany=(key:string)=>superAdmin||!!own?.datasets.includes('*')||!!own?.datasets.includes(key);
 const canAllCompanies=superAdmin||!!own?.datasets.includes('*'),canAllUnits=superAdmin||!!own?.units.includes('*');
 const canUnit=(name:string)=>canAllUnits||!!own?.units.includes(name);
 const grantable=companies.filter(c=>canCompany(c.key));
 const shownCompanies=grantable.filter(c=>!companyFind||c.label.toLowerCase().includes(companyFind.toLowerCase()));
 const sections=useMemo(()=>accessSections,[]);

 function edit(u:UserRow){setError('');setDraft({username:u.username,name:u.name,role:u.role==='admin'?'admin':'user',password:'',active:u.active,revision:u.revision,permissions:{datasets:[...u.permissions.datasets],units:[...u.permissions.units],modules:Object.fromEntries(Object.entries(u.permissions.modules).map(([k,v])=>[k,[...v]]))}});}
 function setRight(key:string,right:string,on:boolean){
  setDraft(d=>{if(!d)return d;const cur=new Set(d.permissions.modules[key]||[]);
   if(on){cur.add(right);if(right!=='view'&&right!=='reports')cur.add('view');}
   else{cur.delete(right);if(right==='view')for(const r of [...cur])if(r!=='reports')cur.delete(r);}
   const modules={...d.permissions.modules,[key]:[...cur]};if(!cur.size)delete modules[key];
   return {...d,permissions:{...d.permissions,modules}};});
 }
 // Quick fills: only rights the signed-in login can give are ticked.
 function fill(keys:string[],mode:'all'|'view'|'none'){
  setDraft(d=>{if(!d)return d;const modules={...d.permissions.modules};
   for(const key of keys){const row=accessRows.get(key);if(!row)continue;
    const list=mode==='none'?[]:row.rights.filter(r=>canRight(key,r)&&(mode==='all'||r==='view'));
    if(list.length)modules[key]=list;else delete modules[key];}
   return {...d,permissions:{...d.permissions,modules}};});
 }
 const toggleList=(field:'datasets'|'units',value:string,on:boolean)=>setDraft(d=>{if(!d)return d;const cur=new Set(d.permissions[field]);if(on)cur.add(value);else cur.delete(value);return {...d,permissions:{...d.permissions,[field]:[...cur]}};});
 const setList=(field:'datasets'|'units',list:string[])=>setDraft(d=>d?{...d,permissions:{...d.permissions,[field]:list}}:d);

 async function save(e:React.FormEvent){
  e.preventDefault();if(!draft)return;setError('');
  if(!/^[a-zA-Z][a-zA-Z0-9_.-]{2,39}$/.test(draft.username)){setError('Login ID: 3 to 40 letters, digits, . _ - and it must start with a letter.');return;}
  if(!draft.revision&&draft.password.length<8){setError('Enter a password of at least 8 characters.');return;}
  if(draft.password&&draft.password.length<8){setError('The password needs at least 8 characters.');return;}
  if(!draft.permissions.datasets.length){setError('Choose at least one company.');return;}
  if(!draft.permissions.units.length){setError('Choose at least one location, or All locations.');return;}
  setBusy(true);
  try{await post({action:'save',user:draft});setDraft(null);await q.refetch();toast.success(draft.revision?'Login updated':'Login created');}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 async function toggleActive(u:UserRow){
  if(u.active&&!window.confirm(`Make ${u.username} inactive? ${u.username} will not be able to sign in. Their activity log is kept.`))return;
  try{await post({action:'set-active',username:u.username,active:!u.active,revision:u.revision});await q.refetch();toast.success(u.active?'Login made inactive':'Login activated');}catch(err){toast.error((err as Error).message);}
 }
 async function savePassword(e:React.FormEvent){
  e.preventDefault();if(!reset)return;
  if(reset.password.length<8){toast.error('The password needs at least 8 characters.');return;}
  if(reset.password!==reset.again){toast.error('The two passwords are not the same.');return;}
  setBusy(true);try{await post({action:'reset-password',username:reset.user.username,password:reset.password,revision:reset.user.revision});setReset(null);await q.refetch();toast.success('Password changed');}catch(err){toast.error((err as Error).message);}finally{setBusy(false);}
 }

 if(q.error)return <section className="hr-page"><h1>Users & Roles</h1><p className="hr-error">{q.error.message}</p></section>;
 const users=q.data?.users||[];
 const columns=(section:string)=>section==='hr'?['view','add','edit','approve','delete','reports']:['view','add','edit','delete'];

 if(draft){
  const count=Object.keys(draft.permissions.modules).length,all=draft.permissions.datasets.includes('*'),allUnits=draft.permissions.units.includes('*');
  return <section className="hr-page"><h1>{draft.revision?`Edit ${roleLabel[draft.role]}: ${draft.username}`:`New ${roleLabel[draft.role]}`}</h1>
   <p className="ua-note">{draft.role==='admin'?'An Admin can make Users and see the activity of all Users. The rights ticked below are the most this Admin can give to the Users.':'A User can work only in the companies, locations and screens ticked below; every other menu stays hidden. Tick Utilities › Activity Log if the User may read its own activity.'}</p>
   {error&&<p className="hr-error" role="alert">{error}</p>}
   <form className="hr-editor" onSubmit={save}>
    <div className="hr-fields">
     <label>Login ID<input required disabled={!!draft.revision||busy} autoComplete="off" value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value.trim()})}/><small>Letters, digits, . _ - ; this is typed on the sign-in page.</small></label>
     <label>Full name<input autoComplete="off" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
     <label>{draft.revision?'New password (leave blank to keep)':'Password'}<input type="password" autoComplete="new-password" minLength={8} required={!draft.revision} value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})}/><small>At least 8 characters.</small></label>
     <label>Status<span className="ua-quick"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/> Active (can sign in)</span></label>
    </div>
    {!draft.revision&&superAdmin&&<div className="ua-role"><b>Role</b>
     <label><input type="radio" name="role" checked={draft.role==='user'} onChange={()=>setDraft({...draft,role:'user'})}/> User</label>
     <label><input type="radio" name="role" checked={draft.role==='admin'} onChange={()=>setDraft({...draft,role:'admin'})}/> Admin</label></div>}
    <div className="ua-two">
     <div className="ua-box"><h3>Companies / years</h3>
      <div className="ua-mini">{canAllCompanies&&<label><input type="checkbox" checked={all} onChange={e=>setList('datasets',e.target.checked?['*']:[dataset])}/> All companies</label>}
       {!all&&<><input placeholder="Find a company" value={companyFind} onChange={e=>setCompanyFind(e.target.value)}/><button type="button" onClick={()=>setList('datasets',grantable.map(c=>c.key))}>Select all</button><button type="button" onClick={()=>setList('datasets',[])}>Clear</button></>}</div>
      {!all&&<div className="ua-list">{shownCompanies.map(c=><label key={c.key}><input type="checkbox" checked={draft.permissions.datasets.includes(c.key)} onChange={e=>toggleList('datasets',c.key,e.target.checked)}/> {c.label}</label>)}{!shownCompanies.length&&<small>No company.</small>}</div>}
      <small>{all?'Every company.':`${draft.permissions.datasets.length} selected.`}</small></div>
     <div className="ua-box"><h3>Locations (units)</h3>
      <div className="ua-mini">{canAllUnits&&<label><input type="checkbox" checked={allUnits} onChange={e=>setList('units',e.target.checked?['*']:[])}/> All locations</label>}</div>
      {!allUnits&&<div className="ua-list">{locations.filter(canUnit).map(l=><label key={l}><input type="checkbox" checked={draft.permissions.units.includes(l)} onChange={e=>toggleList('units',l,e.target.checked)}/> {l}</label>)}{!locations.length&&<small>This company has no locations in Location Entry.</small>}</div>}
      <small>{allUnits?'Every location of the chosen companies.':`${draft.permissions.units.length} selected.`}</small></div>
    </div>
    <div className="ua-matrix-head"><h2>Rights on the screens</h2><span className="ua-count">{count} screen{count===1?'':'s'} with rights</span>
     <button type="button" onClick={()=>fill([...accessRows.keys()],'all')}>Full access</button><button type="button" onClick={()=>fill([...accessRows.keys()],'view')}>View only</button><button type="button" onClick={()=>fill([...accessRows.keys()],'none')}>Clear all</button></div>
    {sections.map(s=>{const cols=columns(s.id),n=s.rows.filter(r=>draft.permissions.modules[r.key]?.length).length;
     return <details className="ua-section" key={s.id} open={s.id==='master'||n>0}><summary>{s.label}<span className="ua-count">{n} of {s.rows.length}</span>
      <span className="ua-tools" onClick={e=>e.preventDefault()}><button type="button" onClick={()=>fill(s.rows.map(r=>r.key),'all')}>All</button><button type="button" onClick={()=>fill(s.rows.map(r=>r.key),'view')}>View only</button><button type="button" onClick={()=>fill(s.rows.map(r=>r.key),'none')}>None</button></span></summary>
      <table><thead><tr><th>Screen</th>{cols.map(c=><th key={c}>{c==='delete'&&s.id==='hr'?'Archive':rightLabel[c]}</th>)}</tr></thead>
       <tbody>{s.rows.map(r=><tr key={r.key}><td>{r.label}</td>{cols.map(c=>r.rights.includes(c)?<td key={c} className={canRight(r.key,c)?'':'locked'}><input type="checkbox" aria-label={`${r.label} ${rightLabel[c]}`} disabled={!canRight(r.key,c)} checked={!!draft.permissions.modules[r.key]?.includes(c)} onChange={e=>setRight(r.key,c,e.target.checked)}/></td>:<td key={c} className="na">–</td>)}</tr>)}</tbody></table></details>;})}
    <div className="hr-actions"><button disabled={busy}>{busy?'Saving…':'Save login'}</button><button type="button" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button></div>
   </form></section>;
 }

 return <section className="hr-page"><h1>Users & Roles</h1>
  <p className="ua-note">{superAdmin?'Make Admins and Users. An Admin can make Users and sees the activity of all Users; you see everybody’s activity.':'Make Users and choose what each can open and change. You can give only the rights you have.'} Every login keeps an activity log (Utilities › Activity Log). A login is made inactive, never deleted.{workspace?' Logins made here belong to this workspace ('+workspace+'): they sign in on the normal sign-in page and open it.':''}</p>
  {me?.readonly&&<p className="hr-note">This is the original workspace (read only). Logins are kept in the editable workspace: sign in with the editable password to make or change them.</p>}
  {(error||q.isPending)&&<p className={error?'hr-error':'hr-note'}>{error||'Loading…'}</p>}
  <div className="hr-actions">{superAdmin&&<button onClick={()=>{setError('');setDraft(blank('admin',dataset));}}>+ New Admin</button>}<button onClick={()=>{setError('');setDraft(blank('user',dataset));}}>+ New User</button><button onClick={()=>void q.refetch()}>Refresh</button></div>
  <div className="hr-scroll"><table className="ua-table"><thead><tr><th>Login ID</th><th>Name</th><th>Role</th><th>Companies</th><th>Locations</th><th>Screens</th><th>Status</th><th>Last sign-in</th><th>Made by</th><th>Actions</th></tr></thead>
   <tbody>{q.data?.superAdmin&&<tr><td><b>{q.data.superAdmin.username}</b></td><td>Super Admin</td><td><span className="ua-badge superadmin">Super Admin</span></td><td>All</td><td>All</td><td>Everything</td><td><span className="ua-badge user">Active</span></td><td>{when(q.data.superAdmin.lastLogin)}</td><td>Built in</td><td><small>Cannot be changed here</small></td></tr>}
    {users.map(u=><tr key={u.username}><td><b>{u.username}</b></td><td>{u.name||'—'}</td><td><span className={'ua-badge '+u.role}>{roleLabel[u.role]}</span></td>
     <td>{u.permissions.datasets.includes('*')?'All':u.permissions.datasets.length}</td><td>{u.permissions.units.includes('*')?'All':u.permissions.units.length}</td><td>{Object.keys(u.permissions.modules).length}</td>
     <td><span className={'ua-badge '+(u.active?'user':'off')}>{u.active?'Active':'Inactive'}</span></td><td>{when(u.lastLogin)}</td><td>{u.createdBy||'—'}</td>
     <td className="ua-actions">{u.manageable?<><button onClick={()=>edit(u)}>Edit</button> <button onClick={()=>setReset({user:u,password:'',again:''})}>Password</button> <button onClick={()=>void toggleActive(u)}>{u.active?'Make inactive':'Activate'}</button></>:<small title="This login has rights, companies or locations that you do not have.">Only the Super Admin can change this login</small>}</td></tr>)}
    {!users.length&&!q.isPending&&<tr><td colSpan={10}>No login has been made yet. Use New {superAdmin?'Admin / New ':''}User.</td></tr>}</tbody></table></div>
  <Dialog open={!!reset} onOpenChange={o=>{if(!o)setReset(null);}}><DialogContent><DialogHeader><DialogTitle>New password for {reset?.user.username}</DialogTitle><DialogDescription>The login signs in with the new password from now on.</DialogDescription></DialogHeader>
   {reset&&<form className="hr-page" style={{border:0,padding:0}} onSubmit={savePassword}><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={reset.password} onChange={e=>setReset({...reset,password:e.target.value})}/></label><label>Type it again<input type="password" autoComplete="new-password" minLength={8} required value={reset.again} onChange={e=>setReset({...reset,again:e.target.value})}/></label><div className="hr-actions"><button disabled={busy}>Change password</button><button type="button" onClick={()=>setReset(null)}>Cancel</button></div></form>}</DialogContent></Dialog>
 </section>;
}
