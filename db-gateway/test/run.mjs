// Tests: SQL translation, and the app's real statements against PostgreSQL (PGlite) through the HTTP gateway.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { toPg } from '../lib/translate.mjs';
import { createGateway } from '../lib/gateway.mjs';
import { testDriver } from './driver.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let passed = 0;
const ok = (name) => { passed++; console.log('PASS ', name); };

// ---- translation ----
assert.equal(toPg('SELECT a FROM t WHERE x=? AND y=?'), 'SELECT a FROM t WHERE x=$1 AND y=$2'); ok('placeholders numbered');
assert.equal(toPg("SELECT '?' q, x FROM t WHERE y=?"), "SELECT '?' q, x FROM t WHERE y=$1"); ok('? inside a literal is left alone');
assert.equal(toPg("SELECT json_extract(data,'$.sourceDataset') FROM t"), "SELECT ((data)::json #>> '{sourceDataset}') FROM t"); ok('json_extract');
assert.equal(toPg("SELECT json_extract(value,'$.a.b[2].c')"), "SELECT ((value)::json #>> '{a,b,2,c}')"); ok('json_extract nested path');
assert.equal(toPg("SELECT lower(trim(json_extract(data,'$.'||?))) FROM t"), "SELECT lower(trim(((data)::json ->> ($1)))) FROM t"); ok('json_extract with a path built at run time');
assert.match(toPg('SELECT l.a FROM json_each(?) j CROSS JOIN l ON l.k=json_extract(j.value,\'$.k\')'), /json_array_elements\(CAST\(\$1 AS json\)\) AS j\(value\) JOIN l ON l\.k=\(\(j\.value\)::json #>> '\{k\}'\)/); ok('json_each with alias, CROSS JOIN ... ON');
assert.match(toPg('INSERT INTO t(a) SELECT json_extract(value,\'$.id\') FROM json_each(?) WHERE true'), /FROM json_array_elements\(CAST\(\$1 AS json\)\) AS je\(value\) WHERE true/); ok('json_each without alias');
assert.match(toPg("UPDATE e SET data=(SELECT json_set(l.profile,'$.id',e.id,'$.revision',2) FROM l)"), /jsonb_set\(jsonb_set\(\(l\.profile\)::jsonb, '\{id\}', to_jsonb\(e\.id\)\), '\{revision\}', to_jsonb\(2\)\)/); ok('json_set');
assert.equal(toPg('SELECT x FROM t ORDER BY paycode COLLATE NOCASE'), 'SELECT x FROM t ORDER BY lower(paycode) COLLATE \"C\"'); ok('COLLATE NOCASE');
assert.equal(toPg('WHERE k LIKE ?'), 'WHERE k ILIKE $1'); ok('LIKE ignores case like SQLite');
assert.equal(toPg("SELECT substr(k,1,instr(k,'|')-1)"), "SELECT substr(k,1,strpos(k, '|')-1)"); ok('instr');

// ---- the real statements, over HTTP ----
const driver = await testDriver();
await driver.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const SECRET = 'test-secret-0123456789';
const server = http.createServer((req, res) => { void handle(req, res); });
const handle = createGateway({ driver, secret: SECRET });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (ops, tx) => {
  const r = await fetch(base + '/db', { method: 'POST', headers: { Authorization: 'Bearer ' + SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops, tx }) });
  return { status: r.status, body: await r.json() };
};
const q = async (sql, params = [], kind = 'all') => { const r = await call([{ sql, params, kind }]); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.results[0]; };

let r = await fetch(base + '/db', { method: 'POST', body: '{}' });
assert.equal(r.status, 401); ok('calls without the secret are refused');
assert.equal((await fetch(base + '/health')).status, 200); ok('health');

const now = new Date().toISOString(), owner = 'local_seedy';
const emp = (i) => ({ id: `e${i}`, paycode: `P${i}`, name: `Emp ${i}`, sourceKey: `K${i}`, sourceDataset: 'om_01_26' });

// Full import (route full-import): employees from a JSON packet
const fresh = [emp(1), emp(2), emp(3)];
await q("INSERT INTO employees(id,owner,dataset,import_id,paycode,data,revision,updated_at) SELECT json_extract(value,'$.id'),?,?,?,json_extract(value,'$.paycode'),value,1,? FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING", [owner, 'om_01_26', 'imp1', now, JSON.stringify(fresh)], 'run');
let res = await q('SELECT id,paycode,data FROM employees WHERE owner=? ORDER BY paycode COLLATE NOCASE', [owner]);
assert.equal(res.rows.length, 3); assert.equal(res.rows[0].data, JSON.stringify(fresh[0])); ok('employees inserted from a JSON packet; the document keeps its exact text');

const links = fresh.map((e) => ({ id: 'l' + e.id, sourceKey: e.sourceKey, employeeId: e.id, profile: { x: 1, deep: { y: [1, 2] } } }));
const linkSql = "INSERT INTO source_employee_links(id,owner,dataset,source_key,employee_id,profile) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.sourceKey'),json_extract(value,'$.employeeId'),json_extract(value,'$.profile') FROM json_each(?) WHERE true ON CONFLICT(owner,dataset,source_key) DO UPDATE SET profile=CASE WHEN source_employee_links.profile='{}' OR source_employee_links.profile=excluded.profile THEN excluded.profile ELSE NULL END";
await q(linkSql, [owner, 'om_01_26', JSON.stringify(links)], 'run');
res = await q('SELECT profile FROM source_employee_links WHERE owner=? AND source_key=?', [owner, 'K1']);
assert.equal(res.rows[0].profile, JSON.stringify(links[0].profile)); ok('nested JSON object comes back as the same text');
await q(linkSql, [owner, 'om_01_26', JSON.stringify(links)], 'run'); // same packet again: no conflict, nothing set to NULL
res = await q('SELECT COUNT(*) n FROM source_employee_links WHERE profile IS NULL');
assert.equal(res.rows[0].n, 0); assert.equal(typeof res.rows[0].n, 'number'); ok('re-importing the same packet keeps profiles; COUNT is a number');

res = await q("SELECT l.source_key,l.employee_id FROM json_each(?) j CROSS JOIN source_employee_links l ON l.owner=? AND l.dataset=? AND l.source_key=json_extract(j.value,'$.sourceKey')", [JSON.stringify(fresh), owner, 'om_01_26']);
assert.equal(res.rows.length, 3); ok('look up links for a packet (json_each + join)');

const att = fresh.map((e) => ({ id: 'a' + e.id, employeeId: e.id, month: '2026-08', data: { days: [{ day: 1 }] } }));
await q("INSERT INTO attendance(id,owner,employee_id,month,data,revision,updated_at,import_id) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.employeeId'),json_extract(value,'$.month'),json_extract(value,'$.data'),1,?,? FROM json_each(?) WHERE true ON CONFLICT(owner,employee_id,month) DO NOTHING", [owner, now, 'imp1', JSON.stringify(att)], 'run');
await q("INSERT INTO attendance(id,owner,employee_id,month,data,revision,updated_at,import_id) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.employeeId'),json_extract(value,'$.month'),json_extract(value,'$.data'),1,?,? FROM json_each(?) WHERE true ON CONFLICT(owner,employee_id,month) DO NOTHING", [owner, now, 'imp1', JSON.stringify(att)], 'run');
res = await q('SELECT a.data,a.revision FROM attendance a JOIN employees e ON e.id=a.employee_id AND e.owner=a.owner WHERE a.owner=? AND a.month=? AND e.dataset=? AND e.deleted=0', [owner, '2026-08', 'om_01_26']);
assert.equal(res.rows.length, 3); assert.equal(res.rows[0].data, JSON.stringify({ days: [{ day: 1 }] })); ok('attendance import is idempotent (ON CONFLICT DO NOTHING)');

res = await q("SELECT id,json_extract(data,'$.sourceKey') k FROM employees WHERE owner=? AND dataset=? AND deleted=0 ORDER BY id", [owner, 'om_01_26']);
assert.deepEqual(res.rows.map((x) => x.k), ['K1', 'K2', 'K3']); ok('json_extract in a select list');
res = await q("SELECT COUNT(*) n FROM employees WHERE owner=? AND dataset=? AND deleted=0 AND lower(trim(json_extract(data,'$.'||?)))=lower(?)", [owner, 'om_01_26', 'name', 'EMP 2']);
assert.equal(res.rows[0].n, 1); ok('in-use check with a path built at run time');

await q("UPDATE employees SET data=(SELECT json_set(l.profile,'$.id',employees.id,'$.revision',2) FROM source_employee_links l WHERE l.owner=employees.owner AND l.employee_id=employees.id AND l.dataset=?),revision=2,updated_at=? WHERE owner=? AND dataset=? AND import_id IS NULL AND revision=1", ['om_01_26', now, owner, 'om_01_26'], 'run');
res = await q('SELECT COUNT(*) n FROM employees WHERE revision=1'); assert.equal(res.rows[0].n, 3); ok('UPDATE with json_set runs (no rows matched: import_id is set)');
await q("UPDATE employees SET import_id=NULL WHERE id='e1'", [], 'run');
await q("UPDATE employees SET data=(SELECT json_set(l.profile,'$.id',employees.id,'$.revision',2) FROM source_employee_links l WHERE l.owner=employees.owner AND l.employee_id=employees.id AND l.dataset=?),revision=2,updated_at=? WHERE owner=? AND dataset=? AND import_id IS NULL AND revision=1", ['om_01_26', now, owner, 'om_01_26'], 'run');
res = await q("SELECT data FROM employees WHERE id='e1'"); const merged = JSON.parse(res.rows[0].data);
assert.equal(merged.id, 'e1'); assert.equal(merged.revision, 2); assert.deepEqual(merged.deep, { y: [1, 2] }); ok('json_set merges id and revision into the profile');

// master_records (biometric settings): insert, then optimistic update by revision
const ins = "INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,?,?,?,'manual',1,0,?) ON CONFLICT(owner,dataset,table_name,record_key) DO NOTHING";
assert.equal((await q(ins, ['m1', owner, 'om_01_26', 'biometric', 'config', '{"url":"x"}', now], 'run')).changes, 1);
assert.equal((await q(ins, ['m2', owner, 'om_01_26', 'biometric', 'config', '{"url":"y"}', now], 'run')).changes, 0); ok('insert reports changes 1, then 0 on conflict');
assert.equal((await q('UPDATE master_records SET data=?,revision=revision+1,updated_at=? WHERE owner=? AND dataset=? AND table_name=? AND record_key=? AND revision=?', ['{"url":"z"}', now, owner, 'om_01_26', 'biometric', 'config', 1], 'run')).changes, 1);
assert.equal((await q('UPDATE master_records SET data=?,revision=revision+1,updated_at=? WHERE owner=? AND dataset=? AND table_name=? AND record_key=? AND revision=?', ['{"url":"q"}', now, owner, 'om_01_26', 'biometric', 'config', 1], 'run')).changes, 0); ok('optimistic revision update');
await q('INSERT INTO master_records(id,owner,dataset,table_name,record_key,data,origin,revision,deleted,updated_at) VALUES(?,?,?,?,?,?,?,1,0,?)', ['m3', owner, 'om_01_26', 'register', 'e1|2026-08', '{}', 'manual', now], 'run');
res = await q("SELECT m.record_key FROM master_records m JOIN employees e ON e.id=substr(m.record_key,1,instr(m.record_key,'|')-1) AND e.owner=m.owner AND e.deleted=0 WHERE m.owner=? AND m.dataset=? AND m.table_name='register' AND m.deleted=0 AND m.record_key LIKE ?", [owner, 'om_01_26', 'E1|%']);
assert.equal(res.rows.length, 1); ok('substr / instr / case-insensitive LIKE');

// guardedWrite: a failed condition rolls the WHOLE batch back
const guard = (cond, params) => [{ sql: 'INSERT INTO hr_write_guard(id,ok) SELECT CAST(? AS TEXT),CASE WHEN ' + cond + ' THEN 1 ELSE 0 END', params }, { sql: "INSERT INTO hr_records(id,owner,dataset,module,data,created_by,updated_at) VALUES(?,?,?,?,?,?,?)", params: ['h1', owner, 'om_01_26', 'leave', '{}', 'me', now], kind: 'run' }, { sql: 'DELETE FROM hr_write_guard WHERE id=?', params: ['g1'], kind: 'run' }];
r = await call(guard('(SELECT COUNT(*) FROM hr_records WHERE owner=?)=?', ['g1', owner, 5]));
assert.equal(r.status, 400); assert.match(r.body.error, /CHECK constraint/);
res = await q('SELECT COUNT(*) n FROM hr_records'); assert.equal(res.rows[0].n, 0); ok('failed guard: CHECK error, nothing from the batch is kept');
r = await call(guard('(SELECT COUNT(*) FROM hr_records WHERE owner=?)=?', ['g1', owner, 0]));
assert.equal(r.status, 200);
res = await q('SELECT COUNT(*) n FROM hr_records'); assert.equal(res.rows[0].n, 1); ok('passing guard: the batch is committed');
r = await call([{ sql: 'INSERT INTO employees(id,owner,paycode,dataset,data,updated_at) VALUES(?,?,?,?,?,?)', params: ['dup', owner, 'P1', 'om_01_26', '{}', now], kind: 'run' }]);
assert.equal(r.status, 400); assert.match(r.body.error, /UNIQUE constraint failed: employees/); ok('duplicate key reads like SQLite (UNIQUE constraint failed: employees)');
r = await call([{ sql: 'INSERT INTO hr_records(id,owner,dataset,module,data,created_by,updated_at) VALUES(?,?,?,?,?,?,?)', params: ['h2', owner, 'd', 'm', '{}', 'me', now], kind: 'run' }, { sql: "INSERT INTO hr_records(id,owner,dataset,module,data,created_by,updated_at) VALUES(?,?,?,?,?,?,?)", params: ['h1', owner, 'd', 'm', '{}', 'me', now], kind: 'run' }]);
assert.equal(r.status, 400);
res = await q("SELECT COUNT(*) n FROM hr_records WHERE id='h2'"); assert.equal(res.rows[0].n, 0); ok('a batch is one transaction (first insert undone when the second fails)');

res = await q('SELECT table_name,SUM(row_count) n FROM source_parts WHERE owner=? GROUP BY table_name', [owner]); assert.deepEqual(res.rows, []); ok('GROUP BY / SUM');
res = await q('SELECT 1 AS ok FROM hr_users WHERE owner=? AND username=? AND active=1', [owner, 'nobody'], 'first'); assert.deepEqual(res.rows, []); ok('first() on no rows');
res = await q('SELECT id FROM employees WHERE id IN (?,?) ORDER BY id LIMIT ?', ['e1', 'e2', 5]); assert.equal(res.rows.length, 2); ok('IN list, LIMIT parameter');

// object store (R2 replacement)
const key = encodeURIComponent(owner) + '/source/x/tbemp/0.json.gz';
const body = Buffer.from([0x1f, 0x8b, 8, 0, 255, 0, 1, 2]);
r = await fetch(base + '/object?key=' + encodeURIComponent(key), { method: 'PUT', headers: { Authorization: 'Bearer ' + SECRET, 'x-content-type': 'application/gzip' }, body });
assert.equal(r.status, 200);
r = await fetch(base + '/object?key=' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + SECRET } });
assert.deepEqual(Buffer.from(await r.arrayBuffer()), body); assert.equal(r.headers.get('x-content-type'), 'application/gzip'); ok('object put / get keeps every byte');
r = await fetch(base + '/object?key=' + encodeURIComponent(key), { method: 'HEAD', headers: { Authorization: 'Bearer ' + SECRET } });
assert.equal(r.status, 200); assert.equal(r.headers.get('x-size'), '8');
r = await fetch(base + '/object?key=nope', { headers: { Authorization: 'Bearer ' + SECRET } }); assert.equal(r.status, 404);
r = await fetch(base + '/object?key=' + encodeURIComponent(key), { method: 'DELETE', headers: { Authorization: 'Bearer ' + SECRET } });
r = await fetch(base + '/object?key=' + encodeURIComponent(key), { method: 'HEAD', headers: { Authorization: 'Bearer ' + SECRET } }); assert.equal(r.status, 404); ok('object head / missing / delete');

// a write repeated with the same x-request-id (the app resends after a lost connection) is applied only once
const sendWrite = (id) => fetch(base + '/db', { method: 'POST', headers: { Authorization: 'Bearer ' + SECRET, 'Content-Type': 'application/json', 'x-request-id': id }, body: JSON.stringify({ ops: [{ sql: 'INSERT INTO holidays(id,owner,dataset,data,revision,updated_at) VALUES(?,?,?,?,1,?)', params: ['hx1', owner, 'd', '{}', now], kind: 'run' }] }) });
const w1 = await sendWrite('req-1'), w2 = await sendWrite('req-1');
assert.equal(w1.status, 200); assert.equal(w2.status, 200);
assert.deepEqual(await w2.json(), { results: [{ rows: [], changes: 1 }] });
assert.equal((await q("SELECT COUNT(*) n FROM holidays WHERE id='hx1'")).rows[0].n, 1);
const w3 = await sendWrite('req-2'); assert.equal(w3.status, 400); // a different request is a real second insert: duplicate key
ok('repeated request id is answered from the first run, written once');

server.close();
await driver.close();
console.log(`\nAll ${passed} PostgreSQL gateway tests passed`);

