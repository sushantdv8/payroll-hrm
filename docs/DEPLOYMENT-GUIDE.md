# Payroll Workspace (HRM) – Deployment & Handover Guide

For hosting the software on a Linux VPS with Plesk, e.g. `hrm.erpkishorexports.com`. Written 2026-10-13.

**What has and has not been tested.** The application, the PostgreSQL gateway and the Node.js runner were tested on Windows 11
with PostgreSQL 17.11 and Node.js 24, using a copy of the real company data (see `db-gateway/README.md`, "What was checked").
The Linux / Plesk steps below follow the same commands but have **not yet been run on your server**: plan a staging run first
(section 4.9). Two parts are not finished and are listed in section 12 (the sign-in layer for a server, and the biometric link).

---------------------------------------------------------------------------------------------------------------------------

## 1. What the software is

One web application (React front end and the API behind it are in the same project) plus a small database service:

```
Browser --HTTPS--> Plesk nginx --> sign-in layer --> Payroll Workspace app (Node.js, port 3000) --> db-gateway (Node.js, 5790) --> PostgreSQL (5432)
```

| Folder | What it is |
|---|---|
| `payroll-web/` | The application: TypeScript, React 19, "vinext" (Next.js-compatible, Vite based). Screens, reports and all `/api/...` routes. |
| `db-gateway/` | Small Node.js service between the app and PostgreSQL. Creates the tables (`schema.sql`), translates the app's SQL, stores files (photos, HR documents, archives) in PostgreSQL. Has its own tests and README. |
| `installer/` | The Windows edition (desktop installer, sign-in window). `launcher.mjs` is the sign-in layer used today. Not needed on a server except as the starting point of the server sign-in layer (section 12). |
| `biometric-web/` | Program that reads punches from the eSSL / ZKTeco attendance machines over the office network. |
| `docs/` | This guide. |

The application was written for the Cloudflare Workers programming interface (`D1` database and `R2` file bindings, the
`cloudflare:workers` module). **It is not hosted on Cloudflare, and no Cloudflare account is needed.** The Windows edition runs it
locally with Cloudflare's open-source `workerd`; on a server it runs on plain Node.js with PostgreSQL (`payroll-web/deploy/node-runner`
and `db-gateway`). There is no Worker deployment to hand over. (The `wrangler` configuration is generated at build time into
`payroll-web/dist/server/wrangler.json` and is only used by the Windows edition.)

## 2. Requirements

* Linux VPS (Ubuntu 22.04 / 24.04 or similar), Plesk Obsidian with nginx. Not suitable for shared hosting (needs long-running Node.js services).
* 2 vCPU, 4 GB RAM (2 GB is the minimum), 20 GB disk. Measured with the real data: PostgreSQL database 0.6 GB, app 100-300 MB RAM (more for a moment while a large report is produced); the gateway is a small Node.js process.
* Node.js 22.13 or newer (22 LTS or 24); npm. PostgreSQL 14 or newer (tested on 17.11). Git.
* Outbound internet only while installing packages and for the Let's Encrypt certificate. At run time the software calls **no** external service.

## 3. Environment variables and configuration files

Keep them in files readable only by the service user (for example `/etc/payroll/gateway.env` and `/etc/payroll/app.env`, mode 640).
**All secrets are created by you on your server; nobody else needs to know them.**

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | gateway | `postgres://payroll:<password>@127.0.0.1:5432/payroll` |
| `GATEWAY_SECRET` | gateway | At least 16 random characters (use 32+). The app sends it with every call. |
| `PORT`, `HOST` | gateway | Default `5790`, `127.0.0.1`. Do not expose. |
| `DB_GATEWAY_URL` | app | `http://127.0.0.1:5790` |
| `DB_GATEWAY_SECRET` | app | The same value as `GATEWAY_SECRET`. |
| `PORT` | app | Port of the web app, for example 3000 (or `-p 3000` on the command line). Keep it on `127.0.0.1`. |

Generate a secret: `openssl rand -hex 32`. Other configuration: `payroll-web/.openai/hosting.json` (binding names, needed by the build),
`db-gateway/schema.sql` (database tables). There is nothing else to configure.

## 4. Installing on the server (Ubuntu example)

### 4.1 Packages

