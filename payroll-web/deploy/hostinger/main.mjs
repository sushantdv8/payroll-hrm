// Payroll Workspace on a Node.js web-app hosting that runs apps under LiteSpeed "lsnode" (Hostinger Business web apps and the like).
//
// Such a hosting starts ONE Node.js process per app, hands it a single socket (listen() is wrapped), and does not let processes reach each other over TCP
// on 127.0.0.1 - but unix sockets work. So everything runs in this one process:
//
//   browser --HTTPS--> hosting (CDN, LiteSpeed) --> sign-in layer (the hosting's socket) --unix socket--> the application --unix socket--> database gateway --> PGlite
//
// * PGlite is PostgreSQL inside Node.js (data in a folder, default ~/payroll-data/pg, outside the folder that every deploy replaces).
// * The application (vinext production server) is not started on a port: its request handler is taken from it and served on a unix socket of its own.
// * The application's calls to its database (fetch to http://gateway.local) are routed to the gateway's unix socket.
// * The sign-in layer (deploy/signin-layer) is the only thing the hosting can reach. Settings come from the web app's environment variables:
//     PUBLIC_ORIGIN         https://<the address people type>   (required)
//     ADMIN_PASSWORD_HASH   scrypt hash of the Super Admin password, made with deploy/signin-layer/make-admin-hash.mjs   (required)
//     PAYROLL_DATA_DIR      where the database lives (default: ~/payroll-data)
//     PORT                  only for a test outside the hosting (the hosting ignores it)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {register, syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), APP = path.resolve(HERE, '..', '..');   // APP = payroll-web
const env = process.env, started = Date.now();
const log = m => console.log(`[payroll ${((Date.now() - started) / 1000).toFixed(1)}s] ${m}`);
process.on('unhandledRejection', e => console.error('[payroll] unhandled rejection:', e && e.stack || e));
process.on('uncaughtException', e => console.error('[payroll] uncaught exception:', e && e.stack || e));

// ---- places ----
const dataDir = path.resolve(env.PAYROLL_DATA_DIR || path.join(os.homedir(), 'payroll-data'));
fs.mkdirSync(dataDir, {recursive: true, mode: 0o700});
const tag = crypto.randomBytes(6).toString('hex');
const runDir = process.platform === 'win32' ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'pw-'));   // 0700: only this user reaches the sockets
const socketPath = name => process.platform === 'win32' ? `\\\\.\\pipe\\pw-${tag}-${name}` : path.join(runDir, name + '.sock');
const gatewaySocket = socketPath('gateway'), appSocket = socketPath('app');
const listenOn = (server, where) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(where, () => { server.off('error', reject); resolve(); }); });

