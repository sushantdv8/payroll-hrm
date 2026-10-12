// Navigation recreated from the original Om Sai Soft System menu bar (labels kept as shown in the video).
import {hrModules} from './hrm';
export type SourceRef={table:string;title?:string};
export type Screen=
 |{kind:'employees'|'attendance'|'times'|'holidays'|'muster'|'salary'|'salary-sheets'|'import'|'join-resign'|'datasets'|'salary-entry'|'salary-delete'|'resignation'|'bonus-reports'|'pf19'|'pf-kyc'|'biometric'}
 |{kind:'source';tables:SourceRef[];note?:string}
 |{kind:'master';tables:string[];note?:string}
 |{kind:'report';report:string}
 |{kind:'hr';view:string}
 |{kind:'pending';note:string;tables?:SourceRef[]};
export type MenuItem={id:string;label:string;screen?:Screen;children?:MenuItem[];separatorBefore?:boolean};
export type MenuGroup={id:string;label:string;items:MenuItem[]};

const mst=(...tables:string[]):Screen=>({kind:'master',tables});
const rpt=(report:string):Screen=>({kind:'report',report});

export const menu:MenuGroup[]=[
 {id:'master',label:'Master Entry',items:[
  {id:'master/group',label:'Add New Group Of Company',screen:mst('tbgroup')},
  {id:'master/company',label:'Company Entry',screen:mst('tbcmp')},
  {id:'master/subcompany',label:'Subcompany Entry',screen:mst('tbsubcmp')},
  {id:'master/location',label:'Location Entry',screen:mst('tblocation')},
  {id:'master/department-head',label:'Deparatment Head Entry',separatorBefore:true,screen:mst('tbdephead')},
  {id:'master/department',label:'Department Entry',screen:mst('tbdep')},
  {id:'master/designation',label:'Designation Entry',screen:mst('tbdes')},
  {id:'master/category',label:'Category Entry',screen:mst('tbcat')},
  {id:'master/salary-grade',label:'Salary Grade Entry',screen:mst('tbsalg')},
  {id:'master/bank',label:'Bank Entry',screen:mst('tbbank')},
  {id:'master/leave-grade',label:'Leave Grade Entry',screen:mst('tblvgrade','tblvgrade1')},
  {id:'master/shift',label:'Shift Entry',separatorBefore:true,screen:mst('tbshift')},
  {id:'master/holiday',label:'Holiday Entry',screen:{kind:'holidays'}},
  // The video shows a flyout arrow here but never opens it, so the related head tables are shown as tabs.
  {id:'master/heads',label:'Heads entry',screen:mst('tbearn','tbded','tbreim')},
  {id:'master/employee',label:'Employee Entry',separatorBefore:true,screen:{kind:'employees'}},
  {id:'master/leave-opening',label:'Leave Opening entry',screen:mst('tblvopen1')},
  {id:'master/misc',label:'Miscellenious Entry',separatorBefore:true,screen:mst('tbmisc')},
  {id:'master/wf-hd',label:'WF HD ENTRY',screen:mst('tbwo','tbwo1')},
  {id:'master/shift-ot',label:'Shift Ot Setup',screen:mst('tbshiftset')},
  // Flyout never opened in the video; related setup tables are shown as tabs.
  {id:'master/setup',label:'Setup Entry',screen:mst('tbpfesi','tbpfmast','tbesimast','tbexpm')},
  {id:'master/import',label:'Import Master',screen:{kind:'import'}},
 ]},
 {id:'transaction',label:'Transaction',items:[
  {id:'transaction/shift-change',label:'Monthly Shift Change',screen:mst('tbshiftm','tbeshift')},
  {id:'transaction/time',label:'Time Updation',separatorBefore:true,screen:{kind:'attendance'}},
  // Biometric machines (through the Biometric Attendance app): connection, machines, employee match, fetch history.
  {id:'transaction/biometric',label:'Biometric Machine Setup',screen:{kind:'biometric'}},
  {id:'transaction/leave',label:'Leave Updation',screen:mst('tblvtentry','tblvopen2')},
  {id:'transaction/loan',label:'Loan Updation',screen:mst('tbloan')},
  {id:'transaction/deduction',label:'Deduction Updation',screen:mst('tbmded')},
  {id:'transaction/salary',label:'Salary Prepairation',screen:{kind:'salary-entry'}},
  {id:'transaction/bonus',label:'Bonus Prepairation',screen:mst('tbbon')},
  {id:'transaction/salary-delete',label:'Salary Deletion',separatorBefore:true,screen:{kind:'salary-delete'}},
  {id:'transaction/resignation',label:'Resignation',separatorBefore:true,screen:{kind:'resignation'}},
  {id:'transaction/increment',label:'Increment Processing',screen:{kind:'master',tables:['tbsal_inc_dt','tbsal_incr','tbsal_incr1'],note:'Increments are entered here. Automatic increment of salary rates needs the confirmed rules.'}},
  {id:'transaction/arrear-auto',label:'Arear Auto Processing',screen:{kind:'master',tables:['tbarrs1','tbarrs2'],note:'Automatic arrear calculation needs the confirmed payroll rules. Arrears can be entered and corrected here.'}},
  {id:'transaction/arrear',label:'Arear Updation',screen:mst('tbarrs1','tbarrs2')},
  {id:'transaction/item-allow',label:'Employee Item Allow Entry',screen:mst('tbmtea')},
  {id:'transaction/manpower',label:'Manpower Entry',screen:mst('tbmanp')},
  // Times edits the separate muster register (tbtimed) that Muster Roll / Form 14 / Leave Detail print.
  {id:'transaction/times',label:'Times',screen:{kind:'times'}},
 ]},
 {id:'reports',label:'Reports',items:[
  {id:'reports/monthly-sheets',label:'Monthly Salary Sheets',screen:{kind:'salary-sheets'}},
  {id:'reports/personal-file',label:'Personnal File forms',screen:rpt('personal')},
  {id:'reports/time',label:'Time Attendence',children:[
   {id:'reports/time/monthly',label:'Monthly/Periodically',screen:rpt('monthly')},
   {id:'reports/time/daily',label:'Daily Reports',screen:rpt('daily')},
   {id:'reports/time/combined',label:'Combined Reports',screen:rpt('combined')},
   {id:'reports/time/periodic',label:'Periodically Reports',screen:rpt('periodic')},
  ]},
  {id:'reports/salary-sheet',label:'Salary Sheet/Overtime',screen:rpt('salary')},
  {id:'reports/comparison',label:'Comparison Report',screen:rpt('comparison')},
  {id:'reports/payslip',label:'Payslip',screen:rpt('payslip')},
  {id:'reports/arrear',label:'Arear',screen:rpt('arrear')},
  {id:'reports/bank',label:'Bank/Cheque/Cash',screen:rpt('bank')},
  {id:'reports/bonus',label:'Bonus',screen:{kind:'bonus-reports'}},
  {id:'reports/pf',label:'P.F.Detail',children:[
   {id:'reports/pf/monthly',label:'Monthly Reports',screen:rpt('pfMonthly')},
   {id:'reports/pf/yearly',label:'Yearly Reports',screen:rpt('pfYearly')},
   {id:'reports/pf/eligibility',label:'Eligibilty Register',screen:rpt('pfEligibility')},
   {id:'reports/pf/form19',label:'PF 19  10 C Reports',screen:{kind:'pf19'}},
   {id:'reports/pf/kyc',label:'PF KYC UPLOAD',screen:{kind:'pf-kyc'}},
  ]},
  {id:'reports/esi',label:'E.S.I.Detail',children:[
   {id:'reports/esi/monthly',label:'Monthly',screen:rpt('esiMonthly')},
   {id:'reports/esi/half-yearly',label:'Half Yearly',screen:rpt('esiHalfYearly')},
  ]},
  {id:'reports/muster',label:'Muster Roll/Leave Detail',screen:rpt('muster')},
  {id:'reports/adult',label:'Adult Sheet',screen:rpt('adult')},
  {id:'reports/loan',label:'Loan',screen:rpt('loan')},
  {id:'reports/full-final',label:'Full and Final',screen:rpt('fullFinal')},
  {id:'reports/join-resign',label:'Join and Resign',screen:rpt('joinResign')},
  {id:'reports/letter',label:'Other Letter(Exp.)',screen:rpt('letter')},
 ]},
 {id:'specific',label:'Specific Report',items:[
  {id:'specific/salary',label:'Salary Register',screen:rpt('salary')},
 ]},
 {id:'hr',label:'HR Management',items:[
  {id:'hr/dashboard',label:'HR Dashboard',screen:{kind:'hr',view:'dashboard'}},
  {id:'hr/profiles',label:'Employee Personal Details',screen:{kind:'hr',view:'profiles'}},
  ...hrModules.map(m=>({id:'hr/'+m.key,label:m.title,screen:{kind:'hr' as const,view:m.key}})),
  {id:'hr/documents',label:'Employee Documents',screen:{kind:'hr',view:'documents'}},
  {id:'hr/processing',label:'Attendance & Payroll Processing',screen:{kind:'hr',view:'processing'}},
  {id:'hr/reports',label:'HR Reports & Annual Finance',screen:{kind:'hr',view:'reports'}},
  {id:'hr/letters',label:'HR Letters',screen:{kind:'hr',view:'letters'}},
  {id:'hr/settings',label:'Company HR & Payroll Rules',screen:{kind:'hr',view:'settings'}},
  {id:'hr/users',label:'Users & Unit Permissions',screen:{kind:'hr',view:'users'}},
  {id:'hr/audit',label:'Approval & Change History',screen:{kind:'hr',view:'audit'}},
 ]},
 {id:'utilities',label:'Utilities',items:[
  {id:'utilities/datasets',label:'Company / Year Selection',screen:{kind:'datasets'}},
  {id:'utilities/import',label:'Import Records',screen:{kind:'import'}},
 ]},
];

export function findItem(id:string,items:MenuItem[]=menu.flatMap(g=>g.items)):MenuItem|undefined{for(const item of items){if(item.id===id)return item;const child=item.children&&findItem(id,item.children);if(child)return child;}return undefined;}
export function groupOf(id:string){return menu.find(g=>id===g.id||id.startsWith(g.id+'/'));}
