#!/usr/bin/env bash
# Restore drill (Phase 0 §12.1: quarterly). Restores a backup into a new, empty database, checks
# that the data is whole, compares row counts with the live database, then drops the copy.
# It never writes to the live database.
#
#   ADMIN_URL=postgres://user@host/postgres SOURCE_URL=postgres://…/wtrdrop \
#     ops/restore-drill.sh backups/wtrdrop-20261120T020000Z.dump
#
# ADMIN_URL: a connection that may CREATE DATABASE. SOURCE_URL (optional): the live database, to
# compare row counts. Needs the built API (apps/api/dist) for the integrity check.
set -euo pipefail
dump="${1:?usage: restore-drill.sh <file.dump>}"
: "${ADMIN_URL:?ADMIN_URL is required}"
here="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$dump.sha256" ]; then (cd "$(dirname "$dump")" && sha256sum --check --quiet "$(basename "$dump").sha256"); fi
name="wtrdrop_restore_drill_$(date -u +%Y%m%d%H%M%S)"
target="${ADMIN_URL%/*}/$name"
start=$(date +%s)
psql "$ADMIN_URL" -qc "CREATE DATABASE $name"
trap 'psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $name WITH (FORCE)" >/dev/null' EXIT
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target" "$dump"
restored=$(( $(date +%s) - start ))

read -r -d '' counts <<'SQL' || true
select string_agg(t || ' ' || n, ', ' order by t) from (
  select 'customers' t, count(*) n from customers union all
  select 'orders', count(*) from orders union all
  select 'delivery_attempts', count(*) from delivery_attempts union all
  select 'payments', count(*) from payments union all
  select 'account_ledger', count(*) from account_ledger union all
  select 'can_ledger', count(*) from can_ledger union all
  select 'stock_movements', count(*) from stock_movements union all
  select 'audit_logs', count(*) from audit_logs) x
SQL
copy_counts=$(psql "$target" -Atc "$counts")
echo "restored in ${restored}s: $copy_counts"
if [ -n "${SOURCE_URL:-}" ]; then
  live_counts=$(psql "$SOURCE_URL" -Atc "$counts")
  if [ "$live_counts" != "$copy_counts" ]; then
    echo "note: live database differs (writes since the backup are expected): $live_counts"
  fi
fi
DATABASE_URL="$target" node "$here/../apps/api/dist/ops/check-integrity.js"
echo "restore drill ok"
