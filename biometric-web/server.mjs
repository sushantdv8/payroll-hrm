// Biometric Attendance: a local web app that downloads users and punch logs from eSSL / ZKTeco machines.
// Run on a PC that is on the same network as the machines:
//   node --no-warnings server.mjs [--port=5180] [--host=127.0.0.1] [--data=folder] [--open]
// --host=0.0.0.0 makes it reachable from other PCs on the LAN (there is no login, so only do that on a trusted network).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ZKClient } from './lib/zk.mjs';
import { openStore } from './lib/store.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const PORT = Number(args.port || process.env.PORT) || 5180;
const HOST = args.host || process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(args.data || process.env.BIOMETRIC_DATA || path.join(ROOT, 'data'));
const PUBLIC = path.join(ROOT, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
const store = openStore(path.join(DATA_DIR, 'biometric.sqlite'));

// The three machines from the Attendance Management program's machine list.
if (!store.getSetting('seeded')) {
  for (const [name, ip] of [['KE1', '192.168.11.180'], ['KE2', '192.168.11.183'], ['b4', '192.168.11.184']]) {
    store.addDevice({ name, ip, port: 4370, protocol: 'auto', commKey: 0, machineNo: 1 });
  }
  store.setSetting('seeded', true);
}
// Punches are fetched by themselves: every 15 minutes while the app is open, and once a few seconds after it starts
// (turned on once; the interval can still be changed or switched off in the app, and that choice is kept).
if (!store.getSetting('autoDefault')) {
  if (!Number(store.getSetting('autoMinutes', 0))) store.setSetting('autoMinutes', 15);
  store.setSetting('autoDefault', true);
}

const busy = new Map(); // device id -> 'test' | 'download'
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function localNetworks() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list || []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address, netmask: a.netmask })));
}
const ipNumber = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
function reachableSubnet(ip, nets) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.startsWith('127.')) return true;
  return nets.some((n) => {
    const mask = ipNumber(n.netmask);
    return (ipNumber(ip) & mask) >>> 0 === (ipNumber(n.address) & mask) >>> 0;
  });
}

// Log of every machine connection with a short protocol trace, so problems on site can be diagnosed later.
const LOG_FILE = path.join(DATA_DIR, 'biometric.log');
function writeLog(line) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    fs.appendFileSync(LOG_FILE, `[${stamp()}] ${line}\r\n`);
  } catch { /* logging must never break a download */ }
}

