// Read-only client for eSSL / ZKTeco attendance machines: the "standalone SDK" protocol on port 4370 used by the
// Attendance Management program and eTimeTrackLite. Works over TCP (newer firmware) or UDP (older firmware).
// Packet layouts follow the open-source pyzk library. Nothing here writes to, clears or disables the machine.
import net from 'node:net';
import dgram from 'node:dgram';

export const CMD = Object.freeze({
  CONNECT: 1000, EXIT: 1001, GET_VERSION: 1100, AUTH: 1102,
  USERTEMP_RRQ: 9, OPTIONS_RRQ: 11, ATTLOG_RRQ: 13, GET_FREE_SIZES: 50, GET_TIME: 201,
  PREPARE_DATA: 1500, DATA: 1501, FREE_DATA: 1502, DATA_WRRQ: 1503, DATA_RDY: 1504,
  ACK_OK: 2000, ACK_ERROR: 2001, ACK_DATA: 2002, ACK_RETRY: 2003, ACK_REPEAT: 2004, ACK_UNAUTH: 2005,
  ACK_UNKNOWN: 0xffff, REG_EVENT: 500,
});
const CODE_NAMES = Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k]));
const FCT_USER = 5;
const USHRT_MAX = 65535;
const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
const EMPTY = Buffer.alloc(0);

export class ZKError extends Error {
  constructor(message, code = 'DEVICE', reason = '') { super(message); this.code = code; this.reason = reason; }
}

const codeName = (code) => CODE_NAMES[code] || `code ${code}`;
const pad = (n) => String(n).padStart(2, '0');

// The SDK checksum: 16-bit one's-complement style sum over the packet with the checksum field zeroed.
export function checksum(buf) {
  let sum = 0, i = 0;
  for (; i + 1 < buf.length; i += 2) {
    sum += buf[i] | (buf[i + 1] << 8);
    if (sum > USHRT_MAX) sum -= USHRT_MAX;
  }
  if (i < buf.length) sum += buf[buf.length - 1];
  while (sum > USHRT_MAX) sum -= USHRT_MAX;
  sum = ~sum;
  while (sum < 0) sum += USHRT_MAX;
  return sum;
}

// Like pyzk (and the vendor SDK), the checksum is taken with the previous reply id and the packet goes out with the next one.
export function buildPacket(command, sessionId, replyId, data = EMPTY) {
  const buf = Buffer.alloc(8 + data.length);
  buf.writeUInt16LE(command, 0);
  buf.writeUInt16LE(sessionId, 4);
  buf.writeUInt16LE(replyId, 6);
  data.copy(buf, 8);
  buf.writeUInt16LE(checksum(buf), 2);
  buf.writeUInt16LE((replyId + 1) % USHRT_MAX, 6);
  return buf;
}

export function tcpFrame(packet) {
  const top = Buffer.alloc(8);
  TCP_MAGIC.copy(top, 0);
  top.writeUInt32LE(packet.length, 4);
  return Buffer.concat([top, packet]);
}

// Machine time is a packed count of seconds since 2000 with 31-day months; it is local machine time, not UTC.
export function decodeTime(buf, offset = 0) {
  let t = buf.readUInt32LE(offset);
  const second = t % 60; t = Math.floor(t / 60);
  const minute = t % 60; t = Math.floor(t / 60);
  const hour = t % 24; t = Math.floor(t / 24);
  const day = (t % 31) + 1; t = Math.floor(t / 31);
  const month = (t % 12) + 1; t = Math.floor(t / 12);
  return `${t + 2000}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export function encodeTime(d) {
  return ((d.getFullYear() % 100) * 12 * 31 + d.getMonth() * 31 + d.getDate() - 1) * 86400 +
    (d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds();
}

// Comm key ("password" in the machine's Comm settings) answer for CMD_AUTH.
export function makeCommKey(key, sessionId, ticks = 50) {
  const value = Number(key) >>> 0;
  let k = 0;
  for (let i = 0; i < 32; i++) k = k * 2 + ((value >>> i) & 1);
  k = (k + sessionId) % 0x100000000;
  const b = Buffer.alloc(4);
  b.writeUInt32LE(k, 0);
  const x = [b[0] ^ 0x5a, b[1] ^ 0x4b, b[2] ^ 0x53, b[3] ^ 0x4f]; // 'Z' 'K' 'S' 'O'
  const swapped = [x[2], x[3], x[0], x[1]];
  const t = ticks & 0xff;
  return Buffer.from([swapped[0] ^ t, swapped[1] ^ t, t, swapped[3] ^ t]);
}

const cstr = (buf, start, length) => {
  const part = buf.subarray(start, start + length);
  const end = part.indexOf(0);
  return (end < 0 ? part : part.subarray(0, end)).toString('utf8').trim();
};

// Record sizes are not announced; they follow from total bytes / record count. A punch made between reading the
// count and the data would make that division inexact, so fall back to the size whose record count is closest.
function pickRecordSize(total, count, sizes) {
  if (count > 0 && total % count === 0 && sizes.includes(total / count)) return total / count;
  const fits = sizes.filter((s) => total % s === 0);
  const pool = fits.length ? fits : sizes;
  return pool.reduce((best, s) => (Math.abs(total / s - count) < Math.abs(total / best - count) ? s : best));
}

function networkError(err, host, port, mode) {
  const where = `${host}:${port}`;
  const [text, reason] = {
    ECONNREFUSED: [`Machine at ${where} refused the ${mode.toUpperCase()} connection`, 'refused'],
    EHOSTUNREACH: [`No route to ${where}: this PC is not on the machine's network`, 'no route to the machine'],
    ENETUNREACH: [`No route to ${where}: this PC is not on the machine's network`, 'no route to the machine'],
    ETIMEDOUT: [`No answer from ${where}`, 'no answer'],
    ECONNRESET: [`Machine at ${where} dropped the connection (is another program connected to it?)`, 'connection dropped'],
  }[err.code] || [`${where}: ${err.message}`, err.code || err.message];
  return new ZKError(text, 'NETWORK', reason);
}