```bash
sudo apt update && sudo apt install -y git postgresql curl
# Node.js 22 LTS (or 24): install from https://nodejs.org or the NodeSource repository, then check:
node -v        # must be v22.13 or newer
sudo useradd -r -m -d /opt/payroll -s /usr/sbin/nologin payroll
sudo mkdir -p /etc/payroll /var/backups/payroll && sudo chown payroll:payroll /var/backups/payroll
```

### 4.2 PostgreSQL

```bash
sudo -u postgres psql -c "CREATE USER payroll WITH PASSWORD '<long random password>'"
sudo -u postgres psql -c "CREATE DATABASE payroll OWNER payroll"
```

(Plesk can also create the database and user under Tools & Settings > Database Servers if you use its PostgreSQL server.)
PostgreSQL must listen on `127.0.0.1` only (the default).

### 4.3 Get the code

```bash
sudo -u payroll git clone https://github.com/<owner>/payroll-hrm.git /opt/payroll/app      # or unzip the project ZIP there
```

### 4.4 Database gateway

```bash
cd /opt/payroll/app/db-gateway && sudo -u payroll npm ci --omit=dev
sudo tee /etc/payroll/gateway.env >/dev/null <<'EOF'
DATABASE_URL=postgres://payroll:<password>@127.0.0.1:5432/payroll
GATEWAY_SECRET=<32+ random characters>
PORT=5790
HOST=127.0.0.1
EOF
sudo chown root:payroll /etc/payroll/gateway.env && sudo chmod 640 /etc/payroll/gateway.env
```

`/etc/systemd/system/payroll-gateway.service`:

```ini
[Unit]
Description=Payroll Workspace database gateway
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=payroll
WorkingDirectory=/opt/payroll/app/db-gateway
EnvironmentFile=/etc/payroll/gateway.env
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now payroll-gateway
curl -s http://127.0.0.1:5790/health        # {"ok":true}
```

The gateway creates all tables on its first start (safe to run again) and waits for PostgreSQL if it is still starting.

### 4.5 The application

```bash
cd /opt/payroll/app/payroll-web
sudo -u payroll npm ci            # all packages: the build tools (vinext, vite) are also needed at run time
sudo -u payroll npm run build     # about a minute; creates dist/
sudo tee /etc/payroll/app.env >/dev/null <<'EOF'
DB_GATEWAY_URL=http://127.0.0.1:5790
DB_GATEWAY_SECRET=<the same secret as GATEWAY_SECRET>
EOF
sudo chown root:payroll /etc/payroll/app.env && sudo chmod 640 /etc/payroll/app.env
```

`/etc/systemd/system/payroll-app.service`:

```ini
[Unit]
Description=Payroll Workspace web application
After=network.target payroll-gateway.service
Wants=payroll-gateway.service

[Service]
User=payroll
WorkingDirectory=/opt/payroll/app/payroll-web
EnvironmentFile=/etc/payroll/app.env
ExecStart=/usr/bin/node --import ./deploy/node-runner/register.mjs node_modules/vinext/dist/cli.js start -p 3000 -H 127.0.0.1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now payroll-app
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/hr-login?username=x     # 401 = running (it wants the sign-in layer)
```