function ping(ip) {
  const argv = process.platform === 'win32' ? ['-n', '1', '-w', '1500', ip] : ['-c', '1', '-W', '2', ip];
  return new Promise((resolve) => {
    execFile('ping', argv, { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve(/ttl=/i.test(String(stdout || ''))));
  });
}

async function withMachine(id, kind, work) {
  const device = store.getDevice(id);
  if (!device) throw httpError(404, 'Machine not found');
  if (busy.has(id)) throw httpError(409, `${device.name} is already busy`);
  busy.set(id, kind);
  const started = Date.now();
  const where = `${device.name} ${device.ip}:${device.port} ${kind}`;
  const zk = new ZKClient({ host: device.ip, port: device.port, protocol: device.protocol, commKey: device.commKey });
  try {
    await zk.connect();
    const result = await work(zk, device);
    const seconds = (Date.now() - started) / 1000;
    writeLog(`${where} OK ${seconds.toFixed(1)}s | ${zk.notes.join(' | ')}`);
    return { ...result, seconds };
  } catch (err) {
    let message = err.message;
    if (['NETWORK', 'TIMEOUT', 'CLOSED'].includes(err.code) && /^[\d.]+$/.test(device.ip)) {
      message += (await ping(device.ip))
        ? '. The machine answers ping, so the network is OK: check the port and Comm Key, and disconnect it in the eSSL software'
        : '. The machine does not answer ping either: check its IP, the network cable, and that this PC is on the same network';
    }
    writeLog(`${where} FAILED ${((Date.now() - started) / 1000).toFixed(1)}s: ${message} | ${zk.notes.join(' | ')}`);
    store.setDeviceResult(id, { ok: false, message });
    if (kind !== 'test') store.addSync({ deviceId: id, kind, startedAt: stamp(new Date(started)), seconds: (Date.now() - started) / 1000, ok: false, message });
    throw httpError(502, `${device.name}: ${message}`);
  } finally {
    await zk.disconnect();
    busy.delete(id);
  }
}

const testMachine = (id) => withMachine(id, 'test', async (zk, device) => {
  const info = { ...device.info, ...(await zk.getInfo()) };
  store.setDeviceResult(id, { ok: true, info });
  return { info };
});

const downloadMachine = (id, kind = 'download') => withMachine(id, kind, async (zk) => {
  const t0 = Date.now(), started = stamp();
  const info = await zk.getInfo();
  const users = await zk.getUsers();
  const logs = await zk.getAttendance(users);
  info.admins = users.filter((u) => u.privilege === 14).length;
  store.saveUsers(id, users);
  const newLogs = store.saveLogs(id, logs);
  store.setDeviceResult(id, { ok: true, info, synced: true });
  store.addSync({ deviceId: id, kind, startedAt: started, seconds: (Date.now() - t0) / 1000, ok: true, users: users.length, logs: logs.length, newLogs });
  return { info, users: users.length, logs: logs.length, newLogs };
});

async function downloadAll(kind) {
  const devices = store.listDevices().filter((d) => !busy.has(d.id));
  const results = await Promise.allSettled(devices.map((d) => downloadMachine(d.id, kind)));
  return devices.map((d, i) => ({
    id: d.id, name: d.name,
    ok: results[i].status === 'fulfilled',
    ...(results[i].status === 'fulfilled' ? results[i].value : { error: results[i].reason.message }),
  }));
}

// Optional automatic download every N minutes while the app is running.
let lastAuto = Date.now();
setInterval(() => {
  const minutes = Number(store.getSetting('autoMinutes', 0));
  if (!minutes || Date.now() - lastAuto < minutes * 60000) return;
  lastAuto = Date.now();
  downloadAll('auto').catch(() => {});
}, 30000).unref();

function readDevice(body) {
  const d = {
    name: String(body.name || '').trim(),
    ip: String(body.ip || '').trim(),
    port: Number(body.port) || 4370,
    protocol: ['auto', 'tcp', 'udp'].includes(body.protocol) ? body.protocol : 'auto',
    commKey: Number(body.commKey) || 0,
    machineNo: Number(body.machineNo) || 1,
  };
  if (!d.name || d.name.length > 40) throw httpError(400, 'Machine name is required (max 40 characters)');
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(d.ip)) throw httpError(400, 'Enter a valid IP address, e.g. 192.168.11.180');
  if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535) throw httpError(400, 'Port must be 1-65535');
  if (!Number.isInteger(d.commKey) || d.commKey < 0 || d.commKey > 999999) throw httpError(400, 'Comm Key must be a number up to 6 digits');
  return d;
}

function readFilter(q) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date();
  return {
    from: day.test(q.get('from') || '') ? q.get('from') : `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`,
    to: day.test(q.get('to') || '') ? q.get('to') : stamp(today).slice(0, 10),
    device: q.get('device') || '',
    q: q.get('q') || '',
  };
}

