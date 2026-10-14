import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {ownerId,db,checkOrigin,fail,readBounded,RequestError,drained} from '@/lib/server-store';
import {hrIdentity,constantEqual,initHr} from '@/lib/hr-store';
import {logActivity,asIdentity,listActivity,initActivity,activityKinds,type ActivityKind} from '@/lib/activity-store';
import {SUPER_ADMIN,roleOf,roleLabel,mayReadActivity} from '@/lib/access';
import {needScreen} from '@/lib/guard';
import {findItem,groupOf} from '@/lib/menu';
import type {Role} from '@/lib/hrm';
export const dynamic='force-dynamic';

// The activity log. GET: the rows the signed-in login may read (the Super Admin all, an Admin the Users' and its own, a User its own).
// POST: what the browser reports about the signed-in login (screen opened, printed, exported, report generated); the sign-in program
// reports sign-ins and sign-outs of any login with its secret key.
const clientEvent=z.object({event:z.enum(['open','print','export','generate']),screen:z.string().max(80).default(''),summary:z.string().max(200).default(''),dataset:z.string().regex(/^[a-zA-Z0-9_-]{0,64}$/).default('')}).strict();
const internalEvent=z.object({internal:z.literal(true),event:z.enum(['login','logout','login-failed']),username:z.string().trim().min(1).max(60),dataset:z.string().regex(/^[a-zA-Z0-9_-]{0,64}$/).default(''),summary:z.string().max(200).default('')}).strict();
const iso=(v:string|null)=>{if(!v)return undefined;if(!Number.isFinite(Date.parse(v)))throw new RequestError('Choose a valid date.');return new Date(v).toISOString();};

export async function GET(request:Request){try{
 const owner=await ownerId(),viewer=await hrIdentity(owner),q=new URL(request.url).searchParams;await initActivity();
 // A User reads its own activity only when the Activity Log was given to it (the Super Admin and the Admins always may).
 if(!mayReadActivity(viewer))await needScreen(owner,viewer,'utilities/activity','view');
 const kind=q.get('kind')||'';if(kind&&!activityKinds.includes(kind as ActivityKind))throw new RequestError('Unknown type.');
 const {rows,truncated}=await listActivity(owner,viewer,{user:q.get('user')||undefined,from:iso(q.get('from')),to:iso(q.get('to')),kind:kind||undefined,q:(q.get('q')||'').slice(0,80)||undefined,limit:Number(q.get('limit'))||500});
 // The names in the "User" box: the logins whose rows this viewer may read.
 await initHr();const people=await db().prepare('SELECT username,data FROM hr_users WHERE owner=?').bind(owner).all<{username:string;data:string}>();
 const known=new Map(people.results.map(p=>{const d=JSON.parse(p.data) as {role?:string;name?:string};return [p.username,{role:(d.role==='admin'?'admin':'user') as Role,name:d.name||''}];}));
 const scope=roleOf(viewer);const users=[{username:viewer.username,name:viewer.name||viewer.username,role:scope}];
 if(scope==='superadmin'){for(const [username,v] of known)users.push({username,name:v.name,role:v.role});}
 else if(scope==='admin'){for(const [username,v] of known)if(v.role==='user')users.push({username,name:v.name,role:v.role});}
 const names=Object.fromEntries(users.map(u=>[u.username,u.name]));
 return Response.json({rows:rows.map(r=>({...r,name:names[r.actor]||''})),truncated,users,me:{username:viewer.username,role:scope,roleLabel:roleLabel[scope]}},{headers:{'Cache-Control':'no-store'}});
}catch(e){return fail(e);}}

async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);
 if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,8000)));
 // The sign-in program: any login, but only with the secret key it was started with.
 if(input?.internal===true){
  const key=env.PAYROLL_INTERNAL_KEY||'';if(!key||!constantEqual(String(request.headers.get('x-payroll-internal')||''),key))throw new RequestError('This request is not allowed.',403);
  const v=internalEvent.parse(input);let role='';
  if(v.username===SUPER_ADMIN)role='superadmin';
  else{await initHr();const row=await db().prepare('SELECT data FROM hr_users WHERE owner=? AND username=?').bind(owner,v.username).first<{data:string}>();if(row)role=(JSON.parse(row.data) as {role?:string}).role==='admin'?'admin':'user';}
  const text={login:'Signed in','logout':'Signed out','login-failed':'Sign-in failed (wrong password)'}[v.event];
  await logActivity(owner,{username:v.username},{kind:v.event,summary:v.summary||text,dataset:v.dataset,ok:v.event!=='login-failed'},{role});
  return Response.json({ok:true});
 }
 const actor=await hrIdentity(owner),v=clientEvent.parse(input);
 const item=findItem(v.screen),group=groupOf(v.screen),where=item?`${group?.label?group.label+' › ':''}${item.label}`:v.screen;
 const summary=v.summary||(v.event==='open'?`Opened ${where}`:v.event==='print'?`Printed ${where}`:v.event==='export'?`Exported from ${where}`:`Generated a report in ${where}`);
 await logActivity(owner,asIdentity(actor),{kind:v.event,screen:v.screen,summary,dataset:v.dataset});
 return Response.json({ok:true});
}catch(e){if(e instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(e);}}
export const POST=drained(postHandler);
