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
```

## What the gateway does

* Translates the app's SQLite SQL on the fly (`json_extract`, `json_each`, `json_set`, `instr`, `COLLATE NOCASE`, `LIKE`, `?` -> `$n`).
* `batch` = one transaction, so the HR "write guard" (CHECK failure) undoes the whole batch like D1 does.
* Files (source archive, photos, HR documents, month indexes) live in the `objects` table instead of R2.
* PostgreSQL errors are reworded the SQLite way (`UNIQUE constraint failed: ...`) so the app's own checks keep working.
* Every call needs `Authorization: Bearer <GATEWAY_SECRET>`.
