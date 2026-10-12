# Payroll Workspace – PostgreSQL database gateway

The app keeps its Cloudflare D1 (SQLite) / R2 calls. When two settings are present it sends them here instead, and this
small Node.js service stores everything in **PostgreSQL**:

```
Browser -> Payroll Workspace (app) -> db-gateway (Node, 127.0.0.1:5790) -> PostgreSQL
```

Without the settings the app works exactly as before (local SQLite). Nothing else changes.

## 1. Set up PostgreSQL (once, on the server)

```sql
CREATE USER payroll WITH PASSWORD '<long password>';
CREATE DATABASE payroll OWNER payroll;
```

## 2. Run the gateway

```
cd db-gateway
npm install --omit=dev
set DATABASE_URL=postgres://payroll:<password>@127.0.0.1:5432/payroll
set GATEWAY_SECRET=<16+ random characters>
node server.mjs
```

It creates all tables itself (`schema.sql`, safe to run again). Keep `HOST` at the default `127.0.0.1` – only the app on
the same server should reach it. Run it as a service (pm2 / systemd / Windows service) so it starts with the server.

## 3. Tell the app to use it

Set these two variables for the app process (wrangler `--var`, `.dev.vars`, or the Cloudflare/Worker environment):

```
DB_GATEWAY_URL=http://127.0.0.1:5790
DB_GATEWAY_SECRET=<the same secret>
```

## 4. Move the existing data (once)

Stop the old app, then:

```
set DATABASE_URL=postgres://payroll:<password>@127.0.0.1:5432/payroll
node migrate-from-sqlite.mjs "%LOCALAPPDATA%\PayrollWorkspace\state"
```

Do the same for `editable-state` if you also want that workspace (use a separate database/schema for it, or a different
`DATABASE_URL`, because both workspaces use the same table names). The old SQLite files are only read, never changed.

## 5. Backups

`pg_dump -Fc payroll > payroll_YYYYMMDD.dump` every night (task scheduler / cron), and keep copies off the server.
Restore with `pg_restore -d payroll --clean payroll_YYYYMMDD.dump`. Never open PostgreSQL's port to the internet.

## Tests

```
npm install
node test/run.mjs            # SQL translation + the app's real statements, on PostgreSQL (PGlite), through the gateway
node test/migrate-test.mjs   # SQLite -> PostgreSQL copy
node test/client-test.mjs    # the app-side adapter, including a connection that dies after the gateway wrote
node test/scan-app-sql.mjs   # every SQL string in payroll-web is prepared by PostgreSQL (needs ..\payroll-web)
```

`DATABASE_URL=pglite:<folder>` starts the gateway on PGlite (PostgreSQL inside Node.js, no server needed). Use it to try
things out only; production uses a real PostgreSQL server.

## What the gateway does

* Translates the app's SQLite SQL on the fly (`json_extract`, `json_each`, `json_set`, `instr`, `COLLATE NOCASE`, `LIKE`, `?` -> `$n`).
* `batch` = one transaction, so the HR "write guard" (CHECK failure) undoes the whole batch like D1 does. Batches also take
  turns on one advisory lock, because SQLite never ran two write batches at once and the guard (check a revision, then
  write) relies on that.
* Files (source archive, photos, HR documents, month indexes) live in the `objects` table instead of R2.
* PostgreSQL errors are reworded the SQLite way (`UNIQUE constraint failed: ...`) so the app's own checks keep working.
* Every call needs `Authorization: Bearer <GATEWAY_SECRET>`.
* A write sent again with the same `x-request-id` (the app does this when a connection drops) is answered from the first run
  and written only once. Idle connections stay open for 5 minutes on the gateway side.
* Text columns use the `"C"` collation, so sorting is bytewise like SQLite whatever the server's locale is.

## What was checked (2026-10-12, with a copy of the real data)

* The real database was copied to PostgreSQL (20,207 employees, 170,363 attendance months, 159,581 salaries, 7,008 files):
  every table matched row for row (SHA-256 of all rows).
* The same build of the app was run twice, on a copy of the SQLite data and on PostgreSQL, and 749 read requests (all
  employee, attendance, salary, register, HR, report, master and original-source endpoints for 8 datasets) were compared:
  identical, apart from rows that the app returns in no fixed order.
* About 190 write requests were sent to both (employees, holidays, attendance, masters, HR users and every HR workflow,
  salaries, salary sheets, biometric settings, images, HR documents): same results, same errors.
* Fresh imports of real packages (om_03_26, om_01_13 and om_01_26, 82 MB) into both: same counts, same content.
* Not yet done: a run against a real PostgreSQL server (the checks used PGlite, which is PostgreSQL itself) and a test
  with several people working at the same time.
