#!/usr/bin/env bash
# Payroll Workspace - installs the whole stack on a fresh Ubuntu 22.04 / 24.04 server. Run as root:
#
#     DOMAIN=hrm.example.com EMAIL=you@example.com bash install-ubuntu.sh
#
# It sets up: packages, PostgreSQL 17, Node.js (official tarball, checksum verified), the service user, the database, random secrets, the code from GitHub,
# the build, the three services (database gateway, application, sign-in layer), nginx + a Let's Encrypt certificate, the firewall and a nightly backup.
# It does NOT set the Super Admin password (you type it, see the end of the output) and does not load data (restore-data.sh).
# Safe to run again: existing secrets and settings are kept. Read it before you run it. DNS of $DOMAIN must already point to this server (the certificate needs it).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i)."; exit 1; }
: "${DOMAIN:?Set DOMAIN, for example DOMAIN=hrm.example.com}"
: "${EMAIL:?Set EMAIL (Let's Encrypt sends expiry notices there)}"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || { echo "DOMAIN looks wrong: $DOMAIN"; exit 1; }
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || { echo "EMAIL looks wrong: $EMAIL"; exit 1; }
REPO="${REPO:-https://github.com/sushantdv8/payroll-hrm.git}"
BRANCH="${BRANCH:-main}"
NODE_VERSION="${NODE_VERSION:-24.19.0}"
ROOT=/opt/payroll; APP=$ROOT/app; ETC=/etc/payroll; BACKUPS=/var/backups/payroll
say() { printf '\n== %s\n' "$*"; }
as_payroll() { runuser -u payroll -- env HOME=/home/payroll bash -c "$1"; }

say "Packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git openssl xz-utils p7zip-full nginx certbot python3-certbot-nginx ufw fail2ban unattended-upgrades postgresql-common

say "PostgreSQL 17"
if ! dpkg -s postgresql-17 >/dev/null 2>&1; then
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  apt-get install -y postgresql-17 postgresql-client-17
fi
systemctl enable --now postgresql

say "Node.js $NODE_VERSION"
case "$(uname -m)" in x86_64) NODE_ARCH=x64 ;; aarch64) NODE_ARCH=arm64 ;; *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;; esac
NODE_DIR=/opt/node-v$NODE_VERSION
if [ ! -x "$NODE_DIR/bin/node" ]; then
  tmp="$(mktemp -d)"; ( cd "$tmp"
    base="https://nodejs.org/dist/v$NODE_VERSION"; file="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
    curl -fsSLO "$base/$file"; curl -fsSLO "$base/SHASUMS256.txt"
    grep " $file\$" SHASUMS256.txt | sha256sum -c -
    mkdir -p "$NODE_DIR"; tar -xJf "$file" -C "$NODE_DIR" --strip-components=1 )
  rm -rf "$tmp"
fi
ln -sf "$NODE_DIR/bin/node" /usr/local/bin/node; ln -sf "$NODE_DIR/bin/npm" /usr/local/bin/npm; ln -sf "$NODE_DIR/bin/npx" /usr/local/bin/npx
node --version

say "Service user and folders"
id payroll >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/payroll --shell /usr/sbin/nologin payroll
mkdir -p "$ROOT" "$ETC" "$BACKUPS"; chown payroll:payroll "$ROOT" "$BACKUPS"; chown root:payroll "$ETC"; chmod 750 "$ETC"

say "Database and secrets"
if [ ! -f "$ETC/gateway.env" ]; then
  DBPW="$(openssl rand -hex 24)"; GWSECRET="$(openssl rand -hex 32)"; KEY="$(openssl rand -hex 24)"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payroll') THEN CREATE ROLE payroll LOGIN; END IF; END \$\$;
