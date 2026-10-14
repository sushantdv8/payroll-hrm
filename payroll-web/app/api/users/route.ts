import {z} from 'zod';
import {ownerId,db,checkOrigin,fail,readBounded,RequestError,drained} from '@/lib/server-store';
import {hrIdentity,initHr,passwordHash,constantEqual} from '@/lib/hr-store';
import {logActivity,asIdentity,initActivity} from '@/lib/activity-store';
import {SUPER_ADMIN,roleOf,roleLabel,normalizeModules,beyondGrant} from '@/lib/access';
import type {HrIdentity,HrPermissions,Role} from '@/lib/hrm';
export const dynamic='force-dynamic';

// Logins of the program. The Super Admin (admin01) makes Admins and Users; an Admin makes Users. A login's rights are the ticks chosen when it is made
// (lib/access.ts); nobody can give more than they have. Logins are never deleted - they are made inactive - so their activity log stays.
type Stored=HrPermissions&{role?:string;name?:string;createdBy?:string;createdAt?:string};
const username=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{2,39}$/,'Login ID: 3 to 40 letters, digits, . _ - and it must start with a letter.');
const scope=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).or(z.literal('*'));
const password=z.string().min(8,'The password needs at least 8 characters.').max(200);
const permissions=z.object({datasets:z.array(scope).min(1,'Choose at least one company.').max(100),units:z.array(z.string().max(200)).min(1,'Choose at least one location (or All).').max(200),modules:z.record(z.string().max(80),z.array(z.string().max(20)).max(8))}).strict();
const saveInput=z.object({action:z.literal('save'),user:z.object({username,name:z.string().trim().max(80).default(''),role:z.enum(['admin','user']),password:password.or(z.literal('')),active:z.boolean(),revision:z.number().int().min(0),permissions}).strict()}).strict();
const activeInput=z.object({action:z.literal('set-active'),username,active:z.boolean(),revision:z.number().int().min(0)}).strict();
const resetInput=z.object({action:z.literal('reset-password'),username,password,revision:z.number().int().min(0)}).strict();
const changeInput=z.object({action:z.literal('change-password'),current:z.string().max(200),password}).strict();

const stored=(raw:string)=>JSON.parse(raw) as Stored;
const roleOfRow=(d:Stored):Role=>d.role==='admin'?'admin':'user';
const permsOf=(d:Stored):HrPermissions=>({datasets:d.datasets||[],units:d.units||[],modules:d.modules||{}});
// Who may manage a login of this role: the Super Admin any, an Admin only Users.
function mayManage(actor:HrIdentity,target:Role){const r=roleOf(actor);return r==='superadmin'||(r==='admin'&&target==='user');}
// An Admin manages only the Users whose rights, companies and locations it has itself - otherwise it could take over a login that can do more than the Admin can
// (reset its password and sign in as it). Such a login stays with the Super Admin.
const outside=(actor:HrIdentity,d:Stored)=>beyondGrant(actor,permsOf(d));
const outsideMessage='This login has rights you do not have, so only the Super Admin can change it.';
function needManager(actor:HrIdentity){if(roleOf(actor)==='user')throw new RequestError('Only the Super Admin and Admins can manage logins.',403);if(actor.readonly)throw new RequestError('Original workspace is read-only.',403);}

export async function GET(){try{
 const owner=await ownerId(),actor=await hrIdentity(owner);needManager(actor);await initHr();await initActivity();
 const rows=await db().prepare('SELECT username,data,revision,active FROM hr_users WHERE owner=? ORDER BY username COLLATE NOCASE').bind(owner).all<{username:string;data:string;revision:number;active:number}>();
 const seen=await db().prepare("SELECT actor,MAX(ts) AS last FROM activity_log WHERE owner=? AND kind='login' GROUP BY actor").bind(owner).all<{actor:string;last:string}>();const last=new Map(seen.results.map(r=>[r.actor,r.last]));
 const users=rows.results.map(r=>({username:r.username,data:stored(r.data),revision:r.revision,active:!!r.active})).filter(u=>mayManage(actor,roleOfRow(u.data))).map(u=>({username:u.username,name:u.data.name||'',role:roleOfRow(u.data),active:u.active,createdBy:u.data.createdBy||'',createdAt:u.data.createdAt||'',lastLogin:last.get(u.username)||'',revision:u.revision,manageable:!outside(actor,u.data),permissions:permsOf(u.data)}));
 return Response.json({me:{username:actor.username,name:actor.name||actor.username,role:roleOf(actor)},users,superAdmin:roleOf(actor)==='superadmin'?{username:SUPER_ADMIN,lastLogin:last.get(SUPER_ADMIN)||''}:null},{headers:{'Cache-Control':'no-store'}});
}catch(e){return fail(e);}}