(`deploy/node-runner` makes the app's `cloudflare:workers` import read the two variables above, so no Cloudflare runtime is used.)

### 4.6 Sign-in layer

The application trusts identity headers that a sign-in layer in front of it adds after a successful login; without them every request is refused.
**A server version of this layer is still to be completed (section 12).** It must be the only way to reach the app: the app listens on `127.0.0.1` only,
and the layer must remove any `oai-authenticated-user-*` headers sent by browsers. The headers the Windows edition sends are:

| Header | Value |
|---|---|
| `oai-authenticated-user-id` | `local_seedy` for **every** user. This is the "owner" (tenant) under which all records are stored; it is not a person. The data on your server must be stored under the same value, so keep it. |
| `oai-authenticated-user-email`, `-full-name` (+ `-full-name-encoding: percent-encoded-utf-8`) | Display name and e-mail of the signed-in person. |
| `oai-authenticated-user-username` | `admin01` for the administrator, otherwise the application user's login name. Decides the permissions. |
| `oai-authenticated-user-mode` | `editable` (normal) or `original` (the read-only workspace). |
| `oai-authenticated-user-path`, `-method` | The request path and HTTP method (used for the permission rules of limited users). |

The layer also provides `GET /__workspace`, which returns `{"company":"<dataset key>","mode":"editable","username":"admin01","location":""}` for the company and
year chosen at sign-in; the screens use it to open the right data.

### 4.7 Subdomain, nginx and HTTPS in Plesk

1. DNS: create an `A` record for `hrm.erpkishorexports.com` pointing to the VPS IP (and `AAAA` if you use IPv6). Wait until it resolves.
2. Plesk: Websites & Domains > Add Subdomain `hrm` under `erpkishorexports.com` (a plain site, no PHP needed).
3. SSL: the subdomain > SSL/TLS Certificates > "Install a free basic certificate provided by Let's Encrypt" (tick "Secure the domain name"). Plesk renews it automatically.
4. Hosting Settings: tick "Permanent SEO-safe 301 redirect from HTTP to HTTPS". Enable HSTS if your Plesk version offers it.
5. Apache & nginx Settings > "Additional nginx directives" (menus differ slightly between Plesk versions):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;        # the sign-in layer once it exists; the app itself while testing locally
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 25m;                 # largest upload: 11 MB documents; imports send up to 8.5 MB per request
    proxy_read_timeout 300s;                  # big reports and imports can take a minute or two
}
```

6. Firewall: allow 22 (SSH, preferably key-only), 80 and 443 only. Ports 3000, 5790 and 5432 must stay closed to the outside.

### 4.8 First data load

Either restore the database backup supplied at handover (section 5), or copy the existing Windows data once with
`node db-gateway/migrate-from-sqlite.mjs <state folder>` (about 5 minutes for 20,000 employees; see `db-gateway/README.md`).
The original and the editable workspaces use the same table names: put the second one in its own database.

### 4.9 Staging check before go-live

1. `curl http://127.0.0.1:5790/health` gives `{"ok":true}`; the app answers 401 on `/api/hr-login`.
2. From the server itself (not from outside!) call the app with identity headers to prove it reads the database:
   `curl -s -H 'oai-authenticated-user-id: local_seedy' -H 'oai-authenticated-user-email: admin@payroll.local' -H 'oai-authenticated-user-username: admin01' -H 'oai-authenticated-user-mode: editable' http://127.0.0.1:3000/api/datasets`
   lists the companies/years (28 entries with the current data).
3. Restore the latest backup into an empty database and compare the employee count with the live one (section 5).
4. Open the site through HTTPS with the sign-in layer, check the dashboard, employees, one attendance month, one salary sheet, a report, and a document upload/download.
5. Reboot the server and confirm everything comes back by itself (both services are `enable`d).

## 5. Backup and restore

Nightly backup (cron, as the `payroll` user), keeping 14 days, and copy the files off the server (Plesk Backup Manager / rsync / object storage):

```bash
0 2 * * *  pg_dump -Fc -h 127.0.0.1 -U payroll payroll > /var/backups/payroll/payroll_$(date +\%F).dump && find /var/backups/payroll -name '*.dump' -mtime +14 -delete
```

(Put the password in `~/.pgpass`, mode 600.) With the real data a dump takes about 1.5 minutes and is about 240 MB; a restore about 1.2 minutes.

Restore into an empty database (use a new database to test, or after stopping the two services to replace the live one):

```bash
sudo -u postgres psql -c "CREATE DATABASE payroll_restore OWNER payroll"
pg_restore -h 127.0.0.1 -U payroll -d payroll_restore --no-owner /var/backups/payroll/payroll_YYYY-MM-DD.dump
```

Everything the software stores (records, salaries, photos, HR documents, imported originals) is inside this one database. Also keep copies of `/etc/payroll/*.env`
(they hold the secrets) in a safe place. Try a restore every month.

## 6. Updating the software

```bash
cd /opt/payroll/app && sudo -u payroll git pull
cd db-gateway && sudo -u payroll npm ci --omit=dev && sudo systemctl restart payroll-gateway     # tables are updated automatically
cd ../payroll-web && sudo -u payroll npm ci && sudo -u payroll npm run build && sudo systemctl restart payroll-app
```

Take a database backup first. Tests that can be run after an update: `cd db-gateway && npm ci && node test/run.mjs` and, for the app's calculations, `npm run test:salary-sheets` in `payroll-web`.

## 7. Third-party services and dependencies

