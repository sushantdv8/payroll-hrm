import {z} from 'zod';
import {employeeSchema,holidaySchema,monthSchema,monthDays} from './payroll';

const label=z.string().trim().min(1).max(200);
const names=z.array(label).max(500);
export const backupSettingsSchema=z.object({
  companyName:label,sourceDataset:label,importedAt:z.string().datetime().optional(),
  masters:z.object({departments:names,designations:names,locations:names,subCompanies:names,banks:names,shifts:names}).strict()
}).strict();
export type BackupSettings=z.infer<typeof backupSettingsSchema>;
const amount=z.number().finite().min(-1e9).max(1e9).nullable();
const figure=z.number().finite().min(-1e9).max(1e9);
// rate / arrear (earning heads, Salary Preparation): the head's salary rate and the arrear included in amount.
const component=z.object({label,amount,rate:figure.optional(),arrear:figure.optional()}).strict();
export const salarySnapshotSchema=z.object({
  employeeId:z.string().uuid(),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),sourceDataset:label,sourceKey:z.string().max(80).optional(),
  payableDays:z.number().finite().min(-10000).max(10000).nullable(),gross:amount,totalDeductions:amount,net:amount,
  earnings:z.array(component).max(30),deductions:z.array(component).max(30),
  // pfWagesEntered / esiWagesEntered: the wages were typed on Salary Preparation (kept when the salary is edited again).
  otHours:figure.optional(),otAmount:figure.optional(),pfWages:figure.optional(),esiWages:figure.optional(),pfWagesEntered:z.boolean().optional(),esiWagesEntered:z.boolean().optional(),
  workingHours:figure.optional(),basePayHours:figure.optional(),paidLeaveHours:figure.optional(),shortHours:figure.optional(),lateHours:figure.optional(),earlyHours:figure.optional(),requiredHours:figure.optional(),employerPF:figure.optional(),employerESI:figure.optional(),loanRecoveries:z.array(z.object({id:z.string().uuid(),amount:z.number().min(0).max(1e9),head:z.string().max(40)}).strict()).max(100).optional(),expenseIds:z.array(z.string().uuid()).max(1000).optional(),revision:z.number().int().nonnegative().optional()
}).strict();
// Salary entered in this application (not imported) uses this source label.
export const MANUAL_SALARY='manual';
export type SalarySnapshot=z.infer<typeof salarySnapshotSchema>;
export const backupBundleSchema=z.object({
  format:z.literal('payroll-sample-v1'),importId:z.string().uuid(),settings:backupSettingsSchema,
  employees:z.array(employeeSchema).min(1).max(100),holidays:z.array(holidaySchema).max(0),
  attendance:z.array(monthSchema).max(1200),salaries:z.array(salarySnapshotSchema).max(1200)
}).strict().superRefine((value,ctx)=>{
  const bad=(message:string)=>ctx.addIssue({code:'custom',message});
  const ids=new Set(value.employees.map(e=>e.id));
  if(ids.size!==value.employees.length||new Set(value.employees.map(e=>e.paycode.toLowerCase())).size!==value.employees.length)bad('Duplicate employee or paycode in this file.');
  if(new Set(value.holidays.map(h=>h.id)).size!==value.holidays.length)bad('Duplicate holiday in this file.');
  for(const e of value.employees)if(e.active!==null||e.photoKey||e.signatureKey||e.revision!==0||e.sourceDataset!==value.settings.sourceDataset)bad('Invalid imported employee.');
  for(const h of value.holidays)if(h.revision!==0)bad('Invalid imported holiday.');
  for(const rows of [value.attendance,value.salaries]){
    if(new Set(rows.map(r=>r.employeeId+':'+r.month)).size!==rows.length)bad('Duplicate monthly record in this file.');
    for(const row of rows)if(!ids.has(row.employeeId)||row.sourceDataset!==value.settings.sourceDataset)bad('Monthly record has an unknown employee or source.');
  }
  for(const row of value.attendance){const count=monthDays(row.month);if(row.revision!==0||row.days.length!==count||new Set(row.days.map(d=>d.day)).size!==count||row.days.some(d=>d.day>count)||new Set(row.leaveLedger.map(l=>l.code)).size!==row.leaveLedger.length)bad('Incomplete or duplicate attendance days.');}
});
export type BackupBundle=z.infer<typeof backupBundleSchema>;
