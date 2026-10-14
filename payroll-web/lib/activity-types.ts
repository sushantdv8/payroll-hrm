// The activity log's kinds and rows (shared by the server and the Activity Log screen).
export type ActivityKind='login'|'logout'|'login-failed'|'open'|'add'|'edit'|'delete'|'print'|'export'|'import'|'generate'|'user'|'denied'|'other';
export const activityKinds:ActivityKind[]=['login','logout','login-failed','open','add','edit','delete','print','export','import','generate','user','denied','other'];
export const kindLabel:Record<ActivityKind,string>={login:'Sign in',logout:'Sign out','login-failed':'Sign-in failed',open:'Opened screen',add:'Added',edit:'Changed',delete:'Deleted',print:'Printed',export:'Exported',import:'Imported',generate:'Generated report',user:'Users & roles',denied:'Access denied',other:'Other'};
export type ActivityInput={kind:ActivityKind;screen?:string;summary:string;dataset?:string;detail?:unknown;ok?:boolean};
// ts: the time as an ISO string (UTC); name: the full name of the login that did it.
export type ActivityRow={id:string;ts:string;actor:string;name?:string;role:string;dataset:string;kind:ActivityKind;screen:string;summary:string;detail:string;ok:boolean};
