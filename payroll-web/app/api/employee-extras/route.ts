import {ownerId,fail,validDataset} from '@/lib/server-store';
import {datasetKey} from '@/lib/full-import';
import {loadEmployeeExtras} from '@/lib/employee-extras-store';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const owner=await ownerId();const dataset=datasetKey.parse(new URL(request.url).searchParams.get('dataset'));await validDataset(owner,dataset);
 return Response.json({extras:await loadEmployeeExtras(owner,dataset)},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
