import {env} from 'cloudflare:workers';
import {pgDatabase,pgBucket} from './pg-gateway-client';
import {datasetKey} from './full-import';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {restrictLegacy,hrIdentity,hrEmployee} from './hr-store';
import {logActivity,asIdentity} from './activity-store';
import {headers} from 'next/headers';
// `logged`: the refusal is already written to the activity log (lib/guard.ts refuse); every other 403 is written when the answer is made (fail).
export class RequestError extends Error {constructor(message:string,public status=400,public logged=false){super(message);}}
export async function ownerId(){const user=await getChatGPTUser();if(!user)throw new RequestError('Please sign in to access your records.',401);await restrictLegacy(user.userId);return user.userId;}
// PostgreSQL mode: when DB_GATEWAY_URL and DB_GATEWAY_SECRET are set, records and files go to PostgreSQL through the db-gateway; otherwise Cloudflare D1 / R2 as before.
let pgDb:D1Database|undefined,pgObjects:R2Bucket|undefined;
function gateway(){return env.DB_GATEWAY_URL&&env.DB_GATEWAY_SECRET?{url:env.DB_GATEWAY_URL.replace(/\/+$/,''),secret:env.DB_GATEWAY_SECRET}:null;}
export function db(){const gw=gateway();if(gw)return pgDb??=pgDatabase(gw);if(!env.DB)throw new RequestError('Records are temporarily unavailable. Please try again.',503);return env.DB;}
export function bucket(){const gw=gateway();if(gw)return pgObjects??=pgBucket(gw);if(!env.BUCKET)throw new RequestError('Image storage is temporarily unavailable.',503);return env.BUCKET;}
export function checkOrigin(request:Request){const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)throw new RequestError('This request could not be verified. Refresh the page and try again.',403);}
export async function readBounded(request:Request,limit:number){if(Number(request.headers.get('content-length')||0)>limit)throw new RequestError('This upload or record is too large.',413);const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let length=0;while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>limit){await reader.cancel();throw new RequestError('This upload or record is too large.',413);}chunks.push(next.value);}const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;}
// Cloudflare Workers cannot answer a request whose body nobody read: the unread body is torn away after the answer, the worker is restarted and every request
// in flight (of every login) fails - so a refused POST (original workspace, inactive login, missing right ...) would stop the whole program for seconds.
// Every API handler that takes a body is wrapped with this: an unread body is read (at most 12 MB) before the answer is sent.
export function drained(handler:(request:Request)=>Promise<Response>){
 return async(request:Request):Promise<Response>=>{
  try{return await handler(request);}
  finally{try{if(request.body&&!request.bodyUsed&&!request.body.locked)await readBounded(request,12_000_000);}catch{/* too large or already closed: nothing to read */}}
 };
}
// A refusal that no guard wrote down (a company, location or right checked deep inside a route): one 'denied' row for the signed-in login, written when the answer is made.
async function logRefusal(message:string){
 try{
  const user=await getChatGPTUser();if(!user)return;
  const actor=await hrIdentity(user.userId),h=await headers();
  await logActivity(user.userId,asIdentity(actor),{kind:'denied',summary:`${message} (${h.get('oai-authenticated-user-method')||'GET'} ${h.get('oai-authenticated-user-path')||''})`,ok:false});
 }catch{/* an inactive login or an unreadable identity: there is nobody to write it for */}
}
export async function fail(error:unknown):Promise<Response>{if(error instanceof RequestError){if(error.status===403&&!error.logged)await logRefusal(error.message);return Response.json({error:error.message},{status:error.status});}const e=error as {issues?:{message:string}[];message?:string};if(e.issues)return Response.json({error:e.issues[0]?.message||'Please check the entered values.'},{status:400});if(e.message?.includes('CHECK constraint'))return Response.json({error:'A related record changed. Reload and try again.',status:409},{status:409});if(e.message?.includes('UNIQUE constraint'))return Response.json({error:'That record already exists. Reload or use a different employee code.',status:409},{status:409});console.error('Payroll storage request failed',error);return Response.json({error:'The record could not be saved or loaded. Your changes have been kept on screen; please try again.'},{status:503});}
export function decoded(row:{data:string;revision:number;dataset?:string}){return {...JSON.parse(row.data),revision:row.revision,...(row.dataset?{dataset:row.dataset}:{})};}
export const visibleImport="(import_id IS NULL OR import_id IN (SELECT id FROM source_datasets WHERE status='complete'))";
export async function validDataset(owner:string,key:string){datasetKey.parse(key);const actor=await hrIdentity(owner);if(!actor.admin&&!actor.permissions.datasets.includes('*')&&!actor.permissions.datasets.includes(key))throw new RequestError('This company is not assigned to your account.',403);if(key==='manual')return;const current=await db().prepare("SELECT id FROM source_datasets WHERE owner=? AND dataset_key=? AND status='complete' UNION ALL SELECT owner id FROM backup_settings WHERE owner=? AND json_extract(data,'$.sourceDataset')=?").bind(owner,key,owner,key).first();if(!current)throw new RequestError('Choose an available dataset.',404);}
export async function ensureEmployee(owner:string,id:string){await hrEmployee(owner,id);}
// Photos and signatures are uploads of this owner named by a UUID (see /api/images); no other object of the file store (HR documents, source archives ...) is one.
export const photoKeyPattern=(owner:string)=>new RegExp('^'+encodeURIComponent(owner).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
export const imageKeyOk=(owner:string,key:string)=>!key||photoKeyPattern(owner).test(key);
