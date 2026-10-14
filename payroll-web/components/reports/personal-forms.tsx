import type {ReactNode} from 'react';
import {useQueries} from '@tanstack/react-query';
import type {Employee} from '@/lib/payroll';
import {trimCell,type MasterRow} from '@/lib/masters';
import {dmy,dMonY,employeeSex,realResignDate} from '@/lib/report-utils';
import type {ReportContext,ReportOption,ReportPage} from './report-form';
import {extraOf,ownerOf,tablePages} from './report-parts';
import {masterQuery} from './salary-reports';

// Personal File Forms of the original (Reports › Personal File forms): the bilingual forms printed for each ticked employee.
// Family / nominee lines come from the employee's Family and Nominees entries (tbemp_fam / tbemp_nom).
type Person={name:string;address:string;dob:string;relation:string;residing:boolean};
const keyOf=(e:Employee)=>String(e.sourceKey||e.id);
const slots=(rows:MasterRow[],e:Employee,n:number,pick:(v:MasterRow['values'],k:number)=>Person):Person[]=>{
 const row=rows.find(r=>trimCell(r.values.emp_code)===keyOf(e));if(!row)return [];
 return Array.from({length:n},(_,k)=>pick(row.values,k+1)).filter(p=>p.name);};
const family=(rows:MasterRow[],e:Employee)=>slots(rows,e,8,(v,k)=>({name:trimCell(v[`f${k}_name`]),address:trimCell(v[`f${k}_add`]),dob:trimCell(v[`f${k}_dob`]),relation:trimCell(v[`f${k}_rel`]),residing:trimCell(v[`f${k}_res`])==='1'}));
const nominees=(rows:MasterRow[],e:Employee)=>slots(rows,e,4,(v,k)=>({name:trimCell(v[`n_name${k}`]),address:trimCell(v[`n_add${k}`]),dob:trimCell(v[`n_dob${k}`]),relation:trimCell(v[`n_rel${k}`]),residing:true}));
type Data={fam:Person[];nom:Person[]};

const blank=(rows:number,cols:number)=>Array.from({length:rows},(_,i)=><tr key={i}>{Array.from({length:cols},(_,j)=><td key={j}>&nbsp;</td>)}</tr>);
const dm=(v:string)=>dmy(v>='2099'?'':v);
const photoUrl=(e:Employee)=>e.photoKey?'/api/images?key='+encodeURIComponent(e.photoKey):'';
const showPhoto=(ctx:ReportContext)=>ctx.options.fields.showPhoto!=='0';
const showDoj=(ctx:ReportContext)=>ctx.options.fields.showDoj!=='0';
const Logo=()=><div className="pf-logo"><span style={{background:'#c0392b'}}>O</span><span style={{background:'#f1c40f'}}>S</span><span style={{background:'#27ae60'}}>S</span><span style={{background:'#2980b9'}}>S</span></div>;
const Photo=({e,ctx}:{e:Employee;ctx:ReportContext})=>showPhoto(ctx)&&photoUrl(e)?<img className="pf-photo" src={photoUrl(e)} alt={e.name}/>:null;
const Line=({v,w}:{v?:ReactNode;w?:string}) => <span className="pf-ul" style={w?{minWidth:w}:undefined}>{v||' '}</span>;
const Org=({ctx}:{ctx:ReportContext})=><div className="pf-org"><b>{ctx.company.name}</b><div>{ctx.company.address}</div></div>;

// Loads the family and nominee entries once and renders one form for one employee.
function WithData({ctx,e,render}:{ctx:ReportContext;e:Employee;render:(d:Data)=>ReactNode}){
 const [fam,nom]=useQueries({queries:['tbemp_fam','tbemp_nom'].map(t=>masterQuery(ctx.dataset,t))});
 if(fam.isPending||nom.isPending)return <p className="rpt-loading">Loading the family details…</p>;
 return <>{render({fam:family(fam.data?.rows||[],e),nom:nominees(nom.data?.rows||[],e)})}</>;
}
const perEmployee=(key:string,make:(ctx:ReportContext,e:Employee,d:Data)=>ReactNode)=>(ctx:ReportContext):ReportPage[]=>ctx.employees.map(e=>({key:key+e.id,orientation:'portrait',owners:[ownerOf(e)],node:<div className="pf-form"><WithData ctx={ctx} e={e} render={d=>make(ctx,e,d)}/></div>}));

// ---- Formats of the printed Personal File (the sample "personal file report"): dates are 03-Feb-2024, the ESIC and Form 11 pages use 03/02/2024 ----
const dd=(v:string)=>dMonY(v>='2099'?'':v);
const wage=(ctx:ReportContext,e:Employee)=>{const s=trimCell(extraOf(ctx,e)?.totsal);const n=Number(s);return s&&Number.isFinite(n)?n.toFixed(2):s;};
const cityOf=(ctx:ReportContext)=>(ctx.company.address||'').trim().split(/[\s,]+/).filter(Boolean).pop()||'';
const addMonths=(iso:string,n:number)=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||'');if(!m)return '';const t=new Date(Date.UTC(+m[1],+m[2]-1+n,1));const last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();return new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),Math.min(+m[3],last))).toISOString().slice(0,10);};
const dayBefore=(iso:string)=>iso?new Date(Date.parse(iso+'T00:00:00Z')-864e5).toISOString().slice(0,10):'';
const ageOf=(dob:string)=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(dob||'');if(!m||dob>='2099')return '';const n=new Date();let a=n.getFullYear()-+m[1];if(n.getMonth()+1<+m[2]||(n.getMonth()+1===+m[2]&&n.getDate()<+m[3]))a--;return a>=0&&a<120?String(a):'';};
const isSpouse=(e:Employee)=>/^\s*(w\/o|h\/o|wife|husband|w\.o|h\.o)/i.test(e.fatherName||'');
const Boxed=({children,double}:{children:ReactNode;double?:boolean})=><div className={'pf2-boxtitle'+(double?' double':'')}>{children}</div>;
const Under=({v,w,children}:{v?:ReactNode;w?:string;children?:ReactNode}) => <span className="pf-ul" style={w?{minWidth:w}:undefined}>{children??(v||' ')}</span>;
const Check=({on}:{on?:boolean}) => <span className="pf2-check">{on?'✓':''}</span>;