const VERIFY = { 0: 'Password', 1: 'Fingerprint', 2: 'Card', 15: 'Face', 25: 'Palm' };
const PUNCH = { 0: 'Check-In', 1: 'Check-Out', 2: 'Break-Out', 3: 'Break-In', 4: 'OT-In', 5: 'OT-Out' };
const PRIVILEGE = { 0: 'User', 2: 'Enroller', 6: 'Manager', 14: 'Admin' };
const minutesBetween = (a, b) => Math.round((new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 60000);

function csv(rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const csvExports = {
  logs(f) {
    const { rows } = store.queryLogs(f);
    return {
      name: `punch-logs_${f.from}_to_${f.to}.csv`,
      body: csv([['User ID', 'Name', 'Date Time', 'Machine', 'Verify Mode', 'Punch'],
        ...rows.map((r) => [r.user_id, r.name, r.ts, r.device, VERIFY[r.verify] ?? r.verify, PUNCH[r.punch] ?? r.punch])]),
    };
  },
  daily(f) {
    const rows = store.queryDaily(f);
    return {
      name: `daily-in-out_${f.from}_to_${f.to}.csv`,
      body: csv([['User ID', 'Name', 'Date', 'First In', 'Last Out', 'Hours', 'Punches', 'Machines'],
        ...rows.map((r) => {
          const single = r.first === r.last;
          return [r.user_id, r.name, r.day, r.first.slice(11, 16), single ? '' : r.last.slice(11, 16),
            single ? '' : (minutesBetween(r.first, r.last) / 60).toFixed(2), r.punches, r.devices];
        })]),
    };
  },
  users(f) {
    const rows = store.queryUsers(f);
    return {
      name: 'machine-users.csv',
      body: csv([['User ID', 'Name', 'Privilege', 'Card', 'Machine', 'Last Punch'],
        ...rows.map((r) => [r.user_id, r.name, PRIVILEGE[r.privilege] ?? r.privilege, r.card === '0' ? '' : r.card, r.device, r.last_punch || ''])]),
    };
  },
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readBody(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw httpError(413, 'Request too large');
    parts.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw httpError(400, 'Invalid JSON'); }
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const method = req.method;
  const id = Number(parts[1]);

  if (method === 'GET' && parts[0] === 'state') {
    const nets = localNetworks();
    return send(res, 200, {
      devices: store.listDevices().map((d) => ({ ...d, busy: busy.get(d.id) || null, sameNetwork: reachableSubnet(d.ip, nets) })),
      networks: nets,
      autoMinutes: Number(store.getSetting('autoMinutes', 0)),
      totals: store.totals(),
    });
  }
  if (parts[0] === 'devices') {
    if (method === 'POST' && parts.length === 1) return send(res, 201, { id: store.addDevice(readDevice(await readBody(req))) });
    if (!store.getDevice(id)) throw httpError(404, 'Machine not found');
    if (method === 'PUT' && parts.length === 2) { store.updateDevice(id, readDevice(await readBody(req))); return send(res, 200, { ok: true }); }
    if (method === 'DELETE' && parts.length === 2) {
      if (busy.has(id)) throw httpError(409, 'Machine is busy');
      store.deleteDevice(id);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[2] === 'test') return send(res, 200, await testMachine(id));
    if (method === 'POST' && parts[2] === 'download') return send(res, 200, await downloadMachine(id));
  }
  if (method === 'POST' && parts[0] === 'download-all') return send(res, 200, { results: await downloadAll('download') });
  if (method === 'PUT' && parts[0] === 'settings') {
    const body = await readBody(req);
    const minutes = Number(body.autoMinutes);
    if (![0, 15, 30, 60, 120].includes(minutes)) throw httpError(400, 'Unsupported interval');
    store.setSetting('autoMinutes', minutes);
    lastAuto = Date.now();
    return send(res, 200, { ok: true });
  }
  if (method === 'GET') {
    const f = readFilter(url.searchParams);
    if (parts[0] === 'logs') {
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1), limit = 500;
      return send(res, 200, { ...store.queryLogs(f, { limit, offset: (page - 1) * limit }), page, limit, filter: f });
    }
    if (parts[0] === 'daily') {
      return send(res, 200, {
        filter: f,
        rows: store.queryDaily(f).map((r) => ({ ...r, minutes: r.first === r.last ? null : minutesBetween(r.first, r.last) })),
      });
    }
    if (parts[0] === 'users') return send(res, 200, { rows: store.queryUsers(f) });
    if (parts[0] === 'history') return send(res, 200, { rows: store.history() });
    if (parts[0] === 'export' && csvExports[parts[1]]) {
      const file = csvExports[parts[1]](f);
      return send(res, 200, file.body, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${file.name}"` });
    }
  }
  throw httpError(404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET') throw httpError(405, 'Method not allowed');
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw httpError(404, 'Not found');
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message || 'Server error' });
  }
});

const URL_SHOWN = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
const openBrowser = () => {
  if (args.open && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', URL_SHOWN], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
};

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    // Second double-click on the shortcut: the app is already running, so just show it.
    const ours = await fetch(`${URL_SHOWN}/api/state`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
    if (ours) {
      console.log(`Biometric Attendance is already running at ${URL_SHOWN}`);
      openBrowser();
      process.exit(0);
    }
    console.error(`Port ${PORT} is used by another program. Close it, or start with --port=<another number>.`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Biometric Attendance running at ${URL_SHOWN}`);
  console.log(`Data folder: ${DATA_DIR}`);
  writeLog(`started on ${URL_SHOWN}, Node ${process.version}, this PC: ${localNetworks().map((n) => n.address).join(', ') || 'no network'}`);
  openBrowser();
  // First download soon after start (not when --no-auto is given, e.g. by the tests), then every autoMinutes.
  if (!args['no-auto'] && Number(store.getSetting('autoMinutes', 0))) {
    lastAuto = Date.now();
    setTimeout(() => downloadAll('auto').catch(() => {}), 5000).unref();
  }
});
