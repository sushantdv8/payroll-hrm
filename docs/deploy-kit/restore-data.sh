#!/usr/bin/env bash
# Loads a database backup (custom format, made with pg_dump -Fc of PostgreSQL 17) into the "payroll" database. Run as root:
#     bash restore-data.sh /root/payroll-editable-2026-10-13.dump
# The services are stopped while it loads and started again after; the existing content of the database is REPLACED (pg_restore --clean --if-exists:
# always with these flags - without them a restore into existing tables silently leaves some tables empty).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
DUMP="${1:?Usage: bash restore-data.sh /path/to/backup.dump}"
[ -f "$DUMP" ] || { echo "No such file: $DUMP"; exit 1; }
pg_restore -l "$DUMP" >/dev/null || { echo "That is not a readable pg_dump -Fc file (is it made with PostgreSQL 17? pg_restore here is $(pg_restore --version))."; exit 1; }

PGPASSWORD="$(sed -n 's#^DATABASE_URL=postgres://payroll:\([^@]*\)@.*#\1#p' /etc/payroll/gateway.env)"; export PGPASSWORD
[ -n "$PGPASSWORD" ] || { echo "Could not read the database password from /etc/payroll/gateway.env"; exit 1; }

echo "Stopping the services ..."
systemctl stop payroll-layer payroll-app payroll-gateway 2>/dev/null || true
echo "Restoring (a few minutes) ..."
pg_restore -h 127.0.0.1 -U payroll -d payroll --no-owner --clean --if-exists -j 2 "$DUMP"
echo "Analysing ..."
psql -h 127.0.0.1 -U payroll -d payroll -q -c 'ANALYZE;'
echo "Row counts (compare with RESTORE.txt of the backup):"
psql -h 127.0.0.1 -U payroll -d payroll -At -F ' : ' -c "SELECT 'employees', count(*) FROM employees UNION ALL SELECT 'attendance', count(*) FROM attendance UNION ALL SELECT 'salary_snapshots', count(*) FROM salary_snapshots UNION ALL SELECT 'master_records', count(*) FROM master_records UNION ALL SELECT 'hr_records', count(*) FROM hr_records UNION ALL SELECT 'objects', count(*) FROM objects"
unset PGPASSWORD

echo "Starting the services ..."
systemctl start payroll-gateway payroll-app
if grep -q '^ADMIN_PASSWORD_HASH=scrypt\$' /etc/payroll/layer.env; then systemctl start payroll-layer; echo "Sign-in layer started."; else echo "The sign-in layer was NOT started: set the Super Admin password first (make-admin-hash.mjs, see install-ubuntu.sh)."; fi
