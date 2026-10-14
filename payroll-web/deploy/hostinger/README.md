# Payroll Workspace on a Node.js web-app hosting (LiteSpeed "lsnode", e.g. Hostinger Business "Web Apps")

For a hosting that starts one Node.js process per app and has no PostgreSQL. Everything runs in that one process:

```
browser --HTTPS--> hosting (CDN, LiteSpeed) --> sign-in layer --unix socket--> the application --unix socket--> database gateway --> PGlite
```

* **PGlite** is PostgreSQL running inside Node.js (data in a folder, default `~/payroll-data/pg`). The gateway code is the same as `db-gateway/` (a copy is in `gateway/`; keep it in step: `fc` / `diff` it against `db-gateway/lib` and `db-gateway/schema.sql`).
* The application's request handler is taken from vinext's production server and served on a unix socket; its calls to the database (`fetch` to `http://gateway.local`) are routed to the gateway's socket.
* The sign-in layer (`../signin-layer`) is the only thing the hosting can reach. See its README for what it checks.
* Why sockets: the hosting wraps `listen()` (the app gets one socket) and does not let processes reach each other over TCP on 127.0.0.1; unix sockets work. This was tested on Hostinger (probe app, October 2026).

## Settings of the web app (hPanel > Web Apps)

| Setting | Value |
|---|---|
| Source | GitHub: `https://github.com/sushantdv8/payroll-hrm` (public repository), branch `main` |
| Root directory | `payroll-web` |
| Framework preset | Other |
| Node version | 24.x |
| Package manager | npm |
| Build command | `npm run build` |
| Entry file | `deploy/hostinger/server.js` |
| Environment variables | `PUBLIC_ORIGIN` = `https://<the address people type>` and `ADMIN_PASSWORD_HASH` = the output of `node deploy/signin-layer/make-admin-hash.mjs` (you type the Super Admin password; only its hash is printed). Optional: `PAYROLL_DATA_DIR` |

Until both variables are set the app answers "not configured". Never put the password itself in a variable.

## The data

The database folder lives outside the folder that every deploy replaces (`~/payroll-data/pg`, `~` = the web app's home). To fill it from the Windows edition:

1. On the PC, with the Windows app stopped: `node installer/snapshot-state.cjs <...\PayrollWorkspace\editable-state> <empty folder>` (a consistent read-only copy).
2. `DATABASE_URL=pglite:<new folder> node db-gateway/migrate-from-sqlite.mjs <the snapshot folder>` (needs `db-gateway` packages; creates the PGlite folder; about 20,000 employees, 1.1 GB of SQLite).
3. Pack the PGlite folder and upload it (SFTP/SSH) to `~/payroll-data/pg` of the web app **before** the first start, with the app stopped. The same PGlite version (0.5.9, in `package.json`) must read it.

Only one copy of the app may use the folder: `~/payroll-data/pg.lock` holds the pid and a new copy waits for the old one to stop. **Back up the folder** (copy it while the app is stopped, or use the hosting's backups) - there is no `pg_dump` here.

## What was measured on the hosting (so the limits are known)

* Node 24.21, 48 shared CPUs, no memory limit visible (1.5 GB could be allocated); disk 50 GB per plan, 600k inodes, 5 web apps.
* **A request longer than about 55 seconds is cut by the CDN with 504** (the process goes on). The Windows edition and a VPS allow 300 s. Very heavy reports / imports may hit this.
* LiteSpeed's `LSAPI_MAX_PROCESS_TIME` is 120 s per request; the app is recreated by every deploy and may be recycled by the hosting: **everybody is signed out then** (sessions are in memory).
* PGlite: opening an empty database 3.8 s, 200 point reads 0.14 s, a 1.6 MB answer 8 ms, reopening a 95 MB database 0.2 s; about 500 MB of memory.
* The client address is `X-Real-IP` (set by the hosting, a browser cannot forge it); the layer uses it for its sign-in limits.
* Uploads of 10 / 30 / 110 MB passed (the application needs 25 MB at most).

## Security notes

* A shared hosting account runs all its websites under one user: other sites of the account (for example WordPress) can reach these files. Payroll data of this size belongs on a server of its own (a VPS: `docs/deploy-kit/install-ubuntu.sh`).
* The layer marks every response that the application does not mark as cacheable with `Cache-Control: no-store` (and `X-LiteSpeed-Cache-Control: no-cache`), so neither the CDN nor LiteSpeed's cache keeps anything of a signed-in user.
* Rate limits, session cookies and the header rules are the ones of `../signin-layer`.
