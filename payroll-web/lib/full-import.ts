import {z} from 'zod';
import {backupSettingsSchema,salarySnapshotSchema} from './backup';
import {employeeSchema,monthSchema,monthDays} from './payroll';
export const datasetKey=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.number().int().min(0).max(100_000_000);
export const manifestSchema=z.object({
 format:z.literal('payroll-full-v1'),importId:z.string().uuid(),
 dataset:z.object({key:datasetKey,companyName:z.string().min(1).max(200),year:z.number().int().min(1900).max(2100)}).strict(),
 settings:backupSettingsSchema,
 expected:z.object({employees:count,attendance:count,salaries:count,rawParts:count}).strict(),packetCount:count.max(100000),
 tables:z.array(z.object({name:z.string().regex(/^[a-zA-Z0-9_]{1,128}$/),columns:z.array(z.object({name:z.string().min(1).max(200),type:z.string().min(1).max(100)}).strict()).max(2000),rowCount:count,parts:z.array(z.object({part:count,rows:count.max(100000),sha256:digest,bytes:count.max(6000000),uncompressedBytes:count.max(8000000)}).strict()).max(100000)}).strict()).max(1000),
 legacySamples:z.array(z.object({sourceKey:z.string().min(1).max(80),fingerprint:digest}).strict()).max(100),
 issues:z.array(z.object({message:z.string().max(600),count:count}).strict()).max(200)
}).strict().superRefine((m,ctx)=>{
 const bad=(message:string)=>ctx.addIssue({code:'custom',message});
 if(m.dataset.key!==m.settings.sourceDataset||m.dataset.companyName!==m.settings.companyName)bad('Dataset details do not match.');
 if(new Set(m.tables.map(t=>t.name)).size!==m.tables.length)bad('Duplicate source table.');
 if(m.tables.reduce((s,t)=>s+t.parts.length,0)!==m.expected.rawParts)bad('Source part count does not match.');
 for(const t of m.tables)if(t.parts.some((p,i)=>p.part!==i)||t.parts.reduce((s,p)=>s+p.rows,0)!==t.rowCount||new Set(t.columns.map(c=>c.name)).size!==t.columns.length)bad('Invalid source table manifest.');
 if(new Set(m.legacySamples.map(s=>s.fingerprint)).size!==m.legacySamples.length)bad('Ambiguous sample mapping.');
});
export type FullManifest=z.infer<typeof manifestSchema>;
const sourceKey=z.string().min(1).max(80);
export const fullEmployeeSchema=employeeSchema.extend({sourceKey,dataset:datasetKey,sourceDataset:datasetKey});
export const fullAttendanceSchema=monthSchema.extend({sourceKey,sourceDataset:datasetKey}).superRefine((m,ctx)=>{const n=monthDays(m.month);if(m.days.length!==n||new Set(m.days.map(d=>d.day)).size!==n||m.days.some(d=>d.day>n))ctx.addIssue({code:'custom',message:'Incomplete attendance month.'});});
export const fullSalarySchema=salarySnapshotSchema.extend({sourceKey});
export const packetSchema=z.discriminatedUnion('kind',[
 z.object({sequence:count,kind:z.literal('employees'),rows:z.array(fullEmployeeSchema).min(1).max(100)}).strict(),
 z.object({sequence:count,kind:z.literal('attendance'),rows:z.array(fullAttendanceSchema).min(1).max(100)}).strict(),
 z.object({sequence:count,kind:z.literal('salaries'),rows:z.array(fullSalarySchema).min(1).max(100)}).strict(),
 z.object({sequence:count,kind:z.literal('source'),rows:z.array(z.object({table:z.string().regex(/^[a-zA-Z0-9_]{1,128}$/),part:count,sha256:digest,gzipBase64:z.string().max(8_000_000)}).strict()).min(1).max(10)}).strict()
]);
export function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export async function sha256(value:string|Uint8Array){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;const hash=await crypto.subtle.digest('SHA-256',bytes as BufferSource);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
export function withoutIdentity(record:Record<string,unknown>){const {employeeId,revision,sourceKey,...rest}=record;void employeeId;void revision;void sourceKey;return rest;}
export type DatasetSummary={key:string;companyName:string;year:number|null;status:string;counts?:{employees:number;attendance:number;salaries:number;rawParts:number};settings?:z.infer<typeof backupSettingsSchema>};