// ---- 1. the sign-in layer listens first (it is the hosting's one socket); the rest starts behind it ----
const {createLayer, readConfig} = await import('../signin-layer/server.mjs');
let cfg;
try { cfg = readConfig({...env, UPSTREAM: 'unix:' + appSocket, HOST: '127.0.0.1', PORT: String(env.PORT || 8080), PAYROLL_INTERNAL_KEY: env.PAYROLL_INTERNAL_KEY || crypto.randomBytes(24).toString('hex')}); }
catch (e) {
  console.error('[payroll] NOT CONFIGURED: ' + e.message);
  const msg = 'Payroll Workspace is not configured yet: ' + e.message + ' (set it in the web app\'s environment variables and redeploy).';
  http.createServer((req, res) => { res.writeHead(503, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(msg); }).listen(Number(env.PORT || 8080));
  await new Promise(() => {});
}
env.PAYROLL_INTERNAL_KEY = cfg.internalKey;
const layer = createLayer(cfg, m => log('layer: ' + m));
await listenOn(layer.server, cfg.port);
log(`sign-in layer is listening for ${cfg.publicOrigin}`);

// ---- 2. one process owns the database folder (a second copy running at the same time would damage it) ----
const lockFile = path.join(dataDir, 'pg.lock');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (let i = 0; i < 60; i++) {
  let other = 0; try { other = Number(fs.readFileSync(lockFile, 'utf8')); } catch { /* no lock */ }
  if (!other || other === process.pid || !alive(other)) break;
  if (i === 0) log(`waiting for the previous copy (pid ${other}) to stop ...`);
  await new Promise(r => setTimeout(r, 1000));
}
fs.writeFileSync(lockFile, String(process.pid));
const releaseLock = () => { try { if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.unlinkSync(lockFile); } catch { /* gone */ } };

try {
  // ---- 3. the database gateway on PGlite, on its own unix socket ----
  const {createGateway} = await import('./gateway/lib/gateway.mjs');
  const {pgliteDriver} = await import('./gateway/lib/drivers.mjs');
  const driver = await pgliteDriver(path.join(dataDir, 'pg'));
  await driver.exec(fs.readFileSync(path.join(HERE, 'gateway', 'schema.sql'), 'utf8'));
  const secret = crypto.randomBytes(32).toString('hex');
  const handle = createGateway({driver, secret});
  const gatewayServer = http.createServer((req, res) => { void handle(req, res); });
  gatewayServer.keepAliveTimeout = 300000; gatewayServer.headersTimeout = 310000;
  await listenOn(gatewayServer, gatewaySocket);
  env.DB_GATEWAY_URL = 'http://gateway.local'; env.DB_GATEWAY_SECRET = secret;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function routedFetch(input, init) {
    let url; try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); } catch { return realFetch(input, init); }
    if (url.hostname !== 'gateway.local') return realFetch(input, init);
    const method = String(init?.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const headers = {}; new Headers(init?.headers || {}).forEach((v, k) => { headers[k] = v; });
    let body = init?.body ?? null;
    if (body !== null && typeof body !== 'string' && !(body instanceof Uint8Array)) body = Buffer.from(await new Response(body).arrayBuffer());
    if (body !== null) headers['content-length'] = String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength);
    return new Promise((resolve, reject) => {
      const request = http.request({socketPath: gatewaySocket, method, path: url.pathname + url.search, headers}, res => {
        const out = new Headers(); for (const [k, v] of Object.entries(res.headers)) out.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const empty = method === 'HEAD' || [101, 204, 205, 304].includes(res.statusCode);
        if (empty) res.resume();
        resolve(new Response(empty ? null : Readable.toWeb(res), {status: res.statusCode, headers: out}));
      });
      request.on('error', reject);
      if (init?.signal) { if (init.signal.aborted) request.destroy(init.signal.reason); else init.signal.addEventListener('abort', () => request.destroy(init.signal.reason), {once: true}); }
      request.end(body);
    });
  };
  log('database (PGlite) is ready');

  // ---- 4. the application: take its request handler instead of letting it listen on a port ----
  register('../node-runner/hooks.mjs', import.meta.url);   // import {env} from 'cloudflare:workers'  ->  process.env
  let appHandler = null;
  const realCreateServer = http.createServer;
  const stub = new Proxy({}, {get: (t, p) => p === 'listen' ? (...a) => { const cb = a.find(x => typeof x === 'function'); queueMicrotask(() => cb && cb()); return stub; }
    : p === 'address' ? () => ({address: '127.0.0.1', family: 'IPv4', port: 0}) : p === 'close' ? cb => { if (typeof cb === 'function') cb(); } : () => stub});
  http.createServer = (...args) => { appHandler = args.find(a => typeof a === 'function') || appHandler; return stub; };
  syncBuiltinESMExports();
  try {
    const {startProdServer} = await import('vinext/server/prod-server');
    await startProdServer({port: 0, host: '127.0.0.1', outDir: path.join(APP, 'dist'), silent: true});
  } finally { http.createServer = realCreateServer; syncBuiltinESMExports(); }
  if (!appHandler) throw new Error('the application did not register a request handler');
  const appServer = http.createServer((req, res) => appHandler(req, res));
  appServer.keepAliveTimeout = 65000; appServer.headersTimeout = 70000; appServer.requestTimeout = 0;
  await listenOn(appServer, appSocket);
  log('application is ready');

  const stop = () => { releaseLock(); void driver.close().catch(() => {}).finally(() => process.exit(0)); setTimeout(() => process.exit(0), 4000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('exit', releaseLock);
} catch (e) {
  releaseLock();
  console.error('[payroll] START FAILED: ' + (e && e.stack || e));   // the layer keeps answering 502 "starting" - the log shows why
}