// ---- Biodata (Hindi / English form) ----
function biodata(ctx:ReportContext,e:Employee,d:Data){const x=extraOf(ctx,e);
 const rows:[string,string,ReactNode,boolean?][]=[
  ['अभ्यर्थित पद','Post applied for',e.designation],['नाम साफ अक्षरों में','Name in Capital  Letters )',e.name.toUpperCase()],['पिता /पति का नाम','Father\'s/Husband\'s Name)',e.fatherName],
  ['जन्म तिथि','Date of Birth',dd(e.dob)],['नियुक्ति की तिथि','Date of Joining',showDoj(ctx)?dd(e.doj):''],['ई0 पी0 एफ0 नं0','PF No',x?.pfNo||'',true],['ई0एस0 आई0 सी0 नं0','ESI No',x?.esiNo||'',true],
  ['राष्ट्रीयता','Nationality','Indian'],['धर्म','Religion',e.religion],['विवाहित / अविवाहित','Married/Unmarried',e.maritalStatus],['स्थानीय पता','Local Address',e.localAddress],['स्थाई पता','Permanent Address',e.permanentAddress],
  ['अहर्ताए','Quilification',e.education],['तकनीकी अहर्ताए','Technical Qualiication',e.technicalQualification],['भाषाएं (लिखना एवं पढ़ना )','Language Read & Write',''],['अनुभव','Experience','']];
 return <div className="pf-bio pf2-frame"><div className="pf-title"><b>व्यक्तिगत विवरण फार्म</b><br/>BIO DATA FORM<span className="pf-code">{e.paycode}</span></div><Logo/><Photo e={e} ctx={ctx}/>
 <table className="pf-plain pf2-bio"><tbody>{rows.map(([hi,en,v,plain],i)=><tr key={i}><td className="n">{i+1}.</td><td className="h">{hi}</td><td className="en">{plain?en:'('+en.replace(/\)$/,'')+')'}</td><td>{v}</td></tr>)}</tbody></table>
 <table className="pf-grid"><thead><tr><th>क्रमांक<br/>S.No</th><th>नियोक्ता का नाम<br/>Name of Employer</th><th>धारित पद<br/>Post of held</th><th>अवधि<br/>From &nbsp; To</th><th>वेतन<br/>Salary</th><th>छोड़ने का कारण<br/>Reason for Leaving</th></tr></thead><tbody><tr><td>1</td><td/><td/><td/><td/><td/></tr><tr><td>2</td><td/><td/><td/><td/><td/></tr></tbody></table>
 <div className="pf-sub">17. पारिवारिक विवरण &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Family Detail</div>
 <table className="pf-grid"><thead><tr><th>क्रमांक<br/>S.No</th><th>पारिवारिक विवरण<br/>Family Detail</th><th>सम्बन्ध<br/>Relation</th><th>आयु<br/>Age</th><th>पता<br/>Address</th></tr></thead>
  <tbody>{[0,1,2,3,4].map(i=>{const p=d.fam[i];return <tr key={i} className="tall"><td>{i+1}{i<4?'.':''}</td><td>{p?.name}</td><td>{p?.relation}</td><td>{p?ageOf(p.dob):''}</td><td>{p?.address}</td></tr>;})}</tbody></table>
 <div className="pf-sub">18. दो व्यक्तियो के नाम (सगे सम्बन्धियो को छोड कर )जो आपको भलीभाति जानते हों<br/><span style={{fontWeight:400}}>Give names,Telephone No. &amp; Addresses of two Persones (excluding Relatives) who know you well.</span></div>
 <table className="pf-grid"><thead><tr><th>#</th><th>नाम<br/>Name</th><th>पता<br/>/Address</th><th>सम्बन्ध<br/>Relation</th><th>दूरभाष<br/>Telephone</th></tr></thead><tbody><tr className="tall"><td>1.</td><td/><td/><td/><td/></tr><tr className="tall"><td>2.</td><td/><td/><td/><td/></tr></tbody></table>
 <div className="pf-sign" style={{justifyContent:'flex-end',marginTop:'12mm'}}><span>अभ्यर्थी के हस्ताक्षर<br/>Signature of Applicant/Left Thumb Impression</span></div></div>;}

// ---- Application form ----
function appForm(ctx:ReportContext,e:Employee){return <div className="pf-letter pf2-app"><div className="pf-title"><b className="big">Application form</b><br/><b>आवेदन पत्र</b><span className="pf-code">{e.paycode}</span></div>
 <p>दिनांक :</p><p>सेवा में,</p><p style={{paddingLeft:'8mm'}}><Under v="The Manager" w="75mm"/><br/><Under v={<b>{ctx.company.name}</b>} w="75mm"/><br/>{ctx.company.address}<br/><Under w="75mm"/></p>
 <p>विषय : <Under v={<span style={{display:'block',textAlign:'center'}}>{e.designation}</span>} w="95mm"/> हेतु आवेदन पत्र</p><p style={{paddingLeft:'8mm'}}>महोदय,</p>
 <p>मुझे पता चला है कि आपकी कम्पनी में <Under v={e.designation} w="85mm"/> की जगह</p><p>खाली है। मुझे <Under v={e.designation} w="75mm"/> का काम करनेका अच्छा अनुभव है । यदि आप</p>
 <p>मुझे एक बार सेवा का अवसर प्रदान करें तो मैं अपना काम बड़ी मेहनत और ईमानदारी से करूँगा/करूँगी तथा</p><p style={{paddingLeft:'6mm'}}>किसी भी अवैध कार्य, राजनितिक या असामाजिक गतिविधियों में भाग नहीं लूंगा/लूंगी।</p>
 <div className="pf-sign"><span>स्थान &nbsp; <Under v={cityOf(ctx)} w="40mm"/><br/><br/>दिनांक &nbsp; <Under v={dd(e.doj)} w="40mm"/></span><span>(हस्ताक्षर)<br/><br/><br/>{e.name}</span></div></div>;}

// ---- Appointment letter (Hindi) ----
const CONDITIONS:(string|string[])[]=[
 'आप 6 महीने तक अस्थाई/प्रोबेशन पर नियुक्त रहेंगे। जरुरत पड़ने पर यह अवधि 3 महीनों के लिए दोबारा बढ़ाई जा सकती है।',
 'अस्थाई/प्रोबेशन कार्यकाल या बढ़ाई गई अस्थाई/प्रोबेशन कार्यकाल, के दौरान आपको यह अधिकार होगा कि आप बिना किसी सूचना (नोटिस) दिए नौकरी छोड़ सकते हैं। इस अस्थाई/प्रोबेशन के दौरान कम्पनी को भी अधिकार होगा कि वह आपको बिना किसी सूचना (नोटिस) के नौकरी छोड़ने के लिए कह सकती है।',
 'किसी एक दिन 8 घन्टा कार्य करने के उपरान्त और किसी एक हफ्ते में 48 घन्टा कार्य करने के बाद आप ओवर टाइम (OT) वेतन के हकदार हैं। फैक्ट्री एक्ट 1948 (धारा 59) के तहत ओवर टाइम (OT) हमेशा आपकी स्वीकृति से होगा।',
 'काम की जरुरत के अनुसार कम्पनी आपका तबादला (ट्रांसफर) कम्पनी के किसी दूसरे विभाग या भारत में कम्पनी की किसी अन्य फैक्ट्री में कर सकती है। अगर आपका तबादला एक से दूसरे राज्य में किया जाता है तो आपकी यात्रा का खर्चा कम्पनी के द्वारा दिया जाएगा।',
 'आपकी आयु 58 वर्ष की होने पर आपको कम्पनी द्वारा रिटायर कर दिया जाएगा। कम्पनी द्वारा आपके उम्र के सबूत के तौर पर केवल स्कूल प्रमाणपत्र या आपके जन्म का प्रमाणपत्र ही माने जाएंगे। जन्म प्रमाण पत्र एक बार दिए जाने के बाद बदला नहीं जा सकता।',
 ['अस्थाई/प्रोबेशन कार्यकाल खत्म होने के बाद आपकी नियुक्ति पक्की की जायेगी, कम्पनी द्वारा इस संदर्भ में आपको पत्र दिया जाएगा।',
  '(क) अगर आप मासिक वेतन पर कार्यरत है : पक्की नियुक्ति होने के बाद, अगर आप अपनी नौकरी छोड़ना चाहते हैं तो आपको कम्पनी को एक महीने का नोटिस देना पड़ेगा और नोटिस पीरियड/समय के दौरान आपको कार्य करना पड़ेगा या फिर आपकी सालाना छुट्टी बकाया है तो आप उसकी एडजस्टमैन्ट करा सकते हैं। अगर आप कम्पनी के पक्के कर्मचारी हैं और कम्पनी आपकी सेवायें बर्खास्त करती है तो वह आपको एक महीने का नोटिस या फिर नोटिस न देने के स्थान पर एक महीने का वेतन देगी।',
  '(ख) अगर आप मासिक वेतन पर कार्यरत नहीं हैं : पक्की नियुक्ति होने के बाद, अगर आप अपनी नौकरी छोड़ना चाहते हैं तो आपको कम्पनी को दो हफ्तों का नोटिस देना पड़ेगा या फिर अगर सालाना छुट्टी बकाया है तो आप उसकी एडजस्टमैन्ट करा सकते हैं। अगर आप पक्के कर्मचारी हैं और कम्पनी आपकी सेवायें बर्खास्त करती है तो वह आपको दो हफ्ते का नोटिस या नोटिस देने के स्थान पर दो सप्ताह का वेतन प्रदान करेगी।'],
 'बुरे व्यवहार की शिकायत मिलने पर आपको नौकरी से निलंबित (सस्पैंड) किया जा सकता है, जब तक कि जाँच (इन्क्वायरी) पूरी नहीं होगी। आपको सस्पैंशन के दौरान 50% वेतन मिलेगा। यदि आपका बुरा व्यवहार साबित नहीं होता है तो कम्पनी आपको निलंबित समय का पूरा वेतन देगी।',
 'जब तक आप इस कम्पनी में काम करते है, आपको बिना कम्पनी की आज्ञा लिए दूसरी किसी कम्पनी में काम करने की अनुमति नहीं है।',
 'भारतीय श्रम कानून के नियम अनुसार जैसे ही आप इस कम्पनी में 240 दिन काम कर लेते हैं तो आपको 1 दिन की छुट्टी हर 20 कार्य दिनों के बाद वेतन सहित लेने का अधिकार होगा।',
 'आपको वर्ष में 7 दिन का आकस्मिक अवकाश (CL) का अधिकार होगा पूरे वेतन के साथ।',
 'आपको वर्ष में ESIC के नियमानुसार बीमारी के अवकाश का अधिकार होगा।',
 'यदि आपका मेडिकल इन्श्योरेंस नहीं है और यदि आपने कम से कम 80 दिन कम्पनी में कार्य किया है तो गर्भावस्था के समय आपको पूरे वेतन के साथ बिना काम किए 26 हफ्ते की गर्भावस्था छुट्टियाँ मिलेगी।',
 'नियमानुसार आपको और आपके परिवार को मेडिकल इन्श्योरेंस (ESI) की सुविधा दी जायेगी। जिसके लिए आपके कुल वेतन का 0.75 प्रतिशत हर महिने काट लिया जाएगा और आपके योगदान के रुप में आपको ESI का कार्ड दिया जाएगा। इस कार्ड से आपको बीमार पड़ने पर छुट्टियों का पैसा मिलेगा और गर्भावस्था के दौरान भी पैसा मिलेगा। अस्थाई या स्थाई रुप से अपंग होने पर भी पैसा मिलेगा। इसके अतिरिक्त उन सब चीजों का पैसा मिलेगा जो कि एम्पलॉयिज स्टेट इन्श्योरेंस ऐक्ट में दिए गए हैं।',
 'आपके नियमानुसार प्रोविडेंट फन्ड (PF) की सुविधा भी मिलेगी जिसके लिए आपके वेतन के मूल (BASIC) व महंगाई भत्ते (DA) का 12 प्रतिशत काट लिया जाएगा। आपके (PF) खाते में हर महीने जमा कराया जाएगा। कम्पनी भी अपनी ओर से 12 प्रतिशत उतना ही पैसा आपके खाते में जमा कराएगी।',
 'यदि आप कम्पनी मे 30 दिन से ज्यादा काम कर चुके हैं तो साल में कुल वेतन का कम से कम 8.33% या अधिक से अधिक 20% बोनस दिया जायेगा।',
 'यदि आपने कम्पनी में बिना नौकरी छोड़े लगातार 5 साल तक काम किया है तो कम्पनी आपको नौकरी छोड़ने पर ग्रेचुएटी की सुविधा देगी जो कि ग्रेचुएटी पेमेन्ट एक्ट के तहत होगी।'];
