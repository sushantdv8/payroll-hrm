// Needs a real PostgreSQL server (TEST_DATABASE_URL, see test\driver.mjs): PGlite has one connection and cannot race.
// 20 people save the same attendance month at the same moment, all starting from revision 1. The app's write guard
// (check the revision, then write) must let exactly one of them win and tell the other 19 to reload. That only works
// because the gateway makes write batches take turns; the second half of this test switches that off and shows the
// problem it prevents (every one of the 20 is told "saved" although only one change is kept).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../lib/gateway.mjs';
import { pgDriver } from '../lib/drivers.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) { console.log('SKIP lock test: set TEST_DATABASE_URL to a PostgreSQL database whose name contains "test"'); process.exit(0); }
if (!/test/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must name a test database');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET = 'lock-test-secret-123456';
const now = new Date().toISOString();

async function run(lock) {
  const driver = await pgDriver(url, { lock });
  await driver.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await driver.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
  const handle = createGateway({ driver, secret: SECRET });
  const server = http.createServer((req, res) => { void handle(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (ops) => fetch(base + '/db', { method: 'POST', headers: { Authorization: 'Bearer ' + SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) });
  await post([{ sql: "INSERT INTO employees(id,owner,paycode,dataset,data,revision,updated_at) VALUES('e1','o','P1','d','{}',1,?)", params: [now], kind: 'run' }]);
  await post([{ sql: "INSERT INTO attendance(id,owner,employee_id,month,data,revision,updated_at) VALUES('a1','o','e1','2026-06','{}',1,?)", params: [now], kind: 'run' }]);
  // the same three statements the app sends (see guardedWrite and saveAttendance): guard, write, audit
  const save = (i) => post([
    { sql: 'INSERT INTO hr_write_guard(id,ok) SELECT CAST(? AS TEXT),CASE WHEN EXISTS(SELECT 1 FROM attendance WHERE owner=? AND employee_id=? AND month=? AND revision=?) THEN 1 ELSE 0 END', params: ['g' + i, 'o', 'e1', '2026-06', 1], kind: 'run' },
    { sql: 'SELECT pg_sleep(0.05)', params: [], kind: 'run' }, // a slower real-world moment between the check and the write
    { sql: 'UPDATE attendance SET data=?,revision=?,updated_at=? WHERE id=? AND owner=? AND revision=?', params: [JSON.stringify({ writer: i }), 2, now, 'a1', 'o', 1], kind: 'run' },
    { sql: 'INSERT INTO hr_audit(id,owner,dataset,record_id,module,actor,action,data,created_at) VALUES(?,?,?,?,?,?,?,?,?)', params: ['au' + i, 'o', 'd', 'a1', 'attendance', 'w' + i, 'save', '{}', now], kind: 'run' },
    { sql: 'DELETE FROM hr_write_guard WHERE id=?', params: ['g' + i], kind: 'run' },
  ]);
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => save(i)));
  const told = { saved: rs.filter((r) => r.status === 200).length, refused: rs.filter((r) => r.status !== 200).length };
  const audits = (await driver.query('SELECT COUNT(*)::int n FROM hr_audit')).rows[0].n;
  const stored = JSON.parse((await driver.query("SELECT data FROM attendance WHERE id='a1'")).rows[0].data);
  server.close(); await driver.close();
  return { told, audits, stored };
}

const withLock = await run(true);
console.log('with the write lock   :', JSON.stringify(withLock));
assert.equal(withLock.told.saved, 1); assert.equal(withLock.told.refused, 19); assert.equal(withLock.audits, 1);
console.log('PASS  one winner, 19 told to reload, one audit entry');
let withoutLock;
for (let attempt = 1; attempt <= 3; attempt++) { // the race is a matter of timing: try up to three times
  withoutLock = await run(false);
  if (withoutLock.told.saved > 1) break;
}
console.log('without the write lock:', JSON.stringify(withoutLock), withoutLock.told.saved > 1 ? '  <- several writers are told "saved" but only one change is kept' : '  (no race happened in 3 tries)');
process.exit(0);
