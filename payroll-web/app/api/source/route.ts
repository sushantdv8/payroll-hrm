import {ownerId,db,bucket,readBounded,RequestError,fail} from '@/lib/server-store';
import {datasetKey,type FullManifest} from '@/lib/full-import';
import {hrIdentity} from '@/lib/hr-store';
import {isSuper} from '@/lib/access';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const owner=await ownerId();if(!isSuper(await hrIdentity(owner)))throw new RequestError('The original source tables are for the Super Admin only.',403);const url=new URL(request.url);const key=datasetKey.parse(url.searchParams.get('dataset'));const source=await db().prepare('SELECT id,manifest FROM source_datasets WHERE owner=? AND dataset_key=? AND status=\'complete\'').bind(owner,key).first<{id:string;manifest:string}>();
 if(!source)return Response.json({tables:[],issues:[],complete:false},{headers:{'Cache-Control':'no-store'}});const m=JSON.parse(source.manifest) as FullManifest;const tableName=url.searchParams.get('table');
 if(!tableName)return Response.json({complete:true,companyName:m.dataset.companyName,year:m.dataset.year,counts:m.expected,tables:m.tables.map(t=>({name:t.name,rowCount:t.rowCount,columns:t.columns,parts:t.parts.length})),issues:m.issues},{headers:{'Cache-Control':'no-store'}});
 const table=m.tables.find(t=>t.name===tableName);if(!table)throw new RequestError('Original table not found.',404);
 const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>table.rowCount)throw new RequestError('Invalid page.');let skipped=0;const part=table.parts.find(p=>{if(offset<skipped+p.rows)return true;skipped+=p.rows;return false;});
 if(!part)return Response.json({columns:table.columns,rows:[],total:table.rowCount,offset,nextOffset:null},{headers:{'Cache-Control':'no-store'}});
 const stored=await db().prepare('SELECT object_key FROM source_parts WHERE owner=? AND session_id=? AND table_name=? AND part=?').bind(owner,source.id,table.name,part.part).first<{object_key:string}>();if(!stored)throw new RequestError('Original part is unavailable.',503);const object=await bucket().get(stored.object_key);if(!object)throw new RequestError('Original part is unavailable.',503);
 if(url.searchParams.get('download')==='1')return new Response(object.body,{headers:{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="'+key+'_'+table.name+'_'+part.part+'.json.gz"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 const stream=object.body.pipeThrough(new DecompressionStream('gzip'));const rows=JSON.parse(new TextDecoder().decode(await readBounded(new Request('http://archive.local',{method:'POST',body:stream,duplex:'half'} as RequestInit),8_000_000))) as (string|null)[][];const selected=rows.slice(offset-skipped,offset-skipped+50);const nextOffset=offset+selected.length;
 return Response.json({columns:table.columns,rows:selected,total:table.rowCount,offset,nextOffset:nextOffset<table.rowCount?nextOffset:null},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