function appointmentHindi(ctx:ReportContext,e:Employee,part=1){const six=CONDITIONS[5] as string[];if(part===2)return <div className="pf-letter pf2-appt"><span className="pf-code">{e.paycode}</span><div className="sub0">{six[2]}</div>
 <ol className="pf-terms pf2-terms" start={7}>{CONDITIONS.slice(6).map((c,i)=><li key={i}>{c as string}</li>)}
  <li value={17}>यदि आपको ऊपर दी गयी शर्तें मंजूर हैं तो आप इस नियुक्ति पत्र की दूसरी प्रति पर स्वीकृति के लिए अपने हस्ताक्षर करें और दिनांक <Under v={dd(e.doj)} w="30mm"/> से काम पर आयें।</li></ol>
 <div className="pf2-accept">मैने ऊपर लिखी सभी शर्तें पढ़ और समझ ली हैं, मैं उन्हें स्वीकार करता हूँ।</div><div className="pf-sign" style={{marginTop:'14mm'}}><span>हस्ताक्षर प्रबन्धक (स्टाम्प)</span><span>हस्ताक्षर कर्मचारी</span></div></div>;
 return <div className="pf-letter pf2-appt"><span className="pf-code">{e.paycode}</span><div className="pf2-org"><b>{ctx.company.name}</b><br/><b>{ctx.company.address}</b></div>
 <div className="pf2-boxrow"><Boxed><span className="deva">नियुक्ति पत्र</span></Boxed><span className="deva side">नियुक्ति पत्र</span></div>
 <p>आपके नौकरी के लिए आवेदन पत्र और साक्षात्कार (इन्टरव्यू) के संदर्भ में आपकी <b>{e.designation}</b> पद के लिए नियुक्ति करते हुए हमें हर्ष होता है।</p>
 <table className="pf-plain pf2-fields"><tbody><tr><td className="k">नाम</td><td>: &nbsp; {e.name}</td><td className="k">पिता / पति का नाम:</td><td>{e.fatherName}</td></tr>
 <tr><td className="k">अस्थायी पता</td><td colSpan={3}>: &nbsp; {e.localAddress}</td></tr><tr><td className="k">स्थायी पता</td><td colSpan={3}>: &nbsp; {e.permanentAddress}</td></tr>
 <tr><td className="k">जन्म तिथि</td><td>: &nbsp; {dd(e.dob)}</td><td className="k">काम शुरू करने की तारीख:</td><td>{dd(e.doj)}</td></tr>
 <tr><td className="k">पद</td><td>: &nbsp; {e.designation}</td><td className="k">विभाग :</td><td>{e.department}</td></tr>
 <tr><td className="k">श्रेणी</td><td colSpan={3}>: &nbsp; (अकुशल, अर्द्धकुशल कुशल, अतिकुशल)</td></tr>
 <tr><td className="k">वेतन</td><td colSpan={3}>: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {wage(ctx,e)} /- &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; प्रति माह / रोजाना / पीस रेट के आधार पर</td></tr></tbody></table>
 <div className="pf2-terms-title"><u>नियुक्ति की शर्तें</u></div>
 <ol className="pf-terms pf2-terms">{CONDITIONS.slice(0,5).map((c,i)=><li key={i}>{c as string}</li>)}<li value={6}>{six[0]}<div className="sub">{six[1]}</div></li></ol></div>;}
// ---- Employee Orientation ----
const ORIENTATION=['कर्मचारी के आने का समय सुबह  9:00  बजे है ।','दोपहर के भोजन का समय 13:00 से 14:00 है ।','शाम को जाने का समय 18:00 है ।','ओवरटाइम  करना  अनिवार्य नहीं है ।','साप्ताहिक छुट्टी रविवार को होगी।','राष्ट्रीय और धार्मिक त्यौहार की कुल छुट्टी  1 जनवरी से 31 दिसम्बर, जो एक कैलेंडर वर्ष में  होती  है ।','प्रत्येक कैलेंडर वर्ष में  7 आकस्मिक छुट्टी ले सकते हैं।',
 'अर्जित छुट्टी  (वार्षिक छुट्टी)  या इसका पैसा  ले सकते हैं । इसकी गणना  आपकी  वर्ष भर की उपस्थिति के आधार पर होती  है ।','प्रत्येक कर्मचारी के  वेतन से  12 (जिसका  मूल  वेतन 15000 से कम या बराबर है ) प्रतिशत  भविष्य निधि(पीएफ  )के रूप में काटा  जाता है । इतना ही शेयर कंपनी भी आपके पीएफ खाते में जमा करती  है ।',
 'प्रत्येक कर्मचारी के  वेतन से  0.75 (जिसका  कुल वेतन 21000 से कम या बराबर है )  प्रतिशत  ईएसआई  के रूप में काटा जाता है । 3.25 प्रतिशत  कंपनी  अपने हिस्से से  जमा  करती  है । जिसके बाद ईएसआई आपको  विभिन्न प्रकार की  चिकित्सा सुविधाएं प्रदान करती  है ।',
 'प्रत्येक कर्मचारी  लगातार 5 साल  काम करने के बाद ग्रेच्युटी के लिए अधिकारी  हो  जाता है  सेवा  छोड़ने के बाद 15 दिन  प्रति वर्ष दर से  जो 26 द्वारा वर्तमान मूल  वेतन के विभाजन के बाद देय है।','प्रत्येक कर्मचारी को कार्मिक विभाग से नियुक्ति पत्र अवश्य  ले।','महिला कर्मचारियों को प्रसव अवकाश मिलेगा जो सरकारी नियमानुसार होगा ।','वेतन प्रतेक माह की सात   तारीख को   मिलता है ।'];
