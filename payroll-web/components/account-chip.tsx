'use client';
import './hr-workspace.css';
import './users-admin.css';
import {useState} from 'react';
import {toast} from 'sonner';
import {requestJson} from '@/lib/client-api';
import {roleLabel,roleOf} from '@/lib/access';
import type {HrIdentity} from '@/lib/hrm';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';

// Top right of the program: who is signed in, with what role, and a way to change the own password.
export function AccountChip({identity}:{identity?:HrIdentity}){
 const [open,setOpen]=useState(false),[current,setCurrent]=useState(''),[next,setNext]=useState(''),[again,setAgain]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!identity)return null;
 const role=roleOf(identity),name=identity.name||identity.username,builtIn=role==='superadmin';
 async function save(e:React.FormEvent){
  e.preventDefault();setError('');
  if(next.length<8){setError('The new password needs at least 8 characters.');return;}
  if(next!==again){setError('The two new passwords are not the same.');return;}
  setBusy(true);
  try{await requestJson('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'change-password',current,password:next})});setCurrent('');setNext('');setAgain('');setOpen(false);toast.success('Your password was changed');}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 return <>
  <button type="button" className="account-chip" title="My account" onClick={()=>{setError('');setOpen(true);}}><i>{name.slice(0,1).toUpperCase()}</i><span>{name}<small>{roleLabel[role]}</small></span></button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>My account</DialogTitle><DialogDescription>Signed in as <b>{identity.username}</b> · {roleLabel[role]}{identity.readonly?' · original workspace (read only)':''}</DialogDescription></DialogHeader>
   {builtIn?<p className="hr-note">The Super Admin password is kept by the sign-in program of this computer; it is not changed here.</p>
    :<form className="hr-page" style={{border:0,padding:0}} onSubmit={save}><h2 style={{margin:'0 0 4px',fontSize:16}}>Change password</h2>
     {error&&<p className="hr-error" role="alert">{error}</p>}
     <label>Current password<input type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)}/></label>
     <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={next} onChange={e=>setNext(e.target.value)}/></label>
     <label>New password again<input type="password" autoComplete="new-password" minLength={8} required value={again} onChange={e=>setAgain(e.target.value)}/></label>
     <div className="hr-actions"><button disabled={busy}>{busy?'Saving…':'Change password'}</button><button type="button" onClick={()=>setOpen(false)}>Close</button></div></form>}
  </DialogContent></Dialog></>;
}
