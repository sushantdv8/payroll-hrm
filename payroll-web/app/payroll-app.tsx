'use client';
import {useEffect,useMemo,useState,useCallback,useSyncExternalStore} from 'react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {ClipboardList,ShieldCheck} from 'lucide-react';
import {toast} from 'sonner';
import {Toaster} from '@/components/ui/sonner';
import {Skeleton} from '@/components/ui/skeleton';
import {EmployeeEntry} from '@/components/employee-entry';
import {TimeOffice} from '@/components/time-office';
import {BiometricSetup} from '@/components/biometric-setup';
import {HolidayRegister} from '@/components/holiday-register';
import {AttendanceReport} from '@/components/attendance-report';
import {SalaryHistory} from '@/components/salary-history';
import {SalarySheets} from '@/components/salary-sheets';
import {BackupImport} from '@/components/backup-import';
import {FullImport} from '@/components/full-import';
import {AppSidebar} from '@/components/app-sidebar';
import {SourceTables} from '@/components/source-table';
import {MasterEntry} from '@/components/master-entry';
import {SalaryDeletion,SalaryPreparation} from '@/components/salary-entry';
import {Resignation} from '@/components/resignation';
import {BonusReports} from '@/components/bonus-reports';
import {Pf19Form,PfKycUpload} from '@/components/pf-forms';
import {ReportForm} from '@/components/reports/report-form';
import {reportConfigs} from '@/components/reports/catalog';
import {DatasetScreen,JoinResignReport,PendingScreen} from '@/components/extra-screens';
import {BackupSettings} from '@/lib/backup';
import type {DatasetSummary} from '@/lib/full-import';
import {findItem,groupOf,type MenuItem} from '@/lib/menu';
import {companyLabel} from '@/lib/company-groups';
import {itemAllowed,firstScreen,isSuper,accessRows,screenRight,hrDirect} from '@/lib/access';
import {logEvent,setActivityScreen} from '@/lib/activity-client';
import {AccessProvider} from '@/components/access-context';
import {AccountChip} from '@/components/account-chip';
import {UsersAdmin} from '@/components/users-admin';
import {ActivityLog} from '@/components/activity-log';
import {ErrorMessage,Picker} from '@/components/payroll-controls';
import {requestJson} from '@/lib/client-api';
import {AppData} from '@/lib/payroll';
import {HrWorkspace} from '@/components/hr-workspace';
import {DocumentExpiryAlert} from '@/components/document-expiry';
import type {HrIdentity} from '@/lib/hrm';
import {canHr} from '@/lib/hr-access';