ALTER ROLE payroll WITH PASSWORD '$DBPW';
SQL
  if ! runuser -u postgres -- psql -At -c "SELECT 1 FROM pg_database WHERE datname = 'payroll'" | grep -q 1; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE payroll OWNER payroll ENCODING 'UTF8' TEMPLATE template0"
  fi
  umask 027
  printf 'DATABASE_URL=postgres://payroll:%s@127.0.0.1:5432/payroll\nGATEWAY_SECRET=%s\nPORT=5790\nHOST=127.0.0.1\n' "$DBPW" "$GWSECRET" > "$ETC/gateway.env"
  printf 'DB_GATEWAY_URL=http://127.0.0.1:5790\nDB_GATEWAY_SECRET=%s\nNODE_ENV=production\nPAYROLL_INTERNAL_KEY=%s\n' "$GWSECRET" "$KEY" > "$ETC/app.env"
  printf 'PUBLIC_ORIGIN=https://%s\nUPSTREAM=http://127.0.0.1:3000\nHOST=127.0.0.1\nPORT=8080\nADMIN_PASSWORD_HASH=\nPAYROLL_INTERNAL_KEY=%s\n' "$DOMAIN" "$KEY" > "$ETC/layer.env"
  chown root:payroll "$ETC"/*.env; chmod 640 "$ETC"/*.env
  printf '127.0.0.1:5432:payroll:payroll:%s\n' "$DBPW" > /home/payroll/.pgpass; chown payroll:payroll /home/payroll/.pgpass; chmod 600 /home/payroll/.pgpass
  unset DBPW GWSECRET KEY
else
  echo "(settings in $ETC already exist - kept)"
fi

say "Code ($REPO, $BRANCH)"
if [ -d "$APP/.git" ]; then as_payroll "git -C $APP pull --ff-only"; else as_payroll "git clone --depth 1 --branch $BRANCH $REPO $APP"; fi

say "Packages and build (a few minutes)"
as_payroll "cd $APP/db-gateway && npm ci --omit=dev"
as_payroll "cd $APP/payroll-web && npm ci && npm run build"

say "Services"
NODE_BIN="$(command -v node)"
for unit in payroll-gateway payroll-app payroll-layer; do
  sed "s#/usr/bin/node#$NODE_BIN#" "$APP/docs/deploy-kit/systemd/$unit.service" > "/etc/systemd/system/$unit.service"
done
systemctl daemon-reload
systemctl enable --now payroll-gateway payroll-app
systemctl enable payroll-layer     # starts after the Super Admin password is set (see the end)
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3000/api/hr-login?username=x' || true)"
  [ "$code" = 401 ] && break; sleep 2
done
echo "application answers $code (401 = running)"

say "nginx and HTTPS"
install -m 644 "$APP/docs/deploy-kit/nginx/payroll-ratelimit.conf" /etc/nginx/conf.d/payroll-ratelimit.conf
install -d /etc/nginx/snippets; install -m 644 "$APP/docs/deploy-kit/nginx/payroll-proxy.conf" /etc/nginx/snippets/payroll-proxy.conf
sed "s/__DOMAIN__/$DOMAIN/g" "$APP/docs/deploy-kit/nginx/payroll-site.conf" > /etc/nginx/sites-available/payroll
ln -sf /etc/nginx/sites-available/payroll /etc/nginx/sites-enabled/payroll
rm -f /etc/nginx/sites-enabled/default
printf 'server {\n    listen 80 default_server;\n    listen [::]:80 default_server;\n    server_name _;\n    return 444;\n}\n' > /etc/nginx/conf.d/00-default-deny.conf
nginx -t; systemctl enable --now nginx; systemctl reload nginx
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect -n \
  || echo "!! The certificate could not be issued (does $DOMAIN already point to this server?). Fix DNS, then run:  certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --no-eff-email --redirect"

say "Firewall, fail2ban, automatic security updates"
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"; SSH_PORT="${SSH_PORT:-22}"
ufw allow "$SSH_PORT/tcp" >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable
systemctl enable --now fail2ban

say "Nightly backup (02:17, 14 days kept in $BACKUPS)"
touch /var/log/payroll-backup.log; chown payroll:payroll /var/log/payroll-backup.log
printf '17 2 * * * payroll bash %s/docs/deploy-kit/backup/backup-payroll.sh >> /var/log/payroll-backup.log 2>&1\n' "$APP" > /etc/cron.d/payroll-backup
chmod 644 /etc/cron.d/payroll-backup

cat <<DONE

== Installed. Two things are left:

 1. Set the Super Admin (admin01) password - type it yourself; nothing is shown while you type and it is never stored, only its hash:
        node $APP/payroll-web/deploy/signin-layer/make-admin-hash.mjs --write-to $ETC/layer.env
        systemctl start payroll-layer
    then open https://$DOMAIN and sign in as admin01.
 2. Load the data (optional, can be done later):
        bash $APP/docs/deploy-kit/restore-data.sh /path/to/backup.dump

 Checks:  systemctl is-active postgresql payroll-gateway payroll-app payroll-layer nginx
          curl -s http://127.0.0.1:8080/__ping       (ok)
DONE
