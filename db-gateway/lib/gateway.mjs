// HTTP gateway between Payroll Workspace (which speaks the Cloudflare D1 / R2 API) and PostgreSQL.
//   POST /db      {ops:[{sql, params, kind}], tx?}   kind: first | all | run | exec ; several ops run in ONE transaction
//   PUT|GET|HEAD|DELETE /object?key=...               the object store (table "objects")
//   GET /health
// Every call except /health needs the header  Authorization: Bearer <GATEWAY_SECRET>.
import crypto from 'node:crypto';
import { toPg } from './translate.mjs';

const MAX_DB_BODY = 32 * 1024 * 1024;
const MAX_OBJECT = 64 * 1024 * 1024;

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// PostgreSQL errors, worded like SQLite's so the app's own checks keep working.
export function describe(error) {
  const c = error.code, t = error.table || '', n = error.constraint || '';
  if (c === '23505') return `UNIQUE constraint failed: ${t}${n ? ' (' + n + ')' : ''}`;
  if (c === '23514') return `CHECK constraint failed: ${t || n}`;
  if (c === '23503') return `FOREIGN KEY constraint failed: ${t}`;
  if (c === '23502') return `NOT NULL constraint failed: ${t}.${error.column || ''}`;
  return error.message || String(error);
}

const plain = (v) => (typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v);
const row = (r) => { for (const k of Object.keys(r)) r[k] = plain(r[k]); return r; };
const param = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

async function run(q, op) {
  if (op.kind === 'exec') { await q.exec(op.sql); return { rows: [], changes: 0 }; }
  const result = await q.query(toPg(op.sql), (op.params || []).map(param));
  const rows = (result.rows || []).map(row);
  return { rows: op.kind === 'first' ? rows.slice(0, 1) : rows, changes: Number(result.rowCount ?? result.affectedRows ?? 0) };
}

async function readBody(req, limit) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export function createGateway({ driver, secret }) {
  if (!secret || secret.length < 16) throw new Error('GATEWAY_SECRET must be set (at least 16 characters).');
  const send = (res, status, body, headers = {}) => {
    const json = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, { 'Content-Type': json ? 'application/json' : 'application/octet-stream', 'Cache-Control': 'no-store', ...headers });
    res.end(json ? JSON.stringify(body) : body);
  };

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://gateway');
      if (url.pathname === '/health') {
        await driver.query('SELECT 1', []);
        return send(res, 200, { ok: true });
      }
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (!bearer || !same(bearer[1], secret)) return send(res, 401, { error: 'Not authorised' });

      if (url.pathname === '/db' && req.method === 'POST') {
        const { ops, tx } = JSON.parse((await readBody(req, MAX_DB_BODY)).toString('utf8'));
        if (!Array.isArray(ops) || !ops.length) return send(res, 400, { error: 'No statements' });
        const results = ops.length > 1 || tx ? await driver.transaction((q) => ops.reduce(async (p, op) => [...(await p), await run(q, op)], Promise.resolve([]))) : [await run(driver, ops[0])];
        return send(res, 200, { results });
      }

      if (url.pathname === '/object') {
        const key = url.searchParams.get('key');
        if (!key) return send(res, 400, { error: 'Missing key' });
        if (req.method === 'PUT') {
          const body = await readBody(req, MAX_OBJECT);
          await driver.query(
            'INSERT INTO objects (key, body, content_type, size, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO UPDATE SET body = excluded.body, content_type = excluded.content_type, size = excluded.size, updated_at = excluded.updated_at',
            [key, body, req.headers['x-content-type'] || 'application/octet-stream', body.length, new Date().toISOString()]);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const r = await driver.query(`SELECT ${req.method === 'GET' ? 'body,' : ''} content_type, size FROM objects WHERE key = $1`, [key]);
          if (!r.rows.length) return send(res, 404, { error: 'Not found' });
          const o = r.rows[0];
          const headers = { 'x-content-type': o.content_type, 'x-size': String(Number(o.size)) };
          if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
          return send(res, 200, Buffer.from(o.body), headers);
        }
        if (req.method === 'DELETE') {
          await driver.query('DELETE FROM objects WHERE key = $1', [key]);
          return send(res, 200, { ok: true });
        }
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      return send(res, error.status || 400, { error: describe(error), code: error.code || null });
    }
  };
}
