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
| Environment variables | `PUBLIC_ORIGIN` = `https://<the address people type>` and `ADMIN_PASSWORD_HASH` = the output of `node deploy/signin-layer/make-admin-hash.mjs` (you type the Super Admin password; only its hash is printed; on Windows / macOS add `--clipboard` to get the hash into the clipboard without showing it, then paste it into the variable). Optional: `PAYROLL_DATA_DIR` |

Until both variables are set the app answers "not configured". Never put the password itself in a variable.

**Settings file.** The same names can be kept in a file of `KEY=VALUE` lines, `<PAYROLL_DATA_DIR>/app.env` (or the file named by `PAYROLL_ENV_FILE`); real environment variables win over it. Keep it private (`chmod 600`; `make-admin-hash.mjs --write-to <file>` creates it that way). The log (`console.log` of the app) says which file was read.

## By hand over SSH (a normal website of the plan, no Web App wizard)

Hostinger's wizard creates the website of the domain as soon as the domain step is accepted; if it is then left, that site cannot be chosen again ("Domain connected to site") and the file-upload step says "Failed to prepare service". The sites are run by LiteSpeed with the same Passenger-style lines that the Web Apps get, so the app can be set up by hand on such a site (done on a subdomain of a Business plan, October 2026):

1. SSH key in hPanel (Advanced > SSH Access), then `ssh -p 65002 <user>@<server>`. Node.js and npm of the hosting: `/opt/alt/alt-nodejs24/root/bin` (add it to `PATH`).
2. Unpack the code (a ZIP of `payroll-web`, `git archive --format=zip -o payroll-app.zip HEAD:payroll-web`) into `~/domains/<site>/app`, then there: `npm ci` and `RAYON_NUM_THREADS=2 TOKIO_WORKER_THREADS=2 npm run build` (about 15 s; the account may start only a few threads - without the limits the bundler stops with "Resource temporarily unavailable").
3. `~/domains/<site>/public_html/.htaccess` (the app folder stays outside `public_html`):

```
PassengerAppRoot /home/<user>/domains/<site>/app
PassengerAppType node
PassengerNodejs /opt/alt/alt-nodejs24/root/bin/node
PassengerStartupFile deploy/hostinger/server.js
PassengerBaseURI /
PassengerRestartDir /home/<user>/domains/<site>/app/tmp
SetEnv LSNODE_CONSOLE_LOG console.log
SetEnv TOKIO_WORKER_THREADS 2
SetEnv PAYROLL_DATA_DIR /home/<user>/payroll-data
```

4. `~/payroll-data/app.env` with `PUBLIC_ORIGIN=https://<site>`; the Super Admin password on the server itself (you type it; only the hash is stored): `ssh -t ... "/opt/alt/alt-nodejs24/root/bin/node ~/domains/<site>/app/deploy/signin-layer/make-admin-hash.mjs --write-to ~/payroll-data/app.env"`.
5. The data (below) into `~/payroll-data/pg`.
6. Restart: `touch app/tmp/restart.txt` is slow to act; stop the process instead, LiteSpeed starts it again with the next request: `pkill -TERM -u $USER -f "lsnode:/home/<user>/domains/<site>/app"`. The app's log: `app/console.log` and `app/stderr.log`.

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
* The real data (PGlite folder of 1.35 GB: 29 companies / years, about 20,000 employees, 170,000 attendance rows, 7,000 files) was run through the whole stack on a PC with 8 GB of memory (busy, 600 MB free): start 3 s, 270 MB of memory idle and 525 MB after the heaviest reports; one company-year with 1,552 employees: employee list 0.3-0.5 s, monthly attendance 0.7-1.1 s, salary sheets 4-5 s, salary slips 0.3-6 s, personal-file report 0.2-0.8 s. The PGlite folder must be `<PAYROLL_DATA_DIR>/pg` itself (the files `PG_VERSION`, `base/`, ... directly inside); an empty folder there makes a new, empty database.
* Uploads of 10 / 30 / 110 MB passed (the application needs 25 MB at most).

## Security notes

* A shared hosting account runs all its websites under one user: other sites of the account (for example WordPress) can reach these files. Payroll data of this size belongs on a server of its own (a VPS: `docs/deploy-kit/install-ubuntu.sh`).
* The layer marks every response that the application does not mark as cacheable with `Cache-Control: no-store` (and `X-LiteSpeed-Cache-Control: no-cache`), so neither the CDN nor LiteSpeed's cache keeps anything of a signed-in user.
* Rate limits, session cookies and the header rules are the ones of `../signin-layer`.
