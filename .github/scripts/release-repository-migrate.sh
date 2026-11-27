#!/usr/bin/env bash
# Миграция «релиз → репозиторий» (ADR-LORE-066, фаза А): ребро RELEASE_OF KnowRelease → KnowRepository.
# Вызывается из workflow migrate-release-of-repository.yml (только ручной запуск).
#
# Работу делает СЕРВЕР (/lore/release-repository/migrate, LoreReleaseRepositoryMigration): чей релиз,
# решает Forgejo — в каком репозитории есть объект Release или тег. Отсюда — только вызов API.
#
# РЕЖИМЫ (MODE):
#   dry_run — GET …/migrate: план и находки (неоднозначные, нерешённые, непроверенные,
#             Release в Forgejo без записи в LORE), ничего не пишет;
#   apply   — POST …/migrate?apply=true: ставит рёбра; старые рёбра к проекту не трогает.
#             Хоть одно ребро не встало (failed > 0 или HTTP ≠ 200) — шаг КРАСНЫЙ.
#
# ТОКЕН — как у migrate-qg-task-component-edge: учётка пробы CD, realm-роль admin.
# `--selftest` — разбор исходов на подделках.
set -uo pipefail

http() {
  # shellcheck disable=SC2086 # MIG_CURL — составная команда намеренно
  ${MIG_CURL:-curl} -s -m "${MIG_TIMEOUT:-120}" -w '\n%{http_code}' "$@" || true
}

# Первое числовое значение поля верхнего уровня; пусто, если нет.
num() { printf '%s' "$2" | tr -d '\n\r' | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*-?[0-9]+" | head -1 | grep -oE -- '-?[0-9]+$'; }
# Первый массив/объект поля (без вложенности того же вида) — для печати.
raw() { printf '%s' "$2" | tr -d '\n\r' | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*[\[{][^]}]*[]}]" | head -1 | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*//"; }

# Вердикт. $1 — режим, $2 — HTTP-код, $3 — тело. Печатает сводку; 0 — зелёный.
judge() {
  local mode="$1" code="$2" body="$3"
  case "$code" in
    200|207) ;;
    000|"") echo "нет ответа (HTTP ${code:-пусто}) — адрес недоступен"; return 1 ;;
    401)    echo "HTTP 401 — токен не принят бэкендом (issuer/realm/учётка)"; return 1 ;;
    403)    echo "HTTP 403 — BLOCKED: у service account клиента LORE_CD_PROBE_CLIENT_ID нет realm-роли admin в omilore. Выдать роль admin этому service account в Keycloak, затем перезапустить."; return 1 ;;
    *)      echo "HTTP $code — ожидался 200: $(printf '%s' "$body" | head -c 300)"; return 1 ;;
  esac
  case "$body" in *'"migration_id"'*) ;; *)
    echo "HTTP $code, но это не ответ миграции (нет migration_id) — вероятно, SPA-заглушка или старый бэкенд без эндпоинта"; return 1 ;;
  esac
  local r c al am un uc mi
  r=$(num resolved "$body"); c=$(num to_create "$body"); al=$(num already "$body")
  am=$(num ambiguous_count "$body"); un=$(num unresolved_count "$body")
  uc=$(num unchecked_count "$body"); mi=$(num missing_in_lore_count "$body")
  if [ -z "$r" ] || [ -z "$c" ] || [ -z "$un" ]; then echo "в ответе нет счётов плана"; return 1; fi
  echo "релизов с репозиторием: ${r} (поставить RELEASE_OF: ${c}, уже стоит: ${al:-?})"
  echo "по основанию: $(raw by_basis "$body")"
  echo "по репозиторию: $(raw by_repository "$body")"
  echo "неоднозначных: ${am:-?}, нерешённых: ${un}, непроверенных (Forgejo не ответил): ${uc:-?}, Release в Forgejo без записи в LORE: ${mi:-?}"
  if [ "$mode" = dry_run ]; then echo "СУХОЙ ПРОГОН — ничего не записано"; return 0; fi
  local x
  x=$(num failed "$body"); c=$(num created "$body")
  if [ -z "$x" ]; then echo "в ответе нет счёта провалов"; return 1; fi
  echo "ИТОГ: поставлено RELEASE_OF ${c:-?}, провалов ${x}"
  if [ "$x" != 0 ] || [ "$code" != 200 ]; then
    echo "провалы: $(printf '%s' "$body" | tr -d '
' | grep -oE '"failed_items"[[:space:]]*:.*' | head -c 4000)"
    return 1
  fi
  return 0
}

# Стенд → базовый адрес. Адреса — те же, что у проб LORE CD (препрод) и выкатки прода.
base_of() {
  case "$1" in
    preprod) echo "https://preprod.lore.odal.seidrstudio.pro" ;;
    prod)    echo "https://lore.odal.seidrstudio.pro" ;;
    *)       return 1 ;;
  esac
}

fetch_token() {
  local issuer="${LORE_OIDC_ISSUER:-}" out code body tok
  if [ -z "$issuer" ] || [ -z "${PROBE_CLIENT_ID:-}" ] || [ -z "${PROBE_CLIENT_SECRET:-}" ]; then
    echo "::error::BLOCKED: нет токена — не заданы LORE_OIDC_ISSUER и/или секреты LORE_CD_PROBE_CLIENT_ID / LORE_CD_PROBE_CLIENT_SECRET (Forgejo: Settings -> Actions -> Secrets)." >&2
    return 1
  fi
  out=$(MIG_TIMEOUT=20 http -X POST "${issuer%/}/protocol/openid-connect/token" \
    -d grant_type=client_credentials \
    --data-urlencode "client_id=${PROBE_CLIENT_ID}" \
    --data-urlencode "client_secret=${PROBE_CLIENT_SECRET}")
  code=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')
  tok=$(printf '%s' "$body" | tr -d '\n\r' | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ "$code" != "200" ] || [ -z "$tok" ]; then
    echo "::error::токен не получен: KC ответил HTTP $code ($(printf '%s' "$body" | head -c 200))" >&2
    return 1
  fi
  printf '%s' "$tok"
}

