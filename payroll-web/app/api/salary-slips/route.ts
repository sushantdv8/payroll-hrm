import {monthNo} from '@/lib/dataset-year';
import {ownerId,fail,RequestError,validDataset} from '@/lib/server-store';
import {datasetKey} from '@/lib/full-import';
import {monthSlips} from '@/lib/salary-slip';
export const dynamic='force-dynamic';

// GET: the salaries the original software saved for one month (rates, arrears, OT, PF / ESI wages), keyed by the original employee code.
export async function GET(request:Request){try{
 const owner=await ownerId();const url=new URL(request.url);const dataset=datasetKey.parse(url.searchParams.get('dataset'));await validDataset(owner,dataset);
 const month=url.searchParams.get('month')||'';if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RequestError('Choose a valid month.');
 const slips=dataset==='manual'?{}:await monthSlips(owner,dataset,monthNo(dataset,month));
 return Response.json({slips},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
