import {monthSchema,monthDays,type AttendanceMonth} from './payroll';
import {db,ensureEmployee,RequestError} from './server-store';
import {hrIdentity,hrEmployee,assertHr,hrRows,auditStatement,guardedWrite} from './hr-store';

// Saves one employee-month of attendance (Time Updation). Imported months may be modified here (the original stays
// in the source archive) but keep their source identity; their stored totals may exceed calendar days.
export async function saveAttendance(owner:string,input:unknown,now:string):Promise<AttendanceMonth>{
 const value=monthSchema.parse(input);const actor=await hrIdentity(owner),employee=await hrEmployee(owner,value.employeeId,actor);assertHr(actor,employee.dataset,'attendance','edit',employee.location);if((await hrRows(owner,employee.dataset,'exit')).some(r=>r.employeeId===employee.id&&r.status==='settled'&&String(r.data.lastWorkingDate).slice(0,7)===value.month))throw new RequestError('Final settlement is recorded. Final-month attendance is locked.',409);const count=monthDays(value.month);
 const stored=await db().prepare('SELECT id,revision,data FROM attendance WHERE owner=? AND employee_id=? AND month=?').bind(owner,value.employeeId,value.month).first<{id:string;revision:number;data:string}>();
 const storedData=stored?JSON.parse(stored.data) as {sourceDataset?:string;sourceKey?:string}:null;const imported=!!storedData?.sourceDataset;
 if(value.sourceDataset||value.sourceKey){if(!imported||value.sourceDataset!==storedData!.sourceDataset||value.sourceKey!==storedData!.sourceKey)throw new RequestError('The source of imported attendance cannot be changed.',409);}else if(imported)throw new RequestError('Attendance changed in another window. Reload before saving.',409);
 if(value.days.length!==count||new Set(value.days.map(d=>d.day)).size!==count||value.days.some(d=>d.day>count)||(!imported&&Object.values(value.totals).some(v=>v!==''&&v>count))||new Set(value.leaveLedger.map(l=>l.code)).size!==value.leaveLedger.length)throw new RequestError('Check the days and totals for this month.');
 if((stored?.revision||0)!==value.revision)throw new RequestError('Attendance changed in another window. Reload before saving.',409);
 const revision=value.revision+1;const data=JSON.stringify({...value,revision});
 const statement=stored?db().prepare('UPDATE attendance SET data=?,revision=?,updated_at=? WHERE id=? AND owner=? AND revision=?').bind(data,revision,now,stored.id,owner,value.revision):db().prepare('INSERT INTO attendance(id,owner,employee_id,month,data,revision,updated_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,value.employeeId,value.month,data,revision,now);
 await db().batch(guardedWrite(stored?'EXISTS(SELECT 1 FROM attendance WHERE owner=? AND employee_id=? AND month=? AND revision=?)':'NOT EXISTS(SELECT 1 FROM attendance WHERE owner=? AND employee_id=? AND month=?)',[owner,value.employeeId,value.month,...(stored?[value.revision]:[])],[statement,auditStatement(owner,employee.dataset,employee.id,'attendance',actor.username,'attendance-save',{month:value.month,revision})]));
 return {...value,revision};
}
