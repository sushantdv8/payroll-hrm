'use client';
import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {toast} from 'sonner';
import {requestJson} from '@/lib/client-api';
import {hrDirect} from '@/lib/access';
import {useCanOpen,useIdentity} from '@/components/access-context';

// Employee document expiry reminders: documents (Employee Documents, with an expiry date) that have expired or expire
// within 30 days. Read from the Documents / Expiry report, so each user only gets reminders for the units and the
// documents the user is allowed to see. Shown on the HR Dashboard and, once per sign-in window, as a notice on opening.
type Report={columns:string[];rows:string[][]};
export type ExpiryRow={paycode:string;name:string;department:string;category:string;file:string;expiry:string;status:string;days:number};
const today=()=>new Date().toISOString().slice(0,10);
const dayNumber=(date:string)=>Math.round(Date.parse(date+'T00:00:00Z')/864e5);

export function useDocumentExpiry(dataset:string,enabled=true){
 return useQuery({queryKey:['hr-doc-expiry',dataset],enabled,retry:false,refetchOnWindowFocus:false,staleTime:5*60000,queryFn:async({signal}):Promise<ExpiryRow[]>=>{
  const r=await requestJson<Report>('/api/hr-reports?'+new URLSearchParams({dataset,report:'documents'}),{signal});
  const at=(name:string)=>r.columns.indexOf(name);const [p,n,d,c,f,x,s]=['Paycode','Employee','Department','Category','File','Expiry date','Status'].map(at);
  const now=dayNumber(today());
  return r.rows.filter(row=>row[s]&&row[s]!=='Current'&&row[x]).map(row=>({paycode:String(row[p]??''),name:String(row[n]??''),department:String(row[d]??''),category:String(row[c]??''),file:String(row[f]??''),expiry:String(row[x]),status:String(row[s]),days:dayNumber(String(row[x]))-now})).sort((a,b)=>a.days-b.days);
 }});
}

const when=(days:number)=>days<0?`expired ${-days} day${days===-1?'':'s'} ago`:days===0?'expires today':`expires in ${days} day${days===1?'':'s'}`;

// HR Dashboard panel.
export function DocumentExpiryPanel({dataset}:{dataset:string}){
 const identity=useIdentity();const q=useDocumentExpiry(dataset,!!identity&&hrDirect(identity,'documents'));const rows=q.data||[];const expired=rows.filter(r=>r.days<0).length;
 if(q.error||q.isPending)return null;
 return <div className="hr-dash-panel hr-dash-expiry"><h2>Document expiry reminders<em>{rows.length}</em></h2>
  {rows.length===0?<p className="hr-dash-empty">No document has expired or expires within 30 days.</p>
   :<><p className="hr-dash-empty">{expired} expired · {rows.length-expired} expiring within 30 days</p><ul>{rows.slice(0,25).map((r,i)=><li key={i}><div><span>{r.paycode} · {r.name} — {r.category||r.file}</span><b style={{color:r.days<0?'#b00020':'#9a6700'}}>{r.expiry} ({when(r.days)})</b></div></li>)}</ul>
   {rows.length>25&&<p className="hr-dash-empty">{rows.length-25} more: see Reports › Documents / Expiry.</p>}</>}</div>;
}

// Notice shown once per browser tab and company when something has expired or is about to.
export function DocumentExpiryAlert({dataset,enabled,onOpen}:{dataset:string;enabled:boolean;onOpen:(screen:string)=>unknown}){
 const q=useDocumentExpiry(dataset,enabled);const canView=useCanOpen()('hr/dashboard');
 useEffect(()=>{
  const rows=q.data;if(!rows?.length)return;const key='hr-doc-expiry-shown:'+dataset;
  try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');}catch{/* storage blocked: the notice may repeat */}
  const expired=rows.filter(r=>r.days<0).length;
  toast.warning(`Employee documents: ${expired} expired, ${rows.length-expired} expiring within 30 days.`,{duration:12000,action:canView?{label:'View',onClick:()=>{onOpen('hr/dashboard');}}:undefined});
 },[q.data,dataset,onOpen,canView]);
 return null;
}
