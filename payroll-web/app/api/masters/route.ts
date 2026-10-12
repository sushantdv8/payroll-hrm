import {masterDef,masterDefs,recordKey,cleanValues,trimCell,type MasterDef,type MasterRow,type MasterValues} from '@/lib/masters';
import {ownerId,db,checkOrigin,fail,readBounded,RequestError,validDataset} from '@/lib/server-store';
import {loadMasterRows as load} from '@/lib/master-store';
import {datasetKey} from '@/lib/full-import';
export const dynamic='force-dynamic';
const nameTables:Record<string,string>={departments:'tbdep',designations:'tbdes',locations:'tblocation',subCompanies:'tbsubcmp',banks:'tbbank',categories:'tbcat',shifts:'tbshift'};
async function scope(owner:string,def:MasterDef,dataset:unknown){if(def.global)return '_global';const key=datasetKey.parse(dataset);await validDataset(owner,key);return key;}


function sameName(a:string|null|undefined,b:string|null|undefined){return trimCell(a).toLowerCase()===trimCell(b).toLowerCase();}
function mostCommon(rows:MasterRow[],col:string){const counts=new Map<string,number>();for(const r of rows){const v=r.values[col];if(v!=null)counts.set(v,(counts.get(v)||0)+1);}let best:string|null=null,top=0;for(const [v,c] of counts)if(c>top){best=v;top=c;}return best;}

async function inUse(owner:string,dataset:string,def:MasterDef,row:MasterRow){
 if(def.employeeField&&def.nameCol){const name=trimCell(row.values[def.nameCol]);if(name){const used=await db().prepare("SELECT COUNT(*) n FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND lower(trim(json_extract(data,'$.'||?)))=lower(?)").bind(owner,dataset,def.employeeField,name).first<{n:number}>();if(used?.n)return `${used.n} ${used.n===1?'employee uses':'employees use'} this ${def.title.toLowerCase()}. Change them first.`;}}
 if(def.key.length===1){const code=trimCell(row.values[def.key[0]]);
  for(const other of Object.values(masterDefs)){const refs=other.fields.filter(f=>f.type==='lookup'&&f.lookup===def.table);if(!refs.length||(other.global&&!def.global))continue;const {rows}=await load(owner,dataset,other);const n=rows.filter(r=>refs.some(f=>trimCell(r.values[f.col])===code)).length;if(n)return `${n} ${other.title.toLowerCase()} ${n===1?'record uses':'records use'} this entry. Change them first.`;}}
 return null;
}

export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);
 if(url.searchParams.get('names')==='1'){const dataset=datasetKey.parse(url.searchParams.get('dataset'));await validDataset(owner,dataset);const out:Record<string,string[]>={};
  for(const [name,table] of Object.entries(nameTables)){const def=masterDefs[table];const {rows}=await load(owner,dataset,def);out[name]=Array.from(new Set(rows.map(r=>trimCell(r.values[def.nameCol!])).filter(Boolean)));}
  return Response.json({names:out},{headers:{'Cache-Control':'no-store'}});}
 const def=masterDef(url.searchParams.get('table')||'');if(!def)throw new RequestError('Unknown master.',404);
 const dataset=await scope(owner,def,url.searchParams.get('dataset'));const {rows,columns}=await load(owner,dataset,def);
 // ?key= returns just that record (used by Employee Entry for one employee's details).
 const key=url.searchParams.get('key');
 return Response.json({table:def.table,columns,rows:key==null?rows:rows.filter(r=>r.key===key)},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}

