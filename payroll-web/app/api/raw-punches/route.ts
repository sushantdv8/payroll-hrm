import {datasetKey} from '@/lib/full-import';
import {hrIdentity,hrEmployees,assertHr} from '@/lib/hr-store';
import {rawPunchMonth} from '@/lib/raw-punch-index';
import {ownerId,fail,RequestError,validDataset} from '@/lib/server-store';
export const dynamic='force-dynamic';

// GET: the machines' raw punches of one month for the employees of a company, taken from the original software's own machine table (the imported
// database "osps", see lib/raw-punch-index.ts): { available, last, punches: { employeeId: { 'YYYY-MM-DD': ['10:45','13:44', …] } } }.
// `available` is false when the original has no machine table here; `last` is the last day it has any punch of (the Biometric Attendance app has the later days).
// `pending` is true while a server reads the original's machine table for the first time (about a minute): the screen asks again.
// Only the employees the login may see are matched (by card number); nobody else's punches leave the server.
export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);const dataset=datasetKey.parse(url.searchParams.get('dataset'));await validDataset(owner,dataset);
 const actor=await hrIdentity(owner);assertHr(actor,dataset,'attendance');
 const month=url.searchParams.get('month')||'';if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RequestError('Choose a valid month.');
 const none={available:false,last:'',punches:{}};
 if(dataset==='manual')return Response.json(none,{headers:{'Cache-Control':'no-store'}});
 const employees=await hrEmployees(owner,dataset,actor);
 const found=await rawPunchMonth(owner,month);if(!found.available)return Response.json(none,{headers:{'Cache-Control':'no-store'}});
 if(found.pending)return Response.json({available:true,pending:true,last:'',punches:{}},{headers:{'Cache-Control':'no-store'}});
 // The machine's user ID is the employee's card number; an employee whose record has no card number is matched by the paycode (as the Biometric Fetch does), unless that ID is some other employee's card.
 const bare=(v:string)=>v.trim().toLowerCase().replace(/^0+(?=.)/,'');
 const byCard=new Map(Object.keys(found.punches).map(card=>[bare(card),card]));
 const mine=new Map<string,string>(),taken=new Set<string>();
 for(const e of employees){const card=e.cardNo?byCard.get(bare(e.cardNo)):undefined;if(card){mine.set(e.id,card);taken.add(card);}}
 for(const e of employees){if(mine.has(e.id)||!e.paycode)continue;const card=byCard.get(bare(e.paycode));if(card&&!taken.has(card)){mine.set(e.id,card);taken.add(card);}}
 const punches:Record<string,Record<string,string[]>>={};
 for(const [id,card] of mine)punches[id]=Object.fromEntries(Object.entries(found.punches[card]).map(([day,list])=>[`${month}-${day}`,list.split(',')]));
 return Response.json({available:true,last:found.last,punches},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
