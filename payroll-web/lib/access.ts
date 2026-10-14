// Who may do what. The roles, the screens a login can be given rights on, and the checks shared by the server (every request)
// and the browser (menu, buttons, Users & Roles).
//
// Super Admin: the built-in admin01 sign-in; may do everything and makes Admins and Users.
// Admin / User: logins kept in hr_users with a role and a list of rights. The rights are kept in `permissions.modules`:
//   key = a menu item id ('master/bank', 'transaction/time', 'reports/personal-file' ...) -> View / Add / Edit / Delete of that screen,
//   key = an HR module ('leave', 'payroll' ...)                                         -> the HR rights (view, add, edit, approve, delete, reports).
// An Admin makes Users and can give them only what the Admin has; the Super Admin chooses the rights of an Admin.
import {menu,type MenuItem,type Screen} from './menu';
import {masterDef} from './masters';
import {hrModules,type HrIdentity,type HrPermissions,type Role} from './hrm';
export type {Role};

export const SUPER_ADMIN='admin01';
export const roleLabel:Record<Role,string>={superadmin:'Super Admin',admin:'Admin',user:'User'};
export const rightLabel:Record<string,string>={view:'View',add:'Add',edit:'Edit',delete:'Delete',approve:'Approve',reports:'Reports'};
export const hrRights=['view','add','edit','approve','delete','reports'];

export type AccessRow={key:string;label:string;rights:string[]};
export type AccessSection={id:string;label:string;rows:AccessRow[]};

// What each kind of screen lets its users do besides opening it.
function rightsOf(s:Screen):string[]{
 switch(s.kind){
  case 'master': case 'employees': case 'holidays': case 'salary-entry': return ['view','add','edit','delete'];
  case 'attendance': case 'times': case 'resignation': case 'biometric': case 'salary-sheets': case 'bonus-reports': case 'pf19': case 'pf-kyc': return ['view','edit'];
  case 'salary-delete': return ['view','delete'];
  case 'import': return ['view','add'];
  default: return ['view'];
 }
}
const leaves=(items:MenuItem[],prefix=''):{item:MenuItem;label:string}[]=>items.flatMap(i=>i.children?leaves(i.children,i.label+' › '):[{item:i,label:prefix+i.label}]);
// Screens whose access follows the role instead of a ticked right (Users & Roles: Super Admin and Admins). The Activity Log is a ticked right for a User
// (View = reads its own activity); the Super Admin and the Admins always have it.
const roleDriven=new Set(['utilities/users']);
export const hrAccessRows:[string,string][]=[['employees','Employee Master'],['attendance','Attendance'],['payroll','Payroll'],['dashboard','Dashboard'],['finance','Annual Finance'],['documents','Documents'],['settings','Company Rules'],['audit','History'],...hrModules.map(m=>[m.key,m.title] as [string,string])];
export const accessSections:AccessSection[]=[
 ...menu.filter(g=>g.id!=='hr').map(g=>({id:g.id,label:g.label,rows:leaves(g.items).filter(l=>l.item.screen&&!roleDriven.has(l.item.id)).map(l=>({key:l.item.id,label:l.label,rights:rightsOf(l.item.screen!)}))})).filter(s=>s.rows.length),
 {id:'hr',label:'HR Management',rows:hrAccessRows.map(([key,label])=>({key,label,rights:hrRights}))},
];
export const accessRows=new Map<string,AccessRow>(accessSections.flatMap(s=>s.rows.map(r=>[r.key,r] as [string,AccessRow])));

export const roleOf=(a:{role?:Role;admin:boolean}):Role=>a.role||(a.admin?'superadmin':'user');
export const isSuper=(a:{role?:Role;admin:boolean})=>roleOf(a)==='superadmin';
// The rights ticked for one screen / module key (own keys only: a key like "constructor" must never match something inherited).
const ticked=(a:HrIdentity,key:string):string[]=>{const m=a.permissions.modules,v=Object.prototype.hasOwnProperty.call(m,key)?m[key]:undefined;return Array.isArray(v)?v:[];};
const has=(a:HrIdentity,key:string,right:string)=>ticked(a,key).includes(right);
// The original workspace is read-only for everybody.
export function screenRight(a:HrIdentity,key:string,right:string):boolean{
 if(a.readonly&&right!=='view')return false;
 if(isSuper(a))return true;
 return has(a,key,right)&&(right==='view'||has(a,key,'view'));
}
export const canOpenScreen=(a:HrIdentity,key:string)=>screenRight(a,key,'view');
export const anyAccess=(a:HrIdentity)=>isSuper(a)||Object.values(a.permissions.modules).some(r=>Array.isArray(r)&&r.length>0);
// Has the login the View right on any screen whose key passes the test (the Super Admin always has).
export const anyView=(a:HrIdentity,test:(key:string)=>boolean)=>isSuper(a)||Object.entries(a.permissions.modules).some(([k,r])=>test(k)&&Array.isArray(r)&&r.includes('view'));
const reportKey=(k:string)=>k.startsWith('reports/')||k.startsWith('specific/');

