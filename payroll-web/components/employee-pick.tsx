'use client';
import {useEffect,useRef,useState} from 'react';
import type {Employee} from '@/lib/payroll';

// The original's employee chooser (Time Updation, Times, Salary Preparation): Sorting radios, a box to type the paycode,
// card number or name (the list jumps to the first match; Enter opens it) and the list "code NAME [code][DESIGNATION]".
export const pickLabel=(e:Employee)=>`${e.paycode}  ${e.name} [${e.paycode}][${e.designation||e.department||''}]`;
type Sort='paycode'|'card'|'name';
export function sortEmployees(list:Employee[],sort:Sort){const k=(e:Employee)=>sort==='name'?e.name:sort==='card'?(e.cardNo||e.paycode):e.paycode;return [...list].sort((a,b)=>k(a).localeCompare(k(b),undefined,{sensitivity:'base'}));}

// onSelect returns false when the screen cannot switch employee now (unsaved changes); the box then keeps its text.
export function EmployeePick({employees,selectedId,onSelect,name,suffix,height=150}:{employees:Employee[];selectedId:string;onSelect:(e:Employee)=>boolean;name:string;suffix?:(e:Employee)=>string;height?:number}){
 const [sort,setSort]=useState<Sort>('paycode');const listRef=useRef<HTMLDivElement>(null);
 const sorted=sortEmployees(employees,sort);const selected=employees.find(e=>e.id===selectedId);
 const text=(e:Employee)=>pickLabel(e)+(suffix?suffix(e):'');
 // What was typed belongs to the selection it was typed under; once the screen selects someone else (its own list,
 // the Mismatch dialog) the box shows that employee instead.
 const [typed,setTyped]=useState<{text:string;forId:string}>({text:'',forId:''});
 // A new selection (from here or from the screen) drops what was typed before it.
 const [shownFor,setShownFor]=useState(selectedId);
 if(shownFor!==selectedId){setShownFor(selectedId);if(typed.forId!==selectedId)setTyped({text:'',forId:''});}
 const find=typed.forId===selectedId?typed.text:selected?text(selected):'';
 const term=find.trim().toLowerCase();
 const hit=!term||(selected&&find===text(selected))?-1:sorted.findIndex(e=>(sort==='name'?e.name:sort==='card'?e.cardNo:e.paycode).toLowerCase().startsWith(term)||e.paycode.toLowerCase().startsWith(term)||e.name.toLowerCase().startsWith(term));
 // Scrolls only the list (scrollIntoView would also move the page): to the match, otherwise to the selected employee.
 useEffect(()=>{const list=listRef.current;const item=list?.querySelector<HTMLElement>('[data-hit="true"]')||list?.querySelector<HTMLElement>('[aria-selected="true"]');if(list&&item)list.scrollTop=item.offsetTop-list.offsetTop;},[hit,sort,selectedId]);
 const setFind=(value:string)=>setTyped({text:value,forId:selectedId});
 function choose(e:Employee){if(onSelect(e))setTyped({text:text(e),forId:e.id});}
 return <>
  <fieldset className="to-fieldset"><legend>Sorting</legend>{([['paycode','Paycode'],['card','Card No'],['name','Name']] as const).map(([v,l])=><label key={v}><input type="radio" name={name+'-sort'} checked={sort===v} onChange={()=>setSort(v)}/>{l}</label>)}</fieldset>
  <div><b>Employee Name</b><input className="to-input to-find" aria-label="Find employee by paycode, card number or name" value={find} placeholder="Type paycode, card no. or name" onChange={e=>setFind(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&hit>=0){e.preventDefault();choose(sorted[hit]);}}}/>
   <div className="to-list" style={{height}} ref={listRef} role="listbox" aria-label="Employees">{sorted.map((e,i)=><button type="button" role="option" aria-selected={e.id===selectedId} key={e.id} data-hit={i===hit} className={e.id===selectedId?'is-selected':i===hit?'is-hit':''} onClick={()=>choose(e)}>{text(e)}</button>)}{!sorted.length&&<p className="to-note">No employees.</p>}</div></div>
 </>;
}
