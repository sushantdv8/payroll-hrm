import {db,RequestError,visibleImport} from './server-store';
import {unitAllowed} from './hr-store';
import type {HrIdentity} from './hrm';

// A login that is limited to some locations works only with the employees of those locations, and with the records kept under their codes
// (original employee code = sourceKey, or the id of an employee made in this program). The Super Admin and a login with "All locations" are not limited.
export const unitLimited=(a:HrIdentity)=>!a.admin&&!a.permissions.units.includes('*');

export type EmployeeScope={ids:Set<string>;codes:Set<string>};
// The employees the login may see in this company, or null when the login is not limited to locations.
// A code counts as the login's own only when no employee of another location carries it too (a code is never shared with somebody outside the login's locations).
export async function employeeScope(owner:string,dataset:string,actor:HrIdentity):Promise<EmployeeScope|null>{
 if(!unitLimited(actor))return null;
 const rows=await db().prepare(`SELECT id,data FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND ${visibleImport}`).bind(owner,dataset).all<{id:string;data:string}>();
 const ids=new Set<string>(),codes=new Set<string>(),foreign=new Set<string>();
 for(const r of rows.results){const e=JSON.parse(r.data) as {location?:string;sourceKey?:string};const code=String(e.sourceKey||r.id);if(unitAllowed(actor,e.location||'')){ids.add(r.id);codes.add(code);}else foreign.add(code);}
 for(const code of foreign)codes.delete(code);
 return {ids,codes};
}
// Every employee of the company, whatever their location - for checks that must know whom an ID could also belong to. Never sent to the browser.
export async function allEmployees(owner:string,dataset:string){
 const rows=await db().prepare(`SELECT id,data FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND ${visibleImport}`).bind(owner,dataset).all<{id:string;data:string}>();
 return rows.results.map(r=>({id:r.id,...(JSON.parse(r.data) as {location?:string;cardNo?:string;paycode?:string})}));
}
// Keeps the entries of an object keyed by employee code that belong to the allowed employees.
export function onlyCodes<T>(scope:EmployeeScope|null,byCode:Record<string,T>):Record<string,T>{
 return scope?Object.fromEntries(Object.entries(byCode).filter(([code])=>scope.codes.has(code))):byCode;
}
export function needCode(scope:EmployeeScope|null,code:string){if(scope&&!scope.codes.has(code))throw new RequestError('This employee is outside your assigned locations.',403);}
