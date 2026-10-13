# Payroll Workspace – PostgreSQL database gateway

The app keeps its Cloudflare D1 (SQLite) / R2 calls. When two settings are present it sends them here instead, and this
small Node.js service stores everything in **PostgreSQL**:

```
Browser -> sign-in layer -> Payroll Workspace (app) -> db-gateway (Node, 127.0.0.1:5790) -> PostgreSQL
```

Without the settings the app works exactly as before (local SQLite). Nothing else changes.

## 1. Set up PostgreSQL (once, on the server)

```sql
CREATE USER payroll WITH PASSWORD '<long password>';
CREATE DATABASE payroll OWNER payroll;
```

(Any encoding/locale is fine: the text columns use the `"C"` collation, so sorting is the same as in the old SQLite files.)

## 2. Run the gateway

```
cd db-gateway
npm install --omit=dev
set DATABASE_URL=postgres://payroll:<password>@127.0.0.1:5432/payroll
set GATEWAY_SECRET=<16+ random characters>
node server.mjs
```

On Linux use `export` instead of `set`. It creates all tables itself (`schema.sql`, safe to run again) and waits up to a
minute for PostgreSQL after a reboot. Keep `HOST` at the default `127.0.0.1` – only the app on the same server should reach
it. Run it as a service (systemd / pm2 / Windows service) so it starts with the server.

## 3. Run the app on it

Two settings tell the app to use the gateway:

```
DB_GATEWAY_URL=http://127.0.0.1:5790
DB_GATEWAY_SECRET=<the same secret>
```

**On Node.js (recommended for a server).** The built app runs on plain Node.js, without Cloudflare's workerd / wrangler:

```
cd payroll-web
npm ci
npm run build
set DB_GATEWAY_URL=http://127.0.0.1:5790
set DB_GATEWAY_SECRET=<the same secret>
npm run start:node -- -p 3000
```

