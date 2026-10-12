import {recordKey,trimCell,type MasterDef,type MasterRow,type MasterValues} from './masters';
import {db} from './server-store';
import {readSourceTable} from './source-archive';
import {companyGroups} from './company-groups';
type Overlay={id:string;record_key:string;data:string;origin:string;revision:number;deleted:number};
type Loaded={rows:MasterRow[];columns:string[];overlays:Map<string,Overlay>;allAuto:number[]};


// Merges imported original rows with saved edits/new rows. Duplicate original keys get a #n suffix so each row stays addressable.
export async function loadMasterRows(owner:string,dataset:string,def:MasterDef):Promise<Loaded>{
 const source=def.global?null:await readSourceTable(owner,dataset,def.table);
 const overlayRows=await db().prepare('SELECT id,record_key,data,origin,revision,deleted FROM master_records WHERE owner=? AND dataset=? AND table_name=?').bind(owner,dataset,def.table).all<Overlay>();
 const overlays=new Map(overlayRows.results.map(o=>[o.record_key,o]));
 const columns=source?source.columns.map(c=>c.name):def.fields.map(f=>f.col);
 const rows:MasterRow[]=[];const seen=new Map<string,number>();const allAuto:number[]=[];
 const autoOf=(v:MasterValues)=>{if(!def.auto)return;const n=Number(trimCell(v[def.auto]));if(Number.isInteger(n))allAuto.push(n);};
 for(const cells of source?.rows||[]){
  const values:MasterValues=Object.fromEntries(columns.map((c,i)=>[c,cells[i]??null]));autoOf(values);
  const base=recordKey(def,Object.fromEntries(def.key.map(c=>[c,trimCell(values[c])])));const count=seen.get(base)||0;seen.set(base,count+1);const key=count?`${base}#${count+1}`:base;
  const overlay=overlays.get(key);
  if(overlay?.deleted)continue;
  rows.push(overlay?{key,values:{...values,...JSON.parse(overlay.data)},origin:'edited',revision:overlay.revision}:{key,values,origin:'original',revision:0});
 }
 // Groups of company are not in the backups (see lib/company-groups.ts): the imported companies' groups count as original rows.
 if(def.table==='tbgroup'){const keys=await db().prepare("SELECT dataset_key FROM source_datasets WHERE owner=? AND status='complete'").bind(owner).all<{dataset_key:string}>();
  for(const g of keys.results.map(k=>companyGroups[k.dataset_key]).filter(Boolean).sort((a,b)=>Number(a.code)-Number(b.code))){const values:MasterValues={grp_code:g.code,grp_name:g.name};autoOf(values);const overlay=overlays.get(g.code);if(overlay?.deleted)continue;rows.push(overlay?{key:g.code,values:{...values,...JSON.parse(overlay.data)},origin:'edited',revision:overlay.revision}:{key:g.code,values,origin:'original',revision:0});}}
 for(const overlay of overlayRows.results){const values=JSON.parse(overlay.data) as MasterValues;autoOf(values);if(overlay.origin==='manual'&&!overlay.deleted)rows.push({key:overlay.record_key,values,origin:'new',revision:overlay.revision});}
 return {rows,columns,overlays,allAuto};
}

