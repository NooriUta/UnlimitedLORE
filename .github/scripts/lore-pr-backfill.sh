#!/usr/bin/env bash
# «Дотянуть данные PR» на СРЕДЕ (SPRINT_LORE_MODEL_DOCS_TIDY/MD-05, слово владелицы 22.11.2026 — вариант «б»:
# служебная учётка для CI вместо человека с токеном).
#
# Повод. Операция есть в бэкенде (POST /lore/admin/pr-backfill, только super-admin) и в установщике, а ЗАПУСТИТЬ
# её на нашем стенде или проде было нечем: ни один прогон CI её не звал. После каждой выкатки заголовки PR
# пришлось бы дотягивать руками с чужим токеном — и смоук RFD2-MD05 оставался бы красным «по данным».
#
# Что делает. Берёт учётку lore-ci-ops из Infisical выбранной среды, получает по ней токен у Keycloak той же
# среды (client_credentials; роль super-admin приходит в клейме seer_roles), прогоняет дотяжку ПРОБНО, печатает
# «дотянется N из M» и, если попросили, повторяет без --dry-run.
#
# Пробный прогон — ВСЕГДА, даже при apply=true: иначе цифру «до» никто не увидит и сравнивать будет не с чем.
#
# Секретов в выводе нет: ни клиентский секрет, ни токен не печатаются.
#
# Запуск: lore-pr-backfill.sh <preprod|prod> <true|false> [limit]
set -euo pipefail

ENVN="${1:-}"; APPLY="${2:-false}"; LIMIT="${3:-200}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"

die() { echo "::error::$*"; exit 1; }
note() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY"; }

case "$ENVN" in
  preprod) BASE="https://preprod.lore.odal.seidrstudio.pro"; REALM="omilorePreprod" ;;
  prod)    BASE="https://lore.odal.seidrstudio.pro";          REALM="omilore" ;;
  *) die "среда «$ENVN» неизвестна: ожидается preprod или prod" ;;
esac
ISSUER="https://odal.seidrstudio.pro/kc/realms/$REALM"

for v in LORE_SECRETS_CLIENT_ID LORE_SECRETS_CLIENT_SECRET LORE_SECRETS_PROJECT_ID; do
  eval "val=\${$v:-}"
  [ -z "$val" ] && die "не задан $v — учётка Infisical (machine identity) нужна, чтобы взять lore-ci-ops среды $ENVN"
done

INF="${LORE_SECRETS_URL:-http://infisical:18080}"
icurl() { docker run --rm --add-host infisical:host-gateway curlimages/curl:latest -s -m 20 "$@"; }

# ── 1. Учётка lore-ci-ops из Infisical ───────────────────────────────────────
login="$(icurl -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"${LORE_SECRETS_CLIENT_ID}\",\"clientSecret\":\"${LORE_SECRETS_CLIENT_SECRET}\"}" \
  "$INF/api/v1/auth/universal-auth/login")"
inf_tok="$(printf '%s' "$login" | tr -d '\n' | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -n "$inf_tok" ] || die "вход в Infisical ($INF) не удался: $(printf '%s' "$login" | head -c 200)"

secrets="$(icurl -H "Authorization: Bearer $inf_tok" \
  "$INF/api/v3/secrets/raw?workspaceId=${LORE_SECRETS_PROJECT_ID}&environment=${ENVN}&secretPath=${LORE_SECRETS_SCOPE:-/}")"
pick() { printf '%s' "$secrets" | tr '{' '\n' | grep -F "\"secretKey\":\"$1\"" | sed -n 's/.*"secretValue"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; }
CLIENT_ID="$(pick LORE_CI_OPS_CLIENT_ID)"
CLIENT_SECRET="$(pick LORE_CI_OPS_CLIENT_SECRET)"
[ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] \
  || die "в окружении $ENVN Infisical нет LORE_CI_OPS_CLIENT_ID / LORE_CI_OPS_CLIENT_SECRET — учётку заводит CICDGitHub, секрет кладёт владелица"

# ── 2. Токен Keycloak среды ──────────────────────────────────────────────────
tok_json="$(curl -s -m 30 -X POST "$ISSUER/protocol/openid-connect/token" \
  -d grant_type=client_credentials --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "client_secret=$CLIENT_SECRET")"
LORE_TOKEN="$(printf '%s' "$tok_json" | tr -d '\n' | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -n "$LORE_TOKEN" ] || die "Keycloak $REALM не выдал токен по lore-ci-ops: $(printf '%s' "$tok_json" | sed 's/"[^"]*secret[^"]*"[^,]*//g' | head -c 200)"
export LORE_TOKEN

# ── 3. Пробный прогон — всегда ───────────────────────────────────────────────
note "## Дотянуть данные PR — $ENVN"
note ""
note "- адрес: $BASE"
dry_out="$(mktemp)"
if node "$ROOT/scripts/model-migration/cli.mjs" pr-backfill --url "$BASE" --limit "$LIMIT" --dry-run > "$dry_out" 2>&1; then
  note "- пробный прогон: $(grep -m1 '^PR:' "$dry_out" || echo 'см. журнал')"
else
  sed 's/Bearer [A-Za-z0-9._-]*/Bearer ***/g' "$dry_out"
  die "пробный прогон дотяжки не удался — настоящий не запускаю"
fi

# ── 4. Настоящий прогон — только по просьбе ──────────────────────────────────
if [ "$APPLY" = true ]; then
  run_out="$(mktemp)"
  if node "$ROOT/scripts/model-migration/cli.mjs" pr-backfill --url "$BASE" --limit "$LIMIT" > "$run_out" 2>&1; then
    note "- настоящий прогон: $(grep -m1 '^PR:' "$run_out" || echo 'см. журнал')"
    note ""
    note "Повтор ничего не меняет: дотяжка идемпотентна. Пропущенные — с причиной в журнале прогона."
  else
    sed 's/Bearer [A-Za-z0-9._-]*/Bearer ***/g' "$run_out"
    die "настоящий прогон дотяжки не удался"
  fi
else
  note "- настоящий прогон НЕ запускался (apply=false): это была только оценка"
fi
