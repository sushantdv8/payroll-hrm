'use client';
import {useMemo,useState} from 'react';
import {BarChart3,ChevronDown,ChevronRight,ClipboardList,DatabaseZap,FileText,LogOut,Menu as MenuIcon,Search,Settings2,X} from 'lucide-react';
import {menu,groupOf,type MenuItem} from '@/lib/menu';
import './app-sidebar.css';
import type {HrIdentity} from '@/lib/hrm';
import {canHr} from '@/lib/hr-access';

const icons:Record<string,typeof ClipboardList>={master:DatabaseZap,transaction:ClipboardList,reports:FileText,specific:BarChart3,utilities:Settings2};

function matches(item:MenuItem,q:string):boolean{return item.label.toLowerCase().includes(q)||!!item.children?.some(c=>matches(c,q));}

export function AppSidebar({active,onSelect,signOutHref,identity}:{active:string;onSelect:(id:string)=>void;signOutHref:string;identity?:HrIdentity}){
 const [open,setOpen]=useState<Set<string>>(()=>{const g=groupOf(active);const parent=active.split('/').slice(0,2).join('/');return new Set([g?.id||'master',parent]);});
 const [search,setSearch]=useState('');const [mobileOpen,setMobileOpen]=useState(false);
 const q=search.trim().toLowerCase();
 const groups=useMemo(()=>menu.filter(g=>!identity||identity.admin||g.id==='hr').map(g=>({...g,items:g.items.filter(i=>{if(q&&!matches(i,q))return false;if(!identity||identity.admin||i.screen?.kind!=='hr')return true;const key=i.screen.view;if(key==='users')return false;if(key==='reports')return Object.values(identity.permissions.modules).some(p=>p.includes('reports'));if(key==='letters')return canHr(identity,'employees','reports');if(key==='processing')return canHr(identity,'attendance','edit')||canHr(identity,'payroll','edit')||canHr(identity,'payroll','delete');return canHr(identity,key==='profiles'?'employees':key);})})).filter(g=>g.items.length),[q,identity]);
 function toggle(id:string){setOpen(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});}
 function choose(id:string){onSelect(id);setMobileOpen(false);}
 function renderItem(item:MenuItem,depth:number){
  if(item.children){const expanded=!!q||open.has(item.id);return <li key={item.id} className={item.separatorBefore?'with-separator':''}><button type="button" className={'nav-item nav-parent depth-'+depth} aria-expanded={expanded} onClick={()=>toggle(item.id)}><span>{item.label}</span>{expanded?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>{expanded&&<ul className="nav-sub">{item.children.filter(c=>!q||matches(c,q)).map(c=>renderItem(c,depth+1))}</ul>}</li>;}
  return <li key={item.id} className={item.separatorBefore?'with-separator':''}><button type="button" className={'nav-item depth-'+depth+(active===item.id?' is-active':'')} aria-current={active===item.id?'page':undefined} onClick={()=>choose(item.id)}>{item.label}</button></li>;
 }
 return <>
  <button type="button" className="sidebar-toggle no-print" aria-label={mobileOpen?'Close menu':'Open menu'} onClick={()=>setMobileOpen(v=>!v)}>{mobileOpen?<X size={20}/>:<MenuIcon size={20}/>}<span>Menu</span></button>
  <nav className={'app-sidebar no-print'+(mobileOpen?' is-open':'')} aria-label="Main menu">
   <div className="sidebar-search"><Search size={15}/><input aria-label="Find a menu" placeholder="Find menu…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
   <ul className="nav-groups">{groups.map(g=>{const Icon=icons[g.id]||ClipboardList;const expanded=!!q||open.has(g.id);const hasActive=active.startsWith(g.id+'/');return <li key={g.id} className="nav-group">
    <button type="button" className={'nav-group-title'+(hasActive?' has-active':'')} aria-expanded={expanded} onClick={()=>toggle(g.id)}><Icon size={17}/><span>{g.label}</span>{expanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>
    {expanded&&<ul className="nav-items">{g.items.map(i=>renderItem(i,0))}</ul>}</li>;})}
    {!q||'exit'.includes(q)?<li className="nav-group"><a className="nav-group-title nav-exit" href={signOutHref}><LogOut size={17}/><span>Exit</span></a></li>:null}
   </ul>
  </nav>
  {mobileOpen&&<button type="button" className="sidebar-backdrop no-print" aria-label="Close menu" onClick={()=>setMobileOpen(false)}/>}
 </>;
}
