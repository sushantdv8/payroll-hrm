// Payroll Workspace PostgreSQL gateway.
//   DATABASE_URL     postgres://user:password@host:5432/dbname      (required)
//   GATEWAY_SECRET   a long random text; the workspace sends it with every call   (required, 16+ characters)
//   PORT             default 5790         HOST   default 127.0.0.1 (keep it on the server itself)
// Creates the tables on start (schema.sql, safe to run again).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './lib/gateway.mjs';
import { pgDriver } from './lib/drivers.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
const secret = process.env.GATEWAY_SECRET;
const port = Number(process.env.PORT || 5790);
const host = process.env.HOST || '127.0.0.1';
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
if (!secret || secret.length < 16) { console.error('GATEWAY_SECRET is not set (use at least 16 random characters).'); process.exit(1); }

const driver = await pgDriver(url);
await driver.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const handle = createGateway({ driver, secret });
const server = http.createServer((req, res) => { void handle(req, res); });
server.listen(port, host, () => console.log(`Payroll database gateway on http://${host}:${port} (PostgreSQL ready)`));
const stop = () => server.close(() => driver.close().then(() => process.exit(0)));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