// The HR code asks for data classes (employees, attendance, payroll). A login that works through the ordinary screens gets them
// from those screens: whoever may open Salary Preparation can read and save salary, whoever may change Time Updation can save attendance.
export function screenGrantsData(a:HrIdentity,module:string,action:string):boolean{
 if(a.readonly&&!['view','reports'].includes(action))return false;
 const read=action==='view'||action==='reports';
 switch(module){
  case 'employees': return read?anyAccess(a):['add','edit','delete'].includes(action)&&screenRight(a,'master/employee',action);
  case 'attendance': return read?anyView(a,k=>k.startsWith('transaction/time')||k==='transaction/salary'||reportKey(k)):['add','edit'].includes(action)&&screenRight(a,'transaction/time','edit');
  case 'payroll': return read?anyView(a,k=>k.startsWith('transaction/time')||k==='transaction/salary'||k==='transaction/salary-delete'||reportKey(k)):
   action==='delete'?screenRight(a,'transaction/salary-delete','delete')||screenRight(a,'transaction/salary','delete'):['add','edit'].includes(action)&&screenRight(a,'transaction/salary',action);
  default: return false;
 }
}
// An HR right ticked for this login itself (the menu shows only what was given, not what other screens lend).
// Has the login ticked any HR right itself (an HR module, Employee Master, Attendance, Payroll ...)?
export const hasAnyHr=(a:HrIdentity)=>isSuper(a)||hrAccessRows.some(([key])=>ticked(a,key).length>0)||ticked(a,'*').length>0;
export const hrDirect=(a:HrIdentity,module:string,action='view')=>a.admin||(Object.prototype.hasOwnProperty.call(a.permissions.modules,module)?ticked(a,module):ticked(a,'*')).includes(action);
export function canHrModule(a:HrIdentity,module:string,action='view'):boolean{
 if(a.readonly&&!['view','reports'].includes(action))return false;
 return hrDirect(a,module,action)||screenGrantsData(a,module,action);
}

const hrItemAllowed=(a:HrIdentity,view:string)=>{
 if(view==='users')return false;
 if(view==='reports')return Object.values(a.permissions.modules).some(p=>p.includes('reports'));
 if(view==='letters')return hrDirect(a,'employees','reports');
 if(view==='processing')return hrDirect(a,'attendance','edit')||hrDirect(a,'payroll','edit')||hrDirect(a,'payroll','delete');
 return hrDirect(a,view==='profiles'?'employees':view);
};
// The Activity Log: the Super Admin and Admins read the log of the Users (and their own); a User reads its own only when it was given the View right of the screen.
export const mayReadActivity=(a:HrIdentity)=>isSuper(a)||roleOf(a)==='admin'||screenRight(a,'utilities/activity','view');
// May this login open the menu item? (Parents with children are decided by their children.)
export function itemAllowed(a:HrIdentity,item:MenuItem):boolean{
 if(item.children)return item.children.some(c=>itemAllowed(a,c));
 const s=item.screen;if(!s)return false;
 if(item.id==='utilities/users')return roleOf(a)!=='user';
 if(item.id==='utilities/activity')return mayReadActivity(a);
 if(isSuper(a))return true;
 if(s.kind==='hr')return hrItemAllowed(a,s.view);
 return screenRight(a,item.id,'view');
}
// The first screen a login may open (where it lands after signing in); empty when no screen has been given to it.
export function firstScreen(a:HrIdentity):string{
 for(const g of menu)for(const {item} of leaves(g.items))if(item.screen&&itemAllowed(a,item))return item.id;
 return '';
}

