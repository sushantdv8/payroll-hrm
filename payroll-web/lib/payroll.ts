import { z } from 'zod';

export const attendanceCodes = ['', 'P', 'A', 'WO', 'WO*', 'HD', 'EL', 'PL', 'CL', 'SL', 'CO', 'MT', 'OD', 'SP', 'LWP', 'MS', 'LF', 'HD*', 'NJ'] as const;
export const leaveCodes = ['EL', 'PL', 'CL', 'SL', 'CO', 'MT', 'SP', 'LWP'] as const;
export const educationOptions = ['10th','12TH','5TH','8TH','DIPLOMA','GRADUATION','MBA','POST GRADUATE'];
const text = z.string().trim().max(200).default('');
const longText = z.string().trim().max(2000).default('');
const date = z.string().refine(v => {if(!v)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;}, 'Enter a valid date').default('');
const time = z.string().regex(/^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/, 'Use a valid time').default('');
const duration = z.string().regex(/^(?:|(?:[01]?\d|2[0-3]):[0-5]\d|24:00)$/, 'Use hours:minutes (up to 24:00)').default('');
export const employeeSchema = z.object({
  id: z.string().uuid(), revision:z.number().int().nonnegative().default(0),
  paycode:z.string().trim().min(1,'Paycode is required').max(40), cardNo:text,
  name:z.string().trim().min(1,'Employee name is required').max(150), fatherName:text,motherName:text,wifeName:text,dob:date,
  phone:text,email:z.string().trim().max(200).refine(v=>!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),'Enter a valid email').default(''),
  pan:text,dlNo:text,passport:text,aadhaar:text,disability:text,sex:text,maritalStatus:text,bloodGroup:text,religion:text,height:text,weight:text,education:text,technicalQualification:text,
  localAddress:longText,permanentAddress:longText,remarks:longText,active:z.boolean().nullable().default(true),sourceDataset:z.string().max(200).optional(),dataset:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default('manual'),sourceKey:z.string().max(80).optional(),
  doj:date,resignDate:date,designation:text,department:text,location:text,subCompany:text,
  salaryMode:z.enum(['','Monthly','Daily']).default(''),paymentMode:z.enum(['','Bank','Cheque','Cash']).default(''),bankName:text,accountNo:text,bankBranch:text,ifsc:text,
  photoKey:z.string().max(400).default(''),signatureKey:z.string().max(400).default(''),
  emergencyName:text,emergencyPhone:text,emergencyRelation:text,reportingManagerId:z.string().uuid().or(z.literal('')).default(''),confirmationDate:date,employmentType:text,uan:text,esicNo:text
}).strict();
export type Employee = z.infer<typeof employeeSchema>;
export function emptyEmployee():Employee { return employeeSchema.parse({id:crypto.randomUUID(),paycode:'NEW',name:'New employee'}); }
export const holidaySchema=z.object({dataset:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default('manual'),id:z.string().uuid(),revision:z.number().int().nonnegative().default(0),code:z.string().trim().min(1).max(40),name:z.string().trim().min(1,'Holiday name is required').max(150),date:date.refine(v=>!!v,'Date is required'),type:z.enum(['Others','National','Festival','Company']).default('Others'),locations:z.array(z.string().trim().min(1).max(150)).max(50).default([])}).strict();
export type Holiday=z.infer<typeof holidaySchema>;
// machineIn / machineOut are the attendance-machine punches (absent on records saved before punches were kept);
// deduct is the original's per-day break deduction in minutes (tbtimetmp.mn), kept so work hours can be recalculated.
export const daySchema=z.object({day:z.number().int().min(1).max(31),machineIn:time.optional(),machineOut:time.optional(),deduct:z.number().int().min(0).max(1440).optional(),manualIn:time,manualOut:time,shift:text,first:z.enum(attendanceCodes).default(''),second:z.enum(attendanceCodes).default(''),ot:duration,late:duration,sourceStatus:z.string().max(40).optional(),sourceFirstCode:z.string().max(20).optional(),sourceSecondCode:z.string().max(20).optional(),sourceLateHours:z.string().max(40).optional(),workHours:z.string().max(20).optional(),punches:z.array(z.object({time:time.refine(v=>!!v),kind:z.enum(['IN','OUT']),dayOffset:z.number().int().min(0).max(1).optional()}).strict()).max(100).optional(),outsideHours:duration.optional(),earlyHours:duration.optional(),shortHours:duration.optional(),extraHours:duration.optional(),punchIssues:z.array(z.string().max(150)).max(10).optional(),approvedOt:z.boolean().optional()}).strict();
export type AttendanceDay=z.infer<typeof daySchema>;
const manualTotal=z.union([z.literal(''),z.number().min(0).max(10000)]).default('');
export const monthSchema=z.object({employeeId:z.string().uuid(),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),revision:z.number().int().nonnegative().default(0),sourceDataset:z.string().max(200).optional(),sourceKey:z.string().max(80).optional(),days:z.array(daySchema).max(31),totals:z.object({worked:manualTotal,weeklyOff:manualTotal,holiday:manualTotal,leave:manualTotal,payable:manualTotal,absent:manualTotal}).strict(),leaveLedger:z.array(z.object({code:z.enum(leaveCodes),opening:z.union([z.literal(''),z.number().min(-10000).max(10000)]),earning:z.union([z.literal(''),z.number().min(-10000).max(10000)]),takenYear:z.union([z.literal(''),z.number().min(0).max(10000)]),takenMonth:z.union([z.literal(''),z.number().min(0).max(31)]),balance:z.union([z.literal(''),z.number().min(-10000).max(10000)])}).strict()).max(8)}).strict();
export type AttendanceMonth=z.infer<typeof monthSchema>;
export function monthDays(month:string){const [year,m]=month.split('-').map(Number);return new Date(Date.UTC(year,m,0)).getUTCDate();}
export function emptyMonth(employeeId:string,month:string):AttendanceMonth{return {employeeId,month,revision:0,days:Array.from({length:monthDays(month)},(_,i)=>({day:i+1,manualIn:'',manualOut:'',shift:'',first:'',second:'',ot:'',late:''})),totals:{worked:'',weeklyOff:'',holiday:'',leave:'',payable:'',absent:''},leaveLedger:leaveCodes.map(code=>({code,opening:'',earning:'',takenYear:'',takenMonth:'',balance:''}))};}
export function formatMonth(month:string){return new Date(month+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'});}
export type AppData={employees:Employee[];holidays:Holiday[]};
