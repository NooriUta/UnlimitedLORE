#!/usr/bin/env bash
# Миграция «задача → компонент»: BELONGS_TO KnowTask → LoreComponent → TAGGED_WITH.
# Вызывается из workflow migrate-qg-task-component-edge.yml (только ручной запуск).
#
# ЗАЧЕМ. Промоушен находки QG ставил задаче ребро BELONGS_TO, а паспорт задачи,
# срез component_tasks и граф читают TAGGED_WITH — компонент таких задач не виден.
# Запись исправлена в PR #1265; старые рёбра переводит СЕРВЕР
# (/lore/link/task-component-edge/migrate, LoreTaskComponentEdgeMigration), а не
# прямой SQL отсюда: запись — только через API, ради журнала AO-01 и проверки роли.
#
# РЕЖИМЫ (MODE):
#   dry_run — GET …/migrate: план, ничего не пишет;
#   apply   — POST …/migrate?apply=true: одна точка журнала AO-01 на прогон.
#             Хоть одна пара не прошла (failed > 0 или HTTP ≠ 200) — шаг КРАСНЫЙ.
#
# ТОКЕН. client_credentials учёткой пробы CD (секреты LORE_CD_PROBE_CLIENT_ID /
# LORE_CD_PROBE_CLIENT_SECRET) в realm LORE_OIDC_ISSUER. Эндпоинт — только admin:
# у service account клиента должна быть realm-роль admin, иначе 403 → КРАСНЫЙ с
# пояснением (BLOCKED), а не пропуск. Значения секретов не печатаются.
#
# Разбор JSON — sed по ПЕРВОМУ вхождению поля: сервер кладёт счёты верхнего уровня
# (found/created/deleted/…) раньше списка items, у которого есть поля с теми же
# именами. jq на раннере не гарантирован.
#
# `--selftest` — разбор исходов на подделках: проба, о которой не доказано, что
# она умеет краснеть, — декорация.
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
  if [ "$mode" = dry_run ]; then
    local tasks pairs c d u
    tasks=$(num tasks "$body"); pairs=$(num pairs "$body")
    c=$(num to_create "$body"); d=$(num to_delete "$body"); u=$(num unchanged "$body")
    if [ -z "$tasks" ] || [ -z "$c" ] || [ -z "$d" ]; then echo "в ответе нет счётов плана"; return 1; fi
    echo "ПЛАН (ничего не записано): задач ${tasks}, пар задача→компонент ${pairs:-?}, создать TAGGED_WITH ${c}, удалить BELONGS_TO ${d}, TAGGED_WITH уже есть ${u:-?}"
    echo "по источнику задач: $(raw by_src "$body")"
    echo "task_uid: $(raw task_uids "$body")"
    [ "$tasks" = 0 ] && echo "старых рёбер нет — применять нечего (без изменений)"
    return 0
  fi
  local f c d u x
  f=$(num found "$body"); c=$(num created "$body"); d=$(num deleted "$body")
  u=$(num unchanged "$body"); x=$(num failed "$body")
  if [ -z "$f" ] || [ -z "$x" ]; then echo "в ответе нет счётов итога"; return 1; fi
  echo "ИТОГ: найдено пар ${f}, создано TAGGED_WITH ${c:-?}, удалено BELONGS_TO ${d:-?}, без изменений (TAGGED_WITH уже было) ${u:-?}, провалов ${x}"
  [ "$f" = 0 ] && echo "старых рёбер не было — без изменений"
  if [ "$x" != 0 ] || [ "$code" != 200 ]; then
    echo "провалившиеся пары: $(printf '%s' "$body" | tr -d '\n\r' | grep -oE '"failed_items"[[:space:]]*:.*' | head -c 4000)"
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
  url="${base}/lore/link/task-component-edge/migrate"
  tok="${MIG_TOKEN:-}"
  [ -n "$tok" ] || tok=$(fetch_token) || return 1
  echo "режим: $mode, адрес: $url"
  if [ "$mode" = apply ]; then
    out=$(http -X POST -H "Authorization: Bearer ${tok}" -H 'Accept: application/json' "${url}?apply=true")
  else
    out=$(http -H "Authorization: Bearer ${tok}" -H 'Accept: application/json' "${url}?dry_run=true")
  fi
  code=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')
  verdict=$(judge "$mode" "$code" "$body"); rc=$?
  printf '%s\n' "$verdict"
  {
    echo "## Миграция задача→компонент: $mode"
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
  P='{"migration_id":"qg-task-component-edge","dry_run":true,"tasks":2,"pairs":2,"to_create":1,"to_delete":2,"unchanged":1,"noop":false,"by_src":{"qg":2},"task_uids":["S/T-1","S/T-2"],"items":[]}'
  P0='{"migration_id":"qg-task-component-edge","dry_run":true,"tasks":0,"pairs":0,"to_create":0,"to_delete":0,"unchanged":0,"noop":true,"by_src":{},"task_uids":[],"items":[]}'
  A='{"migration_id":"qg-task-component-edge","dry_run":false,"found":2,"created":1,"deleted":2,"unchanged":1,"failed":0,"noop":false,"items":[{"task_uid":"S/T-1","created":true,"deleted":1}],"failed_items":[]}'
  AF='{"migration_id":"qg-task-component-edge","dry_run":false,"found":2,"created":1,"deleted":1,"unchanged":0,"failed":1,"noop":false,"items":[{"task_uid":"S/T-2","created":true,"deleted":1}],"failed_items":[{"task_uid":"S/T-1","error":"x"}]}'
  ok  dry_run 200 "$P"
  ok  dry_run 200 "$P0"
  ok  apply   200 "$A"
  bad apply   207 "$AF"                       # провал пары — красный
  bad apply   200 "$AF"                       # failed>0 даже при 200 — красный
  bad apply   207 "$A"                        # 207 без провалов в теле — всё равно красный
  bad dry_run 200 '<!doctype html><html></html>'
  bad dry_run 403 '{"error":"FORBIDDEN"}'
  bad apply   401 '{}'
  bad apply   000 ''
  bad apply   ""  ''
  bad apply   200 '{"migration_id":"qg-task-component-edge"}'   # нет счётов
  # Счёт верхнего уровня берётся раньше одноимённого поля в items.
  [ "$(num deleted "$A")" = 2 ] || { echo "::error::selftest FAIL — deleted взят не с верхнего уровня"; rc=1; }
  [ "$(raw task_uids "$P")" = '["S/T-1","S/T-2"]' ] || { echo "::error::selftest FAIL — task_uids: $(raw task_uids "$P")"; rc=1; }
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
  echo "::error::использование: task-component-edge-migrate.sh <dry_run|apply> <базовый адрес> | --selftest"
  exit 2
fi
run "$1" "$2"
