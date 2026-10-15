// The machines' raw punches of the original software (table tbmachine of its shared database "osps"): grouping of its rows by month, card and day.
// No server code here, so the grouping can be tested on its own.
export type DayPunches=Record<string,string>;          // 'DD' -> 'HH:MM,HH:MM,…' (ascending, each minute once)
export type MonthPunches=Record<string,DayPunches>;    // card number (as the machines have it) -> its days
export type Collected=Map<string,Map<string,string>>;  // 'YYYY-MM' -> 'card|DD' -> the times collected so far, comma separated

const TIME=/^(\d{1,2}):(\d{2})/,TIME_IN_DATE=/T(\d{2}):(\d{2})/;
// Adds the rows of one stored part to what was collected. A row without a card, a real date or a time is skipped.
export function collectRows(acc:Collected,rows:(string|null)[][],at:{card:number;date:number;time:number}){
 for(const row of rows){
  const card=String(row[at.card]??'').trim(),date=String(row[at.date]??'').slice(0,10);if(!card||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
  // the time of the punch is tpunch; when that is unusable the time inside tdate stands in for it (a date with no time of day, 00:00, is not a punch)
  const inDate=TIME_IN_DATE.exec(String(row[at.date]??''));const t=TIME.exec(String(row[at.time]??'').trim())||(inDate&&inDate[1]+inDate[2]!=='0000'?inDate:null);if(!t)continue;
  const time=t[1].padStart(2,'0')+':'+t[2];const month=date.slice(0,7),key=card+'|'+date.slice(8,10);
  let days=acc.get(month);if(!days)acc.set(month,days=new Map());const old=days.get(key);days.set(key,old===undefined?time:old+','+time);
 }
}
// One month's file: every list sorted, a minute that two machines (or one machine twice) recorded listed once.
export function finishMonth(days:Map<string,string>):MonthPunches{
 const out:MonthPunches={};
 for(const [key,list] of days){const bar=key.lastIndexOf('|'),card=key.slice(0,bar),day=key.slice(bar+1);(out[card]??={})[day]=[...new Set(list.split(','))].sort().join(',');}
 return out;
}

