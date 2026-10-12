import {db} from './server-store';
import {readSourceTable} from './source-archive';
// Report-only employee details that the employee record does not carry (codes stay as stored in the original tbemp).
const pick={pfNo:'pf_no',esiNo:'esi_no',sex:'emp_sex',payMode:'pay_mode',act:'emp_act',cat:'cat_code',salg:'sal_code',lvg:'leave_code',sft:'shift_code',dhead:'dhead_code',dol:'emp_dol',
 // salary settings used by the salary calculation
 salMode:'sal_mode',stype:'stype',totsal:'totsal',totsal1:'totsal1',pfAlw:'pf_alw',pf1Alw:'pf1_alw',pfLimitIgnore:'pfel_lmt_ignr',pfLimit:'pf_el_lmt',pfPerIgnore:'pfper_elignr',pfPer:'pfper_el',pfErLimitIgnore:'pfer_lmt_ignr',pfErLimit:'pf_er_lmt',esiAlw:'esi_alw',esi1Alw:'esi1_alw',esiLimit:'esi_lmt',esiOt:'esi_ot',
 otType:'ot_type',otRate:'ot_rate',otLimit:'ot_limit',otAlw:'ot_alw',food1:'food1',foodAlw:'food_alw',tea1:'tea1',teaAlw:'tea_alw',incent1:'incent1',incentAlw:'incent_alw',conv1:'conv1',convAlw:'conv_alw',addS1:'add_s1',addSAlw:'add_s_alw',night1:'night1',nightAlw:'night_alw',busAmt:'bus_amt',busAlw:'bus_alw',lwfApp:'lwf_app',lateApp:'late_app',
 // Time Updation: weekly off day (0 = Sunday)
 wkOff:'wk_off',loc:'loc_code',oel:'oel',ocl:'ocl',osl:'osl'} as const;
export type EmployeeExtras=Record<string,Record<keyof typeof pick,string>>;

export async function loadEmployeeExtras(owner:string,dataset:string){
 const table=dataset==='manual'?null:await readSourceTable(owner,dataset,'tbemp');
 const extras:EmployeeExtras={};
 if(table){const index=Object.fromEntries(table.columns.map((c,i)=>[c.name,i]));const code=index.emp_code;
  for(const row of table.rows){const key=(row[code]??'').trim();if(!key)continue;extras[key]=Object.fromEntries(Object.entries(pick).map(([k,col])=>[k,index[col]===undefined?'':(row[index[col]]??'').trim()])) as Record<keyof typeof pick,string>;}}
 // Changes made in Employee Entry (saved as tbemp edits) replace the original values; employees added here are keyed by id.
 const edits=await db().prepare("SELECT record_key,data FROM master_records WHERE owner=? AND dataset=? AND table_name='tbemp' AND deleted=0").bind(owner,dataset).all<{record_key:string;data:string}>();
 for(const edit of edits.results){const values=JSON.parse(edit.data) as Record<string,string|null>;const base=extras[edit.record_key]||Object.fromEntries(Object.keys(pick).map(k=>[k,''])) as Record<keyof typeof pick,string>;
  extras[edit.record_key]={...base,...Object.fromEntries(Object.entries(pick).filter(([,col])=>values[col]!==undefined&&values[col]!==null).map(([k,col])=>[k,String(values[col]).trim()]))} as Record<keyof typeof pick,string>;}
 return extras;
}