run() {
  local mode="$1" base="${2%/}" tok out code body verdict rc url
  case "$mode" in dry_run|apply) ;; *) echo "::error::mode='$mode' — допустимы dry_run | apply"; return 2 ;; esac
  url="${base}/lore/release-repository/migrate"
  tok="${MIG_TOKEN:-}"
  [ -n "$tok" ] || tok=$(fetch_token) || return 1
  echo "режим: $mode, адрес: $url"
  if [ "$mode" = apply ]; then
    out=$(http -X POST -H "Authorization: Bearer ${tok}" -H 'Accept: application/json' "${url}?apply=true")
  else
    out=$(http -H "Authorization: Bearer ${tok}" -H 'Accept: application/json' "${url}")
  fi
  code=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')
  verdict=$(judge "$mode" "$code" "$body"); rc=$?
  printf '%s\n' "$verdict"
  {
    echo "## Миграция релиз→репозиторий: $mode"
    echo '```'
    printf '%s\n' "$verdict"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  echo "::group::ответ сервера целиком"
  printf '%s\n' "$body" | head -c 60000; echo
  echo "::endgroup::"
  if [ "$rc" -ne 0 ]; then echo "::error::миграция ($mode) КРАСНАЯ: $(printf '%s' "$verdict" | head -1)"; fi
  return "$rc"
}

if [ "${1:-}" = "--selftest" ]; then
  rc=0
  ok()  { judge "$@" >/dev/null || { echo "::error::selftest FAIL — зелёный признан красным: $1 $2 $(printf '%s' "$3" | head -c 80)"; rc=1; }; }
  bad() { judge "$@" >/dev/null && { echo "::error::selftest FAIL — красный признан зелёным: $1 $2 $(printf '%s' "$3" | head -c 80)"; rc=1; }; }
  P='{"migration_id":"release-of-repository","dry_run":true,"edge":"RELEASE_OF","resolved":3,"to_create":2,"already":1,"ambiguous_count":0,"unresolved_count":1,"unchecked_count":0,"missing_in_lore_count":1,"by_basis":{"forgejo_release":2},"by_repository":{"x":3},"ambiguous":[],"unresolved":[{"release_uid":"a#b"}],"items":[]}'
  A='{"migration_id":"release-of-repository","dry_run":false,"edge":"RELEASE_OF","resolved":3,"to_create":2,"already":1,"ambiguous_count":0,"unresolved_count":0,"unchecked_count":0,"missing_in_lore_count":0,"by_basis":{},"by_repository":{},"items":[],"created":2,"failed":0,"failed_items":[]}'
  AF='{"migration_id":"release-of-repository","dry_run":false,"edge":"RELEASE_OF","resolved":3,"to_create":2,"already":1,"ambiguous_count":0,"unresolved_count":0,"unchecked_count":0,"missing_in_lore_count":0,"by_basis":{},"by_repository":{},"items":[],"created":1,"failed":1,"failed_items":[{"release_uid":"a#b","error":"x"}]}'
  ok  dry_run 200 "$P"
  ok  apply   200 "$A"
  bad apply   207 "$AF"
  bad apply   200 "$AF"
  bad apply   207 "$A"
  bad dry_run 200 '<!doctype html><html></html>'
  bad dry_run 403 '{"error":"FORBIDDEN"}'
  bad apply   401 '{}'
  bad apply   000 ''
  bad dry_run 200 '{"migration_id":"release-of-repository"}'
  [ "$(num unresolved_count "$P")" = 1 ] || { echo "::error::selftest FAIL — unresolved_count"; rc=1; }
  ( unset MIG_TOKEN PROBE_CLIENT_ID PROBE_CLIENT_SECRET
    LORE_OIDC_ISSUER=https://kc.invalid/realms/x run dry_run "http://127.0.0.1:1" >/dev/null 2>&1 ) \
    && { echo "::error::selftest FAIL — без секретов прошло зелёным"; rc=1; }
  ( MIG_TOKEN=x run bogus "http://127.0.0.1:1" >/dev/null 2>&1 ) \
    && { echo "::error::selftest FAIL — неизвестный режим прошёл"; rc=1; }
  [ "$(base_of preprod)" = https://preprod.lore.odal.seidrstudio.pro ] || { echo "::error::selftest FAIL — адрес препрода"; rc=1; }
  [ "$(base_of prod)" = https://lore.odal.seidrstudio.pro ] || { echo "::error::selftest FAIL — адрес прода"; rc=1; }
  base_of staging >/dev/null && { echo "::error::selftest FAIL — неизвестный стенд принят"; rc=1; }
  [ "$rc" -eq 0 ] && echo "selftest ok"; exit "$rc"
fi

if [ "${1:-}" = "--resolve-target" ]; then
  b=$(base_of "${2:-}") || { echo "::error::target='${2:-}' — допустимы preprod | prod"; exit 2; }
  echo "стенд ${2}: $b"
  echo "LORE_BASE=$b" >> "${GITHUB_ENV:-/dev/null}"
  exit 0
fi

if [ "$#" -ne 2 ]; then
  echo "::error::использование: release-repository-migrate.sh <dry_run|apply> <базовый адрес> | --selftest"
  exit 2
fi
run "$1" "$2"