export async function POST(request:Request){try{
 const owner=await ownerId();checkOrigin(request);if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid request.');
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,60000)));if(!input||typeof input!=='object'||Array.isArray(input))throw new RequestError('Invalid request.');
 const def=masterDef(typeof input.table==='string'?input.table:'');if(!def)throw new RequestError('Unknown master.',404);
 const dataset=await scope(owner,def,input.dataset);const now=new Date().toISOString();
 if(!Number.isInteger(input.revision)||input.revision<0)throw new RequestError('Invalid record.');
 const loaded=await load(owner,dataset,def);const byKey=new Map(loaded.rows.map(r=>[r.key,r]));
 if(input.action==='master-delete'){
  const row=typeof input.key==='string'?byKey.get(input.key):undefined;if(!row)throw new RequestError('This record is no longer available. Refresh the list.',404);
  if(row.revision!==input.revision)throw new RequestError('This record changed in another window. Refresh and try again.',409);
  const blocked=await inUse(owner,dataset,def,row);if(blocked)throw new RequestError(blocked,409);
  const overlay=loaded.overlays.get(row.key);
  const result=overlay?await db().prepare('UPDATE master_records SET deleted=1,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted=0').bind(now,overlay.id,owner,row.revision).run()
   :await db().prepare('INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,?,?,?,?,1,1,?)').bind(crypto.randomUUID(),owner,dataset,def.table,row.key,JSON.stringify(row.values),'source',now).run();
  if(result.meta.changes!==1)throw new RequestError('This record changed in another window. Refresh and try again.',409);
  return Response.json({deleted:true});
 }
 if(input.action!=='master-save')throw new RequestError('Unknown action.');
 const cleaned=cleanValues(def,input.values);if('error' in cleaned)throw new RequestError(cleaned.error);
 const nameClash=(values:MasterValues,exceptKey?:string)=>def.nameCol&&loaded.rows.some(r=>r.key!==exceptKey&&sameName(r.values[def.nameCol!],values[def.nameCol!])&&(def.table!=='tbmisc'||trimCell(r.values.misc_code)===trimCell(values.misc_code)));
 if(typeof input.key==='string'){
  const row=byKey.get(input.key);if(!row)throw new RequestError('This record is no longer available. Refresh the list.',404);
  if(row.revision!==input.revision)throw new RequestError('This record changed in another window. Refresh and try again.',409);
  const values:MasterValues={...row.values,...cleaned.values};for(const c of def.key)values[c]=row.values[c];
  if(def.auto)values[def.auto]=row.values[def.auto];
  const invalid=def.validate?.(values);if(invalid)throw new RequestError(invalid);
  if(def.nameCol&&!sameName(values[def.nameCol],row.values[def.nameCol])&&nameClash(values,row.key))throw new RequestError(`${def.fields.find(f=>f.col===def.nameCol)?.label||'Name'} already exists.`,409);
  const overlay=loaded.overlays.get(row.key);const revision=row.revision+1;const data=JSON.stringify(values);
  const result=overlay?await db().prepare('UPDATE master_records SET data=?,revision=?,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted=0').bind(data,revision,now,overlay.id,owner,row.revision).run()
   :await db().prepare('INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,?,?,?,?,1,0,?)').bind(crypto.randomUUID(),owner,dataset,def.table,row.key,data,'source',now).run();
  if(result.meta.changes!==1)throw new RequestError('This record changed in another window. Refresh and try again.',409);
  return Response.json({row:{key:row.key,values,origin:row.origin==='new'?'new':'edited',revision} satisfies MasterRow});
 }
 if(input.revision!==0)throw new RequestError('Invalid record.');
 if(def.singleton&&loaded.rows.length)throw new RequestError('This setup already exists. Use Modify to change it.',409);
 const values:MasterValues={...def.defaults};
 for(const c of loaded.columns)if(!def.fields.some(f=>f.col===c)&&values[c]===undefined){const common=mostCommon(loaded.rows,c);if(common!==null)values[c]=common;}
 for(const [c,v] of Object.entries(cleaned.values))if(v!==null&&v!==''||values[c]===undefined)values[c]=v;
 if(def.auto&&!trimCell(values[def.auto])){
  // Skip codes that other tables already point at (the originals contain orphan references), so a new entry never inherits them.
  const taken=[...loaded.allAuto];
  if(def.key.length===1)for(const other of Object.values(masterDefs)){const refs=other.fields.filter(f=>f.type==='lookup'&&f.lookup===def.table);if(!refs.length||(other.global&&!def.global))continue;for(const r of (await load(owner,dataset,other)).rows)for(const f of refs){const n=Number(trimCell(r.values[f.col]));if(Number.isInteger(n))taken.push(n);}}
  values[def.auto]=String(Math.max(0,...taken)+1);
 }
 const key=recordKey(def,values);if(def.key.some(c=>!trimCell(values[c])))throw new RequestError('Fill in every key field.');
 const invalid=def.validate?.(values);if(invalid)throw new RequestError(invalid);
 if(byKey.has(key))throw new RequestError('A record with the same code already exists.',409);
 if(nameClash(values))throw new RequestError(`${def.fields.find(f=>f.col===def.nameCol)?.label||'Name'} already exists.`,409);
 const hidden=loaded.overlays.get(key);const data=JSON.stringify(values);
 const result=hidden?await db().prepare('UPDATE master_records SET data=?,deleted=0,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND deleted=1').bind(data,now,hidden.id,owner).run()
  :await db().prepare('INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,?,?,?,?,1,0,?)').bind(crypto.randomUUID(),owner,dataset,def.table,key,data,'manual',now).run();
 if(result.meta.changes!==1)throw new RequestError('A record with the same code already exists.',409);
 const saved=await db().prepare('SELECT origin,revision FROM master_records WHERE owner=? AND dataset=? AND table_name=? AND record_key=?').bind(owner,dataset,def.table,key).first<{origin:string;revision:number}>();
 return Response.json({row:{key,values,origin:saved?.origin==='manual'?'new':'edited',revision:saved?.revision||1} satisfies MasterRow});
}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return fail(error);}}
