import type {FullManifest} from './full-import';
import {bucket,db,readBounded,RequestError} from './server-store';

export type SourceTable={columns:{name:string;type:string}[];rows:(string|null)[][]};

export async function gunzipJson(body:ReadableStream){const stream=body.pipeThrough(new DecompressionStream('gzip'));return JSON.parse(new TextDecoder().decode(await readBounded(new Request('http://archive.local',{method:'POST',body:stream,duplex:'half'} as RequestInit),8_000_000)));}

// Reads every row of one original table from the completed import archive (null when the
// dataset has no archive or the table is absent). Master tables are small, so all parts are read.
export async function readSourceTable(owner:string,dataset:string,tableName:string,maxRows=20000):Promise<SourceTable|null>{
 const source=await db().prepare("SELECT id,manifest FROM source_datasets WHERE owner=? AND dataset_key=? AND status='complete'").bind(owner,dataset).first<{id:string;manifest:string}>();
 if(!source)return null;
 const manifest=JSON.parse(source.manifest) as FullManifest;const table=manifest.tables.find(t=>t.name===tableName);
 if(!table)return null;
 if(table.rowCount>maxRows)throw new RequestError('This table is too large to edit here.',413);
 const parts=await db().prepare('SELECT part,object_key FROM source_parts WHERE owner=? AND session_id=? AND table_name=? ORDER BY part').bind(owner,source.id,table.name).all<{part:number;object_key:string}>();
 if(parts.results.length!==table.parts.length)throw new RequestError('Original records are unavailable.',503);
 const rows:(string|null)[][]=[];
 for(const part of parts.results){const object=await bucket().get(part.object_key);if(!object)throw new RequestError('Original records are unavailable.',503);rows.push(...await gunzipJson(object.body) as (string|null)[][]);}
 return {columns:table.columns,rows};
}
