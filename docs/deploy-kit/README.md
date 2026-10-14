# Deploy kit - Payroll Workspace (HRM) on a Linux VPS with Plesk

Ready-to-copy configuration for the steps in [`../DEPLOYMENT-GUIDE.md`](../DEPLOYMENT-GUIDE.md). It contains templates only (no secrets).
**Not yet run on your server**: the application, the gateway and the Node.js runner were tested on Windows with PostgreSQL 17.11; these Linux files follow the same
commands. Do a staging run first (guide, section 4.9).

## Quick path: a plain Ubuntu 22.04 / 24.04 VPS (no Plesk)

```bash
# as root, DNS of the domain already points to this server
git clone --depth 1 https://github.com/sushantdv8/payroll-hrm.git /root/payroll-hrm
DOMAIN=hrm.example.com EMAIL=you@example.com bash /root/payroll-hrm/docs/deploy-kit/install-ubuntu.sh
node /opt/payroll/app/payroll-web/deploy/signin-layer/make-admin-hash.mjs --write-to /etc/payroll/layer.env   # you type the Super Admin password
systemctl start payroll-layer
bash /opt/payroll/app/docs/deploy-kit/restore-data.sh /path/to/backup.dump                                    # optional: load data
```

`install-ubuntu.sh` does the "Order of work" below (packages, PostgreSQL 17, Node.js 24, user, database, secrets, build, services, nginx + Let's Encrypt, firewall, nightly backup); it keeps existing secrets when run again.
The sign-in layer (`payroll-web/deploy/signin-layer`) is the only way in: nginx proxies to it (port 8080), the application (3000), gateway (5790) and PostgreSQL (5432) stay on 127.0.0.1.

## Required runtime and dependencies

| What | Version | Why |
|---|---|---|
| Linux, 64-bit | glibc based (Ubuntu 22.04 / 24.04, Debian 12, AlmaLinux / Rocky 8-9), x86-64 (arm64 and musl packages are also in the lock files) | the server; Plesk Obsidian with nginx for the subdomain, proxy and SSL |
| Node.js | 24 (tested); the project declares 22.13 or newer | runs the application and the gateway |
| npm | the one that comes with Node.js | installs the packages from the lock files (`npm ci`) |
| PostgreSQL | **17** (tested 17.11; the supplied backups need `pg_restore` 17 or newer) | the database; client tools `pg_dump` / `pg_restore` for backups |
| Git | any | gets the code (or unpack the project ZIP instead) |
| 7-Zip / p7zip | any | only to unpack the encrypted database backups |
| Internet access | during installation | npm packages, PostgreSQL repository, Let's Encrypt; **at run time nothing is called outside the server** |

Server size: 2 vCPU, 4 GB RAM (2 GB minimum), 20 GB disk. Space used: packages `payroll-web/node_modules` about 0.8 GB (53,000 files), gateway packages 25 MB, build output `dist` 6 MB,
database 0.6 GB per workspace, backups 0.25 GB each. `npm run build` takes 1-2 minutes; if the server has little RAM, add swap for the build.
Ports (all on 127.0.0.1 except 80/443 through Plesk): web application 3000, gateway 5790, PostgreSQL 5432.

## Order of work

1. DNS A record for `hrm.erpkishorexports.com`; subdomain, Let's Encrypt certificate and HTTP-to-HTTPS redirect in Plesk (guide, section 4.7).
2. Install packages and PostgreSQL 17; create the service user `payroll` and the folders `/opt/payroll` and `/etc/payroll` (guide, 4.1).
3. Create the database: `postgresql/create-database.sql` (guide, 4.2).
4. Get the code into `/opt/payroll/app` (`git clone` or the project ZIP).
5. Gateway: `cd /opt/payroll/app/db-gateway && npm ci --omit=dev`; copy `env/gateway.env.example` to `/etc/payroll/gateway.env` and fill it in; install `systemd/payroll-gateway.service`; start it (guide, 4.4).
6. Application: `cd /opt/payroll/app/payroll-web && npm ci && npm run build`; copy `env/app.env.example` to `/etc/payroll/app.env` and fill it in (same secret as the gateway); install `systemd/payroll-app.service`; start it (guide, 4.5).
7. Load the data: `pg_restore -h 127.0.0.1 -U payroll -d payroll --no-owner --clean --if-exists -j 2 <backup>.dump` (always with `--clean --if-exists`; see `RESTORE.txt` of the database package for the row counts to compare), then `ANALYZE;` (guide, 4.8 and 5). Doing this before step 5 is cleanest, but with `--clean --if-exists` the order does not matter.
8. Sign-in layer and nginx: install `systemd/payroll-layer.service` and `env/layer.env.example` (set the Super Admin password with `make-admin-hash.mjs`, guide 4.6), then paste `nginx/plesk-additional-nginx-directives.conf` in Plesk with `proxy_pass` pointing to the layer, port 8080 (guide 4.7); without Plesk use `nginx/payroll-site.conf`.
9. Backups: `~payroll/.pgpass`, `chmod +x backup/backup-payroll.sh`, install `backup/crontab.example` for the `payroll` user; run the script once by hand and restore its output into a test database.
10. Staging checks and reboot test (guide, 4.9).

## Quick checks

```bash
curl -s http://127.0.0.1:5790/health                                                     # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/hr-login?username=x" # 401 = the application runs and waits for the sign-in layer
systemctl is-active payroll-gateway payroll-app postgresql                                # active active active
sudo -u payroll /opt/payroll/app/docs/deploy-kit/backup/backup-payroll.sh                # backup ok: /var/backups/payroll/payroll_....dump
```

## Updating

```bash
cd /opt/payroll/app && sudo -u payroll git pull
cd db-gateway && sudo -u payroll npm ci --omit=dev && sudo systemctl restart payroll-gateway   # tables are updated automatically
cd ../payroll-web && sudo -u payroll npm ci && sudo -u payroll npm run build && sudo systemctl restart payroll-app
```

Take a backup first. To go back: `git checkout <previous commit>`, rebuild, restart; restore the database backup only if a data problem was caused.

## Files

| File | Purpose |
|---|---|
| `ENVIRONMENT-VARIABLES.md` | every variable and configuration file, with rules for secrets |
| `install-ubuntu.sh`, `restore-data.sh` | one-go installation on a plain Ubuntu VPS, and loading a database backup |
| `env/gateway.env.example`, `env/app.env.example`, `env/layer.env.example` | the three environment files |
| `systemd/payroll-gateway.service`, `systemd/payroll-app.service`, `systemd/payroll-layer.service` | the three services |
| `nginx/plesk-additional-nginx-directives.conf` | the proxy block for Plesk |
| `nginx/payroll-site.conf`, `nginx/payroll-proxy.conf`, `nginx/payroll-ratelimit.conf` | the nginx files for a plain Ubuntu VPS (site, proxy headers, sign-in rate limit) |
| `postgresql/create-database.sql` | database and user |
| `backup/backup-payroll.sh`, `backup/crontab.example` | nightly backup with 14 days of retention |
