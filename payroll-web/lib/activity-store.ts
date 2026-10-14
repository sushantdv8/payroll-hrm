import {headers} from 'next/headers';
import {db} from './server-store';
import {roleOf} from './access';
import type {HrIdentity,Role} from './hrm';
import {activityKinds,type ActivityInput,type ActivityKind,type ActivityRow} from './activity-types';
export {activityKinds,type ActivityInput,type ActivityKind,type ActivityRow};

// The activity log: one row for every sign-in, screen opened, record changed, print / export and refused attempt of every login.
// Rows are only ever added (nobody can edit or delete the log). The original workspace is read-only and is not written to.

let ready:Promise<unknown>|undefined;
export async function initActivity(){if(!ready)ready=db().exec(`CREATE TABLE IF NOT EXISTS activity_log(id TEXT PRIMARY KEY,owner TEXT NOT NULL,ts TEXT NOT NULL,actor TEXT NOT NULL,role TEXT NOT NULL DEFAULT '',dataset TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,screen TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',ok INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS activity_log_actor ON activity_log(owner,actor,ts);
CREATE INDEX IF NOT EXISTS activity_log_ts ON activity_log(owner,ts);`).catch(e=>{ready=undefined;throw e;});await ready;}

// Control characters (a NUL typed into an employee name, say) cannot go into a PostgreSQL text column and would lose the row.
const plain=(s:string)=>s.replace(/[\u0000-\u001F\u007F]/g,' ');
// Writes one row; a problem with the log never stops the work itself.
export async function logActivity(owner:string,actor:{username:string;role?:Role;admin?:boolean},e:ActivityInput,extra?:{role?:string}){
 try{
  if((await headers()).get('oai-authenticated-user-mode')==='original')return;
  await initActivity();
  const role=extra?.role??roleOf({role:actor.role,admin:!!actor.admin});
  await db().prepare('INSERT INTO activity_log(id,owner,ts,actor,role,dataset,kind,screen,summary,detail,ok) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,new Date().toISOString(),plain(actor.username).slice(0,60),role,plain(e.dataset||'').slice(0,64),e.kind,plain(e.screen||'').slice(0,80),plain(e.summary).slice(0,300),e.detail===undefined?'':JSON.stringify(e.detail).slice(0,4000),e.ok===false?0:1).run();
 }catch(error){console.error('The activity log could not be written',error);}
}
export const asIdentity=(a:HrIdentity)=>({username:a.username,role:a.role,admin:a.admin});
// Logs for the signed-in login without the caller having its identity at hand.
export async function logAs(owner:string,e:ActivityInput,actor:HrIdentity){await logActivity(owner,asIdentity(actor),e);}

// Which rows a login may read: the Super Admin all of them, an Admin the Users' rows and the own, a User the own.
export function visibleRoles(viewer:HrIdentity):string[]{
 const role=roleOf(viewer);
 return role==='superadmin'?['superadmin','admin','user','']:role==='admin'?['user']:[];
}
export type ActivityQuery={user?:string;from?:string;to?:string;kind?:string;q?:string;limit?:number};
export async function listActivity(owner:string,viewer:HrIdentity,query:ActivityQuery):Promise<{rows:ActivityRow[];truncated:boolean}>{
 await initActivity();
 const roles=visibleRoles(viewer);const where=['owner=?'],args:(string|number)[]=[owner];
 where.push(`(actor=?${roles.length?` OR role IN (${roles.map(()=>'?').join(',')})`:''})`);args.push(viewer.username,...roles);
 if(query.user){where.push('actor=?');args.push(query.user);}
 if(query.from){where.push('ts>=?');args.push(query.from);}
 if(query.to){where.push('ts<=?');args.push(query.to);}
 if(query.kind){where.push('kind=?');args.push(query.kind);}
 if(query.q){where.push('(lower(summary) LIKE ? OR lower(screen) LIKE ? OR lower(actor) LIKE ?)');const like='%'+query.q.toLowerCase().replace(/[%_]/g,'')+'%';args.push(like,like,like);}
 const limit=Math.min(Math.max(1,query.limit||500),5000);
 const r=await db().prepare(`SELECT id,ts,actor,role,dataset,kind,screen,summary,detail,ok FROM activity_log WHERE ${where.join(' AND ')} ORDER BY ts DESC,id DESC LIMIT ?`).bind(...args,limit+1).all<{id:string;ts:string;actor:string;role:string;dataset:string;kind:ActivityKind;screen:string;summary:string;detail:string;ok:number}>();
 const rows=r.results.slice(0,limit).map(x=>({...x,ok:!!x.ok}));
 return {rows,truncated:r.results.length>limit};
}