const orientation=(ctx:ReportContext)=><div className="pf-letter pf2-orient"><div className="pf2-org"><b>{ctx.company.name}</b><br/>{ctx.company.address}</div><div className="pf2-orient-title">EMPLOYEE ORIENTATION</div><p>प्रत्येक कर्मचारी  जब  कंपनी में  काम करने के लिए आता है  तो  उसे  निम्न  बातो का  ध्यान रखना  अनिवार्य है  :-</p><ol className="pf-terms pf2-terms">{ORIENTATION.map((c,i)=><li key={i}>{c}</li>)}</ol>
 <div className="pf-sign" style={{marginTop:'26mm'}}><span><b>Employee's Signature</b></span><span><i><b>For</b></i> &nbsp;&nbsp;&nbsp; <b>{ctx.company.name}</b><br/><br/><br/><b>Authorized Signatory</b></span></div></div>;

// ---- Employee Details (file cover) ----
function employeeDetails(ctx:ReportContext,e:Employee){const x=extraOf(ctx,e);const r=realResignDate(e);
 const rows:[string,ReactNode][]=[['CODE',e.paycode],['NAME',e.name],['DESIGNATION',e.designation],['FATHER\'S NAME',e.fatherName],['RATE',wage(ctx,e)],['PRESENT ADDRESS',e.localAddress],['PERMANENT ADDRESS',e.permanentAddress],['CARD NUMBER',e.cardNo],['DATE OF JOINING',dd(e.doj)],['DATE OF BIRTH',dd(e.dob)],['ESI NUMBER',x?.esiNo||''],['PF NUMBER',x?.pfNo||''],['DATE OF LEAVING',r?dd(r):'']];
 return <div className="pf2-frame pf2-details"><span className="pf-code">{e.paycode}</span><div className="pf2-details-head"><Boxed double>Employee Details</Boxed></div>
 <table className="pf2-table"><tbody>{rows.map(([k,v])=><tr key={k}><td className="k">{k}</td><td>{v}</td></tr>)}
  <tr><td className="k">CHECK LIST FOR P&amp;A DEPTT. (AT THE OF JOINING)</td><td>APPLICATION FORM, AGREEMENT, AGE PROOF, ESI DECLARATION, PF NOMINATION, GRATUITY NOMINATION FORM, FORM-16. FORM-11</td></tr>
  <tr><td className="k">CHECK LIST FOR P&amp;A DEPTT. (AT THE OF LEAVING)</td><td>RESIGNATION,FULL &amp; FINAL,ACCEPTANCE OF RESIGN, LEAVE ENCASHMENT</td></tr></tbody></table>
 <table className="pf2-table"><tbody><tr><td className="k"/><td className="c"><b>NAME</b></td><td className="c"><b>SIGNATURE</b></td></tr>{['FILE PREPARED BY','FILE CHECKED BY','FILE CLOSED BY','FILE CHECKED BY'].map((k,i)=><tr key={i} className="tall"><td className="k">{k}</td><td/><td/></tr>)}<tr className="tall"><td className="k"/><td colSpan={2}/></tr></tbody></table></div>;}

// ---- Employee Personal Detail (increment & promotion sheet) ----
function history(ctx:ReportContext,e:Employee){return <div className="pf2-hist"><div className="pf2-hist-head"><Boxed double>EMPLOYEE PERSONAL DETAIL</Boxed><span className="pf-code" style={{position:'static'}}>{e.paycode}</span></div>
 <div className="pf2-hist-body"><div className="pf2-hist-fields"><div className="r"><b>PAY CODE</b><span>{e.paycode}</span><b className="r2">DOJ</b><span>{showDoj(ctx)?dd(e.doj):''}</span></div><div className="r"><b>NAME</b><span>{e.name}</span><b className="r2">DOB</b><span>{dd(e.dob)}</span></div>
  <div className="r"><b>F./H.NAME</b><span>{e.fatherName}</span></div><div className="r"><b>DESIGNATION</b><span>{e.designation}</span><b className="r2">WAGES</b><span>{wage(ctx,e).replace(/\.00$/,'')} &nbsp; <b>/PER MONTH</b></span></div><div className="r"><b>DEPARTMENT</b><span>{e.department}</span><b className="r2">QUALIFICATION</b><span>{e.education}</span></div></div>
  <div className="pf2-hist-logo"><Logo/><Photo e={e} ctx={ctx}/></div></div>
 <p className="addr"><b>Preasent Address</b><br/>{e.localAddress}</p><p className="addr"><b>Permanant Address</b><br/>{e.permanentAddress}</p>
 <Boxed double>INCREMENT &amp; PROMOTION DETAILS</Boxed>
 <table className="pf2-table incr"><thead><tr><th>With Effect<br/>From</th><th>Annual<br/>Increment</th><th>DA</th><th>Revised Wages</th><th>Promotion<br/>if,Any</th><th>Approved By</th><th>Remarks</th></tr></thead><tbody>{Array.from({length:10},(_,i)=><tr key={i} className="tall"><td/><td/><td/><td/><td/><td/><td/></tr>)}</tbody></table></div>;}

// ---- Confirmation letter (Hindi) ----
function confirmation(ctx:ReportContext,e:Employee){const from=addMonths(e.doj,6);return <div className="pf-letter pf2-conf"><span className="pf-code">{e.paycode}</span><div className="pf2-org"><b>{ctx.company.name}</b><br/>{ctx.company.address}</div>
 <table className="pf-plain pf2-fields" style={{marginTop:'12mm'}}><tbody><tr><td className="k">कर्मचारी का नाम</td><td>{e.name}</td></tr><tr><td className="k">पिता / पति का नाम</td><td>{e.fatherName}</td></tr><tr><td className="k">पद</td><td>{e.designation}</td></tr><tr><td className="k">विभाग</td><td>{e.department}</td></tr></tbody></table>
 <div className="pf2-boxrow center"><Boxed><span className="deva">स्थायी नियुक्ति पत्र</span></Boxed></div>
 <p className="deva-p">आपको सूचित किया जाता है कि प्रबन्धन नें आपको कम्पनी की सेवाओं में दिनांक &nbsp;<Under v={dd(e.doj)} w="30mm"/>&nbsp; से दिनांक &nbsp;<Under v={dd(dayBefore(from))} w="30mm"/>&nbsp; तक परीवीक्षाकल पर रखा था। आपका कार्य एवं आचरण सन्तोष जनक रहा।</p>
 <p className="deva-p" style={{marginTop:'12mm'}}>अतः आपको कम्पनी में आज दिनांक &nbsp;<Under v={dd(from)} w="30mm"/>&nbsp; से आपको स्थाई रूप से नियुक्त किया जाता है। आपको कम्पनी द्वारा दी गई सुविधाओ का लेने का पूर्ण अधिकार होगा।</p>
 <div className="pf-sign" style={{marginTop:'40mm'}}><span>कृते &nbsp;&nbsp;&nbsp;&nbsp; <b>{ctx.company.name}</b></span><span>कर्मचारी के हस्ताक्षर</span></div><p style={{marginTop:'10mm',paddingLeft:'6mm'}}>प्रबन्धक</p></div>;}

