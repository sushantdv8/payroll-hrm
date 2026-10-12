import {hrIdentity,hrEmployees,assertHr} from '@/lib/hr-store';
import {backupBundleSchema} from '@/lib/backup';
import {ownerId,db,checkOrigin,readBounded,RequestError,fail} from '@/lib/server-store';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
  const owner=await ownerId();
  if(new URL(request.url).searchParams.get('view')==='salaries'){
    const url=new URL(request.url);const dataset=url.searchParams.get('dataset')||'om_01_26';const month=url.searchParams.get('month')||'2026-08';if(!/^[a-zA-Z0-9_-]{1,64}$/.test(dataset)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RequestError('Choose a valid dataset and month.');
    const rows=await db().prepare("SELECT s.data FROM salary_snapshots s JOIN employees e ON e.id=s.employee_id AND e.owner=s.owner WHERE s.owner=? AND e.dataset=? AND s.month=? AND e.deleted=0 AND (s.import_id IS NULL OR s.import_id IN (SELECT id FROM source_datasets WHERE status='complete')) AND (e.import_id IS NULL OR e.import_id IN (SELECT id FROM source_datasets WHERE status='complete')) ORDER BY s.month DESC").bind(owner,dataset,month).all<{data:string}>();
    const actor=await hrIdentity(owner);assertHr(actor,dataset,'payroll');const ids=new Set((await hrEmployees(owner,dataset,actor)).map(e=>e.id));return Response.json({salaries:rows.results.map(r=>JSON.parse(r.data)).filter(s=>ids.has(s.employeeId))},{headers:{'Cache-Control':'no-store'}});
  }
  const actor=await hrIdentity(owner);if(!actor.admin)return Response.json({settings:null,importId:null});const row=await db().prepare('SELECT data,import_id FROM backup_settings WHERE owner=?').bind(owner).first<{data:string;import_id:string}>();
  return Response.json({settings:row?JSON.parse(row.data):null,importId:row?.import_id||null},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}

export async function POST(request:Request){try{await ownerId();checkOrigin(request);throw new RequestError('Use the full data import screen to load or resume this database.',409);}catch(error){return fail(error);}}