async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);const actor=await hrIdentity(owner);await initHr();
 if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,100000)));const now=new Date().toISOString();
 const log=(summary:string,detail?:unknown)=>logActivity(owner,asIdentity(actor),{kind:'user',screen:'utilities/users',summary,detail});

 // A login changes its own password (any role except the Super Admin, whose password is kept by the sign-in program).
 if(input?.action==='change-password'){
  const v=changeInput.parse(input);if(actor.username===SUPER_ADMIN)throw new RequestError('The Super Admin password is kept by the sign-in program and cannot be changed here.',400);
  const row=await db().prepare('SELECT password_hash,salt,revision FROM hr_users WHERE owner=? AND username=? AND active=1').bind(owner,actor.username).first<{password_hash:string;salt:string;revision:number}>();
  if(!row||!constantEqual(await passwordHash(v.current,row.salt),row.password_hash))throw new RequestError('The current password is wrong.',403);
  const salt=crypto.randomUUID();const result=await db().prepare('UPDATE hr_users SET password_hash=?,salt=?,revision=revision+1 WHERE owner=? AND username=? AND revision=?').bind(await passwordHash(v.password,salt),salt,owner,actor.username,row.revision).run();
  if(result.meta.changes!==1)throw new RequestError('Your account changed in another window. Try again.',409);
  await log('Changed own password');return Response.json({ok:true});
 }
 needManager(actor);

 if(input?.action==='set-active'||input?.action==='reset-password'){
  const v=input.action==='set-active'?activeInput.parse(input):resetInput.parse(input);
  if(v.username.toLowerCase()===SUPER_ADMIN)throw new RequestError('The Super Admin login cannot be changed here.',400);
  const row=await db().prepare('SELECT data,revision FROM hr_users WHERE owner=? AND username=?').bind(owner,v.username).first<{data:string;revision:number}>();if(!row)throw new RequestError('This login does not exist.',404);
  const data=stored(row.data),target=roleOfRow(data);if(!mayManage(actor,target))throw new RequestError('You cannot manage this login.',403);
  if(outside(actor,data))throw new RequestError(outsideMessage,403);
  if(row.revision!==v.revision)throw new RequestError('This login changed in another window. Reload first.',409);
  const result='active' in v?await db().prepare('UPDATE hr_users SET active=?,revision=revision+1 WHERE owner=? AND username=? AND revision=?').bind(v.active?1:0,owner,v.username,row.revision).run()
   :await (async()=>{const salt=crypto.randomUUID();return db().prepare('UPDATE hr_users SET password_hash=?,salt=?,revision=revision+1 WHERE owner=? AND username=? AND revision=?').bind(await passwordHash(v.password,salt),salt,owner,v.username,row.revision).run();})();
  if(result.meta.changes!==1)throw new RequestError('This login changed in another window. Reload first.',409);
  await log('active' in v?`${v.active?'Activated':'Deactivated'} ${roleLabel[target]} ${v.username}`:`Reset the password of ${roleLabel[target]} ${v.username}`);return Response.json({ok:true});
 }

 if(input?.action==='save'){
  const v=saveInput.parse(input).user;
  if(v.username.toLowerCase()===SUPER_ADMIN)throw new RequestError('The Super Admin login is reserved.',400);
  if(!mayManage(actor,v.role))throw new RequestError(v.role==='admin'?'Only the Super Admin can make an Admin.':'You cannot manage this login.',403);
  const normal=normalizeModules(v.permissions.modules);if(normal.error)throw new RequestError(normal.error);
  const wanted:HrPermissions={datasets:[...new Set(v.permissions.datasets)],units:[...new Set(v.permissions.units)],modules:normal.modules};
  const denied=beyondGrant(actor,wanted);if(denied)throw new RequestError(denied,403);
  const same=await db().prepare('SELECT username,data,revision,password_hash,salt FROM hr_users WHERE owner=? AND lower(username)=lower(?)').bind(owner,v.username).first<{username:string;data:string;revision:number;password_hash:string;salt:string}>();
  if(same&&same.username!==v.username)throw new RequestError(`The login ID already exists as "${same.username}".`,409);
  const old=same?stored(same.data):undefined;
  if(old&&roleOfRow(old)!==v.role)throw new RequestError('The role of a login cannot be changed. Make a new login instead.',409);
  if(old&&!mayManage(actor,roleOfRow(old)))throw new RequestError('You cannot manage this login.',403);
  if(old&&outside(actor,old))throw new RequestError(outsideMessage,403);
  if((same?.revision||0)!==v.revision)throw new RequestError('This login changed in another window. Reload first.',409);
  if(!same&&!v.password)throw new RequestError('Enter a password for the new login.');
  const data:Stored={...wanted,role:v.role,name:v.name,createdBy:old?.createdBy||actor.username,createdAt:old?.createdAt||now};
  const salt=v.password?crypto.randomUUID():same!.salt,hash=v.password?await passwordHash(v.password,salt):same!.password_hash;
  const result=same?await db().prepare('UPDATE hr_users SET password_hash=?,salt=?,data=?,revision=revision+1,active=? WHERE owner=? AND username=? AND revision=?').bind(hash,salt,JSON.stringify(data),v.active?1:0,owner,v.username,same.revision).run()
   :await db().prepare('INSERT INTO hr_users(owner,username,password_hash,salt,data,revision,active) VALUES(?,?,?,?,?,1,?)').bind(owner,v.username,hash,salt,JSON.stringify(data),v.active?1:0).run();
  if(result.meta.changes!==1)throw new RequestError('This login changed in another window. Reload first.',409);
  const keys=Object.keys(wanted.modules).length;
  await log(`${same?'Changed':'Created'} ${roleLabel[v.role]} ${v.username}${v.password?(same?' (new password)':''):''}`,{role:v.role,active:v.active,companies:wanted.datasets,units:wanted.units,screens:keys});
  return Response.json({ok:true});
 }
 throw new RequestError('Unknown action.');
}catch(e){if(e instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});if(e instanceof Error&&/UNIQUE|duplicate key/i.test(e.message))return Response.json({error:'This login ID is already taken.'},{status:409});return fail(e);}}
export const POST=drained(postHandler);
