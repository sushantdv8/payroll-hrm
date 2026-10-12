import configs from './salary-sheet-templates.json';
import footerConfig from './salary-sheet-footer.json';
import {monthDays} from './payroll';
import type {XlCell} from './client-api';

export type SheetCell=string|number|null;
export type SheetColumn={key:string;label:string;numeric:boolean;date:boolean;formula:string|null};
export type SheetTemplate={id:string;group:string;name:string;sheetName:string;title:string;sampleMonth:string;sampleFile:string;headerRow:number;columns:SheetColumn[];persistent:string[];required:string[];dayColumn:string;rateColumn:string;netColumn:string;links:Record<string,string[]>};
export const sheetTemplates=configs as SheetTemplate[];
export type InputRow={card:string;values:Record<string,SheetCell>;formulas?:Record<string,string>;overrides?:Record<string,number>;note?:string;sourceRow?:number};
export type SheetRules={divisor:'calendar'|'30'|'26';pfPct:number;esiPct:number;employerEsiPct:number;ctcPct:number;claimEmployerCap:number;claimOtherCap:number;claimPriorityCap:number;comparisonMonth:string;summaryHeadcount?:number};
export type SheetDocument={templateId:string;month:string;revision:number;rows:InputRow[];rules:SheetRules;formulaEdits?:Record<string,string>;sourceFile?:string;footerValues?:Record<string,SheetCell>;generation?:{scope:string}};
export const footerFields=footerConfig as Record<string,{address:string;label:string;identifier:boolean}[]>;
export const defaultSheetRules=(template:SheetTemplate,month:string):SheetRules=>({divisor:template.group==='subsidy'?'30':'calendar',pfPct:12,esiPct:0.75,employerEsiPct:3.25,ctcPct:22.477,claimEmployerCap:1000,claimOtherCap:5000,claimPriorityCap:6000,comparisonMonth:previousMonth(month)});
export const previousMonth=(month:string)=>{const [y,m]=month.split('-').map(Number);const d=new Date(Date.UTC(y,m-2,1));return d.toISOString().slice(0,7);};
export const excelRound=(n:number,d=0)=>{const k=10**d;return Math.sign(n)*Math.round(Math.abs(n)*k+1e-8)/k;};
export const columnIndex=(key:string)=>[...key].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
export const sheetDate=(value:SheetCell|undefined)=>typeof value==='number'?new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10):String(value??'');
const n=(v:SheetCell|undefined)=>v==null||v===''?0:typeof v==='number'?v:Number(v);

// A small Excel expression parser. It accepts cell columns and arithmetic, never JavaScript or external links.
export function calculateExpression(expression:string,read:(key:string)=>number):number {
 const source=expression.replace(/^=/,'').replace(/\$/g,'').replace(/([A-Z]+)\d+\b/g,'$1');
 const tokens=source.match(/\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+|[A-Z_][A-Z_0-9.]*|[+\-*/(),%:]/g)||[];
 if(tokens.join('')!==source.replace(/\s/g,''))throw new Error('Use column letters, numbers, + - * / and Excel rounding functions.');
 let i=0;
 const take=(x:string)=>{if(tokens[i]!==x)throw new Error('Invalid calculation.');i++;};
 const expr=():number=>{let x=term();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++],y=term();x=op==='+'?x+y:x-y;}return x;};
 const term=():number=>{let x=factor();while(tokens[i]==='*'||tokens[i]==='/'){const op=tokens[i++],y=factor();if(op==='/'&&y===0)throw new Error('Division by zero.');x=op==='*'?x*y:x/y;}return x;};
 const factor=():number=>{
  if(tokens[i]==='+'){i++;return factor();}if(tokens[i]==='-'){i++;return -factor();}
  let x:number;const token=tokens[i++];
  if(token==='('){x=expr();take(')');}
  else if(/^\d|^\./.test(token||''))x=Number(token);
  else if(/^[A-Z_]/.test(token||'')){
   if(tokens[i]==='('){i++;const args:number[]=[];
    if(tokens[i]!==')')do{args.push(expr());if(tokens[i]!==',')break;i++;}while(i<tokens.length);take(')');
    if(token==='ROUND'&&args.length===2)x=excelRound(args[0],args[1]);
    else if(token==='ROUNDUP'&&args.length===2){const k=10**args[1];x=Math.sign(args[0])*Math.ceil(Math.abs(args[0])*k-1e-9)/k;}
    else if(token==='MROUND'&&args.length===2){if(args[1]===0)x=0;else if(args[0]*args[1]<0)throw new Error('MROUND requires amounts with the same sign.');else x=excelRound(args[0]/args[1])*args[1];}
    else if(['SUM','MIN','MINA','MAX','ABS'].includes(token)&&args.length)x=token==='SUM'?args.reduce((s,v)=>s+v,0):token==='MAX'?Math.max(...args):token==='ABS'?Math.abs(args[0]):Math.min(...args);
    else throw new Error('Unsupported calculation function: '+token);
   }else x=read(token);
  }else throw new Error('Invalid calculation.');
  if(tokens[i]==='%'){i++;x/=100;}return x;
 };
 const result=expr();if(i!==tokens.length||!Number.isFinite(result))throw new Error('Invalid calculation.');return result;
}