(`deploy/node-runner` makes the app's `cloudflare:workers` import read the two variables above.) In the measurements below
this was about twice as fast as the wrangler runner on big requests, several times faster under a mixed load, and needed far
less memory (about 100 MB when idle and a few hundred MB under heavy requests, against 400-950 MB that stays allocated).

**With wrangler** (what the Windows edition uses): add `--var DB_GATEWAY_URL:... --var DB_GATEWAY_SECRET:...` to the
`wrangler dev` command, or put them in `.dev.vars`.

**Sign-in.** The app trusts the `oai-authenticated-user-*` headers that the sign-in layer (`installer/launcher.mjs`) adds after a
successful login; without them every request is refused (401/404). On a server this layer has to sit in front of the app,
and the app itself must only be reachable from it (bind it to `127.0.0.1`).

## 4. Move the existing data (once)

Stop the old app, then:

```
set DATABASE_URL=postgres://payroll:<password>@127.0.0.1:5432/payroll
node migrate-from-sqlite.mjs "%LOCALAPPDATA%\PayrollWorkspace\state"
```

About 5 minutes for 20,000 employees / 170,000 attendance months / 7,000 files (a 1.2 GB SQLite file became a 0.6 GB PostgreSQL
database). Do the same for `editable-state` if you also want that workspace, but into a separate database (both workspaces use
the same table names). The old SQLite files are only read, never changed.

## 5. Backups

```
pg_dump -Fc payroll > payroll_YYYYMMDD.dump          (94 s, 240 MB for the data above)
pg_restore -d payroll_new --no-owner payroll_YYYYMMDD.dump   (71 s)
```

Run the dump every night (task scheduler / cron) and keep copies off the server; try a restore into an empty database now and
then. Never open PostgreSQL's port to the internet.

## Notes

* Tested on PostgreSQL 17.11. Nothing newer than PostgreSQL 9.5 features is used, so older supported versions should work.
* Each refused save (someone else changed the record first) shows up as an `ERROR ... hr_write_guard ... check constraint` line
  in PostgreSQL's log. That is how the app's write guard says "reload and try again"; it is not a fault.
* If PostgreSQL restarts while people work, requests fail for a couple of seconds and then continue by themselves.
* Importing a big company (82 MB package) takes about 2 minutes.

## Tests

```
npm install
node test/run.mjs            # SQL translation + the app's real statements, through the gateway
node test/migrate-test.mjs   # SQLite -> PostgreSQL copy
node test/client-test.mjs    # the app-side adapter, including a connection that dies after the gateway wrote
node test/scan-app-sql.mjs   # every SQL string in payroll-web is prepared by PostgreSQL (needs ..\payroll-web)
node test/lock-test.mjs      # 20 people save the same record at once (needs a real PostgreSQL server)
```

They run on PGlite (PostgreSQL inside Node.js, no server needed) unless `TEST_DATABASE_URL` points to a real server, for
example `postgres://payroll:<password>@127.0.0.1:5432/payroll_test`; that database is emptied first, so its name must contain
"test". `DATABASE_URL=pglite:<folder>` starts the gateway itself on PGlite: for trying things out only.

## What the gateway does

* Translates the app's SQLite SQL on the fly (`json_extract`, `json_each`, `json_set`, `instr`, `COLLATE NOCASE`, `LIKE`, `?` -> `$n`).
* `batch` = one transaction, so the HR "write guard" (CHECK failure) undoes the whole batch like D1 does. Batches also take
  turns on one advisory lock, because SQLite never ran two write batches at once and the guard (check a revision, then
  write) relies on that. Without it, two people saving the same record at the same moment can both be told "saved" (shown by
  `test/lock-test.mjs`).
* Files (source archive, photos, HR documents, month indexes) live in the `objects` table instead of R2.
* PostgreSQL errors are reworded the SQLite way (`UNIQUE constraint failed: ...`) so the app's own checks keep working.
* Every call needs `Authorization: Bearer <GATEWAY_SECRET>`.
* A write sent again with the same `x-request-id` (the app does this when a connection drops) is answered from the first run
  and written only once. Idle connections stay open for 5 minutes on the gateway side.
* Text columns use the `"C"` collation, so sorting is bytewise like SQLite whatever the server's locale is.
* A lost or restarted PostgreSQL connection does not stop the gateway; a new one is opened when needed.

## What was checked (2026-10-12/13, with a copy of the real data)

On PGlite first, then again on a real **PostgreSQL 17.11** server (official EnterpriseDB Windows binaries):

* The real database was copied to PostgreSQL (20,207 employees, 170,363 attendance months, 159,581 salaries, 7,008 files):
  every table matched row for row (SHA-256 of all rows), and so did a `pg_dump` / `pg_restore` copy of it.
* The same build of the app was run twice, on a copy of the SQLite data and on PostgreSQL (wrangler runner, and again on the
  Node.js runner), and 749 / 447 read requests (employee, attendance, salary, register, HR, report, master and original-source
  endpoints for up to 8 datasets) were compared: identical, apart from rows the app returns in no fixed order.
* About 190 write requests were sent to both (employees, holidays, attendance, masters, HR users and every HR workflow,
  salaries, salary sheets, biometric settings, images, HR documents): same results, same errors, on both runners.
* Fresh imports of real packages (om_03_26, om_01_13 and om_01_26, 82 MB) into both: same counts, same content.
* 20 people at once on the same attendance month, salary, employee, HR record, loan approval or settings: exactly one wins and
  the other 19 are told to reload, as with SQLite; 20 people on different records all succeed. A 30 s mixed load of 20 readers
  and 5 writers ran without errors (Node.js runner on PostgreSQL: 3,500 reads and 630 writes, 95% under 0.3 s; the SQLite/wrangler
  edition managed 900 reads and 210 writes, 95% under 0.85 s).
* PostgreSQL restarted while the app was in use: 2 seconds of errors, then normal; the gateway kept running.
* A fresh `git clone` of the repository builds (`npm run build`) and serves the data from PostgreSQL.

Not checked: a long run with many real users on a small machine (on an 8 GB PC the wrangler runner once stopped during a
long, heavy test session and could not be made to repeat), and the sign-in layer on a server.
