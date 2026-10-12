// Protocol self-test against simulated machines:  node tools/zk-test.mjs
import assert from 'node:assert/strict';
import { ZKClient, encodeTime, decodeTime } from '../lib/zk.mjs';
import { startSimulator } from './zk-sim.mjs';

const fmt = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

{
  const d = new Date(2026, 9, 5, 18, 4, 59);
  const b = Buffer.alloc(4);
  b.writeUInt32LE(encodeTime(d), 0);
  assert.equal(decodeTime(b), '2026-10-05 18:04:59');
}

const cases = [
  { name: 'TCP, 72-byte users, 40-byte logs, chunked + fragmented', port: 14380, udp: false, users: 150, days: 45 },
  { name: 'TCP, machine sends blocks as one DATA packet', port: 14381, udp: false, users: 60, directData: true },
  { name: 'UDP only (old firmware), 28-byte users, 16-byte logs', port: 14382, tcp: false, users: 80, userSize: 28, logSize: 16, protocol: 'auto' },
  { name: 'UDP, 28-byte users, 8-byte logs, comm key 1234', port: 14383, tcp: false, users: 40, userSize: 28, logSize: 8, commKey: 1234, clientKey: 1234 },
  { name: 'TCP, comm key 987654', port: 14384, udp: false, users: 30, commKey: 987654, clientKey: 987654, protocol: 'tcp' },
  { name: 'Punch arriving during the download', port: 14385, udp: false, users: 30, punchDuringRead: true },
  { name: 'Small machine (data fits in one reply)', port: 14386, users: 3, days: 2 },
];

let failed = 0;
for (const c of cases) {
  const sim = startSimulator(c);
  await new Promise((r) => setTimeout(r, 50));
  const started = Date.now();
  const zk = new ZKClient({ host: '127.0.0.1', port: c.port, protocol: c.protocol || 'auto', commKey: c.clientKey || 0, timeout: 4000, connectTimeout: 1500 });
  try {
    await zk.connect();
    const info = await zk.getInfo();
    const users = await zk.getUsers();
    const logs = await zk.getAttendance(users);
    await zk.disconnect();

    assert.equal(info.serialNumber, sim.options.serial);
    assert.equal(info.users, sim.data.users.length);
    assert.equal(users.length, sim.data.users.length);
    for (const [i, u] of users.entries()) {
      const want = sim.data.users[i];
      assert.equal(u.userId, want.userId);
      assert.equal(u.name, want.name.slice(0, c.userSize === 28 ? 8 : 23).trim());
      assert.equal(u.privilege, want.privilege);
      assert.equal(u.card, want.card);
    }
    const expected = sim.data.logs.length + (c.punchDuringRead ? 1 : 0);
    assert.equal(logs.length, expected);
    for (const [i, l] of sim.data.logs.entries()) {
      assert.equal(logs[i].userId, l.user.userId);
      assert.equal(logs[i].time, fmt(l.time));
      assert.equal(logs[i].punch, l.punch);
      assert.equal(logs[i].verify, l.verify);
    }
    assert.equal(sim.stats.badChecksum, 0, 'checksums');
    assert.equal(sim.stats.badSession, 0, 'session ids');
    console.log(`PASS  ${c.name}: ${zk.mode.toUpperCase()}, ${users.length} users, ${logs.length} punches, ${Date.now() - started} ms`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${c.name}: ${err.stack}`);
  } finally {
    await zk.disconnect();
    await sim.close();
  }
}

// Wrong comm key must give a clear message, unreachable machine must fail fast.
{
  const sim = startSimulator({ port: 14387, commKey: 555 });
  await new Promise((r) => setTimeout(r, 50));
  const zk = new ZKClient({ host: '127.0.0.1', port: 14387, commKey: 0, timeout: 2000 });
  await assert.rejects(zk.connect(), (e) => e.code === 'AUTH' && /Comm Key/.test(e.message));
  await sim.close();
  console.log('PASS  wrong comm key is reported');
}
{
  const zk = new ZKClient({ host: '127.0.0.1', port: 14399, timeout: 1500, connectTimeout: 1500 });
  const t = Date.now();
  await assert.rejects(zk.connect(), (e) => { console.log(`PASS  nothing listening -> "${e.message}" after ${Date.now() - t} ms`); return true; });
}

if (failed) { console.log(`${failed} case(s) failed`); process.exit(1); }
console.log('All protocol tests passed');
