'use client';
import {createContext,useContext} from 'react';
import {isSuper,itemAllowed,roleOf,screenRight,type Role} from '@/lib/access';
import {findItem} from '@/lib/menu';
import type {HrIdentity} from '@/lib/hrm';

// The signed-in login, for the screens: what its buttons may do. (The server checks every request again; this only keeps the screens honest.)
const Ctx=createContext<HrIdentity|null>(null);
export const AccessProvider=Ctx.Provider;
export const useIdentity=()=>useContext(Ctx);
export function useRole():Role{const a=useContext(Ctx);return a?roleOf(a):'superadmin';}
// May the login open this screen (menu item id)? A button that leads to another screen is shown only when it may (and never before the login is known).
export function useCanOpen(){
 const a=useContext(Ctx);
 return (id:string)=>{const item=findItem(id);return !!a&&!!item&&itemAllowed(a,item);};
}
// The rights of one screen (menu item id). While the identity is still loading everything is shown; the server decides.
export function useRights(key:string){
 const a=useContext(Ctx);const r=(x:string)=>!a||screenRight(a,key,x);
 return {view:r('view'),add:r('add'),edit:r('edit'),delete:r('delete'),readOnly:!!a&&!isSuper(a)&&!r('add')&&!r('edit')&&!r('delete')};
}
