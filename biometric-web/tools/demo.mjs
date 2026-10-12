// Demo without hardware: two simulated machines plus the app on port 5181 with its own data folder.
//   node --no-warnings tools/demo.mjs
import os from 'node:os';
import path from 'node:path';
import { startSimulator } from './zk-sim.mjs';

const PORT = 5181;
const data = path.join(os.tmpdir(), 'biometric-web-demo');
startSimulator({ port: 14370, users: 150, days: 50, seed: 11, serial: 'CGXK204960017' });
startSimulator({ port: 14371, tcp: false, users: 60, userSize: 28, logSize: 16, days: 50, seed: 23, serial: 'OIN7030057061201' });

process.argv.push(`--port=${PORT}`, `--data=${data}`, '--no-auto');
await import('../server.mjs');

const base = `http://127.0.0.1:${PORT}/api`;
const { devices } = await (await fetch(`${base}/state`)).json();
for (const d of [
  { name: 'SIM Gate (TCP)', ip: '127.0.0.1', port: 14370, protocol: 'auto' },
  { name: 'SIM Old (UDP)', ip: '127.0.0.1', port: 14371, protocol: 'auto' },
]) {
  if (!devices.some((x) => x.port === d.port && x.ip === d.ip)) {
    await fetch(`${base}/devices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
  }
}
console.log('Demo machines: SIM Gate (TCP) on 127.0.0.1:14370, SIM Old (UDP) on 127.0.0.1:14371');
