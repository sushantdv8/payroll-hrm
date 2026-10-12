import {zipSync,strToU8} from 'fflate';
import layoutsConfig from './salary-sheet-layouts.json';
import {sheetTemplates,footerFields,workbookRows,calculateExpression,columnIndex,type SheetTemplate,type SheetDocument,type SheetCell} from './salary-sheets';
import {monthDays} from './payroll';
import type {XlCell} from './client-api';

type Attributes=Record<string,string>;
type LayoutCell={key:string;attrs:Attributes;value:SheetCell;formula:string|null;input:boolean};
type LayoutRow={row:number;attrs:Attributes;cells:LayoutCell[]};
type Pattern={attrs:Attributes;cells:Record<string,Attributes>;types?:Record<string,string>};
type Layout={prefix:string;suffix:string;headerRows:LayoutRow[];footerRows:LayoutRow[];patterns:Pattern[];body:Record<string,number>;lastDataRow:number;lastRow:number;lastColumn:string;printNames:{name:string;value:string}[]};
type EmptyLayout={emptyXml:string;printNames:{name:string;value:string}[]};
type GroupLayout={sourceFile:string;sheetOrder:string[];styles:string;theme:string|null;layouts:Record<string,Layout|EmptyLayout>};
const layouts=layoutsConfig as unknown as Record<string,GroupLayout>;
const xmlEscape=(s:unknown)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const attrs=(a:Attributes)=>Object.entries(a).map(([k,v])=>` ${k}="${xmlEscape(v)}"`).join('');
const serial=(month:string)=>(Date.parse(month+'-01T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
const monthLabel=(month:string,full=false)=>new Date(month+'-01T00:00:00Z').toLocaleString('en-US',{month:full?'long':'short',timeZone:'UTC'});

function periodText(text:string,template:SheetTemplate,doc:SheetDocument){
 if(template.group==='comparison'&&text.startsWith('Comparison Report'))return `Comparison Report For the Month of ${monthLabel(doc.rules.comparisonMonth)}-${doc.rules.comparisonMonth.slice(0,4)} and ${monthLabel(doc.month)}-${doc.month.slice(0,4)}`;
 const old=monthLabel(template.sampleMonth,true),short=monthLabel(template.sampleMonth);
 return text.replace(new RegExp(`(${old}|${short})(\\s*-?\\s*)(2026|26)\\b`,'gi'),(_all,m,spacing,y)=>{const replacement=monthLabel(doc.month,m.length>3);return (m===m.toUpperCase()?replacement.toUpperCase():replacement)+spacing+(y.length===2?doc.month.slice(2,4):doc.month.slice(0,4));});
}

function cellXml(address:string,value:XlCell,style:Attributes={}){
 const start=`<c r="${address}"${attrs(style)}`;
 if(value===null||value===undefined)return start+'/>';
 if(typeof value==='object')return start+`><f>${xmlEscape(value.f)}</f><v>${value.v??0}</v></c>`;
 if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Invalid export amount at '+address);return start+`><v>${value}</v></c>`;}
 return start+` t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function worksheet(template:SheetTemplate,doc:SheetDocument,documents:Record<string,SheetDocument>,ids:string[],layout:Layout){
 if(!doc.rows.length){
  const header=layout.headerRows.map(r=>`<row r="${r.row}"${attrs(r.attrs)}>${r.cells.map(c=>cellXml(c.key+r.row,typeof c.value==='string'?periodText(c.value,template,doc):c.value,c.attrs)).join('')}</row>`).join('');
  // Keep empty group tabs as styled headers. Body / footer ranges have no employees to refer to.
  const suffix=layout.suffix.replace(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/g,'').replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/g,'');
  return {xml:layout.prefix.replace(/<dimension ref="[^"]*"\s*\/>/,`<dimension ref="A1:${layout.lastColumn}${template.headerRow}"/>`)+'<sheetData>'+header+'</sheetData>'+suffix,printNames:[]};
 }
 const fields=footerFields[template.id]||[];
 for(const f of fields)if(!f.identifier&&(doc.footerValues?.[f.address]==null||doc.footerValues[f.address]===''))throw new Error(`Enter the summary / adjustment at ${f.address} in ${template.name}; enter 0 when none.`);
 const generated=workbookRows(template,doc,documents,ids).slice(2,-1),first=template.headerRow+1,last=template.headerRow+doc.rows.length,delta=last-layout.lastDataRow;
 const bySource=new Map(doc.rows.filter(row=>row.sourceRow!==undefined).map(row=>[row.sourceRow!,first+doc.rows.indexOf(row)]));
 const mapRow=(row:number)=>row>layout.lastDataRow&&row<=layout.lastRow?row+delta:row===layout.lastDataRow?last:row;
 const rangeRow=(row:number,start=false)=>{if(row<first||row>layout.lastDataRow)return mapRow(row);if(row===layout.lastDataRow)return last;if(start&&row===first)return first;const matched=[...bySource].filter(([source])=>source<=row).map(([,target])=>target);return matched.length?Math.max(...matched):Math.min(row,last);};
 const mapReference=(column:string,row:number)=>{if(row>=first&&row<=layout.lastDataRow){const mapped=bySource.get(row);return mapped?column+mapped:'0';}return column+mapRow(row);};
 const values=new Map<string,XlCell>();const rows:string[]=[];
 for(const row of layout.headerRows){
  const cells=row.cells.map(c=>{let value=c.value;if(typeof value==='string')value=periodText(value,template,doc);if(template.group==='comparison'&&row.row===3&&(c.key==='G'||c.key==='M'))value=serial(c.key==='G'?doc.rules.comparisonMonth:doc.month);values.set(c.key+row.row,value);return cellXml(c.key+row.row,value,c.attrs);}).join('');
  rows.push(`<row r="${row.row}"${attrs(row.attrs)}>${cells}</row>`);
 }
 generated.forEach((line,i)=>{
  const source=doc.rows[i].sourceRow??first,pattern=layout.patterns[layout.body[String(source)]??layout.body[String(first)]??0],r=first+i;
  const cells=new Map<string,XlCell>();
  template.columns.forEach((column,at)=>{
   let value=line[at]??null;
   if(typeof value==='object'&&value!==null&&template.headerRow!==2)value={...value,f:value.f.replace(/(\$?[A-Z]+\$?)(\d+)\b/g,(_all,c,n)=>c+String(Number(n)+template.headerRow-2))};
   if(column.date&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))value=(Date.parse(value+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
   // Match original identifier cell types without dropping leading zeroes.
   if(typeof value==='string'&&pattern?.types?.[column.key]==='n'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&value.replace(/\D/g,'').length<=15)value=Number(value);
   cells.set(column.key,value);values.set(column.key+r,value);
  });
  const keys=new Set([...Object.keys(pattern?.cells||{}),...cells.keys()]);
  rows.push(`<row r="${r}"${attrs(pattern?.attrs||{})}>${[...keys].sort((a,b)=>columnIndex(a)-columnIndex(b)).map(k=>cellXml(k+r,cells.get(k)??null,pattern?.cells[k]||{})).join('')}</row>`);
 });
 const footerFormulas=new Map<string,string>();const footerStyles=new Map<string,Attributes>();
 const days=doc.rules.divisor==='calendar'?monthDays(doc.month):Number(doc.rules.divisor);
 for(const row of layout.footerRows)for(const c of row.cells){
  const original=c.key+row.row,address=c.key+mapRow(row.row);footerStyles.set(address,c.attrs);
  if(c.formula){
   let formula=c.formula.replace(/\$/g,'').replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g,(_all,a,r1,b,r2)=>a+rangeRow(Number(r1),true)+':'+b+rangeRow(Number(r2)));
   // Single-row references stay with the employee after insertion, removal or sorting.
   formula=formula.replace(/(?<![:A-Z0-9])([A-Z]+)(\d+)(?!\d|:)/g,(_all,c,r)=>mapReference(c,Number(r)));
   if(template.group==='unit3'){formula=formula.replace(/\/31\b/g,'/'+days).replace(/\/1025\b/g,'/'+(doc.rules.summaryHeadcount??1025));if(template.id==='unit3-nats-actual-salary')formula=formula.replace(/\/11\b/g,'/'+doc.rows.length);}
   footerFormulas.set(address,formula);
  }else values.set(address,c.input?doc.footerValues?.[original]??null:c.value);
 }
 const visiting=new Set<string>();
 const read=(address:string):number=>{
  if(visiting.has(address))throw new Error('Circular summary calculation at '+address);
  if(footerFormulas.has(address)&&!values.has(address)){
   visiting.add(address);let expression=footerFormulas.get(address)!;
   expression=expression.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g,(_all,a,r1,b,r2)=>{
    const amounts:number[]=[];for(let r=Number(r1);r<=Number(r2);r++)for(let c=columnIndex(a);c<=columnIndex(b);c++){const key=String.fromCharCode(65+c%26);const prefix=c>=26?String.fromCharCode(64+Math.floor(c/26))+key:key;const at=prefix+r;const v=values.get(at);amounts.push(footerFormulas.has(at)?read(at):typeof v==='number'?v:typeof v==='object'&&v!==null?v.v??0:0);}return amounts.join(',')||'0';
   });
   expression=expression.replace(/([A-Z]+)(\d+)\b/g,(_all,c,r)=>`(${read(c+r)})`);
   try{const result=calculateExpression(expression,()=>{throw new Error('Unknown summary reference.');});values.set(address,{f:footerFormulas.get(address)!,v:result});}catch(error){throw new Error(`Summary ${address}: ${(error as Error).message}`);}finally{visiting.delete(address);}
  }
  const v=values.get(address);return typeof v==='object'&&v!==null?v.v??0:typeof v==='number'?v:typeof v==='string'&&v.trim()&&Number.isFinite(Number(v))?Number(v):0;
 };
 for(const address of footerFormulas.keys())read(address);
 for(const row of layout.footerRows){const r=mapRow(row.row);rows.push(`<row r="${r}"${attrs(row.attrs)}>${row.cells.map(c=>cellXml(c.key+r,values.get(c.key+r)??null,footerStyles.get(c.key+r))).join('')}</row>`);}
 const metadata=(text:string)=>text.replace(/(ref|sqref|topLeftCell)="([^"]*)"/g,(_all,key:string,reference:string)=>key+'="'+reference.replace(/(\$?[A-Z]+\$?)(\d+)\b/g,(_all,c:string,r:string)=>{const row=Number(r);return c+(row>=first&&row<=layout.lastDataRow?bySource.get(row)??Math.min(row,last):mapRow(row));}).replace(/(\$?[A-Z]+\$?)(\d+):(\$?[A-Z]+\$?)(\d+)/g,(_all,a,r1,b,r2)=>a+Math.min(Number(r1),Number(r2))+':'+b+Math.max(Number(r1),Number(r2)))+'"');
 return {xml:metadata(layout.prefix)+'<sheetData>'+rows.join('')+'</sheetData>'+metadata(layout.suffix),printNames:layout.printNames.map(n=>({...n,value:n.value.replace(/(\$?[A-Z]+\$?)(\d+)\b/g,(_all,c,r)=>c+mapRow(Number(r)))}))};
}

export function buildSalaryWorkbook(group:string,documents:Record<string,SheetDocument>,selectedIds?:string[]):Uint8Array {
 const source=layouts[group];if(!source)throw new Error('Unknown salary format.');
 const ids=selectedIds??source.sheetOrder.filter(id=>sheetTemplates.some(t=>t.id===id));
 for(const id of ids)if(!documents[id]||!documents[id].rows.length&&!documents[id].generation)throw new Error('Add or import employees for '+(sheetTemplates.find(t=>t.id===id)?.name||id)+'.');
 if(!ids.some(id=>documents[id].rows.length))throw new Error('No employees have records in this group for the selected month.');
 const order=selectedIds?source.sheetOrder.filter(id=>selectedIds.includes(id)):source.sheetOrder;
 const files:Record<string,Uint8Array>={};const sheetNodes:string[]=[],relationships:string[]=[],overrides:string[]=[],defined:string[]=[];
 order.forEach((id,i)=>{
  const template=sheetTemplates.find(t=>t.id===id),layout=source.layouts[id],sheet=template?worksheet(template,documents[id],documents,ids,layout as Layout):{xml:(layout as EmptyLayout).emptyXml,printNames:(layout as EmptyLayout).printNames},name=template?.sheetName||id;
  files[`xl/worksheets/sheet${i+1}.xml`]=strToU8(sheet.xml);sheetNodes.push(`<sheet name="${xmlEscape(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`);relationships.push(`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`);overrides.push(`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  for(const n of sheet.printNames)defined.push(`<definedName name="${xmlEscape(n.name)}" localSheetId="${i}">${xmlEscape(n.value)}</definedName>`);
 });
 files['xl/styles.xml']=strToU8(source.styles);
 relationships.push('<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
 if(source.theme){files['xl/theme/theme1.xml']=strToU8(source.theme);relationships.push('<Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>');overrides.push('<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>');}
 files['xl/workbook.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheetNodes.join('')}</sheets>${defined.length?'<definedNames>'+defined.join('')+'</definedNames>':''}<calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>`);
 files['xl/_rels/workbook.xml.rels']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
 files['_rels/.rels']=strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="workbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 // Row coordinates let a reimport keep employee-specific formatting and summary
 // selections after records are inserted or removed. This adds no visible tab.
 const coordinates=Object.fromEntries(ids.map(id=>[sheetTemplates.find(t=>t.id===id)!.sheetName,documents[id].rows.map(r=>r.sourceRow??null)]));
 files['docProps/custom.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="SalaryLayoutRows"><vt:lpwstr>${xmlEscape(JSON.stringify(coordinates))}</vt:lpwstr></property></Properties>`);
 files['_rels/.rels']=strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="workbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="properties" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>');
 files['[Content_Types].xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>${overrides.join('')}</Types>`);
 return zipSync(files,{level:6});
}

export async function downloadSalaryWorkbook(group:string,documents:Record<string,SheetDocument>,month:string,selectedIds?:string[]){
 const bytes=buildSalaryWorkbook(group,documents,selectedIds),blob=new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`Salary-${group}-${month}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
