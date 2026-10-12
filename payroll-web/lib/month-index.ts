import type {FullManifest} from './full-import';
import {bucket,db,RequestError} from './server-store';
import {gunzipJson} from './source-archive';

// Rows of a large original table (one row per employee per month) regrouped by month in the file store, so one month
// can be read without scanning the whole table. Built on first use; each month file maps the original emp_code to
// the value `pick` returned for that row.
export async function monthIndex<T>(owner:string,dataset:string,table:string,version:string,monthNo:number,pick:(cell:(column:string)=>string)=>T|null):Promise<Record<string,T>>{
 const source=await db().prepare("SELECT id,manifest FROM source_datasets WHERE owner=? AND dataset_key=? AND status='complete'").bind(owner,dataset).first<{id:string;manifest:string}>();
 if(!source||monthNo<1)return {};
 const prefix=`${encodeURIComponent(owner)}/${table}-index/${source.id}/${version}/`;
 const stored=await bucket().get(prefix+monthNo+'.json');if(stored)return await stored.json<Record<string,T>>();
 if(await bucket().head(prefix+'done'))return {};
 const meta=(JSON.parse(source.manifest) as FullManifest).tables.find(t=>t.name===table);if(!meta)return {};
 const parts=await db().prepare('SELECT part,object_key FROM source_parts WHERE owner=? AND session_id=? AND table_name=? ORDER BY part').bind(owner,source.id,meta.name).all<{part:number;object_key:string}>();
 if(parts.results.length!==meta.parts.length)throw new RequestError('Original records are unavailable.',503);
 const at=new Map(meta.columns.map((c,i)=>[c.name,i]));const code=at.get('emp_code'),month=at.get('month_no');if(code===undefined||month===undefined)return {};
 const months=new Map<number,Record<string,T>>();let highest=15;
 for(const part of parts.results){const object=await bucket().get(part.object_key);if(!object)throw new RequestError('Original records are unavailable.',503);
  for(const row of await gunzipJson(object.body) as (string|null)[][]){const m=Number(row[month]);const key=(row[code]??'').trim();if(!key||!Number.isInteger(m)||m<1)continue;
   const value=pick(column=>{const i=at.get(column);return i===undefined?'':(row[i]??'').trim();});
   if(value!==null){let byCode=months.get(m);if(!byCode)months.set(m,byCode={});byCode[key]=value;highest=Math.max(highest,m);}}}
 for(let m=1;m<=highest;m++)await bucket().put(prefix+m+'.json',JSON.stringify(months.get(m)||{}),{httpMetadata:{contentType:'application/json'}});
 await bucket().put(prefix+'done',String(highest));
 return months.get(monthNo)||{};
}
