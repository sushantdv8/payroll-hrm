'use client';
import {useEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent,type MouseEvent as ReactMouseEvent,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDown,ArrowUp,ChartColumn,ChevronDown,ChevronLeft,ChevronRight,Columns3,Download,Funnel,Printer,RotateCcw,Search,X} from 'lucide-react';
import {toast} from 'sonner';
import {exportExcel,type XlCell} from '@/lib/client-api';
import {compareKeys,nodeText,sortKey,sumColumn,type SortKey,type Tone} from '@/lib/smart-report';
import type {Column} from './report-parts';
import type {ReportPage} from './report-form';

// The smart view of a table report: the same rows as the printed pages, but as a table that can be searched, sorted, filtered, grouped, summed and exported.
// A report built with tablePages gets it for free; it may add what it knows about its rows (SmartSpec): colours, a status, quick filters (chips) and a detail panel.
// Row numbers in a SmartSpec (status, tone, chip tests, detail) are the positions in SmartTable.rows; groupBy is a column of SmartTable.columns.
export type SmartChip={id:string;label:string;tone?:Tone;test:(row:number)=>boolean;before?:number};
export type SmartSpec={
 chips?:SmartChip[];            // quick filters; each shows how many rows it matches ("before": the same count one period earlier, shown as +n / -n)
 chipLabel?:string;             // what "before" is ("yesterday")
 initialChip?:string;           // the chip that is on when the view opens
 status?:string[];              // per row: a Status column
 tone?:(Tone|'')[];             // per row: the colour of the row and of its status
 groupBy?:number;               // column to group by when the view opens (e.g. Department)
 sums?:number[];               // columns that add up in the footer (default: the columns marked "num"); a column of clock times (In / Out) must not be in it
 detail?:(row:number)=>ReactNode;
 detailTitle?:(row:number)=>string;
 defaultView?:boolean;          // the report opens in the smart view
 pref?:string;                  // key under which the choices are remembered
};
// pagesFor: the printed pages of some of the rows (what the smart view shows after the quick filter, search and column filters); note says which filters were on.
export type SmartTable={key:string;title:string;subtitle?:string;fileName:string;columns:Column[];rows:ReactNode[][];smart?:SmartSpec;pagesFor:(rows:ReactNode[][],note?:string)=>ReportPage[]};

const ROW=30,HEAD=34,MAXFILTER=80;
type Sort={col:number;dir:1|-1}|null;
type Saved={on?:boolean;hidden?:number[];group?:number|null;overview?:boolean};
export const smartPrefKey=(t:SmartTable)=>t.smart?.pref||t.key.replace(/-\d+$/,'');
export function loadSmartPrefs(t:SmartTable):Saved{try{const all=JSON.parse(localStorage.getItem('rpt-smart')||'{}')||{};const s=all[smartPrefKey(t)];return s&&typeof s==='object'?s:{};}catch{return {};}}
export function saveSmartPrefs(t:SmartTable,patch:Saved){try{const all=JSON.parse(localStorage.getItem('rpt-smart')||'{}')||{};all[smartPrefKey(t)]={...(all[smartPrefKey(t)]||{}),...patch};localStorage.setItem('rpt-smart',JSON.stringify(all));}catch{/* the browser may refuse storage */}}

type Item={kind:'group';label:string;count:number}|{kind:'row';row:number};
const byLabel=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});

