// The year of an imported company database (om_01_25 = 2025). Its month_no 1..12 are January..December of that year, 13..15 the next January..March.
export const datasetYear=(dataset:string)=>{const m=/^om_\d{2}_(\d{2})$/.exec(dataset);return m?2000+Number(m[1]):2026;};
export const monthNo=(dataset:string,month:string)=>(Number(month.slice(0,4))-datasetYear(dataset))*12+Number(month.slice(5,7));