type ModelContext={registerTool:(tool:{name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown|Promise<unknown>},options:{signal:AbortSignal})=>void|Promise<void>};
// Assisted-navigation section names kept from the earlier tab layout.
const sections:Record<string,string>={employees:'master/employee',attendance:'transaction/time',holidays:'master/holiday',reports:'reports/muster',salaries:'reports/salary-sheet',backup:'master/import'};
export default function PayrollApp(){const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}}));return <QueryClientProvider client={client}><Workspace/><Toaster richColors position="bottom-right"/></QueryClientProvider>;}
function Workspace(){
 const [screen,setScreen]=useState('master/group');const [month,setMonth]=useState(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');});const [dirty,setDirty]=useState(false);const stableDirty=useCallback((v:boolean)=>setDirty(v),[]);
 const [importing,setImporting]=useState(false);const [chosenDataset,setChosenDataset]=useState<string|null>(null);
 // Installed program: the company is chosen in the sign-in window and handed over in a cookie (no cookie when run without sign-in).
 const cookieCompany=useSyncExternalStore(()=>()=>{},()=>{const m=/(?:^|;\s*)pw_company=([^;]*)/.exec(document.cookie);return m?decodeURIComponent(m[1]):'';},()=>null);
 const cookieWorkspaceMode=useSyncExternalStore(()=>()=>{},()=>/(?:^|;\s*)pw_mode=editable(?:;|$)/.test(document.cookie)?'Editable workspace':'Original workspace',()=> 'Private workspace');
 const desktopSession=useQuery({queryKey:['workspace-login'],queryFn:async()=>{const response=await fetch('/__workspace');if(response.status===404)return null;if(!response.ok)throw new Error('Please sign in again.');return response.json() as Promise<{company:string;mode:string;username:string;location?:string}>;},refetchOnWindowFocus:false});
 const workspaceMode=desktopSession.data?(desktopSession.data.mode==='editable'?'Editable workspace':'Original workspace'):cookieWorkspaceMode;
 const login={ready:cookieCompany!==null&&!desktopSession.isPending,key:desktopSession.data?.company||cookieCompany||null};
 const datasets=useQuery({queryKey:['datasets'],queryFn:()=>requestJson<{datasets:DatasetSummary[]}>('/api/datasets')});const datasetList=datasets.data?.datasets||[];
 const wanted=chosenDataset??login.key;const dataset=wanted&&datasetList.some(d=>d.key===wanted)?wanted:datasetList[0]?.key||'manual';const summary=datasetList.find(d=>d.key===dataset);
 const hrIdentity=useQuery({queryKey:['hr-identity',dataset],queryFn:()=>requestJson<{identity:HrIdentity}>('/api/hr?'+new URLSearchParams({dataset,view:'identity'})),enabled:!datasets.isPending&&login.ready});
 const identity=hrIdentity.data?.identity;
 // A login lands on the first screen it may open, and is taken there from one it may not (the server refuses the rest anyway).
 useEffect(()=>{const it=findItem(screen);if(identity&&it&&!itemAllowed(identity,it))setScreen(firstScreen(identity));},[identity,screen]);
 // The activity log hears of every screen opened and every print.
 useEffect(()=>{const it=findItem(screen);if(!identity||!it||!itemAllowed(identity,it))return;setActivityScreen(screen,dataset);logEvent('open','',screen,dataset);},[screen,identity?.username,dataset]);
 useEffect(()=>{const onPrint=()=>logEvent('print');window.addEventListener('beforeprint',onPrint);return()=>window.removeEventListener('beforeprint',onPrint);},[]);
 const query=useQuery({queryKey:['records',dataset],queryFn:()=>requestJson<AppData>('/api/records?'+new URLSearchParams({dataset})),enabled:!datasets.isPending&&login.ready});const rawData=query.data;
 // Location chosen at sign-in: only that location's employees are shown (every screen and report reads them from here). Empty = all locations.
 const location=(desktopSession.data?.location||'').trim();
 const data=useMemo(()=>rawData&&location?{...rawData,employees:rawData.employees.filter(e=>(e.location||'').trim().toLowerCase()===location.toLowerCase())}:rawData,[rawData,location]);
 const backup=useQuery({queryKey:['backup'],queryFn:()=>requestJson<{settings:BackupSettings|null}>('/api/backup')});const legacySettings=backup.data?.settings||undefined;const settings=summary?.settings||(legacySettings?.sourceDataset===dataset?legacySettings:undefined);
 function chooseDataset(value:string){if(login.key){toast.error('The company is chosen when you sign in. To work in another company, sign in again in a new tab (open the Payroll Workspace shortcut again), or use Exit and sign in again.');return;}if(dirty||importing){toast.error('Save attendance changes or wait for the import to finish before switching companies.');return;}setChosenDataset(value);}
 const onImported=useCallback(async()=>{await datasets.refetch();},[datasets]);
 const reload=useCallback(async()=>{const result=await query.refetch();if(result.error)throw result.error;return result.data;},[query]);
 function navigate(value:string){if(value===screen)return true;if(importing){toast.error('Keep this screen open until the import finishes or is paused.');return false;}if(dirty){toast.error('Save or discard changes before leaving this screen.');return false;}setScreen(value);window.scrollTo({top:0});return true;}
 useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{if(dirty)e.preventDefault();};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[dirty]);
 useEffect(()=>{const context=(document as unknown as {modelContext?:ModelContext}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();const register=(tool:Parameters<ModelContext['registerTool']>[0])=>Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});void register({name:'list_payroll_employees',title:'List employees',description:'Read saved employee names, paycodes and departments. Does not change any record.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async input=>{if(input===null||typeof input!=='object'||Object.keys(input).length)throw new Error('No arguments are accepted.');const records=await requestJson<AppData>('/api/records');return {employees:records.employees.map(e=>({id:e.id,name:e.name,paycode:e.paycode,department:e.department}))};}});void register({name:'open_payroll_section',title:'Open payroll section',description:'Navigate to employees, attendance, holidays, reports, salary history or record import. Does not create or edit records.',inputSchema:{type:'object',properties:{section:{type:'string',enum:Object.keys(sections)}},required:['section'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async input=>{const v=input as {section?:string};if(!v||Object.keys(v).some(k=>k!=='section')||!sections[v.section||''])throw new Error('Choose a valid payroll section.');if(document.querySelector('[role="dialog"],[role="alertdialog"]'))throw new Error('Finish or close the open editor before navigating.');if(dirty)throw new Error('Attendance has unsaved changes. Save or discard them first.');setScreen(sections[v.section!]);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return {section:v.section};}});return()=>lifecycle.abort();},[dirty]);
 const [year,m]=month.split('-').map(Number);const fy=m>=4?year:year-1;
 const item=findItem(screen);const group=groupOf(screen);
 // A screen that can change records, opened by a login that has only the View right of it.
 const viewOnly=!!identity&&!!item&&!isSuper(identity)&&(()=>{const row=accessRows.get(item.id);return !!row&&row.rights.length>1&&!row.rights.some(r=>r!=='view'&&screenRight(identity,item.id,r));})();
 const companyName=summary?.companyName||settings?.companyName||'';
 // Where Close on a form leads: Employee Entry, or - for a login that has no Employee Entry - the first screen it has.
 const home=(()=>{const entry=findItem('master/employee');return !identity||(entry&&itemAllowed(identity,entry))?'master/employee':firstScreen(identity)||'master/employee';})();
 function render(item:MenuItem|undefined){
  const s=item?.screen;if(!item||!s||!data||!identity)return null;
  if(!itemAllowed(identity,item))return <section className="no-access"><h1>No access</h1><p>Your login cannot open {item.label}. Ask your Admin to give you the right.</p></section>;
  switch(s.kind){
   case 'users':return <UsersAdmin key={dataset} dataset={dataset} workspace={desktopSession.data?workspaceMode:undefined} companies={datasetList.map(d=>({key:d.key,label:companyLabel(d)}))}/>;
   case 'activity':return <ActivityLog/>;
   case 'hr':return <HrWorkspace key={dataset+item.id} view={s.view} dataset={dataset} employees={data.employees} month={month} setMonth={setMonth} onDirty={stableDirty} onReload={reload}/>;
   case 'employees':return <EmployeeEntry key={dataset} dataset={dataset} employees={data.employees} companyName={companyName} onChange={reload}/>;
   case 'attendance':return <TimeOffice key={dataset+'daily'} mode="daily" dataset={dataset} employees={data.employees} holidays={data.holidays} month={month} setMonth={setMonth} onDirty={stableDirty} onOpen={navigate}/>;
   case 'biometric':return <BiometricSetup key={dataset} dataset={dataset} employees={data.employees} title={item.label} onOpen={navigate}/>;
   case 'times':return <TimeOffice key={dataset+'register'} mode="register" dataset={dataset} employees={data.employees} holidays={data.holidays} month={month} setMonth={setMonth} onDirty={stableDirty}/>;
   case 'holidays':return <><HolidayRegister key={dataset} dataset={dataset} settings={settings} holidays={data.holidays} onChange={reload}/>{dataset!=='manual'&&<div className="space-top"><MasterEntry dataset={dataset} employees={data.employees} title="Holidays in the original software" tables={['tbholi','tbhol_loc']}/></div>}</>;
   case 'master':return <MasterEntry key={dataset+item.id} dataset={dataset} employees={data.employees} title={item.label} tables={s.tables} note={s.note} eyebrow={group?.id==='transaction'?'TRANSACTION':'MASTER ENTRY'} onClose={()=>navigate(home)}/>;
   case 'muster':return <AttendanceReport key={dataset} dataset={dataset} employees={data.employees} month={month} setMonth={setMonth}/>;
   case 'salary':return <SalaryHistory key={dataset} dataset={dataset} employees={data.employees} companyName={companyName} title={item.label}/>;
   case 'salary-sheets':return <SalarySheets key={dataset} dataset={dataset} month={month} setMonth={setMonth} onDirty={stableDirty}/>;
   case 'import':return <><FullImport onChange={onImported} onBusy={setImporting}/>{legacySettings&&<BackupImport settings={legacySettings} onChange={reload}/>}</>;
   case 'report':{const config=reportConfigs[s.report];return config?<ReportForm key={dataset+item.id} dataset={dataset} employees={data.employees} title={item.label} config={config} companyName={companyName} onClose={()=>navigate(home)}/>:null;}
   case 'salary-entry':return <SalaryPreparation key={dataset} dataset={dataset} employees={data.employees} title={item.label} month={month} setMonth={setMonth} onDirty={stableDirty} onClose={()=>navigate(home)}/>;
   case 'bonus-reports':return <BonusReports key={dataset} dataset={dataset} employees={data.employees} companyName={companyName} onClose={()=>navigate(home)}/>;
   case 'pf19':return <Pf19Form key={dataset} dataset={dataset} employees={data.employees} companyName={companyName} onClose={()=>navigate(home)}/>;
   case 'pf-kyc':return <PfKycUpload key={dataset} dataset={dataset} employees={data.employees} companyName={companyName} onClose={()=>navigate(home)}/>;
   case 'salary-delete':return <SalaryDeletion key={dataset} dataset={dataset} employees={data.employees} title={item.label}/>;
   case 'resignation':return <Resignation key={dataset} employees={data.employees} onChange={reload} title={item.label}/>;
   case 'join-resign':return <JoinResignReport employees={data.employees} title={item.label}/>;
   case 'datasets':return <DatasetScreen datasets={datasetList} current={dataset} onChoose={chooseDataset} title={item.label}/>;
   case 'source':return <SourceTables key={dataset+item.id} dataset={dataset} tables={s.tables} title={item.label} note={s.note}/>;
   case 'pending':return <PendingScreen key={dataset+item.id} dataset={dataset} title={item.label} note={s.note} tables={s.tables}/>;
  }
 }
 // The login was made inactive (or removed) while its window was open: every request is refused, so say so instead of showing empty screens.
 if(hrIdentity.error&&/inactive|sign in again/i.test(hrIdentity.error.message))return <div className="workspace"><main className="main-shell"><section className="no-access"><h1>Signed out</h1><p>{hrIdentity.error.message}</p><p><a href="/signout-with-chatgpt?return_to=/">Go to the sign-in page</a></p></section></main></div>;
 return <AccessProvider value={identity??null}><div className="workspace"><DocumentExpiryAlert dataset={dataset} enabled={!!hrIdentity.data&&hrDirect(hrIdentity.data.identity,'documents')&&!datasets.isPending&&login.ready} onOpen={navigate}/><header className="app-header"><div className="brand"><span className="brand-icon"><ClipboardList size={23}/></span><div><strong>Payroll Workspace</strong><small>{companyName||'Employee & attendance records'}{location?` · ${location}`:''}</small></div></div><div className="header-meta">{datasetList.length>1&&!login.key&&<Picker label="Company and year" className="dataset-picker" value={dataset} onChange={chooseDataset} disabled={dirty||importing} options={datasetList.map(d=>({value:d.key,label:companyLabel(d)}))}/>}<span className="year-badge">FY {fy}–{String(fy+1).slice(-2)}</span><AccountChip identity={identity}/></div></header>
  <div className="app-layout"><AppSidebar active={screen} identity={hrIdentity.data?.identity} onSelect={id=>{navigate(id);}} signOutHref="/signout-with-chatgpt?return_to=/"/>
  <main className="main-shell">{identity&&item&&itemAllowed(identity,item)&&<p className="screen-crumb no-print">{group?.label} › {item.label}</p>}{viewOnly&&<p className="inline-note no-print">You can view this screen but not change anything in it.</p>}{!identity?(hrIdentity.error?<ErrorMessage message={hrIdentity.error.message} retry={()=>hrIdentity.refetch()}/>:<div className="loading-panel" role="status"><span>Checking your access…</span><Skeleton className="h-12 w-full"/></div>):!firstScreen(identity)?<section className="no-access"><h1>No screen assigned</h1><p>No menu has been given to your login yet. Ask your Admin to give you the rights you need.</p></section>:query.isPending?<div className="loading-panel" role="status"><span>Loading your records…</span><Skeleton className="h-12 w-full"/><Skeleton className="h-64 w-full"/></div>:query.error&&!data?<ErrorMessage message={query.error.message} retry={()=>query.refetch()}/>:data?<>{query.error&&<ErrorMessage message={query.error.message} retry={()=>query.refetch()}/>}{render(item)}</>:null}<footer className="app-footer no-print"><span>Payroll Workspace</span><span>Employees, attendance and monthly salary sheets</span></footer></main></div></div></AccessProvider>;
}
