import type {FullManifest} from './full-import';
import {gunzipSync,strFromU8} from 'fflate';
import {bucket,db,pgStore,RequestError} from './server-store';
import {collectRows,finishMonth,type Collected,type MonthPunches} from './raw-punch-rows';

// The machines' raw punches kept by the original software: its shared database "osps", table tbmachine (card_no, tdate, tpunch, …), one row per punch, every punch
// since 2015 - millions of rows that are NOT in date order. The Multi Punch Report needs every punch of a month, so the table is read once (about half a minute) and
// regrouped by month in the file store: one file per month, card number -> day -> the day's times ("10:45,13:44,14:01"). Built on first use, then every month is one
// small file. Its lists equal the original's own Multi Punch Report (checked on its August 2026 printout: 6,222 of 6,222 employee days).
// On a server (PostgreSQL store, behind a gateway with a time limit) the first reading runs on in the background: the request that starts it answers pending after
// WAIT_MS and the screen asks again until the index is there.
const SOURCE='osps',TABLE='tbmachine',VERSION='v1',WAIT_MS=20000,AHEAD=4;
export type {DayPunches,MonthPunches} from './raw-punch-rows';
type Meta={first:string;last:string;months:number};
const building=new Map<string,Promise<Meta|null>>();

// The punches of one month by card number, plus the last day the original has any punch of (later days come from the Biometric Attendance app).
export async function rawPunchMonth(owner:string,month:string):Promise<{available:boolean;pending?:boolean;last:string;punches:MonthPunches}>{
 const source=await db().prepare("SELECT id,manifest FROM source_datasets WHERE owner=? AND dataset_key=? AND status='complete'").bind(owner,SOURCE).first<{id:string;manifest:string}>();
 if(!source)return {available:false,last:'',punches:{}};
 const prefix=`${encodeURIComponent(owner)}/${TABLE}-months/${source.id}/${VERSION}/`;
 let meta:Meta|null=null;const stored=await bucket().get(prefix+'meta.json');if(stored)meta=await stored.json<Meta>();
 if(!meta){let job=building.get(prefix);if(!job){job=buildIndex(owner,source.id,source.manifest,prefix).finally(()=>building.delete(prefix));job.catch(()=>undefined);building.set(prefix,job);}
  if(pgStore()){const late=Symbol();const got=await Promise.race([job,new Promise<symbol>(r=>setTimeout(()=>r(late),WAIT_MS))]);if(got===late)return {available:true,pending:true,last:'',punches:{}};meta=got as Meta|null;}else meta=await job;}
 if(!meta)return {available:false,last:'',punches:{}};
 const file=await bucket().get(`${prefix}${month}.json`);
 return {available:true,last:meta.last,punches:file?await file.json<MonthPunches>():{}};
}

async function buildIndex(owner:string,sourceId:string,manifestText:string,prefix:string):Promise<Meta|null>{
 const table=(JSON.parse(manifestText) as FullManifest).tables.find(t=>t.name===TABLE);if(!table)return null;
 const parts=await db().prepare('SELECT part,object_key FROM source_parts WHERE owner=? AND session_id=? AND table_name=? ORDER BY part').bind(owner,sourceId,table.name).all<{part:number;object_key:string}>();
 if(parts.results.length!==table.parts.length)throw new RequestError('The original machine punches are unavailable.',503);
 const index=new Map(table.columns.map((c,i)=>[c.name,i]));const at={card:index.get('card_no'),date:index.get('tdate'),time:index.get('tpunch')};
 if(at.card===undefined||at.date===undefined||at.time===undefined)return null;
 const acc:Collected=new Map();
 // The next parts are fetched while the current one is unpacked.
 const queue:Promise<R2ObjectBody|null>[]=[];const fetchPart=(i:number)=>{if(i<parts.results.length)queue.push(bucket().get(parts.results[i].object_key) as Promise<R2ObjectBody|null>);};
 for(let i=0;i<Math.min(AHEAD,parts.results.length);i++)fetchPart(i);
 for(let i=0;i<parts.results.length;i++){const object=await queue.shift()!;fetchPart(i+AHEAD);if(!object)throw new RequestError('The original machine punches are unavailable.',503);
  collectRows(acc,JSON.parse(strFromU8(gunzipSync(new Uint8Array(await object.arrayBuffer())))) as (string|null)[][],at as {card:number;date:number;time:number});}
 let first='9999-99',last='0000-00';
 for(const month of [...acc.keys()].sort()){const days=acc.get(month)!;
  await bucket().put(`${prefix}${month}.json`,JSON.stringify(finishMonth(days)),{httpMetadata:{contentType:'application/json'}});acc.delete(month);
  if(month<first)first=month;if(month>last)last=month;}
 // The last day with a punch is found from the last month's file (the table's rows are not in date order).
 let lastDay='';const lastFile=await bucket().get(`${prefix}${last}.json`);
 if(lastFile){const m=await lastFile.json<MonthPunches>();let top='00';for(const days of Object.values(m))for(const d of Object.keys(days))if(d>top)top=d;lastDay=`${last}-${top}`;}
 const meta:Meta={first,last:lastDay,months:0};
 await bucket().put(prefix+'meta.json',JSON.stringify(meta),{httpMetadata:{contentType:'application/json'}});   // written last: the index is complete only now
 return meta;
}
