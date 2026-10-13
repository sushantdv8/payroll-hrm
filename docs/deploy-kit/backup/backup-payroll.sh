#!/usr/bin/env bash
# Nightly PostgreSQL backup of Payroll Workspace. Run as the "payroll" user (cron example: crontab.example).
# Needs ~/.pgpass of that user (chmod 600), one line:   127.0.0.1:5432:payroll:payroll:<database password>
# Not yet run on your server: try it by hand once, then restore the result into a test database (docs/DEPLOYMENT-GUIDE.md, section 5).
set -euo pipefail

DB="${PAYROLL_DB:-payroll}"
DB_USER="${PAYROLL_DB_USER:-payroll}"
DIR="${PAYROLL_BACKUP_DIR:-/var/backups/payroll}"
KEEP_DAYS="${PAYROLL_KEEP_DAYS:-14}"

mkdir -p "$DIR"
STAMP="$(date +%F_%H%M)"
PART="$DIR/.${DB}_${STAMP}.dump.part"
OUT="$DIR/${DB}_${STAMP}.dump"

# custom format: compressed, and restorable with pg_restore (use PostgreSQL 17 or newer tools for a dump made by 17)
pg_dump -h 127.0.0.1 -U "$DB_USER" -Fc --no-owner --no-privileges -f "$PART" "$DB"
mv "$PART" "$OUT"

# sanity check: the finished file must be readable and contain the main table
LIST="$(pg_restore -l "$OUT")"
grep -q 'TABLE DATA public employees' <<<"$LIST" || { echo "backup check FAILED: $OUT" >&2; exit 1; }

# keep the last KEEP_DAYS days; copy the files off the server as well (Plesk Backup Manager, rsync, object storage)
find "$DIR" -maxdepth 1 -name "${DB}_*.dump" -mtime +"$KEEP_DAYS" -delete

echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
