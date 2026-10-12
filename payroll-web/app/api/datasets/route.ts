import {hrIdentity} from '@/lib/hr-store';
import {ownerId,db,fail} from '@/lib/server-store';
import type {DatasetSummary,FullManifest} from '@/lib/full-import';
export const dynamic='force-dynamic';
export async function GET(){try{const owner=await ownerId();const rows=await db().prepare('SELECT dataset_key,status,manifest FROM source_datasets WHERE owner=? ORDER BY dataset_key').bind(owner).all<{dataset_key:string;status:string;manifest:string}>();
 const datasets:DatasetSummary[]=rows.results.filter(r=>r.status==='complete').map(r=>{const m=JSON.parse(r.manifest) as FullManifest;return {key:r.dataset_key,companyName:m.dataset.companyName,year:m.dataset.year,status:r.status,counts:m.expected,settings:m.settings};});
 const old=await db().prepare('SELECT data FROM backup_settings WHERE owner=?').bind(owner).first<{data:string}>();if(old){const settings=JSON.parse(old.data);if(!datasets.some(d=>d.key===settings.sourceDataset))datasets.unshift({key:settings.sourceDataset,companyName:settings.companyName,year:2026,status:'sample',settings});}
 datasets.push({key:'manual',companyName:'Manual records',year:null,status:'manual'});
 const actor=await hrIdentity(owner);return Response.json({datasets:datasets.filter(d=>actor.admin||actor.permissions.datasets.includes('*')||actor.permissions.datasets.includes(d.key)),imports:actor.admin?rows.results.filter(r=>r.status!=='complete').map(r=>{const m=JSON.parse(r.manifest) as FullManifest;return {key:r.dataset_key,companyName:m.dataset.companyName,status:r.status};}):[]},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
