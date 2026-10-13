// The app-side adapter (payroll-web\lib\pg-gateway-client.ts) against the real gateway, with a lost connection in between:
// the gateway does the write, then the connection dies before the answer arrives. The adapter must resend, and the
// write must end up in the database exactly once.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createGateway } from '../lib/gateway.mjs';
import { testDriver } from './driver.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, '..', 'payroll-web');
let ts;
try { ts = createRequire(path.join(web, 'package.json'))('typescript'); } catch { console.log('SKIP client test: payroll-web\\node_modules\\typescript not found'); process.exit(0); }

const source = fs.readFileSync(path.join(web, 'lib', 'pg-gateway-client.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const tmp = path.join(os.tmpdir(), `pg-client-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const { pgDatabase, pgBucket } = await import(pathToFileURL(tmp).href);

const driver = await testDriver();
await driver.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const SECRET = 'client-test-secret-123456';
const handle = createGateway({ driver, secret: SECRET });
let dropNext = 0;
const server = http.createServer((req, res) => {
  if (dropNext > 0 && req.method === 'POST' && req.url === '/db') {
    dropNext--;
    // let the gateway do its work, then cut the connection instead of answering
    void handle(req, { writeHead() {}, end() { req.socket.destroy(); } });
    return;
  }
  void handle(req, res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const gw = { url: `http://127.0.0.1:${server.address().port}`, secret: SECRET };
const db = pgDatabase(gw), bucket = pgBucket(gw);
let passed = 0; const ok = (m) => { passed++; console.log('PASS ', m); };
const now = new Date().toISOString();

// plain calls
const ins = "INSERT INTO holidays(id,owner,dataset,data,revision,updated_at) VALUES(?,?,?,?,1,?)";
assert.equal((await db.prepare(ins).bind('h1', 'o', 'd', '{}', now).run()).meta.changes, 1);
assert.deepEqual(await db.prepare('SELECT id FROM holidays WHERE id=?').bind('h1').first(), { id: 'h1' });
assert.equal(await db.prepare('SELECT id FROM holidays WHERE id=?').bind('nope').first(), null);
assert.equal((await db.prepare('SELECT COUNT(*) n FROM holidays').all()).results[0].n, 1); ok('run / first / all');

// connection lost after the gateway wrote: a single write
dropNext = 1;
const r = await db.prepare(ins).bind('h2', 'o', 'd', '{}', now).run();
assert.equal(r.meta.changes, 1);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM holidays WHERE id='h2'").all()).results[0].n, 1); ok('write whose answer was lost is applied once and answered');

// the same for a batch (one transaction): both statements once
dropNext = 1;
const out = await db.batch([db.prepare(ins).bind('h3', 'o', 'd', '{}', now), db.prepare(ins).bind('h4', 'o', 'd', '{}', now)]);
assert.equal(out.length, 2);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM holidays WHERE id IN ('h3','h4')").all()).results[0].n, 2); ok('batch whose answer was lost is applied once');

// a failing batch rolls back and reports the SQLite-style error
await assert.rejects(db.batch([db.prepare(ins).bind('h5', 'o', 'd', '{}', now), db.prepare(ins).bind('h1', 'o', 'd', '{}', now)]), /UNIQUE constraint failed: holidays/);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM holidays WHERE id='h5'").all()).results[0].n, 0); ok('failed batch rolls back; error reads like SQLite');

// files, including a lost connection on a read
const body = new Uint8Array([0, 1, 2, 250, 255]);
await bucket.put('k/1', body, { httpMetadata: { contentType: 'application/gzip' } });
const o = await bucket.get('k/1');
assert.deepEqual(new Uint8Array(await o.arrayBuffer()), body); assert.equal(o.httpMetadata.contentType, 'application/gzip'); assert.equal(o.size, 5);
assert.equal((await bucket.head('k/1')).size, 5); assert.equal(await bucket.get('k/none'), null);
await bucket.put('k/2', JSON.stringify({ a: 1 }));
assert.deepEqual(await (await bucket.get('k/2')).json(), { a: 1 });
await bucket.delete('k/1'); assert.equal(await bucket.head('k/1'), null); ok('object put / get / head / json / delete');

server.close(); await driver.close(); fs.rmSync(tmp, { force: true });
console.log(`\nAll ${passed} adapter tests passed`);
process.exit(0);
