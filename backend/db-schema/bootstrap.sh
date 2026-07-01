#!/usr/bin/env bash
# Bootstrap system_aida_lore schema on a fresh (or existing) ArcadeDB instance.
# Runs create-schema.sql statement-by-statement over ArcadeDB's HTTP command API —
# no Java/Quarkus backend required. Idempotent (every DDL statement uses IF NOT EXISTS).
#
# Usage:
#   ./bootstrap.sh                                    # localhost:2480, db=system_aida_lore, root/playwithdata
#   ARCADEDB_HOST=host ARCADEDB_PORT=2480 ARCADEDB_DB=mydb ARCADEDB_USER=root ARCADEDB_PASS=secret ./bootstrap.sh
#
# Prereqs: ArcadeDB server running and reachable; the target database must already
# exist (this script creates TYPES/PROPERTIES/INDEXES inside it, not the database
# itself — create the DB first via ArcadeDB Studio or `POST /api/v1/server` with
# command "create database <name>").

set -uo pipefail

HOST="${ARCADEDB_HOST:-localhost}"
PORT="${ARCADEDB_PORT:-2480}"
DB="${ARCADEDB_DB:-system_aida_lore}"
USER="${ARCADEDB_USER:-root}"
PASS="${ARCADEDB_PASS:-playwithdata}"
SQL_FILE="$(dirname "$0")/create-schema.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: $SQL_FILE not found" >&2
  exit 1
fi

BASE_URL="http://${HOST}:${PORT}/api/v1/command/${DB}"
echo "Bootstrapping schema on ${BASE_URL} ..."

OK=0
FAIL=0
TOTAL=0

# Strip line comments (-- ...) and blank lines, then split on ';'.
STATEMENTS=$(sed -e 's/--.*$//' "$SQL_FILE" | tr '\n' ' ' | tr -s ' ')
IFS=';' read -ra STMTS <<< "$STATEMENTS"

for stmt in "${STMTS[@]}"; do
  # Trim whitespace
  stmt="$(echo "$stmt" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -z "$stmt" ] && continue
  TOTAL=$((TOTAL + 1))

  # Build JSON body safely via python (handles quoting).
  BODY=$(STMT="$stmt" py -3 -c "import json, os; print(json.dumps({'language':'sql','command':os.environ['STMT']}))" 2>/dev/null \
      || STMT="$stmt" python3 -c "import json, os; print(json.dumps({'language':'sql','command':os.environ['STMT']}))")

  RESP=$(curl -s -X POST "$BASE_URL" -u "${USER}:${PASS}" -H "Content-Type: application/json" -d "$BODY")

  if echo "$RESP" | grep -q '"error"'; then
    # IF NOT EXISTS statements that hit an already-created type/index sometimes
    # still report a harmless error on some ArcadeDB versions — log but don't
    # hard-fail the whole run; the idempotent flag is the real safety net.
    echo "  [WARN] ${stmt:0:70}... → ${RESP:0:150}"
    FAIL=$((FAIL + 1))
  else
    OK=$((OK + 1))
  fi
done

echo ""
echo "Done: ${OK}/${TOTAL} statements OK, ${FAIL} warnings/errors (see above)."
[ "$FAIL" -gt 0 ] && echo "Non-zero warnings are often benign for IF NOT EXISTS DDL on a pre-existing schema — review the messages above."
exit 0
