import {headers} from 'next/headers';
import {z} from 'zod';
import {ownerId,db,checkOrigin,fail,readBounded,RequestError,validDataset,drained} from '@/lib/server-store';
import {datasetKey} from '@/lib/full-import';
import {sheetTemplates,defaultSheetRules,freshMonth,footerFields,type SheetDocument} from '@/lib/salary-sheets';
import {loadMonthlySheets} from '@/lib/salary-sheet-monthly-store';
import {previousMonth} from '@/lib/salary-sheets';
import {hrIdentity} from '@/lib/hr-store';
import {needScreen,refuse,note} from '@/lib/guard';
import {unitLimited} from '@/lib/unit-scope';
export const dynamic='force-dynamic';
const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const cell=z.union([z.string().max(2000),z.number().finite().min(-1e12).max(1e12),z.null()]);
const formulas=z.record(z.string().regex(/^[A-Z]{1,2}$/),z.string().max(500));
const docSchema=z.object({templateId:z.enum(sheetTemplates.map(t=>t.id) as [string,...string[]]),month,revision:z.number().int().nonnegative(),rows:z.array(z.object({card:z.string().min(1).max(80),values:z.record(z.string().regex(/^[A-Z]{1,2}$/),cell),formulas:formulas.optional(),overrides:z.record(z.string().regex(/^[A-Z]{1,2}$/),z.number().finite()).optional(),note:z.string().max(500).optional(),sourceRow:z.number().int().min(3).max(10000).optional()}).strict()).max(5000),
 rules:z.object({divisor:z.enum(['calendar','30','26']),pfPct:z.number().min(0).max(100),esiPct:z.number().min(0).max(100),employerEsiPct:z.number().min(0).max(100),ctcPct:z.number().min(0).max(100),claimEmployerCap:z.number().min(0),claimOtherCap:z.number().min(0),claimPriorityCap:z.number().min(0),comparisonMonth:month,summaryHeadcount:z.number().min(1).max(100000).optional()}).strict(),formulaEdits:formulas.optional(),sourceFile:z.string().max(200).optional(),generation:z.object({scope:z.string().min(1).max(200)}).strict().optional(),footerValues:z.record(z.string().regex(/^[A-Z]{1,2}\d{1,5}$/),cell).optional()}).strict();
