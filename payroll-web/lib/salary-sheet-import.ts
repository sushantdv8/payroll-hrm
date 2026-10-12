import {sheetTemplates,defaultSheetRules,columnIndex,footerFields,type SheetTemplate,type SheetDocument,type InputRow,type SheetCell} from './salary-sheets';
import sourceRows from './salary-sheet-source-rows.json';
type ExcelSheet=Record<string,{v?:string|number;f?:string}|unknown>;
type ExcelBook={SheetNames:string[];Sheets:Record<string,ExcelSheet>;Custprops?:object};
const value=(s:ExcelSheet,at:string):SheetCell=>{const c=s[at] as {v?:unknown}|undefined;return typeof c?.v==='number'||typeof c?.v==='string'?c.v:null;};
const formula=(s:ExcelSheet,at:string)=>(s[at] as {f?:string}|undefined)?.f;
const key=(v:SheetCell)=>String(v??'').trim().replace(/\.0$/,'');
export function importSalaryWorkbook(book:ExcelBook,month?:string):SheetDocument[] {
 const docs:SheetDocument[]=[];
 let coordinates:Record<string,unknown>={};try{const raw=(book.Custprops as Record<string,unknown>|undefined)?.SalaryLayoutRows;if(typeof raw==='string'&&raw.length<500000){const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))coordinates=parsed;}}catch{/* Foreign workbooks need no export coordinates. */}
 for(const name of book.SheetNames){
  const sheet=book.Sheets[name];const template=sheetTemplates.find(t=>t.sheetName.trim().toLowerCase()===name.trim().toLowerCase());if(!template)continue;
  // Sheet1 only belongs to the supplied comparison layout, not an arbitrary spreadsheet.
  const nameColumn=template.group==='comparison'?'D':'C';const headerRow=[template.headerRow,2].find(r=>String(value(sheet,nameColumn+r)||'').toUpperCase().replace(/[^A-Z]/g,'').includes(template.group==='comparison'?'EMPLOYEENAME':'NAME'));
  if(!headerRow)continue;
  const selectedMonth=month||template.sampleMonth;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth))throw new Error('Choose a valid month.');
  const rows:InputRow[]=[];const seen=new Set<string>();let lastPhysical=headerRow;
  const last=Math.max(...Object.keys(sheet).filter(a=>/^[A-Z]+\d+$/.test(a)).map(a=>Number(a.replace(/^[A-Z]+/,''))),0);
  for(let r=headerRow+1;r<=Math.min(last,10000);r++){
   const id=key(value(sheet,(template.group==='comparison'?'C':'B')+r));const person=value(sheet,nameColumn+r);
   if(!id||person==null||person===''||typeof value(sheet,'A'+r)!=='number'||formula(sheet,'A'+r))continue;
   if(seen.has(id))throw new Error('Duplicate card '+id+' in '+name+'. Correct the sample before import.');seen.add(id);
   const mapping=coordinates[name];const sourceRow=Array.isArray(mapping)?mapping[rows.length]:r;
   const row:InputRow={card:id,sourceRow:Number.isInteger(sourceRow)&&sourceRow>=3&&sourceRow<=10000?sourceRow:undefined,values:{},formulas:{},overrides:{}};lastPhysical=r;
   for(const col of template.columns){
    const v=value(sheet,col.key+r),f=formula(sheet,col.key+r);const basic=col.formula;
    if(basic){
     if(f&&!/VLOOKUP|\[|!/.test(f)){
      const normalized=f.replace(/\$/g,'').replace(/([A-Z]+)\d+\b/g,'$1').replace(template.group==='unit3'?/\/31\b/g:/$^/g,'/DAYS');
      // Retain per-row formula exceptions only within the month in which they were entered.
      if(normalized!==basic)row.formulas![col.key]=normalized;
     }else if(!f&&template.group!=='comparison'&&(typeof v==='number'||v===null))row.overrides![col.key]=v??0;
    }else {row.values[col.key]=col.numeric?v:typeof v==='number'&&!col.date?String(v):v;if(f&&!/VLOOKUP|\[|!/.test(f))row.formulas![col.key]=f.replace(/\$/g,'').replace(/([A-Z]+)\d+\b/g,'$1').replace(template.group==='unit3'?/\/31\b/g:/$^/g,'/DAYS');}
   }
   row.values[template.group==='comparison'?'C':'B']=id;
   // Excel treats blank sample number cells as zero. New months stay blank until entered.
   for(const col of template.required)if(row.values[col]==null&&template.columns.find(c=>c.key===col)?.numeric){row.values[col]=0;row.note='Blank numeric sample entries imported as 0, matching Excel.';}
   rows.push(row);
  }
  if(rows.length){const shift=lastPhysical-(sourceRows as Record<string,number>)[template.id];const footerValues=Object.fromEntries((footerFields[template.id]||[]).map(f=>{const at=f.address.replace(/\d+$/,r=>String(Number(r)+shift));return [f.address,value(sheet,at)];}));docs.push({templateId:template.id,month:selectedMonth,revision:0,rows,rules:defaultSheetRules(template,selectedMonth),sourceFile:template.sampleFile,footerValues});}
 }
 if(!docs.length)throw new Error('No supported salary sheet was found. Choose one of the supplied sample formats.');
 return docs;
}
export const importSummary=(docs:SheetDocument[])=>docs.map(d=>({templateId:d.templateId,month:d.month,rows:d.rows.length}));
export const orderedColumns=(template:SheetTemplate)=>[...template.columns].sort((a,b)=>columnIndex(a.key)-columnIndex(b.key));
