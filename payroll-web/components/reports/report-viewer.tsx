'use client';
import {useEffect,useMemo,useRef,useState,type Dispatch,type KeyboardEvent as ReactKeyboardEvent,type PointerEvent as ReactPointerEvent,type SetStateAction} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,ChevronFirst,ChevronLast,ChevronLeft,ChevronRight,ChevronsDownUp,ChevronsLeft,ChevronsRight,ChevronsUpDown,FileSpreadsheet,FileText,GalleryVertical,ListTree,Maximize2,Minimize2,Printer,RefreshCw,Search,X,ZoomIn,ZoomOut} from 'lucide-react';
import {toast} from 'sonner';
import type {ReportPage} from './report-form';

// The viewer of the report screens: toolbar, group tree on the left, the page on the right.
// A screen that prints several documents for each employee (Personal File forms) gives its pages `owners`: the tree then lists every employee (code · name) with the selected documents under it,
// the pages follow the same order, and the documents of one employee can be shown one below the other, printed together or jumped to with the employee buttons.
type Leaf={page:number;k:number;label:string};
type Group={id:string;label:string;first:number;items:Leaf[]};
type Row={kind:'group';group:Group;open:boolean}|{kind:'leaf';leaf:Leaf;group:string};
type Zoom='width'|'page'|number;
type Prefs={zoom:Zoom;view:'page'|'file';wg:number;wf:number};
const ROW=24,MM=96/25.4,STEPS=[0.5,0.65,0.8,1,1.25,1.5,2];
const isOwn=(p?:ReportPage)=>p?.owners?.length===1;

// Pages of a screen that prints several documents for each employee: employee after employee, each employee's documents together in the order of the
// Reports Selection; the pages that hold many employees (Employee List, I card, Photo Detail) come last.
export function orderByOwner(pages:ReportPage[]):ReportPage[]{
 const own=new Map<string,ReportPage[]>(),shared:ReportPage[]=[];
 for(const p of pages){const id=p.owners?.length===1?p.owners[0].id:'';if(!id)shared.push(p);else if(own.has(id))own.get(id)!.push(p);else own.set(id,[p]);}
 return [...[...own.values()].flat(),...shared];
}

// groups: employee -> documents (a page with many employees is listed under each of them); leaves: the flat list of the other screens (tree / trees of the pages).
function buildTree(pages:ReportPage[]):{groups:Group[]|null;leaves:Leaf[]}{
 if(!pages.some(p=>p.owners?.length))return {groups:null,leaves:pages.flatMap((p,i)=>(p.trees?.length?p.trees:[p.tree]).filter(Boolean).map((label,k)=>({page:i,k,label:label as string})))};
 const map=new Map<string,Group>(),seen=new Map<string,number>();
 pages.forEach((p,i)=>{const base=p.file||p.tree||`Page ${i+1}`;
  for(const o of p.owners?.length?p.owners:[{id:'file:'+base,label:base}]){
   let g=map.get(o.id);if(!g){g={id:o.id,label:o.label,first:i,items:[]};map.set(o.id,g);}
   const key=o.id+'\u0001'+base,n=(seen.get(key)||0)+1;seen.set(key,n);g.items.push({page:i,k:0,label:n>1?`${base} (${n})`:base});}});
 return {groups:[...map.values()],leaves:[]};
}

// What the viewer remembers between reports (zoom, one page / all documents, widths of the tree); the browser may refuse storage, so everything is optional.
const loadPrefs=():Prefs=>{let s:Partial<Prefs>={};try{s=JSON.parse(localStorage.getItem('rpt-viewer')||'{}')||{};}catch{}
 const w=(v:unknown,d:number)=>typeof v==='number'&&v>=100&&v<=560?v:d;
 return {zoom:s.zoom==='width'||s.zoom==='page'||(typeof s.zoom==='number'&&STEPS.includes(s.zoom))?s.zoom:'width',view:s.view==='file'?'file':'page',wg:w(s.wg,300),wf:w(s.wf,120)};};
const savePrefs=(p:Prefs)=>{try{localStorage.setItem('rpt-viewer',JSON.stringify(p));}catch{}};

