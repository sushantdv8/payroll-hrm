// Group of company of each imported company. The original keeps this list (Master Entry › Add New Group Of Company)
// in its own master database, which is not part of the backups; the names below are the ones its login window and
// Group Of Company Entry show for these companies ("KISHOR EXPORT[Kishor Export]", "KISHOR EXPORT[Kishor exp..]",
// "KISHOR EXPORTS WARE HOUSE[C]").
export const companyGroups:Record<string,{code:string;name:string}>={
 om_01_26:{code:'1',name:'Kishor Export'},
 om_02_26:{code:'2',name:'Kishor exp..'},
 om_03_26:{code:'3',name:'C'},
};
// How a company is named in the sign-in window and in the company picker.
// Earlier years of the same companies (om_01_25 ...) keep the company's group and add their year, so each year can be told apart at sign-in.
const groupOfCompany:Record<string,string>={'01':'Kishor Export','02':'Kishor exp..','03':'C'};
const yearLabel=(d:{key:string;companyName:string})=>{const m=/^om_(\d{2})_(\d{2})$/.exec(d.key);return m&&groupOfCompany[m[1]]?`${d.companyName}[${groupOfCompany[m[1]]}] 20${m[2]}`:null;};
// The sign-in page asks for the session (year) and the location (company) separately: year is null for records that belong to no year.
export const companyParts=(d:{key:string;companyName:string;status:string}):{year:number|null;place:string}=>{
 const m=/^om_(\d{2})_(\d{2})$/.exec(d.key);const group=m?groupOfCompany[m[1]]:companyGroups[d.key]?.name;
 return {year:m?2000+Number(m[2]):null,place:group?`${d.companyName}[${group}]`:d.companyName+(d.status==='manual'?'':' · '+d.key)};
};
export const companyLabel=(d:{key:string;companyName:string;status:string})=>companyGroups[d.key]?`${d.companyName}[${companyGroups[d.key].name}]`:yearLabel(d)||d.companyName+(d.status==='manual'?'':' · '+d.key);