const table='salary-sheet';
async function editable(){return (await headers()).get('oai-authenticated-user-mode')==='editable';}
// The monthly sheets hold the salary of the whole company on one sheet, so a login limited to some locations cannot open or change them.
async function sheetAccess(owner:string,right:'view'|'edit'){const actor=await hrIdentity(owner);await needScreen(owner,actor,'reports/monthly-sheets',right);if(unitLimited(actor))await refuse(owner,actor,'The monthly salary sheets cover the whole company, so they need a login that has All locations.','reports/monthly-sheets');}
export async function GET(request:Request){try{
 const owner=await ownerId(),u=new URL(request.url),dataset=datasetKey.parse(u.searchParams.get('dataset'));await validDataset(owner,dataset);await sheetAccess(owner,'view');const target=month.parse(u.searchParams.get('month'));
 const stored=await db().prepare('SELECT record_key,data,revision FROM master_records WHERE owner=? AND dataset=? AND table_name=? AND deleted=0 ORDER BY updated_at DESC').bind(owner,dataset,table).all<{record_key:string;data:string;revision:number}>();
 const history=stored.results.map(r=>({...JSON.parse(r.data),revision:r.revision}) as SheetDocument);
 const documents:Record<string,SheetDocument>={};
 for(const t of sheetTemplates){const current=history.find(d=>d.templateId===t.id&&d.month===target);const previous=history.filter(d=>d.templateId===t.id&&d.month<target).sort((a,b)=>b.month.localeCompare(a.month))[0];
  if(current)documents[t.id]=current;else if(previous)documents[t.id]=freshMonth(t,previous,target);
  else documents[t.id]={templateId:t.id,month:target,revision:0,rows:[],rules:defaultSheetRules(t,target)};
 }
 const source=u.searchParams.get('source')==='imported'?'imported':'application';
 if(source==='application'){
  const scope=z.string().min(1).max(200).parse(u.searchParams.get('scope')||'format'),comparisonMonth=month.parse(u.searchParams.get('compare')||previousMonth(target));
  // Reference rosters may apply before the sample's month; only identity / rules are used, never its monthly numbers.
  const references:Record<string,SheetDocument>={};for(const t of sheetTemplates)references[t.id]=history.filter(d=>d.templateId===t.id).sort((a,b)=>Math.abs(Date.parse(a.month+'-01')-Date.parse(target+'-01'))-Math.abs(Date.parse(b.month+'-01')-Date.parse(target+'-01')))[0];
  const result=await loadMonthlySheets(owner,dataset,target,comparisonMonth,scope,references);
  const saved=await db().prepare("SELECT data,revision FROM master_records WHERE owner=? AND dataset=? AND table_name='salary-sheet-generated' AND deleted=0").bind(owner,dataset).all<{data:string;revision:number}>();
  for(const r of saved.results){const doc={...JSON.parse(r.data),revision:r.revision} as SheetDocument;if(doc.month===target&&doc.generation?.scope===scope){if(u.searchParams.get('refresh')==='1')result.documents[doc.templateId].revision=doc.revision;else result.documents[doc.templateId]=doc;}}
  return Response.json({...result,editable:await editable(),source,history:history.map(d=>({templateId:d.templateId,month:d.month,rows:d.rows.length}))},{headers:{'Cache-Control':'no-store'}});
 }
 return Response.json({documents,editable:await editable(),source,history:history.map(d=>({templateId:d.templateId,month:d.month,rows:d.rows.length}))},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);if(!await editable())throw new RequestError('Sign in to the editable workspace to change these sheets.',403);await sheetAccess(owner,'edit');
 if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,8_000_000)));const dataset=datasetKey.parse(input.dataset);await validDataset(owner,dataset);const document=docSchema.parse(input.document) as SheetDocument;
 const t=sheetTemplates.find(t=>t.id===document.templateId)!;const allowed=new Set(t.columns.map(c=>c.key));
 if(Object.keys(document.footerValues||{}).some(k=>!(footerFields[t.id]||[]).some(f=>f.address===k)))throw new RequestError('Unknown summary input.');
 if(Object.keys(document.formulaEdits||{}).some(k=>!allowed.has(k)))throw new RequestError('Unknown calculation column.');
 for(const row of document.rows)if(Object.keys(row.values).some(k=>!allowed.has(k))||Object.keys(row.formulas||{}).some(k=>!allowed.has(k))||Object.keys(row.overrides||{}).some(k=>!allowed.has(k)))throw new RequestError('Unknown sheet column.');
 if(new Set(document.rows.map(r=>r.card)).size!==document.rows.length)throw new RequestError('Duplicate card numbers in this sheet.');
 const storageTable=document.generation?'salary-sheet-generated':table;
 const key=document.templateId+'|'+document.month+(document.generation?'|'+document.generation.scope:'');
 const previous=await db().prepare('SELECT id,revision FROM master_records WHERE owner=? AND dataset=? AND table_name=? AND record_key=?').bind(owner,dataset,storageTable,key).first<{id:string;revision:number}>();
 if((previous?.revision||0)!==document.revision)throw new RequestError('This sheet changed in another window. Reload before saving.',409);
 const revision=document.revision+1,data=JSON.stringify({...document,revision}),now=new Date().toISOString();
 const result=previous?await db().prepare('UPDATE master_records SET data=?,revision=?,deleted=0,updated_at=? WHERE id=? AND owner=? AND revision=?').bind(data,revision,now,previous.id,owner,document.revision).run():await db().prepare("INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,?,?,?,'entered',?,0,?)").bind(crypto.randomUUID(),owner,dataset,storageTable,key,data,revision,now).run();
 if(result.meta.changes!==1)throw new RequestError('This sheet changed in another window. Reload before saving.',409);
 await note(owner,'edit',`Saved the ${document.templateId} salary sheet for ${document.month}`,{screen:'reports/monthly-sheets',dataset});
 return Response.json({document:{...document,revision}});
}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(error);}}
export const POST=drained(postHandler);
