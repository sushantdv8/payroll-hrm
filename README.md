# Payroll Workspace (HRM / Payroll / Time Office)

Web application for employee records, attendance, salary sheets, PF/ESIC forms, HR modules and biometric punches
(KISHOR EXPORT). This repository contains **source code only**: no employee or salary data, no backups, no passwords.

## Parts

| Folder | What it is |
|---|---|
| `payroll-web/` | The application. TypeScript, React 19, vinext (Vite-based Next.js), runs on the Cloudflare Workers runtime (wrangler/workerd). Database layer: Drizzle + Cloudflare D1 (SQLite), files in an R2-style bucket. |
| `db-gateway/` | Optional PostgreSQL support. A small Node.js service that sits between the app and PostgreSQL. See `db-gateway/README.md`. |
| `installer/` | Windows desktop edition: launcher (login page with Session and Company, one window per login), setup builder (`build-setup.ps1`), installer scripts. |
| `biometric-web/` | Zero-dependency Node.js app that talks to eSSL/ZKTeco machines (TCP/UDP 4370) and feeds punches to the app. |
| `Start Payroll.cmd`, `Stop Payroll.*` | Convenience scripts for the Windows edition. |

## Requirements

* Node.js 24 or newer (`node:sqlite` is used by the tools)
* PostgreSQL 14+ (only for the server/PostgreSQL setup)

## Run the app (development)

```
cd payroll-web
npm install
npm run dev          # development server
npm run build        # production build into dist/
npm start            # runs the build locally on 127.0.0.1 with wrangler (local SQLite in .wrangler/state)
```

Tests: `npm run test:salary-sheets`, `npm run test:salary-months`.

## Run on a server with PostgreSQL

1. Create the database and run the gateway (`db-gateway/README.md`, steps 1-2). It needs `DATABASE_URL` and `GATEWAY_SECRET`.
2. Give the app these two variables (wrangler `--var`, `.dev.vars` or the Worker environment):
   `DB_GATEWAY_URL=http://127.0.0.1:5790` and `DB_GATEWAY_SECRET=<same secret>`.
   Without them the app keeps using local SQLite/R2 as before.
3. Move existing data once with `db-gateway/migrate-from-sqlite.mjs`.
4. Put a reverse proxy (nginx / Plesk) with HTTPS in front of the app. Keep the gateway and PostgreSQL on `127.0.0.1`.
5. Nightly `pg_dump` backups, copied off the server.

Gateway tests: `cd db-gateway && npm install && node test/run.mjs && node test/migrate-test.mjs`.

## Secrets and files that are NOT in this repository

Provided separately by the owner (never by chat or email in plain text):

* The database (employee, attendance, salary data) and any `.bak` backups
* `installer/login-gate.mjs`: hashes of the login IDs and passwords used by the Windows launcher. The launcher imports it, so the
  Windows setup cannot be built without it. It exports `LOGIN_ID_HASH`, `loginMode` and `loginHash`.
* `.env` / `.dev.vars`, `GATEWAY_SECRET`, `DATABASE_URL`

## Data layout (for reference)

Datasets are keyed `om_CC_YY`: `CC` = company group (01 Kishor Export, 02, 03), `YY` = year. The login page chooses
Session (year) and Company; the app then works only inside that dataset. Per-login windows are isolated by cookie.