// ---- Duty join (Karyagrahan suchna) ----
function dutyJoin(ctx:ReportContext,e:Employee){const row=(k:string,v:ReactNode,tall?:boolean)=><div className={'row'+(tall?' tall':'')}><span className="k">{k}</span><span className="c">:</span><span className="v">{v}</span></div>;
 return <div className="pf-letter pf2-duty"><span className="pf-code" style={{top:'8mm'}}>{e.paycode}</span><div className="pf2-duty-top"><div>सेवा में<br/>प्रबंधक महोदय<br/>{ctx.company.name}<br/>{ctx.company.address}</div><div className="date">दिनांक &nbsp;&nbsp; <Under v={dd(e.doj)} w="45mm"/></div></div>
 <div className="pf2-duty-title"><u>कार्यग्रहण सूचना</u></div>
 <p>आपके द्वारा दिये गये नियुक्ति पत्र दिनांक &nbsp; <Under v={dd(e.doj)} w="62mm"/> &nbsp; के अनुसार मैं आज</p><p>दिनांक &nbsp; <Under v={dd(e.doj)} w="60mm"/> &nbsp; से डयुटी पर रिपोर्ट करता हूँ/करती हूँ, जिसके</p>
 {row('अनिवार्य विवरण इस प्रकार है।','')}{row('नाम',e.name)}{row('पिता /पति का नाम',e.fatherName)}{row('पद',e.designation)}{row('वेतन प्रतिमाह',wage(ctx,e))}{row('स्थानीय पता',e.localAddress,true)}{row('स्थाई पता',e.permanentAddress,true)}<div className="row tall"><span className="k"/><span className="c"/><span className="v"/></div>{row('कार्यग्रहण करने की तिथि',dd(e.doj))}
 <p style={{marginTop:'12mm'}}>प्रार्थी के हस्ताखर दिनांक सहित</p></div>;}


// ---- ESI Form 1 front (Temporary Identity Certificate) ----
function esiFront(ctx:ReportContext,e:Employee,d:Data){const x=extraOf(ctx,e);const none='None';const reg=dm(e.doj);const sex=employeeSex(e,x);const g=sex==='Female'?'F':sex==='Male'?'M':sex;
 return <div className="pf2-esic"><span className="pf-code">{e.paycode}</span>
 <div className="head"><div className="logo"><img src="/esic-logo.png" alt="ESIC"/></div><div className="t"><b>EMPLOYEES STATE INSURANCE CORPORATION</b><br/><b>TEMPORARY IDENTITY CERTIFICATE</b></div></div>
 <table className="pf-plain top"><tbody><tr><td className="r">Insured Person :</td><td><b>{e.name}</b></td></tr><tr><td className="r">Insurance No :</td><td><b>{x?.esiNo||''}</b></td></tr><tr><td className="r">Date Of Registration :</td><td><b>{reg}</b></td></tr></tbody></table>
 <div className="center"><b>YOUR REGISTRATION DETAILS</b></div>
 <table className="pf2-table"><tbody><tr><td className="k">Employee Name :</td><td>{e.name}</td><td className="k">Type of Disability :</td><td>{none}</td></tr><tr><td className="k">Name of Father/Husband :</td><td>{e.fatherName}</td><td className="k">Date Of Birth :</td><td>{dm(e.dob)}</td></tr>
  <tr><td className="k">Marital Status :</td><td>{e.maritalStatus}</td><td className="k">Gender :</td><td>{g}</td></tr><tr className="tall"><td className="k">Present Address :</td><td>{e.localAddress}</td><td className="k">Permanent Address :</td><td>{e.permanentAddress}</td></tr><tr><td className="k">Dispensary/IMP :</td><td colSpan={3}/></tr></tbody></table>
 <table className="pf2-table two"><tbody><tr><td colSpan={2} className="k">Current Employer  Details</td><td colSpan={2} className="k">Previous Employer   Details</td></tr>
  <tr><td className="k">Employer's Code No. :</td><td>{trimCell(ctx.company.values.esi_no)}</td><td className="k">Employer's Code No. :</td><td>{none}</td></tr><tr><td className="k">Sub Units  Code No. :</td><td>{none}</td><td className="k">Sub Units  Code No. :</td><td>{none}</td></tr>
  <tr><td className="k">Date of Appointment :</td><td>{reg}</td><td className="k">Previous Insurance No.</td><td>{none}</td></tr><tr><td className="k">Name of Employer :</td><td>{ctx.company.name}</td><td className="k">Name of Employer :</td><td>{none}</td></tr><tr className="tall"><td className="k">Address of Employer :</td><td>{ctx.company.address}</td><td className="k">Address of Employer :</td><td>{none}</td></tr></tbody></table>
 <div className="sub">Family Details:</div>
 <table className="pf2-table fam"><thead><tr><th>Name</th><th>Relation With Employee</th><th>Date Of Birth</th><th>Whether Residing With I</th><th>State</th><th>District</th></tr></thead><tbody>{Array.from({length:6},(_,i)=>{const p=d.fam[i];return <tr key={i}><td>{p?.name}</td><td>{p?.relation}</td><td>{p?dm(p.dob):''}</td><td>{p?(p.residing?'Yes':'No'):''}</td><td/><td/></tr>;})}</tbody></table>
 <div className="sub">Nominee  Details:</div>
 <table className="pf2-table fam"><thead><tr><th>Name Of Nominee</th><th>Relationship with IP</th><th>Percentge</th><th>Address of Nominee</th></tr></thead><tbody>{Array.from({length:2},(_,i)=>{const p=d.nom[i];return <tr key={i}><td>{p?.name}</td><td>{p?.relation}</td><td>{p&&d.nom.length===1?'100':''}</td><td>{p?.address}</td></tr>;})}</tbody></table>
 <p className="b" style={{marginTop:'4mm'}}><b>Documents Uploaded:</b></p><p><b>Please Verify the above Particulars.</b></p><p><b>Please Notify Your Employer or in the Branch Office Address Below Incase of Any Information Found Incorrect.</b><br/>To get permanent ID card, employee is requested to visit the following branch office to get biometric &amp; photo captured by this date<br/>{dmy(e.doj).replace(/^(\d\d)\/(\d\d)\/(\d{4})$/,(_m,a,b,c)=>a+'/'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+b-1]+'/'+c)} &nbsp;&nbsp; <b>In Below Branch office:-</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; or any nearest ESIC Bio-metric Camp Locations.</p>
 <div className="sigrow"><div><b>Signature / LTI of Registered Employee / IP :</b><div className="sigbox"/><p style={{marginTop:'3mm'}}><b>Mobile Number :</b> &nbsp;&nbsp;&nbsp; {e.phone}</p></div><div className="photobox">Affix Your Family Photograph Here.(Attested and Stamped by Employer / ESIC Official)</div></div>
 <p className="note"><b>NOTE:</b><br/>1. Please Keep this Printout for Future Reference and Bring this Along with Your Photo ID Card for All Your Claim Benefits and Medical Benefits .<br/>2. This Copy Should be Retained with You until the Biometric Card is Dispatched .<br/>3. Employer to please affix employee and his family photo here and attest with official stamp across .</p><p className="r"><b>Signature / Stamp of ESIC Officer / Employer</b></p></div>;}
const esiBack=(ctx:ReportContext,e:Employee)=><div className="pf-letter pf-small"><div className="pf-title"><b>ESIC Declaration Form (Form 1) — Back</b></div>
 <p><b>Declaration by the Insured Person</b></p><p>I, <Line v={e.name} w="60mm"/> son/wife/daughter of <Line v={e.fatherName} w="60mm"/>, hereby declare that the particulars furnished in the front of this form are true and correct to the best of my knowledge and belief.</p>
 <p>I shall inform the employer / the Corporation immediately of any change in my family particulars, address or nomination.</p>
 <ol className="pf-terms"><li>The Insured Person should carry the ESIC Pehchan Card / e-Pehchan while availing medical benefits.</li><li>Contribution of the employee is deducted from wages by the employer and paid to the Corporation along with the employer's contribution.</li><li>Any change in family details must be informed through the employer.</li></ol>
 <div className="pf-sign"><span>Date : {dd(e.doj)}<br/>Place : ____________</span><span>Signature / Thumb impression of Insured Person<br/><b>{e.name}</b></span></div></div>;