// A small panel that floats above the page (the column filter): the viewer's scroll areas would clip it.
function Floating({at,onClose,children}:{at:{x:number;y:number};onClose:()=>void;children:ReactNode}){
 const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{const off=(e:MouseEvent)=>{if(!box.current?.contains(e.target as Node))onClose();};const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
  document.addEventListener('mousedown',off);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',off);document.removeEventListener('keydown',esc);};},[onClose]);
 return createPortal(<div ref={box} className="rpt-sm-pop" style={{left:Math.max(8,Math.min(at.x,window.innerWidth-270)),top:Math.max(8,Math.min(at.y,window.innerHeight-340))}}>{children}</div>,document.body);
}

export function SmartView({table,onPrint,active=true}:{table:SmartTable;onPrint:(rows:ReactNode[][],note:string)=>void;active?:boolean}){
 const spec=table.smart;const status=spec?.status;const hasStatus=!!status;const off=hasStatus?1:0;
 // With a status the Status column comes first, so it sorts, filters and groups like the others.
 const columns=useMemo<Column[]>(()=>hasStatus?[{h:'Status'},...table.columns]:table.columns,[hasStatus,table.columns]);const nCols=columns.length;
 const texts=useMemo(()=>table.rows.map((r,i)=>[...(status?[status[i]||'']:[]),...r.map(nodeText)]),[table.rows,status]);
 const [saved]=useState(()=>loadSmartPrefs(table));
 const [q,setQ]=useState('');const [chip,setChip]=useState(spec?.initialChip||'all');const [sort,setSort]=useState<Sort>(null);
 // a new report of the same kind (another day, "Present" instead of "All") starts on its own quick filter; one that stays keeps the user's choice
 const [seenChip,setSeenChip]=useState(spec?.initialChip);if(spec?.initialChip!==seenChip){setSeenChip(spec?.initialChip);if(spec?.initialChip&&(spec.initialChip==='all'||spec.chips?.some(c=>c.id===spec.initialChip)))setChip(spec.initialChip);}
 const [hidden,setHidden]=useState<Set<number>>(()=>new Set((saved.hidden||[]).filter(c=>c<nCols)));
 const [groupCol,setGroupCol]=useState<number|null>(()=>saved.group===undefined?(spec?.groupBy!==undefined?spec.groupBy+off:null):(typeof saved.group==='number'&&saved.group<nCols?saved.group:null));
 const [collapsed,setCollapsed]=useState<Set<string>>(()=>new Set());const [filters,setFilters]=useState<Map<number,Set<string>>>(()=>new Map());
 const [selRaw,setSel]=useState<number|null>(null);const sel=selRaw!==null&&selRaw<table.rows.length?selRaw:null;const [panel,setPanel]=useState(false);const [overview,setOverview]=useState(saved.overview??false);
 const [menu,setMenu]=useState<''|'cols'|'group'>('');const [pop,setPop]=useState<{col:number;x:number;y:number}|null>(null);
 const [top,setTop]=useState(0);const [h,setH]=useState(400);const scroller=useRef<HTMLDivElement>(null);const root=useRef<HTMLDivElement>(null);const search=useRef<HTMLInputElement>(null);

 const widths=useMemo(()=>columns.map((c,i)=>{let m=nodeText(c.h).length+3;const step=Math.max(1,Math.floor(texts.length/400));for(let r=0;r<texts.length;r+=step)m=Math.max(m,(texts[r][i]||'').length);return Math.max(54,Math.min(i<off?230:280,Math.round(m*7.4+26)));}),[columns,texts,off]);
 const shown=useMemo(()=>columns.map((_,i)=>i).filter(i=>!hidden.has(i)),[columns,hidden]);
 const template=shown.map(i=>widths[i]+'px').join(' ');const totalW=shown.reduce((a,i)=>a+widths[i],0);
 const counts=useMemo(()=>Object.fromEntries((spec?.chips||[]).map(c=>{let n=0;for(let r=0;r<table.rows.length;r++)if(c.test(r))n++;return [c.id,n];})),[spec?.chips,table.rows.length]);

 // the rows that pass the quick filter, the search and the column filters
 const chipDef=spec?.chips?.find(c=>c.id===chip);
 const passing=useMemo(()=>{const words=q.trim().toLowerCase().split(/\s+/).filter(Boolean);const out:number[]=[];
  for(let r=0;r<texts.length;r++){
   if(chipDef&&!chipDef.test(r))continue;
   let ok=true;for(const [col,set] of filters){if(!set.has(texts[r][col]||'')){ok=false;break;}}if(!ok)continue;
   if(words.length){const hay=texts[r].join(' ').toLowerCase();if(!words.every(w=>hay.includes(w)))continue;}
   out.push(r);}
  return out;},[texts,q,chipDef,filters]);
 // the sort (stable), then the groups (A-Z) with their rows in that order
 const ordered=useMemo(()=>{if(!sort)return passing;const k:SortKey[]=texts.map(r=>sortKey(r[sort.col]||''));return [...passing].sort((a,b)=>compareKeys(k[a],k[b],sort.dir)||a-b);},[passing,sort,texts]);
 const groups=useMemo(()=>{if(groupCol===null)return null;const by=new Map<string,number[]>();for(const r of ordered){const g=texts[r][groupCol]||'';const l=by.get(g);if(l)l.push(r);else by.set(g,[r]);}
  return [...by.entries()].sort((a,b)=>byLabel(a[0],b[0]));},[ordered,groupCol,texts]);
 const flat=useMemo(()=>groups?groups.flatMap(g=>g[1]):ordered,[groups,ordered]);   // every passing row in the order of the table, collapsed groups included (Excel, Print)
 const items=useMemo<Item[]>(()=>groups?groups.flatMap(([label,rows])=>[{kind:'group' as const,label,count:rows.length},...(collapsed.has(label)?[]:rows.map(row=>({kind:'row' as const,row})))]):ordered.map(row=>({kind:'row' as const,row})),[groups,ordered,collapsed]);
 const rowsAt=useMemo(()=>items.flatMap(i=>i.kind==='row'?[i.row]:[]),[items]);

 useEffect(()=>{const el=scroller.current;if(!el)return;const measure=()=>setH(el.clientHeight);measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect();},[]);
 useEffect(()=>{scroller.current?.scrollTo({top:0});},[q,chip,sort,groupCol,filters]);   // the scroll event updates "top"
 useEffect(()=>{saveSmartPrefs(table,{hidden:[...hidden],group:groupCol,overview});},[hidden,groupCol,overview]);   // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(active)root.current?.focus({preventScroll:true});},[active]);

 const from=Math.max(0,Math.floor(top/ROW)-6),to=Math.min(items.length,Math.ceil((top+h)/ROW)+6);
 const sumSet=useMemo(()=>new Set((spec?.sums??table.columns.flatMap((c,i)=>c.cls?.includes('num')?[i]:[])).map(i=>i+off)),[spec?.sums,table.columns,off]);
 const sums=useMemo(()=>shown.map(i=>sumSet.has(i)&&passing.length?sumColumn(passing.map(r=>texts[r][i]||'')):null),[shown,passing,texts,sumSet]);
 // every group with its tones (the overview counts all rows, the table only the passing ones)
 const groupStats=useMemo(()=>{if(groupCol===null)return [];const by=new Map<string,{n:number;tones:Record<string,number>;pass:number}>();const pass=new Set(passing);
  texts.forEach((r,i)=>{const g=r[groupCol]||'';let s=by.get(g);if(!s){s={n:0,tones:{},pass:0};by.set(g,s);}s.n++;const t=spec?.tone?.[i]||'none';s.tones[t]=(s.tones[t]||0)+1;if(pass.has(i))s.pass++;});
  return [...by.entries()].sort((a,b)=>byLabel(a[0],b[0]));},[groupCol,texts,spec?.tone,passing]);

 const dirty=filters.size>0||q.trim()!==''||chip!==(spec?.initialChip||'all')||sort!==null;
 const reset=()=>{setQ('');setChip(spec?.initialChip||'all');setSort(null);setFilters(new Map());setCollapsed(new Set());};
 const clickSort=(col:number)=>setSort(s=>!s||s.col!==col?{col,dir:1}:s.dir===1?{col,dir:-1}:null);
 const openPop=(col:number,e:ReactMouseEvent)=>{const b=(e.currentTarget as HTMLElement).getBoundingClientRect();setPop({col,x:b.left,y:b.bottom+4});};
 const toggleGroup=(id:string)=>setCollapsed(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
 const pickGroupFilter=(g:string)=>{if(groupCol===null)return;setFilters(m=>{const n=new Map(m);const cur=n.get(groupCol);if(cur&&cur.size===1&&cur.has(g))n.delete(groupCol);else n.set(groupCol,new Set([g]));return n;});};

 // Export / print what is on screen: the quick filter, search, filters and sort applied, the hidden columns left out.
 const exportRows=():XlCell[][]=>{const cell=(t:string):XlCell=>/^-?\d+(\.\d+)?$/.test(t)&&!/^0\d/.test(t)?Number(t):t;
  return [shown.map(i=>nodeText(columns[i].h)),...flat.map(r=>shown.map(i=>cell(texts[r][i]||'')))];};
 async function doExport(){if(!flat.length){toast.error('Nothing to export.');return;}try{await exportExcel(table.fileName+'.xlsx',[{name:(table.title||'Report').replace(/[\\/?*[\]:]/g,' ').slice(0,31),rows:exportRows()}]);toast.success(`Excel file created (${flat.length} rows)`);}catch(e){toast.error((e as Error).message);}}
 const doPrint=()=>{if(!flat.length){toast.error('Nothing to print.');return;}
  const what=[chipDef&&chipDef.id!=='all'?chipDef.label:'',q.trim()?`search "${q.trim()}"`:'',...[...filters].map(([col,set])=>`${label(col)}: ${set.size===1?[...set][0]||'(blank)':set.size+' values'}`)].filter(Boolean);
  onPrint(flat.map(r=>table.rows[r]),`${what.length?what.join(', ')+' - ':''}${flat.length} of ${table.rows.length} rows`);};

 const selAt=sel!==null?rowsAt.indexOf(sel):-1;
 const goto=(next:number)=>{setSel(next);const idx=items.findIndex(i=>i.kind==='row'&&i.row===next);const sc=scroller.current;
  if(sc&&idx>=0){const y0=HEAD+idx*ROW,y1=y0+ROW;if(y0<sc.scrollTop+HEAD)sc.scrollTop=y0-HEAD;else if(y1>sc.scrollTop+sc.clientHeight)sc.scrollTop=y1-sc.clientHeight;}};
 const step=(d:number)=>{if(!rowsAt.length)return;goto(rowsAt[Math.max(0,Math.min(rowsAt.length-1,(selAt<0?(d>0?-1:rowsAt.length):selAt)+d))]);};
 function onKey(e:ReactKeyboardEvent<HTMLDivElement>){
  const el=e.target as HTMLElement;if(/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)){if(e.key==='Escape'&&el===search.current){if(q)setQ('');else el.blur();e.preventDefault();}return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='/'){search.current?.focus();search.current?.select();e.preventDefault();}
  else if(e.key==='ArrowDown'){step(1);e.preventDefault();}else if(e.key==='ArrowUp'){step(-1);e.preventDefault();}
  else if(e.key==='Enter'&&sel!==null&&spec?.detail){setPanel(true);e.preventDefault();}
  else if(e.key==='Escape'){if(menu){setMenu('');e.stopPropagation();}else if(panel){setPanel(false);e.stopPropagation();}}}

 const popValues=useMemo(()=>{if(!pop)return null;const by=new Map<string,number>();texts.forEach(r=>{const v=r[pop.col]||'';by.set(v,(by.get(v)||0)+1);});
  return by.size>MAXFILTER?{tooMany:true as const,list:[] as [string,number][]}:{tooMany:false as const,list:[...by.entries()].sort((a,b)=>compareKeys(sortKey(a[0]),sortKey(b[0])))};},[pop,texts]);
 const popSet=pop?filters.get(pop.col):undefined;
 const toggleValue=(col:number,v:string)=>setFilters(m=>{const n=new Map(m);const all=popValues?.list.map(x=>x[0])||[];const cur=new Set(n.get(col)||all);if(cur.has(v))cur.delete(v);else cur.add(v);if(cur.size===all.length)n.delete(col);else n.set(col,cur);return n;});
 const cls=(i:number)=>i<off?'':columns[i].cls?.includes('num')?' is-num':columns[i].cls?.includes('c')?' is-c':'';
 const label=(i:number)=>nodeText(columns[i].h);

 return <div className="rpt-smart" ref={root} tabIndex={0} onKeyDown={onKey}>
  <div className="rpt-sm-main">
   <div className="rpt-sm-top">
    <div className="rpt-sm-title"><b>{table.title}</b>{table.subtitle&&<span>{table.subtitle}</span>}</div>
    {spec?.chips&&<div className="rpt-sm-chips" role="group" aria-label="Quick filters">
     {[{id:'all',label:'All',test:()=>true} as SmartChip,...spec.chips].map(c=>{const n=c.id==='all'?table.rows.length:counts[c.id]||0;const d=c.before===undefined?null:n-c.before;
      return <button key={c.id} type="button" className={'rpt-sm-chip'+(c.tone?' t-'+c.tone:'')+(chip===c.id?' is-on':'')} aria-pressed={chip===c.id} onClick={()=>setChip(c.id)} title={d===null?undefined:`${d>0?'+':''}${d} against ${spec.chipLabel||'before'}`}>
       <span className="n">{n}</span><span className="l">{c.label}</span>{d!==null&&d!==0&&<span className={'d '+(d>0?'up':'down')}>{d>0?'+':''}{d}</span>}</button>;})}</div>}
    <div className="rpt-sm-tools">
     <label className="rpt-sm-search"><Search size={14}/><input ref={search} aria-label="Search the table" placeholder="Search name, paycode, department …  ( / )" value={q} onChange={e=>setQ(e.target.value)}/>{q&&<button type="button" aria-label="Clear the search" onClick={()=>setQ('')}><X size={13}/></button>}</label>
     <div className="rpt-menu-wrap"><button type="button" className={'rpt-sm-btn'+(groupCol!==null?' is-on':'')} aria-haspopup="menu" aria-expanded={menu==='group'} onClick={()=>setMenu(m=>m==='group'?'':'group')}>Group by: {groupCol===null?'none':label(groupCol)}<ChevronDown size={13}/></button>
      {menu==='group'&&<div className="rpt-menu" role="menu"><button type="button" role="menuitem" onClick={()=>{setGroupCol(null);setMenu('');}}>No grouping</button>{columns.map((_,i)=>label(i)&&<button key={i} type="button" role="menuitem" className={groupCol===i?'is-on':''} onClick={()=>{setGroupCol(i);setCollapsed(new Set());setMenu('');}}>{label(i)}</button>)}</div>}</div>
     <div className="rpt-menu-wrap"><button type="button" className={'rpt-sm-btn'+(hidden.size?' is-on':'')} aria-haspopup="menu" aria-expanded={menu==='cols'} onClick={()=>setMenu(m=>m==='cols'?'':'cols')} title="Show or hide columns"><Columns3 size={14}/>Columns{hidden.size?` (${shown.length}/${nCols})`:''}</button>
      {menu==='cols'&&<div className="rpt-menu" role="menu">{columns.map((_,i)=>label(i)&&<label key={i} className="rpt-sm-check"><input type="checkbox" checked={!hidden.has(i)} onChange={e=>setHidden(s=>{const n=new Set(s);if(e.target.checked)n.delete(i);else n.add(i);return n;})}/>{label(i)}</label>)}
       {hidden.size>0&&<button type="button" role="menuitem" onClick={()=>setHidden(new Set())}>Show all columns</button>}</div>}</div>
     {groupCol!==null&&spec?.tone&&<button type="button" className={'rpt-sm-btn'+(overview?' is-on':'')} aria-pressed={overview} onClick={()=>setOverview(v=>!v)} title="A bar for every group: who is present, absent, late …"><ChartColumn size={14}/>Overview</button>}
     <span className="rpt-sep"/>
     <button type="button" className="rpt-sm-btn" onClick={doExport} title="Export the rows on screen to Excel"><Download size={14}/>Excel</button>
     <button type="button" className="rpt-sm-btn" onClick={doPrint} title="Print the rows on screen"><Printer size={14}/>Print</button>
     {dirty&&<button type="button" className="rpt-sm-btn" onClick={reset} title="Clear the search, quick filter, column filters and sorting"><RotateCcw size={14}/>Reset</button>}
    </div>
    {filters.size>0&&<div className="rpt-sm-active">{[...filters].map(([col,set])=><span key={col} className="rpt-sm-tag">{label(col)}: {set.size===1?[...set][0]||'(blank)':`${set.size} values`}<button type="button" aria-label={'Remove the filter on '+label(col)} onClick={()=>setFilters(m=>{const n=new Map(m);n.delete(col);return n;})}><X size={11}/></button></span>)}</div>}
   </div>
   {overview&&groupCol!==null&&<div className="rpt-sm-over" aria-label="Overview">
    {groupStats.map(([g,s])=>{const on=filters.get(groupCol)?.size===1&&filters.get(groupCol)!.has(g);
     return <button key={g} type="button" className={'rpt-sm-bar'+(on?' is-on':'')} onClick={()=>pickGroupFilter(g)} title={`${g}: ${s.n} - click to show only this group`}>
      <span className="nm">{g||'(none)'}</span><span className="bar">{(['ok','warn','bad','info','mute','none'] as const).map(t=>s.tones[t]?<i key={t} className={'t-'+t} style={{width:(s.tones[t]/s.n*100)+'%'}}/>:null)}</span><span className="ct">{s.pass===s.n?s.n:`${s.pass}/${s.n}`}</span></button>;})}
    <div className="rpt-sm-legend"><i className="t-ok"/>Present<i className="t-warn"/>Late / mispunch / half day<i className="t-bad"/>Absent<i className="t-info"/>Leave<i className="t-mute"/>Off<i className="t-none"/>No entry</div></div>}
   <div className="rpt-sm-scroll" ref={scroller} onScroll={e=>setTop(e.currentTarget.scrollTop)}>
    <div className="rpt-sm-grid" role="table" aria-rowcount={items.length} style={{minWidth:totalW}}>
     <div className="rpt-sm-head" role="row" style={{gridTemplateColumns:template,height:HEAD}}>
      {shown.map(i=>{const on=sort?.col===i;return <div key={i} role="columnheader" aria-sort={on?(sort!.dir===1?'ascending':'descending'):'none'} className={'rpt-sm-th'+cls(i)+(on?' is-sorted':'')}>
       <button type="button" className="rpt-sm-sort" onClick={()=>clickSort(i)} title="Click to sort"><span>{columns[i].h}</span>{on&&(sort!.dir===1?<ArrowUp size={12}/>:<ArrowDown size={12}/>)}</button>
       <button type="button" className={'rpt-sm-fbtn'+(filters.has(i)?' is-on':'')} aria-label={'Filter '+label(i)} title="Filter this column" onClick={e=>openPop(i,e)}><Funnel size={11}/></button></div>;})}
     </div>
     <div className="rpt-sm-body" style={{height:items.length*ROW}}>
      {items.slice(from,to).map((it,k)=>{const y=(from+k)*ROW;
       if(it.kind==='group')return <div key={'g'+it.label} role="row" className="rpt-sm-row is-group" style={{top:y,height:ROW}}>
        <button type="button" className="rpt-sm-gtog" aria-expanded={!collapsed.has(it.label)} onClick={()=>toggleGroup(it.label)}>{collapsed.has(it.label)?<ChevronRight size={14}/>:<ChevronDown size={14}/>}<b>{it.label||'(none)'}</b><span>{it.count} {it.count===1?'row':'rows'}</span></button></div>;
       const r=it.row,t=spec?.tone?.[r]||'';
       return <div key={r} role="row" aria-selected={sel===r} className={'rpt-sm-row'+(t?' t-'+t:'')+(sel===r?' is-sel':'')} style={{top:y,height:ROW,gridTemplateColumns:template}} onClick={()=>{setSel(r);if(spec?.detail)setPanel(true);}}>
        {shown.map(i=>i<off?<div key={i} role="cell" className="rpt-sm-td"><span className={'rpt-sm-badge'+(t?' t-'+t:'')}>{texts[r][0]}</span></div>
         :<div key={i} role="cell" className={'rpt-sm-td'+cls(i)} title={texts[r][i]||undefined}>{table.rows[r][i-off]}</div>)}</div>;})}
     </div>
     {!items.length&&<p className="rpt-sm-none">{table.rows.length?'No rows match the search, quick filter and column filters.':'This report has no rows.'}{dirty&&<button type="button" onClick={reset}>Clear them</button>}</p>}
    </div>
   </div>
   <div className="rpt-sm-foot"><span><b>{passing.length}</b> of {table.rows.length} rows{groups&&` · ${groups.length} groups`}</span>
    <span className="rpt-sm-sums">{shown.map((i,k)=>sums[k]&&<span key={i}>{label(i)}: <b>{sums[k]!.text}</b></span>)}</span></div>
  </div>
  {panel&&spec?.detail&&sel!==null&&<aside className="rpt-sm-panel" aria-label="Details">
   <div className="rpt-sm-ph"><div><b>{spec.detailTitle?.(sel)||'Details'}</b><span>{selAt>=0?`${selAt+1} of ${rowsAt.length}`:''}</span></div>
    <button type="button" aria-label="Previous row" disabled={selAt<=0} onClick={()=>step(-1)}><ChevronLeft size={15}/></button><button type="button" aria-label="Next row" disabled={selAt<0||selAt>=rowsAt.length-1} onClick={()=>step(1)}><ChevronRight size={15}/></button><button type="button" aria-label="Close the details" onClick={()=>setPanel(false)}><X size={15}/></button></div>
   <div className="rpt-sm-pb">{spec.detail(sel)}</div></aside>}
  {pop&&<Floating at={pop} onClose={()=>setPop(null)}>
   <div className="rpt-sm-pop-h"><b>{label(pop.col)}</b><button type="button" aria-label="Close" onClick={()=>setPop(null)}><X size={13}/></button></div>
   {popValues?.tooMany?<p className="rpt-sm-pop-note">Too many different values to list - use the search box.</p>:<>
    <div className="rpt-sm-pop-tools"><button type="button" onClick={()=>setFilters(m=>{const n=new Map(m);n.delete(pop.col);return n;})}>Show all</button></div>
    <div className="rpt-sm-pop-list">{popValues?.list.map(([v,n])=><label key={v}><input type="checkbox" checked={popSet?popSet.has(v):true} onChange={()=>toggleValue(pop.col,v)}/><span>{v||'(blank)'}</span><em>{n}</em></label>)}</div></>}
  </Floating>}
 </div>;
}
