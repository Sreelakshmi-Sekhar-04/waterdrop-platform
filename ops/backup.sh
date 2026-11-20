#!/usr/bin/env bash
# Daily logical backup of the WtrDrop database, kept off the database host (Phase 0 §12.1).
# The managed PostgreSQL's own daily backups and point-in-time recovery stay the first line;
# this copy protects against losing the provider account or a bad restore point.
#
#   DATABASE_URL=postgres://… BACKUP_DIR=/backups RETENTION_DAYS=30 ops/backup.sh
#
# Writes wtrdrop-<UTC time>.dump (pg_dump custom format) and a .sha256 next to it, then deletes
# dumps older than RETENTION_DAYS. Copy BACKUP_DIR to storage in another account or region.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/wtrdrop-$stamp.dump"
pg_dump --format=custom --no-owner --no-privileges --file="$file.part" "$DATABASE_URL"
mv "$file.part" "$file"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
find "$BACKUP_DIR" -name 'wtrdrop-*.dump*' -type f -mtime +"$RETENTION_DAYS" -delete
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
