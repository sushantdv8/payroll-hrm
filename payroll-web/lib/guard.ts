import {RequestError} from './server-store';
import {hrIdentity} from './hr-store';
import {logActivity,asIdentity} from './activity-store';
import {anyAccess,rightLabel,screenLabel,screenRight} from './access';
import type {ActivityKind} from './activity-types';
import type {HrIdentity} from './hrm';

// The checks the routes make before they read or change something for a login that is not the Super Admin (the Super Admin passes all of them).
// A refused attempt is written to the activity log (here, or - for a check made deep inside a route - when the answer is made: server-store.ts `fail`).
export async function refuse(owner:string,actor:HrIdentity,message:string,screen=''):Promise<never>{
 await logActivity(owner,asIdentity(actor),{kind:'denied',screen,summary:message,ok:false});
 throw new RequestError(message,403,true);
}
// The login may use at least one of these screens for this right (or for any of these rights).
export async function needScreen(owner:string,actor:HrIdentity,keys:string|string[],right:string|string[]){
 const list=Array.isArray(keys)?keys:[keys],rights=Array.isArray(right)?right:[right];
 if(list.some(k=>rights.some(r=>screenRight(actor,k,r))))return;
 await refuse(owner,actor,`You do not have ${rights.map(r=>rightLabel[r]||r).join(' / ')} permission for ${list.map(screenLabel).join(' / ')}.`,list[0]);
}
// Any of these screens may be opened (View).
export const needView=(owner:string,actor:HrIdentity,keys:string[])=>needScreen(owner,actor,keys,'view');
export async function needAccess(owner:string,actor:HrIdentity){if(!anyAccess(actor))await refuse(owner,actor,'No screen is assigned to your login.');}
// Writes one activity row for the signed-in login.
export async function note(owner:string,kind:ActivityKind,summary:string,more?:{screen?:string;dataset?:string;detail?:unknown}){
 try{await logActivity(owner,asIdentity(await hrIdentity(owner)),{kind,summary,...more});}catch(e){console.error('The activity log could not be written',e);}
}
