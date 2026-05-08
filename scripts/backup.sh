#!/usr/bin/env bash
#
# Dino-World — nightly SQLite backup with 14-day retention.
#
# Env vars:
#   DATABASE_PATH  Path to the live SQLite file. Default: /opt/dinoworld/data/dinoworld.db
#   BACKUP_DIR     Where compressed backups land.  Default: /opt/dinoworld/backups
#
# Exit codes:
#   0   success
#   1   integrity check or gzip verification failed
#
# Cron line (UTC nightly at 03:00):
#   0 3 * * * /opt/dinoworld/scripts/backup.sh >> /opt/dinoworld/logs/backup.log 2>&1
#
# Safe to run while the bot is online — sqlite3's `.backup` is online-safe.
set -euo pipefail

DB="${DATABASE_PATH:-/opt/dinoworld/data/dinoworld.db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/dinoworld/backups}"
mkdir -p "$BACKUP_DIR"
TS=$(date -u +%F-%H%M%SZ)

# Pre-flight: refuse to back up a corrupted DB.
if ! sqlite3 "$DB" "PRAGMA integrity_check;" | grep -qx 'ok'; then
    echo "[backup.sh] integrity_check FAILED on $DB — aborting" >&2
    exit 1
fi

OUT="$BACKUP_DIR/dinoworld-$TS.db"
sqlite3 "$DB" ".backup '$OUT'"
gzip -9 "$OUT"

# Verify the produced gzip before we trust it for prune decisions.
if ! gzip -t "$OUT.gz"; then
    echo "[backup.sh] gzip integrity test FAILED on $OUT.gz — aborting before prune" >&2
    exit 1
fi

# Only prune after a verified-good new backup exists.
find "$BACKUP_DIR" -name '*.db.gz' -mtime +14 -delete
echo "[backup.sh] $(date -u +%FT%TZ) backup ok: $OUT.gz"