* **No external service is called at run time**: no cloud API, CDN, font service, analytics, e-mail or payment service. The pages load nothing from other websites.
* PostgreSQL (database), Node.js (runtime), nginx and Let's Encrypt (through Plesk).
* npm packages, listed with exact versions in `payroll-web/package-lock.json` and `db-gateway/package-lock.json` (main ones: React 19, vinext/Vite, Drizzle ORM, zod, TanStack Query and Table, Recharts, SheetJS `xlsx` for Excel files, `pg` for PostgreSQL). `vinext` is a beta release.
* Attendance machines (eSSL KE1, KE2, b4; ZKTeco protocol, TCP/UDP port 4370) on the office network, read by `biometric-web` (section 9).

## 8. Security and credentials

* The built-in administrator login is `admin01`. No password is stored in the source code or in GitHub; the Windows edition keeps only password hashes in a file that is not part of the repository.
  At handover the company's authorised person chooses the new administrator password in the server sign-in layer; share it only person-to-person (phone / password manager), never by e-mail or chat.
* Other users and their permissions (companies, units, modules) are created inside the application (HR Management > Users & Unit Permissions) and kept, with salted password hashes, in the database table `hr_users`.
* Database password, `GATEWAY_SECRET`, Plesk and root access belong to the company. The developer needs none of them: your team can install following this guide, with the developer on a screen-share.
  If you want the developer to do it, give a temporary limited SSH user and remove it afterwards.
* The database holds personal and salary data of all employees: restrict who can read backups, transfer them only encrypted (SFTP / encrypted ZIP with the password sent separately), and delete copies that are no longer needed.
* Keep the operating system updated, use SSH keys, add `fail2ban`, and never publish ports 3000, 5790 or 5432.
* The Windows setup file (`PayrollWorkspace_Setup.exe`) contains real company data and must not be passed on with the source code.

## 9. Biometric machines

The application reads punches through the `biometric-web` program (default address `http://127.0.0.1:5180`, set in the Biometric settings screen), which talks to the machines at
`192.168.11.x:4370`. A VPS on the internet cannot reach those private addresses. Options: keep `biometric-web` on an office PC and link it with the VPS through a VPN
(WireGuard / site-to-site) so the app can use `http://<vpn address>:5180`, or run it on the VPS behind such a VPN. A mode where the office PC pushes punches to the server is not built.
Until this is arranged, attendance can still be imported/entered as before; only the automatic machine download needs the link.

## 10. Troubleshooting

* `journalctl -u payroll-gateway -f` and `journalctl -u payroll-app -f` show the logs. PostgreSQL's own log is under `/var/log/postgresql/`.
* Lines such as `ERROR ... hr_write_guard ... check constraint` in PostgreSQL's log are normal: they mean someone saved a record that another user had just changed.
* Gateway "Cannot reach PostgreSQL": check that PostgreSQL runs and `DATABASE_URL` is correct. After a PostgreSQL restart users see errors for a few seconds, then it recovers by itself.
* 401 from the app: the sign-in layer is missing or not forwarding the identity headers. 404 on `/`: same cause.
* Slow after a big import: run `ANALYZE;` in `psql` once (the migration script does this itself).

## 11. Database tables (`db-gateway/schema.sql`)

| Table | Content |
|---|---|
| `employees`, `holidays` | Employee and holiday records (one JSON document each, with revision number). A "dataset" is a company and year, e.g. `om_01_26`. |
| `attendance`, `salary_snapshots` | One row per employee and month. |
| `source_datasets`, `source_employee_links`, `source_packets`, `source_parts` | The imported original company databases (manifests, links to employees, uploaded parts). |
| `master_records` | Master data and settings (departments, banks, shifts, salary sheets, biometric settings, ...). |
| `hr_records`, `hr_audit`, `hr_settings`, `hr_users`, `hr_write_guard` | HR module records, audit trail, settings, users with permissions, and the guard table used for safe saving. |
| `objects` | Files: employee photos, HR documents, original-table archives, month indexes. |

## 12. Not finished / to be decided

1. **Sign-in layer for the server.** The current one (`installer/launcher.mjs`) was written for the Windows edition (embedded password hashes, one window per login). The server version needs the same
   login page with Session (year) and Company choice, `admin01` plus the application's users, cookies marked `Secure`, trust in the proxy's headers, and login rate limits. Alternatively your own login system
   (for example nginx `auth_request`, Authelia or Cloudflare Access) can add the identity headers.
2. **Biometric link** (section 9).
3. A test run on your actual server (section 4.9) and, if wished, a load test with your number of users.
4. The Windows data migration for the editable workspace (a second database) if you want to keep both workspaces.
