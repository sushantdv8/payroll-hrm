// Tells the activity log what the signed-in login did in the browser (a screen opened, a report generated, printed or exported).
// Fire and forget: the log never slows or stops the work.
export type ClientEvent='open'|'print'|'export'|'generate';
let current={screen:'',dataset:''};
export const setActivityScreen=(screen:string,dataset:string)=>{current={screen,dataset};};
export function logEvent(event:ClientEvent,summary='',screen=current.screen,dataset=current.dataset){
 try{void fetch('/api/activity',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({event,screen,summary:summary.slice(0,200),dataset})}).catch(()=>{});}catch{}
}
