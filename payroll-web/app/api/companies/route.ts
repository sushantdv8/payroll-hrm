import {ownerId,db,fail} from '@/lib/server-store';
import {hrIdentity} from '@/lib/hr-store';
import type {FullManifest} from '@/lib/full-import';
import {companyLabel,companyParts} from '@/lib/company-groups';
export const dynamic='force-dynamic';

// The companies (and years) offered by the sign-in window: the imported companies, then the manually kept records.
// The sign-in program asks this before anybody is signed in (as the Super Admin); a signed-in login sees only the companies assigned to it.
export async function GET(){try{
 const owner=await ownerId();const actor=await hrIdentity(owner);
 const rows=await db().prepare("SELECT dataset_key,manifest FROM source_datasets WHERE owner=? AND status='complete' ORDER BY dataset_key").bind(owner).all<{dataset_key:string;manifest:string}>();
 // year / place: the sign-in page's separate Session and Location choices.
 const entry=(key:string,companyName:string,status:string)=>{const d={key,companyName,status};return {key,label:companyLabel(d),...companyParts(d)};};
 const companies=rows.results.map(r=>{const m=JSON.parse(r.manifest) as FullManifest;return entry(r.dataset_key,m.dataset.companyName,'complete');});
 companies.push(entry('manual','Manual records','manual'));
 return Response.json({companies:companies.filter(c=>actor.admin||actor.permissions.datasets.includes('*')||actor.permissions.datasets.includes(c.key))},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
