import {manifestSchema,packetSchema,canonical,sha256,withoutIdentity,type FullManifest} from '@/lib/full-import';
import {ownerId,db,bucket,checkOrigin,readBounded,RequestError,fail,drained} from '@/lib/server-store';
import {hrIdentity} from '@/lib/hr-store';
import {needScreen,refuse,note} from '@/lib/guard';
import {unitLimited} from '@/lib/unit-scope';
export const dynamic='force-dynamic';
type Session={id:string;dataset_key:string;manifest:string;manifest_hash:string;status:string;next_sequence:number};
async function session(owner:string,id:unknown){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new RequestError('Invalid import session.');const row=await db().prepare('SELECT * FROM source_datasets WHERE id=? AND owner=?').bind(id,owner).first<Session>();if(!row)throw new RequestError('Import session not found.',404);return row;}
async function inflate(bytes:Uint8Array){const stream=new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(new TextDecoder().decode(await readBounded(new Request('http://archive.local',{method:'POST',body:stream,duplex:'half'} as RequestInit),8_000_000)));}
function placeholderJSON(rows:unknown[]){return JSON.stringify(rows);}
async function postHandler(request:Request){try{
 const owner=await ownerId();checkOrigin(request);if(!request.headers.get('content-type')?.includes('application/json'))throw new RequestError('Invalid import request.');
 const actor=await hrIdentity(owner);await needScreen(owner,actor,['utilities/import','master/import'],'add');
 // An import brings in a whole company, so it needs a login that is not limited to some companies or locations.
 if(unitLimited(actor)||(!actor.admin&&!actor.permissions.datasets.includes('*')))await refuse(owner,actor,'Import Records covers whole companies, so it needs a login that has All companies and All locations.','utilities/import');
 const input=JSON.parse(new TextDecoder().decode(await readBounded(request,8_500_000)));const now=new Date().toISOString();
 if(input.action==='begin'){
  const m=manifestSchema.parse(input.manifest);const hash=await sha256(canonical(m));const id=await sha256(owner+':'+m.importId);
  const existing=await db().prepare('SELECT * FROM source_datasets WHERE owner=? AND dataset_key=?').bind(owner,m.dataset.key).first<Session>();
  if(existing){if(existing.id!==id||existing.manifest_hash!==hash)throw new RequestError('This dataset already has a different import. Existing records were kept.',409);return Response.json({sessionId:id,status:existing.status,nextSequence:existing.next_sequence});}
  const old=await db().prepare("SELECT e.id FROM employees e LEFT JOIN source_employee_links l ON l.employee_id=e.id AND l.owner=e.owner WHERE e.owner=? AND e.dataset=? AND json_extract(e.data,'$.sourceDataset')=? AND l.id IS NULL").bind(owner,m.dataset.key,m.dataset.key).all<{id:string}>();
  const candidates=new Map(m.legacySamples.map(e=>[e.fingerprint,e.sourceKey]));const mapped=new Set<string>();const links=[];
  for(const e of old.results){
   const [a,s]=await Promise.all([db().prepare("SELECT data FROM attendance WHERE owner=? AND employee_id=? AND json_extract(data,'$.sourceDataset')=? ORDER BY month").bind(owner,e.id,m.dataset.key).all<{data:string}>(),db().prepare("SELECT data FROM salary_snapshots WHERE owner=? AND employee_id=? AND json_extract(data,'$.sourceDataset')=? ORDER BY month").bind(owner,e.id,m.dataset.key).all<{data:string}>()]);
   const fingerprint=await sha256(canonical({attendance:a.results.map(r=>withoutIdentity(JSON.parse(r.data))),salaries:s.results.map(r=>withoutIdentity(JSON.parse(r.data)))}));const sourceKey=candidates.get(fingerprint);
   if(!sourceKey||mapped.has(sourceKey))throw new RequestError('An existing sample record could not be matched safely. No existing records were changed.',409);mapped.add(sourceKey);
   links.push(db().prepare('INSERT INTO source_employee_links(id,owner,dataset,source_key,employee_id,profile) VALUES(?,?,?,?,?,?)').bind(await sha256(owner+':'+m.dataset.key+':'+sourceKey),owner,m.dataset.key,sourceKey,e.id,'{}'));
  }
  await db().batch([db().prepare('INSERT INTO source_datasets(id,owner,dataset_key,manifest,manifest_hash,status,next_sequence,updated_at) VALUES(?,?,?,?,?,\'staging\',0,?)').bind(id,owner,m.dataset.key,JSON.stringify(m),hash,now),...links]);
  await note(owner,'import',`Started importing ${m.dataset.companyName} (${m.dataset.key})`,{screen:'utilities/import',dataset:m.dataset.key});
  return Response.json({sessionId:id,status:'staging',nextSequence:0});
 }
 const current=await session(owner,input.sessionId);const m=JSON.parse(current.manifest) as FullManifest;
 if(input.action==='packet'){
  const packet=packetSchema.parse(input.packet);const hash=await sha256(canonical(packet));
  const prior=await db().prepare('SELECT hash FROM source_packets WHERE owner=? AND session_id=? AND sequence=?').bind(owner,current.id,packet.sequence).first<{hash:string}>();
  if(prior){if(prior.hash!==hash)throw new RequestError('This import part changed. Select the original file to resume.',409);return Response.json({nextSequence:current.next_sequence});}
  if(current.status!=='staging'||packet.sequence!==current.next_sequence||packet.sequence>=m.packetCount)throw new RequestError('Import sequence changed. Resume the file to continue.',409);
  const statements=[db().prepare('INSERT INTO source_packets(id,owner,session_id,sequence,hash,kind,row_count) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,session_id,sequence) DO UPDATE SET hash=CASE WHEN source_packets.hash=excluded.hash THEN excluded.hash ELSE NULL END').bind(crypto.randomUUID(),owner,current.id,packet.sequence,hash,packet.kind,packet.rows.length)];
  if(packet.kind==='source'){
   if(new Set(packet.rows.map(p=>p.table+':'+p.part)).size!==packet.rows.length)throw new RequestError('Duplicate original archive part.');
   for(const part of packet.rows){const table=m.tables.find(t=>t.name===part.table);const expected=table?.parts[part.part];
   if(!table||!expected||expected.sha256!==part.sha256)throw new RequestError('Source archive part does not match its manifest.');
   let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(part.gzipBase64),c=>c.charCodeAt(0));}catch{throw new RequestError('Invalid archive encoding.');}
   if(bytes.byteLength!==expected.bytes||await sha256(bytes)!==expected.sha256)throw new RequestError('Source archive checksum failed.');
   const rows=await inflate(bytes);if(!Array.isArray(rows)||rows.length!==expected.rows||rows.some(r=>!Array.isArray(r)||r.length!==table.columns.length||r.some(v=>v!==null&&typeof v!=='string')))throw new RequestError('Source archive row count or columns do not match.');
   const objectKey=encodeURIComponent(owner)+'/source/'+current.id+'/'+table.name+'/'+part.part+'.json.gz';await bucket().put(objectKey,bytes,{httpMetadata:{contentType:'application/gzip'}});
   statements.push(db().prepare('INSERT INTO source_parts(id,owner,session_id,table_name,part,hash,row_count,object_key) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,session_id,table_name,part) DO UPDATE SET hash=CASE WHEN source_parts.hash=excluded.hash THEN excluded.hash ELSE NULL END').bind(crypto.randomUUID(),owner,current.id,table.name,part.part,expected.sha256,rows.length,objectKey));
   }
  }else{
   if(packet.rows.some(r=>r.sourceDataset!==m.dataset.key))throw new RequestError('Monthly record has the wrong dataset.');
   const rowKeys=packet.rows.map(r=>r.sourceKey+(packet.kind==='employees'?'':':'+('month' in r?r.month:'')));if(new Set(rowKeys).size!==rowKeys.length)throw new RequestError('Duplicate source records in one part.');
   if(packet.kind==='employees'){
    if(packet.rows.some(r=>r.dataset!==m.dataset.key||r.active!==null||r.photoKey||r.signatureKey||r.revision!==0))throw new RequestError('Invalid source employee profile.');
    const linked=await db().prepare('SELECT l.source_key,l.employee_id FROM json_each(?) j CROSS JOIN source_employee_links l ON l.owner=? AND l.dataset=? AND l.source_key=json_extract(j.value,\'$.sourceKey\')').bind(placeholderJSON(packet.rows),owner,m.dataset.key).all<{source_key:string;employee_id:string}>();const map=new Map(linked.results.map(l=>[l.source_key,l.employee_id]));
    const rows=packet.rows.map(e=>({...e,id:map.get(e.sourceKey)||crypto.randomUUID(),revision:1}));
    // Existing linked profiles are only enriched during final activation, and only if unedited.
    const fresh=rows.filter(e=>!map.has(e.sourceKey));if(fresh.length)statements.push(db().prepare('INSERT INTO employees(id,owner,dataset,import_id,paycode,data,revision,updated_at) SELECT json_extract(value,\'$.id\'),?,?,?,json_extract(value,\'$.paycode\'),value,1,? FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING').bind(owner,m.dataset.key,current.id,now,placeholderJSON(fresh)));
    const links=rows.map(e=>({id:crypto.randomUUID(),sourceKey:e.sourceKey,employeeId:e.id,profile:JSON.stringify(e)}));
    statements.push(db().prepare('INSERT INTO source_employee_links(id,owner,dataset,source_key,employee_id,profile) SELECT json_extract(value,\'$.id\'),?,?,json_extract(value,\'$.sourceKey\'),json_extract(value,\'$.employeeId\'),json_extract(value,\'$.profile\') FROM json_each(?) WHERE true ON CONFLICT(owner,dataset,source_key) DO UPDATE SET profile=CASE WHEN source_employee_links.profile=\'{}\' OR source_employee_links.profile=excluded.profile THEN excluded.profile ELSE NULL END').bind(owner,m.dataset.key,placeholderJSON(links)));
   }else{
    const linked=await db().prepare('SELECT l.source_key,l.employee_id FROM json_each(?) j CROSS JOIN source_employee_links l ON l.owner=? AND l.dataset=? AND l.source_key=json_extract(j.value,\'$.sourceKey\')').bind(placeholderJSON(packet.rows),owner,m.dataset.key).all<{source_key:string;employee_id:string}>();const map=new Map(linked.results.map(l=>[l.source_key,l.employee_id]));
    if(packet.rows.some(r=>!map.has(r.sourceKey)))throw new RequestError('Monthly record refers to an employee that has not been imported.');
    const rows=packet.rows.map(r=>({...r,employeeId:map.get(r.sourceKey)!,...(packet.kind==='attendance'?{revision:1}:{})}));
    const table=packet.kind==='attendance'?'attendance':'salary_snapshots';
    const existing=await db().prepare(`SELECT a.data FROM json_each(?) j CROSS JOIN ${table} a ON a.owner=? AND a.employee_id=json_extract(j.value,'$.employeeId') AND a.month=json_extract(j.value,'$.month')`).bind(placeholderJSON(rows),owner).all<{data:string}>();
    if(existing.results.some(r=>JSON.parse(r.data).sourceDataset!==m.dataset.key))throw new RequestError('A manually entered monthly record conflicts with this import. It was kept for review.',409);
    const records=rows.map(r=>({id:crypto.randomUUID(),employeeId:r.employeeId,month:r.month,data:JSON.stringify(r)}));
    statements.push(packet.kind==='attendance'?db().prepare('INSERT INTO attendance(id,owner,employee_id,month,data,revision,updated_at,import_id) SELECT json_extract(value,\'$.id\'),?,json_extract(value,\'$.employeeId\'),json_extract(value,\'$.month\'),json_extract(value,\'$.data\'),1,?,? FROM json_each(?) WHERE true ON CONFLICT(owner,employee_id,month) DO NOTHING').bind(owner,now,current.id,placeholderJSON(records)):db().prepare('INSERT INTO salary_snapshots(id,owner,employee_id,month,data,import_id) SELECT json_extract(value,\'$.id\'),?,json_extract(value,\'$.employeeId\'),json_extract(value,\'$.month\'),json_extract(value,\'$.data\'),? FROM json_each(?) WHERE true ON CONFLICT(owner,employee_id,month) DO NOTHING').bind(owner,current.id,placeholderJSON(records)));
   }
  }
  statements.push(db().prepare('UPDATE source_datasets SET next_sequence=next_sequence+1,updated_at=? WHERE id=? AND owner=? AND next_sequence=?').bind(now,current.id,owner,packet.sequence));await db().batch(statements);
  const updated=await session(owner,current.id);return Response.json({nextSequence:updated.next_sequence});
 }
 if(input.action==='finish'){
  if(current.status==='complete')return Response.json({complete:true,counts:m.expected});
  if(current.next_sequence!==m.packetCount)throw new RequestError('Some import parts are still missing.',409);
  const countRows=async(sql:string,...args:(string|number)[])=>Number((await db().prepare(sql).bind(...args).first<{n:number}>())?.n||0);
  const counts={employees:await countRows('SELECT COUNT(*) n FROM source_employee_links WHERE owner=? AND dataset=? AND profile<>\'{}\'',owner,m.dataset.key),attendance:await countRows("SELECT COUNT(*) n FROM attendance a JOIN source_employee_links l ON a.employee_id=l.employee_id AND a.owner=l.owner WHERE l.owner=? AND l.dataset=? AND json_extract(a.data,'$.sourceDataset')=?",owner,m.dataset.key,m.dataset.key),salaries:await countRows("SELECT COUNT(*) n FROM salary_snapshots a JOIN source_employee_links l ON a.employee_id=l.employee_id AND a.owner=l.owner WHERE l.owner=? AND l.dataset=? AND json_extract(a.data,'$.sourceDataset')=?",owner,m.dataset.key,m.dataset.key),rawParts:await countRows('SELECT COUNT(*) n FROM source_parts WHERE owner=? AND session_id=?',owner,current.id)};
  if(Object.entries(counts).some(([k,v])=>v!==m.expected[k as keyof typeof counts]))throw new RequestError('Imported record counts do not match the source. The import remains paused for review.',409);
  const tables=await db().prepare('SELECT table_name,SUM(row_count) n FROM source_parts WHERE owner=? AND session_id=? GROUP BY table_name').bind(owner,current.id).all<{table_name:string;n:number}>();const totals=new Map(tables.results.map(t=>[t.table_name,Number(t.n)]));if(m.tables.some(t=>(totals.get(t.name)||0)!==t.rowCount))throw new RequestError('Original table counts do not match.',409);
  await db().batch([
   db().prepare('UPDATE employees SET data=(SELECT json_set(l.profile,\'$.id\',employees.id,\'$.revision\',2) FROM source_employee_links l WHERE l.owner=employees.owner AND l.employee_id=employees.id AND l.dataset=?),revision=2,updated_at=? WHERE owner=? AND dataset=? AND import_id IS NULL AND revision=1 AND EXISTS(SELECT 1 FROM source_employee_links l WHERE l.owner=employees.owner AND l.employee_id=employees.id AND l.dataset=? AND l.profile<>\'{}\')').bind(m.dataset.key,now,owner,m.dataset.key,m.dataset.key),
   db().prepare('UPDATE source_datasets SET status=\'complete\',updated_at=? WHERE id=? AND owner=? AND next_sequence=?').bind(now,current.id,owner,m.packetCount)
  ]);await note(owner,'import',`Finished importing ${m.dataset.companyName} (${m.dataset.key})`,{screen:'utilities/import',dataset:m.dataset.key,detail:counts});return Response.json({complete:true,counts});
 }
 throw new RequestError('Unknown import action.');
}catch(error){if(error instanceof SyntaxError)return Response.json({error:'Invalid import file or archive.'},{status:400});return fail(error);}}
export const POST=drained(postHandler);
