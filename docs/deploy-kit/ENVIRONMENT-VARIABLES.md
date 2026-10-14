# Environment variables and configuration files

Everything the software reads from its environment on a server. **All secrets are created by you on your server**; the example files in
`env/` contain only `CHANGE_ME` placeholders.

## 1. Variables you must set

| Variable | Read by | Required | Example | Meaning |
|---|---|---|---|---|
| `DATABASE_URL` | database gateway | yes | `postgres://payroll:<password>@127.0.0.1:5432/payroll` | PostgreSQL connection. Use a password of letters and digits (`openssl rand -hex 24`); other characters (`@ : / # ?`) must be URL-encoded. |
| `GATEWAY_SECRET` | database gateway | yes | 64 hex characters | Shared secret between the app and the gateway. At least 16 characters (the gateway refuses to start otherwise); use 32 or more: `openssl rand -hex 32`. |
| `PORT` | database gateway | no | `5790` (default) | Port of the gateway. |
| `HOST` | database gateway | no | `127.0.0.1` (default) | Address the gateway listens on. Keep it on the loopback address: only the app may reach it. |
| `DB_GATEWAY_URL` | web application | yes | `http://127.0.0.1:5790` | Where the gateway is. With `DB_GATEWAY_URL` and `DB_GATEWAY_SECRET` set, the application stores everything in PostgreSQL. |
| `DB_GATEWAY_SECRET` | web application | yes | the same value as `GATEWAY_SECRET` | If the two differ, the gateway refuses every call and the screens cannot load or save any data. |
| `NODE_ENV` | web application | recommended | `production` | Standard Node.js setting. |
| web port | web application | yes | `-p 3000` (command line) or `PORT=3000` | Port of the application (the unit file uses `-p 3000 -H 127.0.0.1`). |

| `PAYROLL_INTERNAL_KEY` | web application | no | 48 hex characters | Secret shared with the sign-in layer: with it (header `x-payroll-internal`) the layer may write sign-ins / sign-outs of any login to the activity log (`POST /api/activity`, see the guide, section 4.6). Without it those entries are not written; nothing else changes. Create it with `openssl rand -hex 24`; keep it out of the browser. |

That is the complete list: the application itself reads no other variable, and there is no API key, e-mail or payment setting.

## 2. Variables of other programs (only if you use them)

| Variable | Program | Meaning |
|---|---|---|
| `DATABASE_URL` | `db-gateway/migrate-from-sqlite.mjs` | Same format as above; used once to copy the old Windows data (the script also takes the Windows state folder as its argument). |
| `TEST_DATABASE_URL` | `db-gateway` tests | A test database whose name contains "test" (it is emptied). Never point it at the live database. |
| `PORT`, `HOST`, `BIOMETRIC_DATA` (or `--port`, `--host`, `--data=`, `--no-auto`) | `biometric-web` | Port (default 5180), address (default 127.0.0.1) and data folder of the attendance-machine reader, and `--no-auto` to skip the automatic punch download. Only needed if the reader runs on the server (see the guide, section 9). |

Not needed on a server: the Cloudflare bindings `DB` and `BUCKET`, wrangler settings, and the variables of the Windows launcher.

## 3. Configuration files

| File (on the server) | Template in this kit | Holds | Rights |
|---|---|---|---|
| `/etc/payroll/gateway.env` | `env/gateway.env.example` | database password and `GATEWAY_SECRET` | `root:payroll`, mode 640 |
| `/etc/payroll/app.env` | `env/app.env.example` | `DB_GATEWAY_URL`, `DB_GATEWAY_SECRET` | `root:payroll`, mode 640 |
| `/etc/systemd/system/payroll-gateway.service` | `systemd/payroll-gateway.service` | how the gateway is started and restarted | root |
| `/etc/systemd/system/payroll-app.service` | `systemd/payroll-app.service` | how the web application is started and restarted | root |
| Plesk > subdomain > Apache & nginx Settings | `nginx/plesk-additional-nginx-directives.conf` | proxy from HTTPS to the application, upload size, timeouts | Plesk |
| `~payroll/.pgpass` | one line, see `backup/backup-payroll.sh` | database password for the backup job | `payroll`, mode 600 |
| crontab of `payroll` | `backup/crontab.example` | nightly backup | `payroll` |
| `pg_hba.conf` of PostgreSQL | note in `postgresql/create-database.sql` | allows password login from 127.0.0.1 | PostgreSQL |
| `payroll-web/.openai/hosting.json` | (in the repository) | binding names needed by the build; do not edit | - |
| `db-gateway/schema.sql` | (in the repository) | the database tables; the gateway applies it at every start; do not edit | - |

## 4. Changing a secret

* **`GATEWAY_SECRET`:** put the new value in both `/etc/payroll/gateway.env` (`GATEWAY_SECRET`) and `/etc/payroll/app.env` (`DB_GATEWAY_SECRET`), then
  `sudo systemctl restart payroll-gateway payroll-app`.
* **Database password:** `sudo -u postgres psql -c "ALTER USER payroll WITH PASSWORD '<new>'"`, then update `DATABASE_URL` in `gateway.env` and the line in `~payroll/.pgpass`, then `sudo systemctl restart payroll-gateway`.
* After a suspected leak change both, and check who can read `/etc/payroll`.
