// Simulated eSSL / ZKTeco machine for testing without hardware. Answers the same port-4370 protocol over TCP and/or UDP
// with generated users and punches, chunked bulk transfers and (optionally) fragmented TCP writes.
//   node tools/zk-sim.mjs --port=14370 --users=120 --userSize=72 --logSize=40 --commKey=0 --tcp=1 --udp=1
import net from 'node:net';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import { CMD, checksum, tcpFrame, encodeTime, makeCommKey } from '../lib/zk.mjs';

const NAMES = ['Ramesh Kumar', 'Sunita Devi', 'Amit Sharma', 'Pooja Verma', 'Rahul Singh', 'Neha Gupta', 'Suresh Yadav',
  'Anita Rani', 'Vikas Chauhan', 'Kavita Joshi', 'Manoj Tiwari', 'Rekha Mishra', 'Deepak Saini', 'Priya Bansal', 'Ajay Rawat'];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function makeData(o) {
  const rand = rng(o.seed);
  const users = Array.from({ length: o.users }, (_, i) => ({
    uid: i + 1,
    userId: String(o.userSize === 72 ? 1001 + i : 101 + i),
    name: i === o.users - 1 ? '' : NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''),
    privilege: i === 0 ? 14 : 0,
    card: rand() < 0.3 ? 1000000 + Math.floor(rand() * 8999999) : 0,
  }));
  const logs = [];
  const today = new Date();
  for (let back = o.days; back >= 0; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    if (day.getDay() === 0) continue;
    for (const u of users) {
      if (rand() < 0.1) continue;
      const verify = rand() < 0.8 ? 1 : rand() < 0.5 ? 15 : 2;
      const at = (h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, Math.floor(rand() * 60));
      const inTime = at(8, 45 + Math.floor(rand() * 40));
      if (back === 0 && inTime > today) continue;
      logs.push({ user: u, time: inTime, verify, punch: 0 });
      const outTime = at(17, 50 + Math.floor(rand() * 50));
      if (back === 0 && outTime > today) continue;
      if (rand() < 0.05) continue; // forgot to punch out
      logs.push({ user: u, time: outTime, verify, punch: 1 });
    }
  }
  return { users, logs };
}

function userRecord(u, size) {
  const r = Buffer.alloc(size);
  r.writeUInt16LE(u.uid, 0);
  r[2] = u.privilege;
  if (size === 28) {
    r.write(u.name.slice(0, 8), 8, 8, 'utf8');
    r.writeUInt32LE(u.card, 16);
    r[21] = 1;
    r.writeUInt32LE(Number(u.userId), 24);
  } else {
    r.write(u.name.slice(0, 23), 11, 24, 'utf8');
    r.writeUInt32LE(u.card, 35);
    r.write('1', 40, 7, 'latin1');
    r.write(u.userId, 48, 24, 'latin1');
  }
  return r;
}

function logRecord(l, size) {
  const r = Buffer.alloc(size);
  const t = encodeTime(l.time);
  if (size === 8) {
    r.writeUInt16LE(l.user.uid, 0); r[2] = l.verify; r.writeUInt32LE(t, 3); r[7] = l.punch;
  } else if (size === 16) {
    r.writeUInt32LE(Number(l.user.userId), 0); r.writeUInt32LE(t, 4); r[8] = l.verify; r[9] = l.punch;
  } else {
    r.writeUInt16LE(l.user.uid, 0); r.write(l.user.userId, 2, 24, 'latin1'); r[26] = l.verify; r.writeUInt32LE(t, 27); r[31] = l.punch;
  }
  return r;
}

const withTotal = (records) => {
  const body = Buffer.concat(records);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
};