export type CalculatedSheetRow={input:InputRow;values:Record<string,SheetCell>;errors:string[];manual:string[]};
export function effectiveFormula(template:SheetTemplate,doc:SheetDocument,row:InputRow,key:string):string|null {
 const base=doc.formulaEdits?.[key]??row.formulas?.[key]??template.columns.find(c=>c.key===key)?.formula;
 if(!base)return null;
 return base.replace(/12%/g,'PFPC/100').replace(/0\.75%/g,'ESIPC/100').replace(/3\.25%/g,'ERESIPC/100').replace(/22\.477%/g,'CTCPC/100').replace(/MINA\(AM,1000\)/g,'MIN(AM,EMPCLAIMCAP)').replace(/MINA\(AA,5000\)/g,'MIN(AA,OTHERCAP)').replace(/MINA\(AA,6000\)/g,'MIN(AA,PRIORITYCAP)');
}
export function computeSheet(template:SheetTemplate,doc:SheetDocument,documents:Record<string,SheetDocument>={},stack=new Set<string>()):CalculatedSheetRow[] {
 const docKey=template.id+'|'+doc.month;if(stack.has(docKey))throw new Error('Circular sheet link.');const path=new Set(stack).add(docKey);
 const linked=new Map<string,Map<string,CalculatedSheetRow>>();
 for(const [id] of Object.values(template.links)){const t=sheetTemplates.find(t=>t.id===id),d=documents[id];if(t&&d&&!linked.has(id))linked.set(id,new Map(computeSheet(t,d,documents,path).map(r=>[r.input.card,r])));}
 return doc.rows.map(row=>{
  const values={...row.values};const errors:string[]=[],manual:string[]=[];const visiting=new Set<string>(),done=new Set<string>();
  const rules={...defaultSheetRules(template,doc.month),...doc.rules};const days=rules.divisor==='calendar'?monthDays(doc.month):Number(rules.divisor);
  const gender=String(values[template.group==='subsidy'?'E':'G']||'').trim().toUpperCase();const category=String(values[template.group==='subsidy'?'F':'H']||'').trim().toUpperCase();
  const variables:Record<string,number>={DAYS:days,PFPC:rules.pfPct,ESIPC:rules.esiPct,ERESIPC:rules.employerEsiPct,CTCPC:rules.ctcPct,EMPCLAIMCAP:rules.claimEmployerCap,OTHERCAP:rules.claimOtherCap,PRIORITYCAP:rules.claimPriorityCap,CLAIMCAP:gender==='FEMALE'||['SC','ST'].includes(category)?rules.claimPriorityCap:rules.claimOtherCap};
  for(const key of template.required)if(values[key]==null||values[key]==='')errors.push('Missing '+(template.columns.find(c=>c.key===key)?.label||key));
  const read=(key:string):number=>{
   if(key in variables)return variables[key];
   if(!template.columns.some(c=>c.key===key))throw new Error('Unknown column '+key);
   if(visiting.has(key))throw new Error('Circular calculation at '+key);
   if(done.has(key)){const v=n(values[key]);if(!Number.isFinite(v)||values[key]===null)throw new Error('Missing value in '+key);return v;}
   visiting.add(key);try{
    if(row.overrides?.[key]!==undefined){values[key]=row.overrides[key];manual.push(key);}
    else if(template.links[key]){
     const [id,column]=template.links[key];const other=linked.get(id)?.get(row.card);
     if(other){values[key]=other.values[column];if(values[key]===null||other.errors.length)throw new Error('Linked sheet needs inputs: '+id);}
     else if(row.values[key]===undefined||row.values[key]===null)throw new Error('Import or generate linked sheet '+id);
     else {values[key]=row.values[key];manual.push(key);}
    }else {const f=effectiveFormula(template,doc,row,key);if(f)values[key]=calculateExpression(f,read);}
    const value=n(values[key]);if(!Number.isFinite(value))throw new Error('Enter a number in '+key);
    if(template.required.includes(key)&&(values[key]===null||values[key]===''))throw new Error('Missing '+key);
    done.add(key);return value;
   }finally{visiting.delete(key);}
  };
  for(const col of template.columns)if(col.formula||doc.formulaEdits?.[col.key]||row.formulas?.[col.key]||template.links[col.key])try{read(col.key);}catch(error){values[col.key]=null;errors.push(col.label+': '+(error as Error).message);}
  return {input:row,values,errors:[...new Set(errors)],manual};
 });
}

