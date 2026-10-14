import {ownerId,fail,validDataset} from '@/lib/server-store';
import {datasetKey} from '@/lib/full-import';
import {loadEmployeeExtras} from '@/lib/employee-extras-store';
import {hrIdentity,assertHr} from '@/lib/hr-store';
import {employeeScope,onlyCodes} from '@/lib/unit-scope';
import {screenGrantsData,seesPersonal} from '@/lib/access';
import {refuse} from '@/lib/guard';
export const dynamic='force-dynamic';
// Salary settings (total salary, rates, PF / ESI limits), PF / ESI numbers and the weekly off of each employee: for the screens that work out attendance and salary,
// the reports and Employee Entry - not for every screen that merely lists employees.
export async function GET(request:Request){try{
 const owner=await ownerId();const dataset=datasetKey.parse(new URL(request.url).searchParams.get('dataset'));await validDataset(owner,dataset);const actor=await hrIdentity(owner);assertHr(actor,dataset,'employees');
 if(!screenGrantsData(actor,'payroll','view')&&!seesPersonal(actor))await refuse(owner,actor,'You do not have permission to read the employee salary settings.','transaction/time');
 const [extras,scope]=await Promise.all([loadEmployeeExtras(owner,dataset),employeeScope(owner,dataset,actor)]);
 return Response.json({extras:onlyCodes(scope,extras)},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