export function startSimulator(options = {}) {
  const o = {
    host: '127.0.0.1', port: 14370, tcp: true, udp: true, users: 25, userSize: 72, logSize: 40, commKey: 0, days: 40,
    seed: 7, serial: 'SIM' + (options.port || 14370), directData: false, fragment: true, punchDuringRead: false, ...options,
  };
  const data = makeData(o);
  const stats = { badChecksum: 0, badSession: 0, packets: 0, connections: 0 };

  function handle(session, raw, send) {
    if (raw.length < 8) return;
    stats.packets++;
    const cmd = raw.readUInt16LE(0), sum = raw.readUInt16LE(2), sid = raw.readUInt16LE(4), reply = raw.readUInt16LE(6);
    const payload = raw.subarray(8);
    const check = Buffer.from(raw);
    check.writeUInt16LE(0, 2);
    check.writeUInt16LE((reply + 65534) % 65535, 6);
    if (checksum(check) !== sum) stats.badChecksum++;
    if (cmd !== CMD.CONNECT && sid !== session.id) stats.badSession++;

    const packet = (code, body = Buffer.alloc(0)) => {
      const p = Buffer.alloc(8 + body.length);
      p.writeUInt16LE(code, 0); p.writeUInt16LE(session.id, 4); p.writeUInt16LE(reply, 6); body.copy(p, 8);
      p.writeUInt16LE(checksum(p), 2);
      return p;
    };
    const out = [];
    const respond = (code, body) => out.push(packet(code, body));

    if (cmd === CMD.CONNECT) {
      session.id = 1 + Math.floor(Math.random() * 60000);
      session.authed = !o.commKey;
      respond(o.commKey ? CMD.ACK_UNAUTH : CMD.ACK_OK);
    } else if (cmd === CMD.AUTH) {
      session.authed = makeCommKey(o.commKey, session.id).equals(payload);
      respond(session.authed ? CMD.ACK_OK : CMD.ACK_UNAUTH);
    } else if (!session.authed) {
      respond(CMD.ACK_UNAUTH);
    } else if (cmd === CMD.GET_FREE_SIZES) {
      const b = Buffer.alloc(92);
      const set = (i, v) => b.writeInt32LE(v, i * 4);
      set(4, data.users.length); set(6, data.users.length * 2); set(8, data.logs.length);
      set(14, 3000); set(15, 3000); set(16, 100000);
      respond(CMD.ACK_OK, b);
    } else if (cmd === CMD.OPTIONS_RRQ) {
      const name = payload.toString('latin1').split('\0')[0];
      const value = { '~SerialNumber': o.serial, '~DeviceName': 'eSSL SIM', '~Platform': 'ZMM220_TFT', MAC: '00:17:61:12:34:56' }[name];
      respond(value == null ? CMD.ACK_ERROR : CMD.ACK_OK, value == null ? undefined : Buffer.from(`${name}=${value}\0`, 'latin1'));
    } else if (cmd === CMD.GET_VERSION) {
      respond(CMD.ACK_OK, Buffer.from('Ver 6.60 Sep 27 2019\0'));
    } else if (cmd === CMD.GET_TIME) {
      const b = Buffer.alloc(4); b.writeUInt32LE(encodeTime(new Date()), 0); respond(CMD.ACK_OK, b);
    } else if (cmd === CMD.DATA_WRRQ) {
      const what = payload.readInt16LE(1);
      let full;
      if (what === CMD.USERTEMP_RRQ) full = withTotal(data.users.map((u) => userRecord(u, o.userSize)));
      else if (what === CMD.ATTLOG_RRQ) {
        const logs = o.punchDuringRead ? [...data.logs, { ...data.logs[0], time: new Date() }] : data.logs;
        full = withTotal(logs.map((l) => logRecord(l, o.logSize)));
      }
      if (!full) respond(CMD.ACK_ERROR);
      else if (full.length <= 1024) respond(CMD.DATA, full);
      else {
        session.pending = full;
        const b = Buffer.alloc(9); b.writeUInt32LE(full.length, 1); respond(CMD.ACK_OK, b);
      }
    } else if (cmd === CMD.DATA_RDY) {
      const start = payload.readInt32LE(0), size = payload.readInt32LE(4);
      const slice = (session.pending || Buffer.alloc(0)).subarray(start, start + size);
      if (o.directData) respond(CMD.DATA, slice);
      else {
        const head = Buffer.alloc(8); head.writeUInt32LE(slice.length, 0); respond(CMD.PREPARE_DATA, head);
        const piece = session.udp ? 1024 : 20000;
        for (let at = 0; at < slice.length; at += piece) respond(CMD.DATA, slice.subarray(at, at + piece));
        respond(CMD.ACK_OK);
      }
    } else if (cmd === CMD.FREE_DATA) {
      session.pending = null; respond(CMD.ACK_OK);
    } else if (cmd === CMD.EXIT) {
      respond(CMD.ACK_OK); session.closing = true;
    } else {
      respond(CMD.ACK_UNKNOWN);
    }
    send(out);
  }

  const servers = [];
  if (o.tcp) {
    const tcp = net.createServer((sock) => {
      stats.connections++;
      sock.setNoDelay(true);
      const session = { id: 0, authed: false, udp: false };
      let buf = Buffer.alloc(0);
      let queue = Promise.resolve();
      sock.on('error', () => {});
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 8) {
          const len = buf.readUInt32LE(4);
          if (buf.length < 8 + len) break;
          const raw = buf.subarray(8, 8 + len);
          buf = buf.subarray(8 + len);
          handle(session, raw, (packets) => {
            const bytes = Buffer.concat(packets.map(tcpFrame));
            queue = queue.then(async () => {
              if (!o.fragment) sock.write(bytes);
              else {
                // Split the reply at odd places so the client has to reassemble frames from a byte stream.
                for (let at = 0; at < bytes.length;) {
                  const n = Math.min(bytes.length - at, 3 + Math.floor(Math.random() * 3000));
                  sock.write(bytes.subarray(at, at + n));
                  at += n;
                  if (Math.random() < 0.3) await new Promise((r) => setTimeout(r, 1));
                }
              }
              if (session.closing) sock.end();
            });
          });
        }
      });
    });
    tcp.listen(o.port, o.host);
    servers.push(tcp);
  }
  if (o.udp) {
    const udp = dgram.createSocket('udp4');
    const sessions = new Map();
    udp.on('message', (msg, rinfo) => {
      const key = `${rinfo.address}:${rinfo.port}`;
      if (!sessions.has(key)) sessions.set(key, { id: 0, authed: false, udp: true });
      handle(sessions.get(key), msg, (packets) => { for (const p of packets) udp.send(p, rinfo.port, rinfo.address); });
    });
    udp.bind(o.port, o.host);
    servers.push(udp);
  }
  return {
    options: o, data, stats,
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(() => r())))),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const opts = {};
  for (const [k, v] of Object.entries(args)) opts[k] = /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
  for (const k of ['tcp', 'udp', 'directData', 'fragment', 'punchDuringRead']) if (k in opts) opts[k] = Boolean(opts[k]);
  const sim = startSimulator(opts);
  console.log(`Simulated machine on ${sim.options.host}:${sim.options.port} (${[sim.options.tcp && 'TCP', sim.options.udp && 'UDP'].filter(Boolean).join('+')}), ` +
    `${sim.data.users.length} users (${sim.options.userSize}-byte), ${sim.data.logs.length} punches (${sim.options.logSize}-byte)` +
    (sim.options.commKey ? `, comm key ${sim.options.commKey}` : ''));
}
