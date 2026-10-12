import type {Employee} from './payroll';

// The original software stores 01/Jan/2100 as "no leaving date"; such dates are not resignations.
export function realResignDate(e:Pick<Employee,'resignDate'>){return e.resignDate&&e.resignDate<'2099-01-01'?e.resignDate:'';}
export type Extra={pfNo:string;esiNo:string;sex:string;payMode:string;act:string;cat:string;salg:string;lvg:string;sft:string;dhead:string;dol:string}&Partial<Record<'salMode'|'stype'|'totsal'|'totsal1'|'pfAlw'|'pf1Alw'|'pfLimitIgnore'|'pfLimit'|'pfPerIgnore'|'pfPer'|'pfErLimitIgnore'|'pfErLimit'|'esiAlw'|'esi1Alw'|'esiLimit'|'esiOt'|'otType'|'otRate'|'otLimit'|'otAlw'|'food1'|'foodAlw'|'tea1'|'teaAlw'|'incent1'|'incentAlw'|'conv1'|'convAlw'|'addS1'|'addSAlw'|'night1'|'nightAlw'|'busAmt'|'busAlw'|'lwfApp'|'lateApp'|'wkOff'|'loc'|'oel'|'ocl'|'osl',string>>;
// Code meanings follow the list order of the original combo boxes (Male/Female; Bank/Cheque/Cash; Active/Left).
export const sexNames:Record<string,string>={'0':'Male','1':'Female'};
export const payModeNames:Record<string,string>={'0':'Bank','1':'Cheque','2':'Cash'};
export function employeeSex(e:Employee,x?:Extra){return e.sex||sexNames[x?.sex||'']||'';}
export function employeePayMode(e:Employee,x?:Extra){return e.paymentMode||payModeNames[x?.payMode||'']||'';}
export function isLeft(e:Employee,x?:Extra){return !!realResignDate(e)||x?.act==='1';}

const mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function dmy(v:string|null|undefined){const s=(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&s<'2099'?s.split('-').reverse().join('/'):'';}
export function dMonY(v:string|null|undefined){const s=(v||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||s>='2099')return '';const [y,m,d]=s.split('-');return `${d}-${mon[Number(m)-1]}-${y}`;}
export function monthLabel(month:string){const [y,m]=month.split('-').map(Number);return `${mon[m-1]}-${y}`;}
export function monthTitle(month:string){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'}).toUpperCase()+'-'+y;}
export const fyMonths=Array.from({length:132},(_,k)=>{const d=new Date(Date.UTC(new Date().getFullYear()-5,k,1));const value=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;return {value,label:monthLabel(value)};});
export const pickMonths=Array.from({length:252},(_,k)=>{const d=new Date(Date.UTC(2011,k,1));const value=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;return {value,label:monthLabel(value)};});
export const money2=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'':n.toFixed(2);
export const money0=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});

const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function below1000(n:number){let s='';if(n>=100){s+=ones[Math.floor(n/100)]+' Hundred';n%=100;if(n)s+=' ';}if(n>=20){s+=tens[Math.floor(n/10)];if(n%10)s+=' '+ones[n%10];}else if(n)s+=ones[n];return s;}
// Indian numbering (Crore / Lakh / Thousand), e.g. 36500 -> "Rs. Thirty Six Thousand Five Hundred Only".
export function amountInWords(value:number|null|undefined){
 if(value==null||!Number.isFinite(value))return '';const negative=value<0;const rupees=Math.floor(Math.abs(value));const paise=Math.round((Math.abs(value)-rupees)*100);
 const parts:string[]=[];let n=rupees;const crore=Math.floor(n/1e7);n%=1e7;const lakh=Math.floor(n/1e5);n%=1e5;const thousand=Math.floor(n/1000);n%=1000;
 if(crore)parts.push(below1000(crore)+' Crore');if(lakh)parts.push(below1000(lakh)+' Lakh');if(thousand)parts.push(below1000(thousand)+' Thousand');if(n)parts.push(below1000(n));
 const words=(parts.join(' ')||'Zero')+(paise?' and '+below1000(paise)+' Paise':'');return `Rs. ${negative?'Minus ':''}${words} Only`;
}