// ---- Giving rights to somebody else ----
const clean=(list:unknown)=>Array.isArray(list)?list.filter((x):x is string=>typeof x==='string'):[];
// What the checked rights of one login must look like: only known screens / modules, only rights that kind of screen has, and view with every other right.
export function normalizeModules(modules:Record<string,unknown>):{modules:Record<string,string[]>;error?:string}{
 const out:Record<string,string[]>={};
 for(const [key,raw] of Object.entries(modules)){
  const row=accessRows.get(key);if(!row)return {modules:{},error:`Unknown screen "${key}".`};
  const list=[...new Set(clean(raw))];const bad=list.find(r=>!row.rights.includes(r));if(bad)return {modules:{},error:`${row.label} has no "${bad}" right.`};
  if(!list.length)continue;
  const need=list.some(r=>r!=='view'&&r!=='reports')&&!list.includes('view')?[...list,'view']:list;
  out[key]=row.rights.filter(r=>need.includes(r));
 }
 return {modules:out};
}
// Error text when `granter` tries to give more than the granter has (the Super Admin can give anything).
export function beyondGrant(granter:HrIdentity,wanted:HrPermissions):string|null{
 if(isSuper(granter))return null;
 const own=granter.permissions;
 const star=(mine:string[],value:string)=>mine.includes('*')||mine.includes(value);
 for(const d of wanted.datasets)if(!star(own.datasets,d))return d==='*'?'You cannot give access to every company.':`You cannot give the company "${d}" - it is not assigned to you.`;
 for(const u of wanted.units)if(!star(own.units,u))return u==='*'?'You cannot give access to every location.':`You cannot give the location "${u}" - it is not assigned to you.`;
 for(const [key,list] of Object.entries(wanted.modules))for(const r of list)if(!has(granter,key,r)&&!(key==='utilities/activity'&&r==='view'&&roleOf(granter)==='admin'))return `You cannot give ${rightLabel[r]||r} on ${accessRows.get(key)?.label||key} - you do not have it.`;
 return null;
}

