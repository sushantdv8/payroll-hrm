// Builds a tiny fake "state" folder (SQLite D1 + R2 files), runs migrate-from-sqlite.mjs into PGlite, checks the copy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmig-'));
const d1 = path.join(dir, 'v3', 'd1', 'miniflare-D1DatabaseObject'); fs.mkdirSync(d1, { recursive: true });
const r2 = path.join(dir, 'v3', 'r2', 'miniflare-R2BucketObject'); fs.mkdirSync(r2, { recursive: true });
fs.mkdirSync(path.join(dir, 'v3', 'r2', 'bucket', 'blobs'), { recursive: true });

const sq = new DatabaseSync(path.join(d1, 'abc.sqlite'));
sq.exec(`CREATE TABLE employees (id TEXT PRIMARY KEY, owner TEXT NOT NULL, paycode TEXT NOT NULL, dataset TEXT NOT NULL DEFAULT 'manual', import_id TEXT, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE attendance (id TEXT PRIMARY KEY, owner TEXT NOT NULL, employee_id TEXT NOT NULL, month TEXT NOT NULL, import_id TEXT, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);`);
for (let i = 1; i <= 1200; i++) sq.prepare('INSERT INTO employees VALUES (?,?,?,?,?,?,?,?,?)').run('e' + i, 'o', 'P' + i, 'om_01_26', null, JSON.stringify({ id: 'e' + i, name: 'Ünï ' + i }), 1, 0, 'now');
sq.prepare('INSERT INTO attendance VALUES (?,?,?,?,?,?,?,?)').run('a1', 'o', 'e7', '2026-08', null, '{"days":[1,2]}', 3, 'now');
sq.close();

const meta = new DatabaseSync(path.join(r2, 'xyz.sqlite'));
meta.exec('CREATE TABLE _mf_objects (key TEXT PRIMARY KEY, blob_id TEXT, version TEXT NOT NULL, size INTEGER NOT NULL, etag TEXT NOT NULL, uploaded INTEGER NOT NULL, checksums TEXT NOT NULL, http_metadata TEXT NOT NULL, custom_metadata TEXT NOT NULL)');
const bytes = Buffer.from([1, 2, 3, 250, 0, 9]);
fs.writeFileSync(path.join(dir, 'v3', 'r2', 'bucket', 'blobs', 'blob1'), bytes);
meta.prepare('INSERT INTO _mf_objects VALUES (?,?,?,?,?,?,?,?,?)').run('o/img', 'blob1', 'v', 6, 'e', 0, '{}', '{"contentType":"image/png"}', '{}');
meta.prepare('INSERT INTO _mf_objects VALUES (?,?,?,?,?,?,?,?,?)').run('o/gone', 'missing', 'v', 6, 'e', 0, '{}', '{}', '{}');
meta.close();

const pgdir = path.join(dir, 'pgdata');
const out = execFileSync(process.execPath, ['--no-warnings', path.join(root, 'migrate-from-sqlite.mjs'), dir], { env: { ...process.env, DATABASE_URL: 'pglite:' + pgdir }, encoding: 'utf8' });
console.log(out);
assert.match(out, /employees: 1200 rows copied/);
assert.match(out, /attendance: 1 rows copied/);
assert.match(out, /files: 1 copied, 1 had no stored content/);

const { pgliteDriver } = await import('../lib/drivers.mjs');
const pg = await pgliteDriver(pgdir);
assert.equal((await pg.query('SELECT COUNT(*)::int n FROM employees')).rows[0].n, 1200);
assert.equal((await pg.query("SELECT data FROM employees WHERE id='e5'")).rows[0].data, JSON.stringify({ id: 'e5', name: 'Ünï 5' }));
assert.equal((await pg.query("SELECT revision FROM attendance WHERE id='a1'")).rows[0].revision, 3);
const o = (await pg.query("SELECT body,content_type FROM objects WHERE key='o/img'")).rows[0];
assert.deepEqual(Buffer.from(o.body), bytes); assert.equal(o.content_type, 'image/png');
await pg.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('Migration test passed');
