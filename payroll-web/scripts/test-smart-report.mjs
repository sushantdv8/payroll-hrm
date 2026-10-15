// Tests of lib/smart-report.ts (the pure helpers of the smart report view). Run: node --test scripts/test-smart-report.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeText,sortKey,compareKeys,sumColumn,classifyDay,worstTone} from '../lib/smart-report.ts';

const el=(type,children)=>({type,props:{children}});

test('nodeText reads strings, numbers, arrays and React-like elements',()=>{
 assert.equal(nodeText('abc'),'abc');assert.equal(nodeText(12),'12');assert.equal(nodeText(null),'');assert.equal(nodeText(false),'');
 assert.equal(nodeText(el('b','Total')),'Total');
 assert.equal(nodeText(['10',el('br'),'11']),'10 11');
 assert.equal(nodeText(el('span',[el('b','A'),' / ','B'])),'A / B');
});

test('sortKey / compareKeys sort times, dates and numbers by value, text without case, empty last',()=>{
 const sorted=(values,dir=1)=>[...values].sort((a,b)=>compareKeys(sortKey(a),sortKey(b),dir));
 assert.deepEqual(sorted(['10:05','9:30','','0:45','112:00']),['0:45','9:30','10:05','112:00','']);
 assert.deepEqual(sorted(['31/08/2026','01/09/2026','15/08/2026']),['15/08/2026','31/08/2026','01/09/2026']);
 assert.deepEqual(sorted(['2026-09-01','2026-08-31']),['2026-08-31','2026-09-01']);
 assert.deepEqual(sorted(['1,200.50','99','100']),['99','100','1,200.50']);
 assert.deepEqual(sorted(['b','A','c','']),['A','b','c','']);
 assert.deepEqual(sorted(['10:05','9:30','','0:45'],-1),['10:05','9:30','0:45','']);   // descending: empty values stay last
 assert.deepEqual(sorted(['P10','P9','P100']),['P9','P10','P100']);                   // numbers inside text sort as numbers
});

test('sumColumn adds times and numbers, and refuses mixed columns',()=>{
 assert.deepEqual(sumColumn(['8:30','','0:45','1:15']),{kind:'time',text:'10:30'});
 assert.deepEqual(sumColumn(['1,000','250.5','']),{kind:'num',text:'1250.5'});
 assert.equal(sumColumn(['a','1']),null);assert.equal(sumColumn(['','']),null);assert.equal(sumColumn([]),null);
});

test('classifyDay reads the two halves of a day',()=>{
 const c=(a,b,p=false)=>classifyDay(a,b,p);
 assert.deepEqual(c('P','P'),{kind:'present',label:'Present',tone:'ok'});
 assert.deepEqual(c('OD','OD'),{kind:'present',label:'On duty',tone:'ok'});
 assert.equal(c('A','A').kind,'absent');assert.equal(c('LWP','LWP').label,'Absent (LWP)');
 assert.deepEqual(c('CL','CL'),{kind:'leave',label:'Leave CL',tone:'info'});
 assert.deepEqual(c('WO','WO'),{kind:'off',label:'Weekly off',tone:'mute'});
 assert.equal(c('HD','HD').label,'Holiday');
 assert.equal(c('P','A').kind,'half');assert.equal(c('P','A').label,'Half day (P/A)');assert.equal(c('','P').label,'Half day (-/P)');
 assert.equal(c('A','CL').kind,'absent');assert.equal(c('CL','SL').kind,'leave');
 assert.equal(c('','').label,'No entry');assert.equal(c('','',true).label,'Not processed');
 assert.equal(c('MS','MS').kind,'mispunch');assert.equal(c('WO*','WO*').kind,'present');
});

test('worstTone picks the colour that matters most',()=>{
 assert.equal(worstTone('ok','warn'),'warn');assert.equal(worstTone('ok','bad','warn'),'bad');assert.equal(worstTone('','ok'),'ok');assert.equal(worstTone(),'');
 assert.equal(worstTone('info','mute'),'info');
});
