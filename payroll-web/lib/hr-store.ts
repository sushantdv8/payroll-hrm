import {headers} from 'next/headers';
import {db,RequestError,visibleImport} from './server-store';
import {defaultHrSettings,settingsSchema,type HrIdentity,type HrPermissions,type HrRecord,type HrSettings} from './hrm';
import {SUPER_ADMIN,canHrModule} from './access';
import type {Employee,AttendanceMonth} from './payroll';
let setup:Promise<unknown>|undefined;
export async function initHr(){if(!setup)setup=db().exec(`CREATE TABLE IF NOT EXISTS hr_records(id TEXT PRIMARY KEY,owner TEXT NOT NULL,dataset TEXT NOT NULL,module TEXT NOT NULL,employee_id TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',data TEXT NOT NULL,created_by TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hr_records_scope ON hr_records(owner,dataset,module,deleted);
CREATE INDEX IF NOT EXISTS hr_records_employee ON hr_records(owner,employee_id,module,status);
CREATE TABLE IF NOT EXISTS hr_audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,dataset TEXT NOT NULL,record_id TEXT NOT NULL,module TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hr_audit_scope ON hr_audit(owner,dataset,created_at);
CREATE TABLE IF NOT EXISTS hr_settings(owner TEXT NOT NULL,dataset TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner,dataset));
CREATE TABLE IF NOT EXISTS hr_users(owner TEXT NOT NULL,username TEXT NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(owner,username));
CREATE TABLE IF NOT EXISTS hr_write_guard(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));`).catch(e=>{setup=undefined;throw e;});await setup;}
// Who is signed in: admin01 is the Super Admin (everything); the other logins are read from hr_users with their role and rights.
// One request asks for the identity several times (the gate, the route, the dataset check ...): it is read from the database once per request.
const identities=new WeakMap<object,Promise<HrIdentity>>();
export async function hrIdentity(owner:string):Promise<HrIdentity>{
 const h=await headers();let known=identities.get(h);
 if(!known){known=loadIdentity(owner,h);identities.set(h,known);known.catch(()=>identities.delete(h));}
 return known;
}
async function loadIdentity(owner:string,h:Awaited<ReturnType<typeof headers>>):Promise<HrIdentity>{
 const username=h.get('oai-authenticated-user-username')||SUPER_ADMIN,readonly=h.get('oai-authenticated-user-mode')==='original';
 if(username===SUPER_ADMIN)return {username,name:'Super Admin',role:'superadmin',admin:true,readonly,permissions:{datasets:['*'],units:['*'],modules:{'*':['view','add','edit','approve','delete','reports']}}};
 await initHr();const row=await db().prepare('SELECT data FROM hr_users WHERE owner=? AND username=? AND active=1').bind(owner,username).first<{data:string}>();if(!row)throw new RequestError('This user account is inactive. Sign in again.',403);
 const data=JSON.parse(row.data) as HrPermissions&{role?:string;name?:string};
 return {username,name:data.name||username,role:data.role==='admin'?'admin':'user',admin:false,readonly,permissions:{datasets:data.datasets||[],units:data.units||[],modules:data.modules||{}}};
}
export function canHr(actor:HrIdentity,module:string,action='view'){return canHrModule(actor,module,action);}
export function assertHr(actor:HrIdentity,dataset:string,module:string,action='view',unit?:string){
 if(!actor.admin&&!actor.permissions.datasets.includes('*')&&!actor.permissions.datasets.includes(dataset))throw new RequestError('This company is not assigned to your account.',403);
 if(!canHr(actor,module,action))throw new RequestError('You do not have '+action+' permission for '+module+'.',403);
 if(unit!==undefined&&!unitAllowed(actor,unit))throw new RequestError('This unit is not assigned to your account.',403);
}
export function unitAllowed(actor:HrIdentity,unit:string){return actor.admin||actor.permissions.units.includes('*')||actor.permissions.units.includes(unit);}
export async function hrEmployees(owner:string,dataset:string,actor?:HrIdentity){const a=actor||await hrIdentity(owner);assertHr(a,dataset,'employees');const r=await db().prepare(`SELECT data,revision,dataset FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND ${visibleImport}`).bind(owner,dataset).all<{data:string;revision:number;dataset:string}>();return r.results.map(r=>({...JSON.parse(r.data),revision:r.revision,dataset:r.dataset}) as Employee).filter(e=>unitAllowed(a,e.location));}
export async function hrEmployee(owner:string,id:string,actor?:HrIdentity){const r=await db().prepare('SELECT data,revision,dataset FROM employees WHERE owner=? AND id=? AND deleted=0').bind(owner,id).first<{data:string;revision:number;dataset:string}>();if(!r)throw new RequestError('Employee not found.',404);const e={...JSON.parse(r.data),revision:r.revision,dataset:r.dataset} as Employee;const a=actor||await hrIdentity(owner);if(!a.admin&&!a.permissions.datasets.includes('*')&&!a.permissions.datasets.includes(e.dataset)||!unitAllowed(a,e.location))throw new RequestError('Employee is outside your assigned units.',403);return e;}
export async function hrRows(owner:string,dataset:string,module?:string,includeArchived=false):Promise<HrRecord[]>{await initHr();const r=await db().prepare('SELECT * FROM hr_records WHERE owner=? AND dataset=?'+(includeArchived?'':' AND deleted=0')+(module?' AND module=?':'')+' ORDER BY updated_at DESC').bind(owner,dataset,...(module?[module]:[])).all<{id:string;dataset:string;module:string;employee_id:string;unit:string;status:string;revision:number;data:string;created_by:string;updated_at:string;deleted:number}>();return r.results.map(r=>({id:r.id,dataset:r.dataset,module:r.module,employeeId:r.employee_id,unit:r.unit,status:r.status,revision:r.revision,data:JSON.parse(r.data),createdBy:r.created_by,updatedAt:r.updated_at,deleted:!!r.deleted}));}
export async function hrSettings(owner:string,dataset:string){await initHr();const r=await db().prepare('SELECT data,revision FROM hr_settings WHERE owner=? AND dataset=?').bind(owner,dataset).first<{data:string;revision:number}>();return {settings:r?settingsSchema.parse({...defaultHrSettings,...JSON.parse(r.data)}):{...defaultHrSettings},revision:r?.revision||0};}
export function auditStatement(owner:string,dataset:string,recordId:string,module:string,actor:string,action:string,data:unknown,revision?:number){return db().prepare('INSERT INTO hr_audit(id,owner,dataset,record_id,module,actor,action,data,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(revision?recordId+':'+revision:crypto.randomUUID(),owner,dataset,recordId,module,actor,action,JSON.stringify(data),new Date().toISOString());}
export async function hrAttendance(owner:string,employeeId:string,month:string):Promise<AttendanceMonth|null>{const r=await db().prepare('SELECT data,revision FROM attendance WHERE owner=? AND employee_id=? AND month=?').bind(owner,employeeId,month).first<{data:string;revision:number}>();return r?{...JSON.parse(r.data),revision:r.revision}:null;}
export function guardedWrite(condition:string,bindings:(string|number)[],statements:D1PreparedStatement[]){const id=crypto.randomUUID();return [db().prepare('INSERT INTO hr_write_guard(id,ok) SELECT CAST(? AS TEXT),CASE WHEN '+condition+' THEN 1 ELSE 0 END').bind(id,...bindings),...statements,db().prepare('DELETE FROM hr_write_guard WHERE id=?').bind(id)];}
export async function passwordHash(password:string,salt:string){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},material,256);return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function constantEqual(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
// What a signed-in Admin / User can reach at all. Each of these checks the rights of its own screens (lib/access.ts) before it reads or writes;
// everything else (the original source tables ...) is for the Super Admin only.
const reachable=['/api/records','/api/datasets','/api/backup','/api/companies','/api/masters','/api/time-office','/api/register','/api/salaries','/api/salary-check','/api/salary-sheets','/api/salary-slips','/api/rate-history','/api/employee-extras','/api/images','/api/biometric','/api/full-import','/api/users','/api/activity'];
export async function restrictLegacy(owner:string){
 const h=await headers(),path=h.get('oai-authenticated-user-path')||'',method=h.get('oai-authenticated-user-method')||'GET';
 if(h.get('oai-authenticated-user-mode')==='original'&&method!=='GET'&&method!=='HEAD'&&path!=='/api/hr-login'&&path!=='/api/activity')throw new RequestError('Original workspace is read-only. Sign in to the editable workspace to change records.',403);
 const user=h.get('oai-authenticated-user-username');if(!user||user===SUPER_ADMIN)return;
 const actor=await hrIdentity(owner);
 // The sign-in program always says which path is asked for; without it the allow-list below cannot be applied, so a limited login is refused.
 if(!path)throw new RequestError('This request could not be checked. Sign in again.',403);
 if(path.startsWith('/api/hr')||reachable.includes(path))return;
 if(path.startsWith('/api/'))throw new RequestError('You do not have access to this function.',403);
 if(!actor.permissions.datasets.length)throw new RequestError('No company is assigned to this user.',403);
}