// ---- PF Form 2 (Nomination and Declaration) ----
function pfFront(ctx:ReportContext,e:Employee,d:Data){const x=extraOf(ctx,e);return <div className="pf2-frame pf2-pf2"><span className="pf-code" style={{top:'12mm',left:'128mm',right:'auto'}}>{e.paycode}</span>
 <div className="pf2-pf2-head"><div><Boxed>NOMINATION AND DECLARATION</Boxed><div className="pf2-subbox">(FOR UNEXEMPTED/EXEMPTED ESTABLISHMENTS)</div></div><div className="formno">Form-2 (Revised)</div></div>
 <p className="pf2-bold c big">Declaration &amp; Nomination Form under the Employee's ProvidentFund and Employees Pension Scheme</p><p className="pf2-bold c">(Paragraph 33 &amp; 61 (1) of Employee's Provident Fund Scheme, 1952 &amp; paragraph 18 of the Employee's PensionScheme 1995)</p>
 <div className="two"><div><p>1. Name (In block letters)<span className="v">{e.name.toUpperCase()}</span></p><p>2. Father's Husband's Name<span className="v">{e.fatherName}</span></p><p>3. Date of Birth<span className="v">{dd(e.dob)}</span></p><p>4. Sex<span className="v">{employeeSex(e,x)}</span></p><p>5. Marital Status<span className="v">{e.maritalStatus}</span></p></div>
  <div><p>6. Account No.<span className="v">{x?.pfNo||''}</span></p><p>7. Permanent Address<br/><span className="v2">{e.permanentAddress}</span></p><p>Temporary Address<br/><span className="v2">{e.localAddress}</span></p><p>8. Date of Appointment<span className="v">{dd(e.doj)}</span></p></div></div>
 <div className="center"><Boxed>PART - A (EPF)</Boxed></div><p className="pf2-j">I hereby nominate the person(s)  / cancel the nomination made by mepreviously and nominate the  person (s) mentioned below to receive below to receive the amount standing to by credit in the employee's provident Fund in the event of my death.</p>
 <table className="pf2-table pf2-nom"><thead><tr><th>Name of the<br/>nominee / nominees</th><th>Address</th><th>Nominee's<br/>relationship<br/>with the<br/>member</th><th>Date of<br/>birth</th><th>Total Amt. of share of accu mulations in provient Fund pai to each nominee</th><th>If the nominee is  a minor<br/>name &amp;<br/>relationship &amp; address of<br/>the guardian who may<br/>receive the amount during<br/>the minority of nominee</th></tr><tr className="nums"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td></tr></thead>
  <tbody>{d.nom.length?d.nom.map((p,i)=><tr key={i} className="tall"><td>{p.name}</td><td>{p.address}</td><td>{p.relation}</td><td>{dd(p.dob)}</td><td>{d.nom.length===1?'100%':''}</td><td/></tr>):<tr className="tall4"><td/><td/><td/><td/><td/><td/></tr>}</tbody></table>
 <p>1. Certified that I have no family as defined in 2 (g) of the Employee's provident Fund Scheme 1952 and should acquired a family here after the above nomination should be deemed as cancelled.</p><p>2.  Certified that my father/mother is /are dependent upon me</p>
 <div className="pf-sign" style={{justifyContent:'flex-end'}}><span style={{textAlign:'center'}}><b>Signature or thumb Impression of the<br/>subscriber</b></span></div></div>;}
function pfBack(ctx:ReportContext,e:Employee,d:Data){return <div className="pf2-frame pf2-pf2b"><span className="pf-code" style={{top:'9mm',left:'auto',right:'22mm'}}>{e.paycode}</span>
 <div className="center"><Boxed>PARA- B (EPS)</Boxed><div className="pf2-subbox small">(Para 18)</div></div>
 <p className="pf2-bold">I hereby furnish below particulars of the members of my family who would be eligible to receive widow/children pension in the event of my death.</p>
 <table className="pf2-table"><thead><tr><th>S.No.</th><th>Name &amp; Address of the family</th><th>Address</th><th>Date of Birth</th><th>Relationship with Member</th></tr></thead><tbody>{Array.from({length:7},(_,i)=>{const p=d.fam[i];return <tr key={i} className="row7"><td>{i+1}</td><td>{p?.name}</td><td>{p?.address}</td><td>{p?dd(p.dob):''}</td><td>{p?.relation}</td></tr>;})}</tbody></table>
 <p>Certified that I have no family as defined in Para 2 (V11) of Emplyee's Pension Scheme , 1995 and should I acquire a family hereafter I shall furnish particulars there on in the above from.</p><p>I Hereby nominate the following person for receiving the monthly widow pension (admissible under para 16 (2) a (1) &amp; (11in the event without leaving any eligible member for receiving pension.</p>
 <table className="pf2-table"><thead><tr><th>Name &amp; Address of the Nominee</th><th>Date of Birth</th><th>Relationship with Member</th></tr></thead><tbody><tr className="tall4"><td>{d.nom[0]?.name}<br/>{d.nom[0]?.address}</td><td>{d.nom[0]?dd(d.nom[0].dob):''}</td><td>{d.nom[0]?.relation}</td></tr></tbody></table>
 <div className="pf-sign" style={{justifyContent:'flex-end',marginTop:'8mm'}}><span style={{textAlign:'center'}}><b>Signature or thumb Impression of the<br/>subscriber</b></span></div>
 <div className="center" style={{marginTop:'6mm'}}><Boxed>CERTIFICATE BY EMPLOYER</Boxed></div><p>Certified that the  above declarion and nomination has been signed/thumb impressed before me by<br/>Employed in my establishment after he/she has read the entries have been read over to him/her by me and got confirmed by him/her.</p>
 <p><b>Place</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {cityOf(ctx)}</p><p><b>Date</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {dd(e.doj)}</p>
 <div className="pf-sign" style={{marginTop:'4mm'}}><span>Name &amp; Address of the factory/Establishment<br/><b>{ctx.company.name}</b><br/>{ctx.company.address}</span><span>For &nbsp;&nbsp;&nbsp; <b>{ctx.company.name}</b><br/><br/><br/>Authority Signatue</span></div></div>;}

