// Finds every SQL statement written in the app's source (payroll-web\lib and \app), translates it with the gateway's
// translator and asks PostgreSQL (PGlite, empty database with schema.sql) to PREPARE it. PREPARE parses the statement and
// checks tables, columns and parameter types without running it, so anything the translator or schema cannot handle shows up.
//   node test\scan-app-sql.mjs [path to payroll-web]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPg } from '../lib/translate.mjs';
import { testDriver } from './driver.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = process.argv[2] || path.join(root, '..', 'payroll-web');

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
walk(path.join(web, 'lib')); walk(path.join(web, 'app'));

const VISIBLE = "(import_id IS NULL OR import_id IN (SELECT id FROM source_datasets WHERE status='complete'))";

// pulls the string literals (', ", `) out of TypeScript source, skipping comments and simple regex literals
function literals(src) {
  const out = [];
  let i = 0, prev = '';
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === '/' && /[(,=:[!&|?{};]/.test(prev || '(')) { // regex literal
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; prev = ')'; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } s += src[j++]; }
      out.push({ at: i, end: j + 1, text: s, tpl: false }); i = j + 1; prev = ')'; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1, k = j + 2;
          while (k < n && depth) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
          s += '\u0001' + src.slice(j + 2, k - 1) + '\u0002'; j = k; continue;
        }
        s += src[j++];
      }
      out.push({ at: i, end: j + 1, text: s, tpl: true }); i = j + 1; prev = ')'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const resolve = (text) => text.replace(/\u0001([^\u0002]*)\u0002/g, (_, expr) => {
  const e = expr.trim();
  if (e === 'visibleImport') return VISIBLE;
  if (/\?['"]\)\.join/.test(e) || /map\(\(\)=>'\?'\)/.test(e)) return '?,?';
  // ${table}: employees/holidays in most places; attendance / salary_snapshots where the statement reads a.employee_id and a.month
  if (/^(table|storageTable)$/.test(e)) return /\ba\.employee_id\b/.test(text) ? 'attendance' : 'employees';
  return '1';
});

const looksSql = (s) => /^\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|SELECT\s)/i.test(s) && /\b(FROM|INTO|SET)\b/i.test(s);

const found = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lits = literals(src);
  for (let k = 0; k < lits.length; k++) {
    let { text, at, end } = lits[k];
    // 'a ' + 'b' joins
    while (k + 1 < lits.length && /^\s*\+\s*$/.test(src.slice(end, lits[k + 1].at))) { text += lits[k + 1].text; end = lits[k + 1].end; k++; }
    const sql = resolve(text);
    const line = src.slice(0, at).split('\n').length;
    const before = src.slice(Math.max(0, at - 40), at);
    if (/guardedWrite\(\s*$/.test(before)) found.push({ f, line, sql: 'INSERT INTO hr_write_guard(id,ok) SELECT CAST(? AS TEXT),CASE WHEN ' + sql + ' THEN 1 ELSE 0 END', kind: 'guard' });
    else if (looksSql(sql) && !/\bWHEN\s*$/.test(sql)) found.push({ f, line, sql, kind: 'sql' }); // (the guard's own opening text ends in WHEN)
  }
}

const driver = await testDriver();
await driver.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
let ok = 0; const bad = [];
const seen = new Set();
for (const s of found) {
  const key = s.sql; if (seen.has(key)) continue; seen.add(key);
  let pg;
  try { pg = toPg(s.sql); await driver.exec('PREPARE scan_stmt AS ' + pg); await driver.exec('DEALLOCATE scan_stmt'); ok++; }
  catch (e) { try { await driver.exec('DEALLOCATE scan_stmt'); } catch { /* not prepared */ } bad.push({ ...s, pg, error: String(e.message || e).split('\n')[0] }); }
}
console.log(`${found.length} SQL strings found, ${seen.size} different, ${ok} accepted by PostgreSQL, ${bad.length} rejected`);
for (const b of bad) console.log(`\n${path.relative(web, b.f)}:${b.line}  ${b.error}\n  sqlite: ${b.sql.slice(0, 260)}\n  pg:     ${(b.pg || '').slice(0, 260)}`);
await driver.close();
process.exitCode = bad.length ? 1 : 0;