// ---- Master data tables ----
// The screens that change each master table (a table can be changed from more than one screen).
const tableExtra:Record<string,string[]>={tbemp:['master/employee','reports/pf/kyc','reports/pf/form19'],tbemp_exp:['master/employee'],tbemp_ref:['master/employee'],tbemp_fam:['master/employee'],tbemp_nom:['master/employee'],tbsal:['master/employee','transaction/salary'],tbempsal:['transaction/salary'],tbsalrule:['transaction/salary'],tbholi:['master/holiday'],tbhol_loc:['master/holiday'],tbbon:['reports/bonus']};
const tableMap=new Map<string,Set<string>>();
const addTable=(t:string,k:string)=>{if(!tableMap.has(t))tableMap.set(t,new Set());tableMap.get(t)!.add(k);};
for(const g of menu)for(const {item} of leaves(g.items))if(item.screen?.kind==='master')for(const t of item.screen.tables)addTable(t,item.id);
for(const [t,keys] of Object.entries(tableExtra))for(const k of keys)addTable(t,k);
export const tableScreens=(table:string):string[]=>[...(tableMap.get(table)||[])];
// Lists every screen needs to show names (departments, designations, banks ...): readable by any login that has some access.
export const lookupTables=new Set(['tbcmp','tbsubcmp','tblocation','tbdephead','tbdep','tbdes','tbcat','tbsalg','tblvgrade','tbshift','tbbank','tbpfmast','tbesimast','tbgroup']);
// Salary rates, pay heads and the pay set-up (read by the screens that work out salary and by Employee Entry, which keeps each employee's rates) ...
const salaryTables=new Set(['tbsal','tbempsal','tbearn','tbded','tbreim','tbpfesi','tbsalrule']);
// ... and the monthly pay entries (read by the screens that work out salary; the entry screens of these tables read their own).
const payTables=new Set(['tbbon','tbarrs1','tbarrs2','tbmded','tbloan','tbsal_inc_dt','tbsal_incr','tbsal_incr1','tbmtea']);
// The personal details of the employees (identity numbers, family, nominees ...): the same screens as the personal fields of the employee list (seesPersonal).
const personalTables=new Set(['tbemp','tbemp_exp','tbemp_ref','tbemp_fam','tbemp_nom']);
// Reading a master table: its own screens; the salary tables also by the screens that work out salary; the personal details by the screens that work with them;
// the rest (attendance set-up ...) by any screen that builds on master data (transactions, reports, employee entry). A Manpower or Leave login cannot read the salary rates.
export function mayReadTable(a:HrIdentity,table:string):boolean{
 if(isSuper(a))return true;
 if(lookupTables.has(table))return anyAccess(a);
 if(tableScreens(table).some(k=>screenRight(a,k,'view')))return true;
 if(payTables.has(table))return screenGrantsData(a,'payroll','view');
 if(salaryTables.has(table))return screenGrantsData(a,'payroll','view')||screenRight(a,'master/employee','view');
 if(personalTables.has(table))return seesPersonal(a);
 return anyView(a,k=>k.startsWith('transaction/')||reportKey(k)||k==='master/employee');
}
// The screens that may do `action` on a master table. Editing an employee may have to create a side-table row the employee does not have yet (Employee Entry),
// so there Edit may also add - but Add never edits an existing row. A screen that has no separate Add right (Bonus, PF KYC) lets Edit add its records as well.
function writeScreens(a:HrIdentity,table:string,action:'add'|'edit'|'delete'):string[]{
 return tableScreens(table).filter(k=>{
  if(k==='master/employee'&&action==='add')return screenRight(a,k,'add')||screenRight(a,k,'edit');
  const row=accessRows.get(k);return screenRight(a,k,action==='add'&&row&&!row.rights.includes('add')?'edit':action);
 });
}
// A table with a row (or more) per employee - Employee Entry, loans, leave, shifts ...; the other master tables are set-ups of the whole company.
export const employeeKeyed=(table:string)=>!!masterDef(table)?.fields.some(f=>f.col==='emp_code');
// Changing a master table: 'add' for a new record, 'edit' for an existing one, 'delete'.
// A login limited to some locations changes only the tables of employees (it works with its employees); the set-ups of the whole company
// (departments, shifts, heads, PF / ESI, holidays, salary rules ...) need All locations.
export function mayWriteTable(a:HrIdentity,table:string,action:'add'|'edit'|'delete',unitRule=true):boolean{
 if(isSuper(a))return !a.readonly;
 if(unitRule&&!employeeKeyed(table)&&!a.permissions.units.includes('*'))return false;
 return writeScreens(a,table,action).length>0;
}
// PF KYC UPLOAD and Form 19 keep only the KYC columns of the employee details (tbemp): a login that reaches tbemp only through them changes nothing else.
const pfKycColumns=new Set(['pf_no','old_empr_no','pf_bank_no','pfb_ifsc','kyc_name','pan_kyc','adhar_kyc','pass_dtf','pass_dtt','elc_card','ration_card','npr_no','edu_id','handi_yn','handi_id','intw_wo','submit_yn','dtl_oldemp']);
const columnLimits:Record<string,Record<string,Set<string>>>={tbemp:{'reports/pf/kyc':pfKycColumns,'reports/pf/form19':pfKycColumns}};
// The columns this login may change in the table, or null for all of them.
export function writableColumns(a:HrIdentity,table:string,action:'add'|'edit'|'delete'):Set<string>|null{
 if(isSuper(a))return null;
 const limits=columnLimits[table];if(!limits)return null;
 const via=writeScreens(a,table,action);if(via.some(k=>!limits[k]))return null;
 return new Set(via.flatMap(k=>[...limits[k]]));
}
export const screenLabel=(key:string)=>accessRows.get(key)?.label||key;

// ---- Employee personal details ----
// The employee list is read by every screen (names, codes, locations). The personal details - family, identity numbers, address, bank account, photo -
// are shown only to the screens that work with them: Employee Entry, the reports and Salary Preparation, and the HR Employee Master.
export const personalFields=['fatherName','motherName','wifeName','dob','phone','email','pan','dlNo','passport','aadhaar','disability','maritalStatus','bloodGroup','religion','height','weight','education','technicalQualification','localAddress','permanentAddress','bankName','accountNo','bankBranch','ifsc','emergencyName','emergencyPhone','emergencyRelation','uan','esicNo','photoKey','signatureKey'];
export const seesPersonal=(a:HrIdentity)=>isSuper(a)||hrDirect(a,'employees','view')||anyView(a,k=>k==='master/employee'||k==='transaction/salary'||k==='transaction/salary-delete'||reportKey(k));
export function redactEmployees<T extends object>(a:HrIdentity,list:T[]):T[]{
 if(seesPersonal(a))return list;
 return list.map(e=>{const out={...e} as Record<string,unknown>;for(const f of personalFields)if(typeof out[f]==='string')out[f]='';return out as T;});
}
// The HR records Time Updation and Salary Preparation need to work out attendance and salary (shifts, holidays, leave rules, loans ...).
export const payrollRecordModules=new Set(['shifts','holidays','salary-profile','roster','leave-types','overtime','revision','loan','loan-payment','bonus','expenses','attendance-approval']);
