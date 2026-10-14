import {logEvent} from './activity-client';
export async function requestJson<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{...init,cache:'no-store'});const data=await response.json() as T & {error?:string};if(!response.ok)throw new Error(data.error||'Something went wrong. Please try again.');return data;}
export async function saveRecord<T>(action:string,data:unknown):Promise<T>{const result=await requestJson<{record:T}>('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});return result.record;}
export async function deleteRecord(action:string,id:string,revision:number){return requestJson('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,revision})});}
// A cell is text, a number, or a live Excel formula ({f:'ROUND(D3*E3,0)',v:<value shown before Excel recalculates>}).
export type XlCell=string|number|null|{f:string;v?:number};
export async function exportExcel(filename:string,sheets:{name:string;rows:XlCell[][];dateColumns?:string[];mergeTitle?:boolean}[]){logEvent('export',filename);const XLSX=await import('xlsx');const book=XLSX.utils.book_new();
 for(const sheet of sheets){const ws=XLSX.utils.aoa_to_sheet(sheet.rows.map(r=>r.map(c=>c!==null&&typeof c==='object'?{t:'n' as const,f:c.f,v:c.v??0}:c)));
  const head=sheet.rows.find(r=>r.length>3)||sheet.rows[0]||[];ws['!cols']=head.map(h=>({wch:Math.max(13,Math.min(30,(h!==null&&typeof h==='object'?0:String(h??'').length)+3))}));
  if(sheet.mergeTitle&&head.length)ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:head.length-1}}];
  for(const key of sheet.dateColumns||[])for(let row=3;row<=sheet.rows.length;row++){const c=ws[key+row];if(c?.t==='n')c.z='dd/mm/yyyy';}
  if(sheet.mergeTitle&&head.length)ws['!autofilter']={ref:`A2:${XLSX.utils.encode_col(head.length-1)}${Math.max(2,sheet.rows.length-1)}`};
  XLSX.utils.book_append_sheet(book,ws,sheet.name.slice(0,31));}
 XLSX.writeFile(book,filename,{compression:true});}