export class ZKClient {
  constructor({ host, port = 4370, protocol = 'auto', commKey = 0, timeout = 10000, connectTimeout = 5000 }) {
    Object.assign(this, { host, port: Number(port), protocol, commKey: Number(commKey) || 0, timeout, connectTimeout });
    this.mode = null;
    this.link = null;
    this.inbox = [];
    this.waiter = null;
    this.linkError = null;
    this.generation = 0;
    this.sessionId = 0;
    this.replyId = USHRT_MAX - 1;
    this.notes = []; // short protocol trace for the app's log file (connection mode, data sizes, record formats)
  }

  async connect() {
    const modes = this.protocol === 'tcp' ? ['tcp'] : this.protocol === 'udp' ? ['udp'] : ['tcp', 'udp'];
    const failures = [];
    for (const mode of modes) {
      try {
        this.mode = mode;
        await (mode === 'tcp' ? this.#openTcp() : this.#openUdp());
        await this.#handshake();
        this.notes.push(`connected over ${mode.toUpperCase()}, session ${this.sessionId}`);
        return this;
      } catch (err) {
        this.notes.push(`${mode.toUpperCase()} failed: ${err.message}`);
        failures.push([mode, err]);
        this.#closeLink();
        if (err.code === 'AUTH') throw err;
      }
    }
    if (failures.length === 1) throw failures[0][1];
    const reasons = failures.map(([mode, e]) => `${mode.toUpperCase()}: ${e.reason || e.message}`).join(', ');
    throw new ZKError(`Cannot connect to ${this.host}:${this.port} (${reasons})`, 'NETWORK');
  }

  async disconnect() {
    if (!this.link) return;
    try { await this.#command(CMD.EXIT, EMPTY, 2000); } catch { /* closing anyway */ }
    this.#closeLink();
  }

  async getInfo() {
    const sizes = await this.getSizes();
    return {
      protocol: this.mode,
      serialNumber: await this.getOption('~SerialNumber'),
      deviceName: await this.getOption('~DeviceName'),
      platform: await this.getOption('~Platform'),
      mac: await this.getOption('MAC'),
      firmware: await this.getVersion(),
      deviceTime: await this.getTime(),
      ...sizes,
    };
  }

  async getSizes() {
    const res = await this.#command(CMD.GET_FREE_SIZES);
    if (!res.ok) throw new ZKError(`Machine refused the size request (${codeName(res.code)})`);
    const d = res.data, out = {};
    if (d.length >= 80) {
      const f = (i) => d.readInt32LE(i * 4);
      Object.assign(out, {
        users: f(4), fingers: f(6), records: f(8), cards: f(12),
        fingersCapacity: f(14), usersCapacity: f(15), recordsCapacity: f(16),
      });
    }
    if (d.length >= 92) Object.assign(out, { faces: d.readInt32LE(80), facesCapacity: d.readInt32LE(88) });
    return out;
  }

  async getOption(name) {
    const res = await this.#command(CMD.OPTIONS_RRQ, Buffer.from(`${name}\0`, 'latin1'));
    if (!res.ok) return '';
    const text = cstr(res.data, 0, res.data.length);
    return text.includes('=') ? text.slice(text.indexOf('=') + 1).replaceAll('=', '').trim() : text;
  }

  async getVersion() {
    const res = await this.#command(CMD.GET_VERSION);
    return res.ok ? cstr(res.data, 0, res.data.length) : '';
  }

  async getTime() {
    const res = await this.#command(CMD.GET_TIME);
    return res.ok && res.data.length >= 4 ? decodeTime(res.data) : '';
  }

  async getUsers() {
    const sizes = await this.getSizes();
    if (!sizes.users) return [];
    const buf = await this.#readBuffer(CMD.USERTEMP_RRQ, FCT_USER);
    if (buf.length < 4) return [];
    const total = buf.readUInt32LE(0), data = buf.subarray(4);
    const size = pickRecordSize(total, sizes.users, [28, 72]);
    this.notes.push(`users: ${sizes.users} reported, ${total} bytes, ${size}-byte records`);
    const users = [];
    for (let at = 0; at + size <= data.length; at += size) {
      const r = data.subarray(at, at + size);
      if (size === 28) {
        users.push({
          uid: r.readUInt16LE(0), privilege: r[2], hasPassword: r[3] !== 0, name: cstr(r, 8, 8),
          card: r.readUInt32LE(16), group: String(r[21]), userId: String(r.readUInt32LE(24)),
        });
      } else {
        users.push({
          uid: r.readUInt16LE(0), privilege: r[2], hasPassword: r[3] !== 0, name: cstr(r, 11, 24),
          card: r.readUInt32LE(35), group: cstr(r, 40, 7), userId: cstr(r, 48, 24),
        });
      }
    }
    return users;
  }

  // users: the list from getUsers(), needed by old 8-byte records that only carry the internal uid.
  async getAttendance(users = []) {
    const sizes = await this.getSizes();
    if (!sizes.records) return [];
    const buf = await this.#readBuffer(CMD.ATTLOG_RRQ);
    if (buf.length < 4) return [];
    const total = buf.readUInt32LE(0), data = buf.subarray(4);
    const size = pickRecordSize(total, sizes.records, [8, 16, 40]);
    this.notes.push(`punches: ${sizes.records} reported, ${total} bytes, ${size}-byte records, first ${data.subarray(0, size).toString('hex')}`);
    const byUid = new Map(users.map((u) => [u.uid, u.userId]));
    const logs = [];
    for (let at = 0; at + size <= data.length; at += size) {
      const r = data.subarray(at, at + size);
      if (size === 8) {
        const uid = r.readUInt16LE(0);
        logs.push({ userId: byUid.get(uid) || String(uid), time: decodeTime(r, 3), verify: r[2], punch: r[7] });
      } else if (size === 16) {
        logs.push({ userId: String(r.readUInt32LE(0)), time: decodeTime(r, 4), verify: r[8], punch: r[9] });
      } else {
        logs.push({ userId: cstr(r, 2, 24) || String(r.readUInt16LE(0)), time: decodeTime(r, 27), verify: r[26], punch: r[31] });
      }
    }
    return logs;
  }

  async #handshake() {
    this.sessionId = 0;
    this.replyId = USHRT_MAX - 1;
    let res = await this.#command(CMD.CONNECT, EMPTY, this.connectTimeout);
    this.sessionId = res.sessionId;
    if (res.code === CMD.ACK_UNAUTH) {
      res = await this.#command(CMD.AUTH, makeCommKey(this.commKey, this.sessionId));
      if (res.code === CMD.ACK_UNAUTH) {
        throw new ZKError(this.commKey
          ? 'Comm Key is wrong. Use the Comm Key set on the machine (Menu > Comm > Comm Key)'
          : 'This machine has a Comm Key. Enter it in the machine settings here', 'AUTH');
      }
    }
    if (!res.ok) throw new ZKError(`Machine refused the connection (${codeName(res.code)})`);
  }

  // Bulk read (CMD_DATA_WRRQ): the machine either answers with the whole buffer, or with its size, which is then
  // fetched in blocks (64 KB over TCP, 16 KB over UDP).
  async #readBuffer(command, fct = 0, ext = 0) {
    const req = Buffer.alloc(11);
    req.writeInt8(1, 0);
    req.writeInt16LE(command, 1);
    req.writeInt32LE(fct, 3);
    req.writeInt32LE(ext, 7);
    const res = await this.#command(CMD.DATA_WRRQ, req);
    if (res.code === CMD.DATA) return res.data;
    if (res.code !== CMD.ACK_OK || res.data.length < 5) {
      throw new ZKError(`Machine refused the data request (${codeName(res.code)})`);
    }
    const size = res.data.readUInt32LE(1);
    const block = this.mode === 'tcp' ? 0xffc0 : 16 * 1024;
    const parts = [];
    for (let start = 0; start < size; start += block) parts.push(await this.#readBlock(start, Math.min(block, size - start)));
    await this.#command(CMD.FREE_DATA).catch(() => {});
    return Buffer.concat(parts);
  }

  async #readBlock(start, size) {
    const req = Buffer.alloc(8);
    req.writeInt32LE(start, 0);
    req.writeInt32LE(size, 4);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.#command(CMD.DATA_RDY, req);
      if (res.code === CMD.DATA) return res.data;
      if (res.code !== CMD.PREPARE_DATA) continue;
      const parts = [];
      for (;;) {
        const p = await this.#next();
        if (p.code === CMD.DATA) parts.push(p.data);
        else if (p.code === CMD.ACK_OK) return Buffer.concat(parts);
        else break;
      }
    }
    throw new ZKError(`Could not read data block at byte ${start} from the machine`);
  }

  async #command(command, data = EMPTY, timeout = this.timeout) {
    if (!this.link) throw new ZKError('Not connected', 'CLOSED');
    this.inbox.length = 0;
    this.link.send(buildPacket(command, this.sessionId, this.replyId, data));
    const res = await this.#next(timeout);
    this.replyId = res.replyId;
    return res;
  }

  #next(timeout = this.timeout) {
    if (this.inbox.length) return Promise.resolve(this.inbox.shift());
    if (this.linkError) return Promise.reject(this.linkError);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new ZKError(`No answer from ${this.host}:${this.port} over ${this.mode.toUpperCase()}`, 'TIMEOUT', 'no answer'));
      }, timeout);
      this.waiter = {
        resolve: (p) => { clearTimeout(timer); resolve(p); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
    });
  }

  #receive(raw) {
    if (raw.length < 8) return;
    const code = raw.readUInt16LE(0);
    if (code === CMD.REG_EVENT) return;
    const packet = {
      code, sessionId: raw.readUInt16LE(4), replyId: raw.readUInt16LE(6), data: raw.subarray(8),
      ok: code === CMD.ACK_OK || code === CMD.PREPARE_DATA || code === CMD.DATA,
    };
    const waiter = this.waiter;
    if (waiter) { this.waiter = null; waiter.resolve(packet); } else this.inbox.push(packet);
  }

  #fail(err) {
    if (this.linkError) return;
    this.linkError = err;
    const waiter = this.waiter;
    if (waiter) { this.waiter = null; waiter.reject(err); }
  }

  // Events from a socket that has been replaced (e.g. the late 'close' of a TCP attempt before the UDP fallback) are ignored.
  #newLink() {
    this.linkError = null;
    const generation = ++this.generation;
    return {
      receive: (raw) => { if (generation === this.generation) this.#receive(raw); },
      fail: (err) => { if (generation === this.generation) this.#fail(err); },
    };
  }

  #closeLink() {
    this.generation++;
    const link = this.link;
    this.link = null;
    this.inbox.length = 0;
    this.waiter = null;
    if (link) link.close();
  }

  #openTcp() {
    const events = this.#newLink();
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new ZKError(`No answer from ${this.host}:${this.port} (TCP)`, 'NETWORK', 'no answer'));
      }, this.connectTimeout);
      sock.once('connect', () => { clearTimeout(timer); sock.setNoDelay(true); resolve(); });
      sock.on('error', (err) => {
        clearTimeout(timer);
        const e = networkError(err, this.host, this.port, 'tcp');
        reject(e);
        events.fail(e);
      });
      sock.on('close', () => events.fail(new ZKError('Machine closed the connection', 'CLOSED')));

      // TCP is a byte stream: collect bytes until a whole [magic | length | packet] frame is available.
      let chunks = [], have = 0, need = 8;
      sock.on('data', (chunk) => {
        chunks.push(chunk);
        have += chunk.length;
        if (have < need) return;
        let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, have);
        need = 8;
        while (buf.length >= 8) {
          if (buf.compare(TCP_MAGIC, 0, 4, 0, 4) !== 0) {
            const at = buf.indexOf(TCP_MAGIC, 1);
            buf = at < 0 ? buf.subarray(buf.length - 3) : buf.subarray(at);
            continue;
          }
          const length = buf.readUInt32LE(4);
          if (buf.length < 8 + length) { need = 8 + length; break; }
          const packet = buf.subarray(8, 8 + length);
          buf = buf.subarray(8 + length);
          events.receive(packet);
        }
        chunks = buf.length ? [buf] : [];
        have = buf.length;
      });
      this.link = { send: (p) => sock.write(tcpFrame(p)), close: () => sock.destroy() };
    });
  }

  #openUdp() {
    const events = this.#newLink();
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      sock.on('message', (msg) => events.receive(msg));
      sock.on('error', (err) => {
        const e = networkError(err, this.host, this.port, 'udp');
        reject(e);
        events.fail(e);
      });
      sock.connect(this.port, this.host, (err) => (err ? reject(networkError(err, this.host, this.port, 'udp')) : resolve()));
      this.link = { send: (p) => sock.send(p), close: () => { try { sock.close(); } catch { /* already closed */ } } };
    });
  }
}
