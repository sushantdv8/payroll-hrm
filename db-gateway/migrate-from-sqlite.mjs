// Copies an existing Payroll Workspace (local SQLite "D1" + local R2 files) into PostgreSQL.
//   node migrate-from-sqlite.mjs <state-folder> [--wipe]
//     <state-folder>  the folder that holds v3\d1 and v3\r2, e.g. %LOCALAPPDATA%\PayrollWorkspace\state
//   DATABASE_URL must point to the empty PostgreSQL database. Run it while the old app is stopped; the SQLite files are only read.
//   --wipe  empties the PostgreSQL tables first (otherwise rows that already exist are skipped).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { pgDriver, pgliteDriver } from './lib/drivers.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const state = process.argv[2];
const wipe = process.argv.includes('--wipe');
if (!state || !process.env.DATABASE_URL) { console.error('Usage: DATABASE_URL=postgres://... node migrate-from-sqlite.mjs <state-folder> [--wipe]'); process.exit(1); }

const biggest = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite').map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
const d1Dir = path.join(state, 'v3', 'd1', 'miniflare-D1DatabaseObject');
const r2Root = path.join(state, 'v3', 'r2');
const d1File = fs.existsSync(d1Dir) && biggest(d1Dir);
if (!d1File) { console.error('No D1 database found under ' + d1Dir); process.exit(1); }

const pg = process.env.DATABASE_URL.startsWith('pglite:') ? await pgliteDriver(process.env.DATABASE_URL.slice(7) || undefined) : await pgDriver(process.env.DATABASE_URL); // pglite: is for tests
await pg.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const src = new DatabaseSync(d1File, { readOnly: true });

// parents before children (foreign keys)
const tables = ['employees', 'holidays', 'attendance', 'backup_settings', 'salary_snapshots', 'source_datasets', 'source_employee_links', 'source_packets', 'source_parts', 'master_records', 'hr_records', 'hr_audit', 'hr_settings', 'hr_users'];
if (wipe) for (const t of [...tables].reverse()) await pg.exec(`DELETE FROM ${t}`);

const exists = (t) => src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
for (const t of tables) {
  if (!exists(t)) { console.log(`${t}: not in the old database, skipped`); continue; }
  const cols = src.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const list = cols.map((c) => `"${c}"`).join(',');
  const stmt = src.prepare(`SELECT ${list} FROM ${t}`);
  const insert = `INSERT INTO ${t} (${list}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT DO NOTHING`;
  let n = 0, batch = [];
  const flush = async () => { if (!batch.length) return; await pg.transaction(async (q) => { for (const row of batch) await q.query(insert, row); }); n += batch.length; batch = []; };
  for (const row of stmt.iterate()) {
    batch.push(cols.map((c) => { const v = row[c]; return typeof v === 'bigint' ? Number(v) : v; }));
    if (batch.length >= 500) await flush();
  }
  await flush();
  console.log(`${t}: ${n} rows copied`);
}

// files (source archive parts, month indexes, photos, HR documents)
let files = 0, skipped = 0;
const bucketDir = path.join(r2Root, 'miniflare-R2BucketObject');
const meta = fs.existsSync(bucketDir) && biggest(bucketDir);
if (meta) {
  const blobDirs = fs.readdirSync(r2Root, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(r2Root, e.name, 'blobs'))).map((e) => path.join(r2Root, e.name, 'blobs'));
  const objects = new DatabaseSync(meta, { readOnly: true });
  for (const o of objects.prepare('SELECT key,blob_id,size,http_metadata FROM _mf_objects WHERE blob_id IS NOT NULL').all()) {
    const dir = blobDirs.find((b) => fs.existsSync(path.join(b, o.blob_id)));
    if (!dir) { skipped++; continue; }
    let type = 'application/octet-stream';
    try { type = JSON.parse(o.http_metadata).contentType || type; } catch { /* keep default */ }
    const body = fs.readFileSync(path.join(dir, o.blob_id));
    await pg.query('INSERT INTO objects (key, body, content_type, size, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING', [o.key, body, type, body.length, new Date().toISOString()]);
    files++;
  }
}
console.log(`files: ${files} copied${skipped ? `, ${skipped} had no stored content (skipped)` : ''}`);
await pg.close();
console.log('Done. Start the gateway and set DB_GATEWAY_URL / DB_GATEWAY_SECRET for the app.');
