// Lets the app talk to PostgreSQL through the db-gateway (see ../../db-gateway) while the rest of the code keeps using
// the Cloudflare D1 / R2 calls (prepare / bind / first / all / run / batch, and bucket get / put / head / delete).
type Kind = 'first' | 'all' | 'run';
type Gateway = {url: string; secret: string};
type Result = {rows: Record<string, unknown>[]; changes: number};

// A connection that sat idle can be closed by the other side just as we send on it ("Network connection lost"): try again.
// Writes carry an x-request-id, so the gateway answers a repeated request from its first run instead of writing twice.
async function send(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(url, init); }
    catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function post(gw: Gateway, ops: {sql: string; params: unknown[]; kind: Kind}[]): Promise<Result[]> {
  const response = await send(gw.url + '/db', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + gw.secret, 'x-request-id': crypto.randomUUID()}, body: JSON.stringify({ops})});
  const body = await response.json().catch(() => ({})) as {results?: Result[]; error?: string};
  if (!response.ok || !body.results) throw new Error(body.error || 'Database request failed (' + response.status + ')');
  return body.results;
}

class Statement {
  constructor(private gw: Gateway, readonly sql: string, readonly params: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.gw, this.sql, values); }
  op(kind: Kind) { return {sql: this.sql, params: this.params, kind}; }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = (await post(this.gw, [this.op('first')]))[0].rows[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async all<T = Record<string, unknown>>() {
    const r = (await post(this.gw, [this.op('all')]))[0];
    return {results: r.rows as T[], success: true, meta: {changes: r.changes}};
  }
  async run() {
    const r = (await post(this.gw, [this.op('run')]))[0];
    return {results: [], success: true, meta: {changes: r.changes}};
  }
}

export function pgDatabase(gw: Gateway) {
  return {
    prepare: (sql: string) => new Statement(gw, sql),
    // Several statements run in ONE transaction: if one fails (for example the write guard), none of them is kept.
    async batch(statements: Statement[]) {
      const results = await post(gw, statements.map((s) => s.op('run')));
      return results.map((r) => ({results: r.rows, success: true, meta: {changes: r.changes}}));
    },
    // The tables already exist in PostgreSQL (the gateway creates them), so the app's SQLite setup text is not sent.
    async exec() { return {count: 0, duration: 0}; },
  } as unknown as D1Database;
}

export function pgBucket(gw: Gateway) {
  const auth = {Authorization: 'Bearer ' + gw.secret};
  const url = (key: string) => gw.url + '/object?key=' + encodeURIComponent(key);
  const toBytes = async (value: unknown): Promise<Uint8Array> => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
  };
  return {
    async put(key: string, value: unknown, options?: {httpMetadata?: {contentType?: string}}) {
      const body = await toBytes(value);
      const response = await send(url(key), {method: 'PUT', headers: {...auth, 'x-content-type': options?.httpMetadata?.contentType || 'application/octet-stream'}, body: body as BodyInit});
      if (!response.ok) throw new Error('Object store write failed (' + response.status + ')');
      return null;
    },
    async get(key: string) {
      const response = await send(url(key), {headers: auth});
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Object store read failed (' + response.status + ')');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get('x-content-type') || 'application/octet-stream';
      return {
        key, size: bytes.length, httpMetadata: {contentType},
        get body() { return new Response(bytes).body as ReadableStream; },
        async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
        async text() { return new TextDecoder().decode(bytes); },
        async json<T>() { return JSON.parse(new TextDecoder().decode(bytes)) as T; },
      };
    },
    async head(key: string) {
      const response = await send(url(key), {method: 'HEAD', headers: auth});
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Object store read failed (' + response.status + ')');
      return {key, size: Number(response.headers.get('x-size') || 0), httpMetadata: {contentType: response.headers.get('x-content-type') || ''}};
    },
    async delete(key: string | string[]) {
      for (const k of Array.isArray(key) ? key : [key]) await send(url(k), {method: 'DELETE', headers: auth});
    },
  } as unknown as R2Bucket;
}