// The left list. Only the rows in view are built (a company has thousands of employees); employees open and close, the search narrows the list.
function TreePanel({groups,leaves,open,setOpen,page,groupId,width,onPick}:{groups:Group[]|null;leaves:Leaf[];open:Set<string>;setOpen:Dispatch<SetStateAction<Set<string>>>;page:number;groupId:string;width:number;onPick:(page:number,group:string)=>void}){
 const [filter,setFilter]=useState('');const [top,setTop]=useState(0);const [height,setHeight]=useState(400);const scroller=useRef<HTMLDivElement>(null);const scrolled=useRef('');
 const q=filter.trim().toLowerCase();const count=groups?groups.length:leaves.length;
 const rows=useMemo<Row[]>(()=>{
  if(!groups)return leaves.filter(l=>!q||l.label.toLowerCase().includes(q)).map(leaf=>({kind:'leaf',leaf,group:''}));
  const out:Row[]=[];
  for(const group of groups){if(q&&!group.label.toLowerCase().includes(q))continue;const isOpen=open.has(group.id);out.push({kind:'group',group,open:isOpen});if(isOpen)for(const leaf of group.items)out.push({kind:'leaf',leaf,group:group.id});}
  return out;},[groups,leaves,open,q]);
 const active=useMemo(()=>rows.findIndex(r=>r.kind==='leaf'&&r.leaf.page===page&&r.leaf.k===0&&r.group===groupId),[rows,page,groupId]);
 useEffect(()=>{const el=scroller.current;if(!el)return;const measure=()=>setHeight(el.clientHeight);measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect();},[]);
 // Follow the viewer: when the page (or employee) changes and its rows are out of view, the employee row comes into view with a few rows above it - once, not every time the user opens another employee.
 useEffect(()=>{const key=page+'|'+groupId,el=scroller.current;if(!el||active<0||scrolled.current===key)return;scrolled.current=key;
  const head=groups?rows.findIndex(r=>r.kind==='group'&&r.group.id===groupId):-1,y0=(head>=0?head:active)*ROW,y1=(active+1)*ROW;
  if(y0<el.scrollTop||y1>el.scrollTop+el.clientHeight)el.scrollTop=Math.max(0,y0-ROW*3);},[active,page,groupId,groups,rows]);
 const from=Math.max(0,Math.floor(top/ROW)-8),to=Math.min(rows.length,Math.ceil((top+height)/ROW)+8);
 const toggle=(id:string)=>setOpen(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
 return <div className="rpt-side no-print" style={{width}}>
  {(groups||count>12)&&<div className="rpt-side-head">
   <label className="rpt-side-search"><Search size={13}/><input aria-label={groups?'Search employee in the list':'Search the list'} placeholder={groups?'Search employee':'Search'} value={filter} onChange={e=>setFilter(e.target.value)}/>{filter&&<button type="button" aria-label="Clear the search" onClick={()=>setFilter('')}><X size={13}/></button>}</label>
   {groups&&<div className="rpt-side-tools"><button type="button" title="Open the documents of every employee" onClick={()=>setOpen(new Set(groups.map(g=>g.id)))}><ChevronsUpDown size={14}/></button><button type="button" title="Close all employees except the current one" onClick={()=>setOpen(new Set(groupId?[groupId]:[]))}><ChevronsDownUp size={14}/></button><span>{q?`${rows.filter(r=>r.kind==='group').length} of ${count}`:count} employees</span></div>}
  </div>}
  <div className="rpt-side-scroll" ref={scroller} role="tree" onScroll={e=>setTop(e.currentTarget.scrollTop)}>
   <div style={{height:rows.length*ROW,position:'relative'}}>{rows.slice(from,to).map((r,k)=>{const style={top:(from+k)*ROW};
    if(r.kind==='group'){const g=r.group;return <div key={'g:'+g.id} className={'rpt-trow is-group'+(g.id===groupId?' is-current':'')} style={style} role="treeitem" aria-level={1} aria-expanded={r.open}>
     <button type="button" className="tw" aria-label={(r.open?'Close ':'Open ')+g.label} onClick={()=>toggle(g.id)}>{r.open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>
     <button type="button" className="lb" title={g.label} onClick={()=>onPick(g.first,g.id)}>{g.label}</button><span className="ct" title={g.items.length+' documents'}>{g.items.length}</span></div>;}
    const on=from+k===active;return <div key={'l:'+r.group+':'+r.leaf.page+':'+r.leaf.k} className={'rpt-trow is-leaf'+(r.group?' is-nested':' is-flat')+(on?' is-active':'')} style={style} role="treeitem" aria-level={r.group?2:1} aria-selected={on}>
     <button type="button" className="lb" title={r.leaf.label} onClick={()=>onPick(r.leaf.page,r.group)}>{r.group&&<FileText size={13} className="ic"/>}{r.leaf.label}</button></div>;})}</div>
   {!rows.length&&<p className="rpt-side-none">Nothing matches.</p>}</div></div>;
}

export function Viewer({pages,onRefresh,onExcel,title,active=true}:{pages:ReportPage[];onRefresh:()=>void;onExcel?:()=>void;title:string;active?:boolean}){
 const prefs=useMemo(loadPrefs,[]);
 const [page,setPage]=useState(0);const [sel,setSel]=useState('');const [open,setOpen]=useState<Set<string>>(()=>new Set());
 const [tree,setTree]=useState(()=>typeof window==='undefined'||window.innerWidth>=760);
 const [zoomMode,setZoomMode]=useState<Zoom>(prefs.zoom);const [view,setView]=useState(prefs.view);const [widths,setWidths]=useState({g:prefs.wg,f:prefs.wf});
 const [find,setFind]=useState('');const [pageText,setPageText]=useState('1');const [printing,setPrinting]=useState<''|'all'|'employee'|'page'>('');const [menu,setMenu]=useState(false);const [max,setMax]=useState(false);const [box,setBox]=useState({w:0,h:0});
 const root=useRef<HTMLDivElement>(null);const canvas=useRef<HTMLDivElement>(null);const tabs=useRef<HTMLDivElement>(null);const quiet=useRef(0);const byScroll=useRef(false);
 const {groups,leaves}=useMemo(()=>buildTree(pages),[pages]);
 const groupAt=useMemo(()=>new Map((groups||[]).map((g,i)=>[g.id,i])),[groups]);
 const current=Math.min(page,Math.max(0,pages.length-1));const here=pages[current];const owners=here?.owners||[];
 // The employee the page belongs to; a page of many employees (Employee List, I card) stays under the employee the user clicked, else under its first one.
 const groupId=groups?(owners.length===1?owners[0].id:owners.find(o=>o.id===sel)?.id||owners[0]?.id||''):'';
 const gi=groups?groupAt.get(groupId)??-1:-1;const group=groups&&gi>=0?groups[gi]:undefined;
 // "All documents of the employee": the pages printed for this employee alone, one below the other.
 const stack=useMemo(()=>{const own=view==='file'&&group&&isOwn(pages[current])?group.items.map(it=>it.page).filter(i=>isOwn(pages[i])):[];return own.length?own:[current];},[view,group,pages,current]);
 const stackKey=stack[0]+'-'+stack.length;const ownCount=group?group.items.filter(it=>isOwn(pages[it.page])).length:0;
 const [pw,ph]=stack.reduce((a,i)=>{const land=pages[i]?.orientation==='landscape';return [Math.max(a[0],(land?297:210)*MM),Math.max(a[1],(land?210:297)*MM)];},[1,1]);
 const fitW=(box.w-32)/pw,fitP=Math.min(fitW,(box.h-(groups?60:44))/ph);
 const raw=zoomMode==='width'?fitW:zoomMode==='page'?(stack.length>1?fitW:fitP):zoomMode;
 const zoom=box.w>0?Math.round(Math.max(0.25,Math.min(3,raw))*100)/100:0.8;
 const go=(p:number)=>setPage(Math.min(pages.length-1,Math.max(0,p)));
 const pick=(p:number,g:string)=>{setPage(p);setSel(g);if(g)setOpen(s=>s.has(g)?s:new Set(s).add(g));};
 const jump=(d:number)=>{if(!groups)return;const g=groups[Math.min(groups.length-1,Math.max(0,(gi<0?0:gi)+d))];if(g)pick(g.first,g.id);};
 const zoomBy=(d:number)=>{const next=d>0?STEPS.find(s=>s>zoom+0.005):[...STEPS].reverse().find(s=>s<zoom-0.005);if(next)setZoomMode(next);};
 // The employee's group opens when the viewer gets there (Find, next page, ...).
 useEffect(()=>{if(groupId)setOpen(s=>s.has(groupId)?s:new Set(s).add(groupId));},[groupId]);
 useEffect(()=>setPageText(String(current+1)),[current]);
 // The arrow keys work as soon as the report is on screen.
 useEffect(()=>{if(active)root.current?.focus({preventScroll:true});},[active]);
 // The tab of the document on view stays inside the row of tabs.
 useEffect(()=>{const row=tabs.current,on=row?.querySelector<HTMLElement>('.is-on');if(!row||!on)return;
  if(on.offsetLeft<row.scrollLeft)row.scrollLeft=on.offsetLeft-8;else if(on.offsetLeft+on.offsetWidth>row.scrollLeft+row.clientWidth)row.scrollLeft=on.offsetLeft+on.offsetWidth-row.clientWidth+8;},[current,groupId]);
 useEffect(()=>{savePrefs({zoom:zoomMode,view,wg:widths.g,wf:widths.f});},[zoomMode,view,widths]);
 // The canvas size feeds Fit width / Fit page.
 useEffect(()=>{const el=canvas.current;if(!el)return;const measure=()=>setBox(b=>b.w===el.clientWidth&&b.h===el.clientHeight?b:{w:el.clientWidth,h:el.clientHeight});measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect();},[pages.length>0]);
 useEffect(()=>{if(view==='page')canvas.current?.scrollTo({top:0});},[current,view]);
 // One below the other: moving to a page (tree, buttons, Find) scrolls its sheet to the top; scrolling by hand moves the highlight instead (the spy below).
 useEffect(()=>{const el=canvas.current;if(!el||view!=='file')return;if(byScroll.current){byScroll.current=false;return;}
  const sheet=el.querySelector<HTMLElement>(`[data-page="${current}"]`);if(!sheet)return;const crumb=el.querySelector<HTMLElement>('.rpt-crumb');
  quiet.current=performance.now()+400;el.scrollTop=sheet.getBoundingClientRect().top-el.getBoundingClientRect().top+el.scrollTop-(crumb?.offsetHeight||0)-6;},[current,stackKey,view,zoom]);
 const spy=()=>{if(view!=='file'||stack.length<2||performance.now()<quiet.current)return;const el=canvas.current;if(!el)return;
  const line=el.getBoundingClientRect().top+Math.min(150,el.clientHeight/3);let hit=stack[0];
  for(const s of el.querySelectorAll<HTMLElement>('[data-page]')){if(s.getBoundingClientRect().top<=line)hit=Number(s.dataset.page);else break;}
  if(hit!==current){byScroll.current=true;setPage(hit);}};
 // Pages that load their own data show a .rpt-loading note meanwhile; printing waits for them (up to a minute).
 useEffect(()=>{if(!printing)return;const done=()=>setPrinting('');window.addEventListener('afterprint',done,{once:true});let t=0,tries=0;
  const run=()=>{t=window.setTimeout(()=>{if(document.querySelector('.rpt-print-root .rpt-loading')&&++tries<200)run();else window.print();},300);};run();
  return()=>{clearTimeout(t);window.removeEventListener('afterprint',done);};},[printing]);
 useEffect(()=>{if(!menu)return;const off=(e:MouseEvent)=>{if(!(e.target as HTMLElement).closest?.('.rpt-menu-wrap'))setMenu(false);};document.addEventListener('mousedown',off);return()=>document.removeEventListener('mousedown',off);},[menu]);
 function doFind(){const q=find.trim().toLowerCase();if(!q)return;
  // employee by employee (code or name), starting after the current one
  if(groups){const from=gi+1,hit=[...groups.slice(from),...groups.slice(0,from)].find(g=>g.label.toLowerCase().includes(q));if(hit)pick(hit.first,hit.id);else toast.error('Not found in the page list.');return;}
  const has=(p:ReportPage)=>[p.tree||'',p.find||'',...(p.trees||[])].some(l=>l.toLowerCase().includes(q));const hit=pages.findIndex((p,i)=>i>current&&has(p));const first=hit>=0?hit:pages.findIndex(has);if(first>=0)setPage(first);else toast.error('Not found in the page list.');}
 function onKey(e:ReactKeyboardEvent<HTMLDivElement>){
  if(/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)||e.altKey||e.metaKey)return;
  const k=e.key;let used=true;
  if(k==='Escape'){if(menu)setMenu(false);else if(max)setMax(false);else used=false;}
  else if(k==='ArrowRight'){if(e.ctrlKey)jump(1);else go(current+1);}else if(k==='ArrowLeft'){if(e.ctrlKey)jump(-1);else go(current-1);}
  else if(k==='Home')go(0);else if(k==='End')go(pages.length-1);
  else if(!e.ctrlKey&&(k==='+'||k==='='))zoomBy(1);else if(!e.ctrlKey&&k==='-')zoomBy(-1);else if(!e.ctrlKey&&k==='0')setZoomMode('width');
  else used=false;
  if(used)e.preventDefault();}
 function dragTree(e:ReactPointerEvent<HTMLDivElement>){const x0=e.clientX,w0=groups?widths.g:widths.f,isGroups=!!groups;e.preventDefault();
  const move=(ev:PointerEvent)=>{const w=Math.round(Math.min(560,Math.max(100,w0+ev.clientX-x0)));setWidths(s=>isGroups?{...s,g:w}:{...s,f:w});};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);}
 if(!pages.length)return <div className="rpt-empty">No records match the selection. Change the selection and press Generate.</div>;
 const printPages=printing==='page'?[here]:printing==='employee'?(()=>{const list=pages.filter(p=>isOwn(p)&&p.owners![0].id===groupId);return list.length?list:[here];})():pages;
 const captionOf=(i:number)=>group?.items.find(it=>it.page===i)?.label||pages[i].file||'';
 return <div className={'rpt-viewer adv'+(max?' is-max':'')} ref={root} tabIndex={0} onKeyDown={onKey}>
  <div className="rpt-toolbar no-print">
   <div className="rpt-menu-wrap"><button type="button" title="Print" aria-haspopup="menu" aria-expanded={menu} className={menu?'is-on':''} onClick={()=>setMenu(v=>!v)}><Printer size={16}/></button>
    {menu&&<div className="rpt-menu" role="menu">
     <button type="button" role="menuitem" onClick={()=>{setMenu(false);setPrinting('all');}}>Print all pages ({pages.length})</button>
     {groups&&ownCount>0&&<button type="button" role="menuitem" onClick={()=>{setMenu(false);setPrinting('employee');}}>Print this employee's documents ({ownCount})</button>}
     <button type="button" role="menuitem" onClick={()=>{setMenu(false);setPrinting('page');}}>Print this page</button></div>}</div>
   {onExcel&&<button type="button" title="Export to Excel" onClick={onExcel}><FileSpreadsheet size={16}/></button>}
   <button type="button" title="Refresh" onClick={onRefresh}><RefreshCw size={16}/></button>
   <button type="button" title="Show / hide the list on the left" className={tree?'is-on':''} onClick={()=>setTree(v=>!v)}><ListTree size={16}/></button>
   {groups&&<button type="button" title={view==='file'?'All documents of the employee are shown one below the other - click to show one page at a time':'Show all documents of the employee one below the other'} aria-pressed={view==='file'} className={view==='file'?'is-on':''} onClick={()=>setView(v=>v==='file'?'page':'file')}><GalleryVertical size={16}/></button>}
   <button type="button" title={max?'Back to the normal size (Esc)':'Full view'} aria-pressed={max} className={max?'is-on':''} onClick={()=>setMax(v=>!v)}>{max?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
   <span className="rpt-sep"/>
   <button type="button" title="First page (Home)" disabled={current===0} onClick={()=>go(0)}><ChevronFirst size={16}/></button>
   <button type="button" title="Previous page (←)" disabled={current===0} onClick={()=>go(current-1)}><ChevronLeft size={16}/></button>
   <input className="rpt-page-input" aria-label="Page number" inputMode="numeric" value={pageText} onFocus={e=>e.target.select()} onChange={e=>setPageText(e.target.value.replace(/\D/g,''))} onBlur={()=>setPageText(String(current+1))} onKeyDown={e=>{if(e.key==='Enter'&&pageText){go(Number(pageText)-1);e.currentTarget.blur();}}}/><span className="rpt-page-no">of {pages.length}</span>
   <button type="button" title="Go to Next Page (→)" disabled={current>=pages.length-1} onClick={()=>go(current+1)}><ChevronRight size={16}/></button>
   <button type="button" title="Last page (End)" disabled={current>=pages.length-1} onClick={()=>go(pages.length-1)}><ChevronLast size={16}/></button>
   {groups&&<><span className="rpt-sep"/>
    <button type="button" title="Previous employee (Ctrl+←)" disabled={gi<=0} onClick={()=>jump(-1)}><ChevronsLeft size={16}/></button><span className="rpt-page-no">Employee {gi+1} of {groups.length}</span>
    <button type="button" title="Next employee (Ctrl+→)" disabled={gi>=groups.length-1} onClick={()=>jump(1)}><ChevronsRight size={16}/></button></>}
   <span className="rpt-sep"/>
   <input aria-label="Find paycode or name" placeholder="Find" value={find} onChange={e=>setFind(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')doFind();}}/><button type="button" title="Find" onClick={doFind}><Search size={16}/></button>
   <span className="rpt-sep"/>
   <button type="button" title="Zoom out (-)" onClick={()=>zoomBy(-1)}><ZoomOut size={16}/></button>
   <select aria-label="Zoom" value={String(zoomMode)} onChange={e=>{const v=e.target.value;setZoomMode(v==='width'||v==='page'?v:Number(v));}}><option value="width">Fit width</option><option value="page">Fit page</option>{STEPS.map(z=><option key={z} value={String(z)}>{Math.round(z*100)}%</option>)}</select>
   <button type="button" title="Zoom in (+)" onClick={()=>zoomBy(1)}><ZoomIn size={16}/></button>
  </div>
  <div className="rpt-body">
   {tree&&(groups?groups.length:leaves.length)>0&&<><TreePanel groups={groups} leaves={leaves} open={open} setOpen={setOpen} page={current} groupId={groupId} width={groups?widths.g:widths.f} onPick={pick}/>
    <div className="rpt-split no-print" role="separator" aria-orientation="vertical" title="Drag to change the width of the list" onPointerDown={dragTree}/></>}
   <div className="rpt-canvas" ref={canvas} onScroll={spy}>
    {groups?<div className="rpt-crumb no-print"><div className="rpt-crumb-top"><b>{group?.label||''}</b><span className="pos">Employee {gi+1} of {groups.length} · Page {current+1} of {pages.length}</span></div>
      {group&&<div className="rpt-doctabs" ref={tabs} role="tablist" aria-label="Documents of this employee">{group.items.map(it=><button key={it.page+'-'+it.label} type="button" role="tab" aria-selected={it.page===current} className={it.page===current?'is-on':''} onClick={()=>pick(it.page,group.id)}>{it.label}</button>)}</div>}</div>
     :<div className="rpt-tab-label">Main Report</div>}
    {stack.map(i=><div key={pages[i].key} className="rpt-sheet" data-page={i}>
     {stack.length>1&&<div className="rpt-sheet-cap">{captionOf(i)}</div>}
     <div style={{zoom}}><div className={'rpt-paper '+pages[i].orientation}>{pages[i].node}</div></div></div>)}
   </div></div>
  {printing&&createPortal(<div className="rpt-print-root" aria-label={title}>{printPages.map(p=><div key={p.key} className={'rpt-paper '+p.orientation}>{p.node}</div>)}</div>,document.body)}
 </div>;
}