export function sheetTitle(template:SheetTemplate,month:string) {
 const [y,m]=month.split('-').map(Number),long=new Date(Date.UTC(y,m-1,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'}).toUpperCase();
 if(template.group==='unit')return template.title.replace(/AUGUST\s*-\s*(?:2026|26)/i,long+'-'+y);
 if(template.group==='subsidy')return `KISHOR EXPORTS ( UNIT - 2 ) SUBSIDY SHEET ${long} - ${y}`;
 if(template.group==='comparison')return `KISHOR EXPORT — Comparison report ${month}`;
 return `KISHOR EXPORTS UNIT 3 SALARY SHEET (${long} ${y})`;
}
export function workbookRows(template:SheetTemplate,doc:SheetDocument,documents:Record<string,SheetDocument>={},exportedIds:string[]=[]):XlCell[][] {
 const calc=computeSheet(template,doc,documents);if(calc.some(r=>r.errors.length))throw new Error('Fill the missing inputs before exporting.');
 const keys=template.columns.map(c=>c.key),out:XlCell[][]=[[sheetTitle(template,doc.month)],template.columns.map(c=>template.group==='comparison'&&columnIndex(c.key)>=6?(columnIndex(c.key)<12?doc.rules.comparisonMonth:columnIndex(c.key)<18?doc.month:'Difference')+' '+c.label:c.label)];
 const vars=(row:InputRow)=>{const rules={...defaultSheetRules(template,doc.month),...doc.rules};const sex=String(row.values.E||'').toUpperCase(),cat=String(row.values.F||'').toUpperCase();return {DAYS:rules.divisor==='calendar'?monthDays(doc.month):Number(rules.divisor),PFPC:rules.pfPct,ESIPC:rules.esiPct,ERESIPC:rules.employerEsiPct,CTCPC:rules.ctcPct,EMPCLAIMCAP:rules.claimEmployerCap,OTHERCAP:rules.claimOtherCap,PRIORITYCAP:rules.claimPriorityCap,CLAIMCAP:sex==='FEMALE'||['SC','ST'].includes(cat)?rules.claimPriorityCap:rules.claimOtherCap};};
 calc.forEach((r,i)=>{const line=i+3;out.push(template.columns.map(c=>{
  if(c.key==='A')return i+1;const v=r.values[c.key]??null;
  if(r.input.overrides?.[c.key]!==undefined)return v;
  if(template.links[c.key]){const [targetId,targetColumn]=template.links[c.key],target=sheetTemplates.find(t=>t.id===targetId),other=documents[targetId];
   if(target&&other?.rows.length&&exportedIds.includes(targetId)){const end=target.columns.at(-1)!.key,name=target.sheetName.replace(/'/g,"''");return {f:`IFERROR(VLOOKUP($B${line},'${name}'!$B$3:$${end}$${other.rows.length+2},${columnIndex(targetColumn)},FALSE),${typeof v==='number'?v:0})`,v:typeof v==='number'?v:0};}
   return v;
  }
  let f=effectiveFormula(template,doc,r.input,c.key);if(!f)return v;
  for(const [key,num] of Object.entries(vars(r.input)))f=f.replace(new RegExp('\\b'+key+'\\b','g'),String(num));
  f=f.replace(/\b[A-Z]+\b(?!\s*\()/g,k=>keys.includes(k)?k+line:k);
  return {f,v:typeof v==='number'?v:0};
 }));});
 if(calc.length)out.push(template.columns.map(c=>c.numeric?{f:`SUM(${c.key}3:${c.key}${calc.length+2})`,v:calc.reduce((s,r)=>s+(typeof r.values[c.key]==='number'?Number(r.values[c.key]):0),0)}:c.key==='C'?'Total':null));
 return out;
}

// Prepare a fresh month from stable employee details/rates only; never repeat last month's attendance or deductions.
export function freshMonth(template:SheetTemplate,previous:SheetDocument,month:string):SheetDocument {
 return {templateId:template.id,month,revision:0,rules:{...previous.rules,comparisonMonth:previousMonth(month)},formulaEdits:previous.formulaEdits,footerValues:Object.fromEntries((footerFields[template.id]||[]).map(f=>[f.address,null])),rows:previous.rows.map(row=>{
  const values:Record<string,SheetCell>={};for(const key of template.persistent)if(row.values[key]!==undefined)values[key]=row.values[key];
  if(template.group==='subsidy'){values.AK=Number(month.slice(0,4));values.AL=new Date(month+'-01T00:00:00Z').toLocaleString('en-US',{month:'long',timeZone:'UTC'});}
  const overrides:Record<string,number>={};
  // Explicit zero contribution exemptions from the sample remain employee settings, not monthly attendance.
  if(template.group==='unit3')for(const key of ['AH','AI','AJ','AK','AL','AM','AN']){
   const column=template.columns.find(c=>c.key===key);if(!column||!/EPF|ESI/.test(column.label))continue;
   const flag=String(values[column.label.includes('EPF')?'O':'R']||'').trim().toUpperCase();
   if(['N','NO','0'].includes(flag)&&row.overrides?.[key]===0)overrides[key]=0;
  }
  if(template.group==='subsidy')for(const key of ['V','W'])if(row.overrides?.[key]===0&&String(values.T||'').trim().toUpperCase()==='NO')overrides[key]=0;
  return {card:row.card,sourceRow:row.sourceRow,values,overrides,note:'New month: enter or import attendance and monthly adjustments.'};
 })};
}