// ---- PF Form 11 (New Declaration Form) ----
function form11(ctx:ReportContext,e:Employee){const x=extraOf(ctx,e);const spouse=isSpouse(e);
 const rows:[string,ReactNode,ReactNode][]=[['1','Name of the member',<b key="n">{e.name}</b>],
  ['2',<>Father's name <span className="pf2-tick"><Check on={!spouse}/></span> &nbsp; Spouse's name <span className="pf2-tick"><Check on={spouse}/></span><br/>Please tich whichever is applicable</>,e.fatherName],
  ['3',<>Date of Birth &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (DD/MM/YYYY)</>,dm(e.dob)],['4','Gender:  (Male/Female/Transgender)',employeeSex(e,x)],['5','Marital Status (Married/Unmarried/Widow/Widower/Divorcee)',e.maritalStatus],
  ['6',<>(a) Email ID:<br/>(b) Mobile No:</>,<>{e.email}<br/>{e.phone}</>],['7','Whether earlier a member of Employee\'s Provident Fund Scheme 1952',''],['8','Whether earlier a member pf Employee\'s Pension Scheme 1995','']];
 const sub=(k:ReactNode,v:ReactNode)=><tr><td className="k">{k}</td><td className="v">{v}</td></tr>;
 return <div className="pf2-f11"><div className="top"><b>New Form No.11- Declaration Form</b><br/>(To be retained by the Employer for future reference)</div>
 <div className="center"><b className="big">The Employees' Provident Fund Organisation</b><br/><b>The Employees' Provident Funds Scheme, 1952 (Paragraph 34 &amp; 57)</b><br/><b>The Employees' Pension Scheme, 1995 (Paragraph 24)</b></div>
 <p className="center">Declaration by a person taking up employment in an establishment in which the E.P.F. Scheme. 1952 AND/OR E.P.S,1995 is applicable.</p>
 <table className="pf2-table f11"><tbody>{rows.map(([n,k,v])=><tr key={n}><td className="n">{n}</td><td>{k}</td><td className="v">{v}</td></tr>)}
  <tr><td className="n">9</td><td colSpan={2} className="inner"><table><tbody><tr><td><b>Previous employment details: [if yes to 7 and /or 8 above]</b><br/>a) Universal Account Number:</td><td className="v">{e.uan||x?.pfNo||''}</td></tr>{sub('b) Previous PF Accont Number:-','')}{sub('c) Date of exit from previous employment            (DD/MM/YYYY)','')}{sub('d) Scheme Certificate No. (if issued)','')}{sub('e) Pension Payment Order (PPO) No. (if issued)','')}</tbody></table></td></tr>
  <tr><td className="n">10</td><td colSpan={2} className="inner"><table><tbody>{sub('a) Internationl Worker.','No')}{sub('b) If yes, state country of origin (India/Name of other country)','India')}{sub('c) Passport No.','')}{sub('d) Validity of passport [(DD/MM/YYYY) to (DD/MM/YYYY)]','')}</tbody></table></td></tr>
  <tr><td className="n">11</td><td colSpan={2} className="inner"><table><tbody>{sub(<><b>KYC Details</b>: (attach self attested copies of following kycs)</>,'')}{sub('a) Bank Account No. & IFS Code',<>{e.accountNo} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {e.ifsc}</>)}{sub('b) AAdhar Number',e.aadhaar)}{sub('c) Permanent Account Number (PAN) , if available',e.pan)}</tbody></table></td></tr></tbody></table>
 <div className="center"><b><u>UNDERTAKING</u></b></div>
 <p>1) Certified that the particular are true to the best of my knowledge.</p><p>2) I authorize EPFO to use my Aadhar for verification/authentication/eKYC purpose for service delivery.</p><p>3) Kindly transfer the funds and service details, if applicable from the previous PF account as declared above to the presnt P.F. Account.<br/>(The transfer would be possible only if the identified KYC detail approved by previous employer has been verified by present employer using his Digital Signature Certificate)</p><p>4) In case of changes in above details, the same will be intimated to employer at the earliest.</p>
 <div className="sigline"><div>Date: &nbsp;&nbsp;&nbsp;&nbsp; {dm(e.doj)}<br/><br/>Place: &nbsp;&nbsp;&nbsp; {cityOf(ctx)}</div><div>Signature of Member</div></div>
 <div className="center"><span className="pf2-boxline">DECLARATION BY THE PRESENT EMPLOYER</span></div>
 <p><b className="ab">A</b> THE MEMBER MR./MS/MRS. &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {e.name} <span style={{float:'right'}}>HAS JOINED ON{dm(e.doj)}</span><br/>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; AND HAS BEEN ALLOTED PF MEMBER ID &nbsp; {x?.pfNo||''}</p>
 <p><b className="ab">B</b> IN CASE THE PERSON WAS EARLIER NOT A MEMBER OF EPF SCHEME, 1952 AND &nbsp;EPS 1995<br/><b>(POST ALLOTMENT OF UAN)</b> THE UAN ALLOTTED FOR MEMBER IS<br/><b style={{paddingLeft:'10mm'}}>(PLEAS TICK THE APPROPRIATE OPTION)</b><br/>THE KYC DETAILS OF THE ABOVE MEMBER IN UAN DATABASE</p>
 <div className="opts"><div><Check/> HAVE NOT BEEN UPLOADED</div><div><Check/> HAVE  BEEN UPLOADED BUT NOT APPROVED</div><div><Check/> HAVE BEEN UPLOADED AND APPROVED WITH DSC</div></div>
 <p><b className="ab">C</b> IN CASE THE PERSON WAS EARLIER A MEMBER OF EPF SCHEME, 1952 AND &nbsp;EPS 1995<br/>THE ABOVE MEMBER ID OF MEMBER AS MENTIONED IN (A)  ABOVE HAS BEEN TAGED WITH  HIS / HER PREVIOUS MEMBER ID AS DECLARED BY MEMBER<br/><b style={{paddingLeft:'10mm'}}>(PLEAS TICK THE APPROPRIATE OPTION)</b></p>
 <div className="opts wide"><div><Check/> THE KYC DETAILS OF ABOVE MEMBER IN THE UAN DATABASE HAVE BEEN APPROVED WITH DIGITAL SIGNATURE CERTIFICATE AND TRANSFER REQUEST HAS BEEN GRANTED ON PORTAL</div><div><Check/> AS THE DSC OF THE ESTABLISHMENT ARE NOT REGISTERED WITH EPFO THE MEMBER HAS BEEN INFORMED TO FILE PHYSICAL CLAIM (FORM-13) FOR TRANSFER OF FUNDS FROM HIS PREVIOUS ESTABLISHMENT.</div></div>
 <div className="sigline"><div>DATE &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {dm(e.doj)}</div><div>SIGNATURE OF EMPLOYER WITH ESTABLISHMENT SEAL</div></div></div>;}

// ---- Form 16 (Rule 107 (2) of U.P. Factories Act, 1948) ----
const form16=(ctx:ReportContext,e:Employee)=><div className="pf2-frame pf2-f16"><span className="pf-code" style={{top:'6mm'}}>{e.paycode}</span>
 <div className="center"><b className="big2">FORM NO. 16</b><br/><b>[RULE 107 (2) OF U.P. FACTORIES ACT, 1948]</b></div>
 <p style={{marginTop:'14mm',paddingLeft:'36mm'}}>I hereby declare that in the event of death before resuming work the</p><p style={{paddingLeft:'6mm'}}>balance of my pay due for the period of leave with wages not availed of shall be paid to :</p>
 <p style={{paddingLeft:'12mm'}}>Shri/Smt/Km &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<Under w="120mm"/></p><p style={{paddingLeft:'12mm'}}>who is my &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<Under w="120mm"/></p>
 <p style={{marginTop:'30mm',paddingLeft:'90mm'}}>Signature of worker</p><p>Witness :</p>
 <div className="wit"><div>1. &nbsp;&nbsp;&nbsp;<Under w="75mm"/></div><div>Name &nbsp;&nbsp;&nbsp; <span className="vv">{e.name}</span></div><div>2. &nbsp;&nbsp;&nbsp;<Under w="75mm"/></div><div>Date &nbsp;&nbsp;&nbsp;&nbsp; <span className="vv">{dd(e.doj)}</span></div></div>
 <p style={{marginTop:'8mm'}}><b>Present Address</b><br/><span className="vv">{e.localAddress}</span></p><p style={{marginTop:'6mm'}}><b>Permanent Home Address</b><br/><span className="vv">{e.permanentAddress}</span></p>
 <hr style={{margin:'12mm 0 3mm'}}/><p><b>Employer's Stamp and Signature</b></p></div>;

// ---- Form F (Gratuity nomination) ----
function formF(ctx:ReportContext,e:Employee,d:Data,back:boolean){return back?<div className="pf2-frame pf2-ffb"><span className="pf-code" style={{top:'6mm'}}>{e.paycode}</span><div className="center"><b className="big2">Statement</b></div>
 {([['1.  Name of the employee in full',<b key="b">{e.name}</b>],['2.  Sex',employeeSex(e,extraOf(ctx,e))],['3.  Religion',e.religion],['4.  Wether unmarried/married/widow/widower',e.maritalStatus],['5.  Department/Branch/Section where employed',e.department],['6.  Post held with Ticket No. or serial no if any',e.designation],['7.  Date of appointment',dd(e.doj)],['8.  Permanent Address',e.permanentAddress]] as [string,ReactNode][]).map(([k,v],i)=><div className="r" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>)}
 <div className="sigrow"><div>Place &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span className="vv">{cityOf(ctx)}</span><br/><br/>Date &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span className="vv">{dd(e.doj)}</span></div><div className="c">Signature/Thumb impression  of the<br/>employee</div></div>
 <div className="center"><b>Declaration  by witness</b></div><p>Nomination signed/thumb impressed before me</p><div className="two"><div>Name in full address<p><b>1.</b></p><p><b>2.</b></p></div><div>Signature of  witness<p><b>1.</b></p><p><b>2.</b></p></div></div>
 <div className="sigrow"><div>Place &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span className="vv">{cityOf(ctx)}</span><br/><br/>Date &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span className="vv">{dd(e.doj)}</span></div></div>
 <div className="center"><b>Certificate  by  the  employer</b></div><p>Certificate  that  the  particulars  of the above nomianation have been verified  and  record  in  this establishment</p><p>Employer's refrence no if any</p>
 <div className="right"><p>Signature of the employer/officer authorised</p><p>Designation</p><p style={{marginTop:'6mm'}}>Name address of the establishment</p><p>or rubber stamb thereof</p></div><p>Date</p>
 <div className="center" style={{marginTop:'8mm'}}><b>Acknowlegement by the employer</b></div><p>Received the duplicate of the nomination in Form 'F' filled by me and duty certifie by the employer.</p><p>Date</p><div className="right"><p style={{marginTop:'8mm'}}>Signature of the employee</p></div><p>Note : Strike out ward /Paragraph not applicable</p></div>
 :<div className="pf2-frame pf2-ff"><span className="pf-code" style={{top:'6mm'}}>{e.paycode}</span><div className="center"><Boxed double>FORM 'F'</Boxed><b className="big2" style={{display:'block'}}>PAYMENT OF GRATUITY</b><b>(See sub-rule (1) of Rule 5)</b><br/><b style={{display:'inline-block',marginTop:'3mm'}}>NOMINATION</b></div>
 <p><b>To,</b></p><p className="ind"><Under v={<b>{ctx.company.name}</b>} w="150mm"/><br/><Under v={ctx.company.address} w="150mm"/><br/><span className="cap">(Give here name of description of the establishment with full address)</span></p>
 <p>1. &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Shri/Smt &nbsp;&nbsp; <Under v={e.name} w="120mm"/><br/><span className="cap" style={{paddingLeft:'62mm'}}>(Name in the full here)</span></p>
 <p>Whose particulars are given in the statement below hereby nominate the person's mentioned below to receive the gratuity payable after my death as also the gratuity standing to my credit in the event of my death before the month has become has not been paid and airct that the said amount of gratuity shall be paid in proporation indirected the against the name's of the month's.</p>
 <p>2.  I hereby certify the persons mentioned is/are a member's of my family within the meaning  of clause that (h) of section 2 of the payment Act. 1972</p><p>3.  I hereby declare that i have no family within meaning of clause (h) of section (2) of paid Act.</p>
 <p>4. (a) &nbsp;&nbsp;&nbsp; My father/mother/parents is/are not dependent  on me.<br/>(b) &nbsp;&nbsp;&nbsp; My husband's/father/mother/parents is/are not dependent on my husband.<br/>5.   I have excluded from my family be a notice date ........................................to the controlling authority in terms of the provision to clause (h) of section 2 of the paid Act.</p><p>6.   Nomination made herein invalidates my previous nomination.</p>
 <div className="center" style={{marginTop:'6mm'}}><b>NOMINEE'S</b></div>
 <table className="pf2-table ffn"><thead><tr><th/><th>Name in full with full address of<br/>nominee's<br/><b>1</b></th><th>Relationship with the<br/>employee<br/><b>2</b></th><th>Age of<br/>nominee<br/><b>3</b></th><th>Proportion by which the<br/>gratuity will be shared<br/><b>4</b></th></tr></thead><tbody>{[0,1,2,3].map(i=>{const p=d.nom[i];return <tr key={i} className="tall22"><td><b>{i+1}.</b></td><td>{p?<>{p.name}<br/>{p.address}</>:''}</td><td>{p?.relation}</td><td>{p?ageOf(p.dob):''}</td><td>{p&&d.nom.length===1?'100%':''}</td></tr>;})}</tbody></table></div>;}


// ---- Employee List / I Card / Photo Detail ----
// A page that holds several employees: the viewer lists it under each of them.
const listed=(part:Employee[],page:ReportPage):ReportPage=>({...page,owners:part.map(ownerOf)});
const employeeList=(ctx:ReportContext)=>tablePages(ctx,{key:'pel',title:'Employee List',perPage:28,orientation:'landscape',
 columns:[{h:'Sno',cls:'c'},{h:'Paycode'},{h:'Card No.'},{h:'Employee Name'},{h:'Father / Husband'},{h:'Date of Birth',cls:'c'},...(showDoj(ctx)?[{h:'Date of Join',cls:'c'}]:[]),{h:'Designation'},{h:'Department'},{h:'Phone'}],
 rows:ctx.employees.map((e,i)=>[i+1,e.paycode,e.cardNo,e.name,e.fatherName,dm(e.dob),...(showDoj(ctx)?[dm(e.doj)]:[]),e.designation,e.department,e.phone])}).map((page,p)=>listed(ctx.employees.slice(p*28,p*28+28),page));
const cardPages=(key:string,make:(ctx:ReportContext,e:Employee)=>ReactNode,per:number)=>(ctx:ReportContext):ReportPage[]=>{const out:ReportPage[]=[];
 for(let i=0;i<ctx.employees.length||!i;i+=per){const part=ctx.employees.slice(i,i+per);out.push(listed(part,{key:`${key}${i}`,orientation:'portrait',node:<div className="pf-cards">{part.map(e=><div key={e.id} className="pf-card">{make(ctx,e)}</div>)}</div>}));}return out;};
const iCard=(ctx:ReportContext,e:Employee)=><><div className="pf-card-head"><b>{ctx.company.name}</b><br/><small>{ctx.company.address}</small></div><div className="pf-card-body"><div className="pf-card-photo">{photoUrl(e)?<img src={photoUrl(e)} alt={e.name}/>:<span>Photo</span>}</div>
 <div><b>{e.name}</b><br/>{e.designation}<br/>{e.department}<br/>Code : {e.paycode} &nbsp; Card : {e.cardNo||'—'}<br/>{showDoj(ctx)&&<>D.O.J. : {dm(e.doj)}<br/></>}Ph. : {e.phone||'—'}</div></div><div className="pf-card-foot">Authorised Signatory</div></>;
const photoCard=(ctx:ReportContext,e:Employee)=><><div className="pf-card-photo big">{photoUrl(e)?<img src={photoUrl(e)} alt={e.name}/>:<span>No photo</span>}</div><b>{e.name}</b><br/>{e.paycode} · {e.designation}</>;

export const personalFormOptions:ReportOption[]=[
 {value:'biodata',label:'Biodata',build:perEmployee('bd',biodata)},
 {value:'appform',label:'App form',build:perEmployee('af',appForm)},
 {value:'appointment',label:'Appointment Letter',build:()=>[]},
 {value:'join',label:'Duty Join',build:()=>[]},
 {value:'personal',label:'Personal Detail',build:perEmployee('pd',(c,e)=>employeeDetails(c,e))},
 {value:'history',label:'Emp History',build:perEmployee('eh',(c,e)=>history(c,e))},
 {value:'orientation',label:'Emp Orientation',build:perEmployee('eo',ctx=>orientation(ctx))},
 {value:'confirmation',label:'Confirmation Letter',build:perEmployee('cf',(c,e)=>confirmation(c,e))},
 {value:'esi1f',label:'ESI FORM 1 Front',build:perEmployee('e1f',esiFront)},
 {value:'esi1b',label:'ESI FORM 1 Back',build:perEmployee('e1b',esiBack)},
 {value:'pf2f',label:'PF Form 2 Front',build:perEmployee('p2f',pfFront)},
 {value:'pf2b',label:'PF Form 2 Back',build:perEmployee('p2b',pfBack)},
 {value:'form11',label:'Form 11',build:perEmployee('f11',(c,e)=>form11(c,e))},
 {value:'form16',label:'Form 16',build:perEmployee('f16',(c,e)=>form16(c,e))},
 {value:'formff',label:'Form F Front',build:perEmployee('fff',(c,e,d)=>formF(c,e,d,false))},
 {value:'formfb',label:'Form F Back',build:perEmployee('ffb',(c,e,d)=>formF(c,e,d,true))},
 {value:'list',label:'Employee List',build:employeeList},
 {value:'icard',label:'I card',build:cardPages('ic',iCard,8)},
 {value:'photo',label:'Photo Detail',build:cardPages('ph',photoCard,12)}];
export const dutyJoinPage=perEmployee('dj',(c,e)=>dutyJoin(c,e));
export const appointmentHindiPage=(ctx:ReportContext):ReportPage[]=>ctx.employees.flatMap(e=>[1,2].map(n=>({key:'aph'+n+e.id,orientation:'portrait' as const,owners:[ownerOf(e)],node:<div className="pf-form">{appointmentHindi(ctx,e,n)}</div>})));
