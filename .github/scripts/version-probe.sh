#!/usr/bin/env bash
# Проба после деплоя: /lore/version отвечает ЧЕРЕЗ :4400 (SPRINT_UXR_S0_SAFETY/S0-03).
#
# ЗАЧЕМ. Все проверки LORE CD до этого шага смотрят на сервисы ИЗНУТРИ:
# `docker exec … curl http://127.0.0.1/` во фронте, `curl http://lore-backend:9100`
# по сети compose. Ни одна не проходит путь пользователя — опубликованный порт
# :4400 → nginx lore-app → прокси /lore/ → бэкенд → проверка токена. Ломается
# любое звено этого пути (порт не опубликован, location /lore/ потерян в
# шаблоне nginx, issuer токена не сходится) — деплой зелёный, а LORE снаружи
# мёртв. Проба закрывает именно этот путь, и ничего сверх него.
#
# ЧТО СЧИТАЕТСЯ ЗЕЛЁНЫМ (все условия сразу):
#   • HTTP 200 — не 401 (токен не принят), не 000 (порт не слушает);
#   • тело — JSON с полем "commit". SPA отдаёт 200 text/html на ЛЮБОЙ путь,
#     поэтому «200» без JSON значит «nginx не проксирует /lore/», а не «жив»;
#   • если задан EXPECT_COMMIT — commit в ответе с ним совпадает (префиксом,
#     в любую сторону: короткий и полный sha). Иначе отвечает СТАРЫЙ бэкенд.
#
# ТОКЕН. /lore/** под OIDC закрыт (SeerRoleFromTokenFilter.isProtected), версия
# читается любым аутентифицированным вызывающим. Берём client_credentials из
# realm'а LORE_OIDC_ISSUER учёткой PROBE_CLIENT_ID/PROBE_CLIENT_SECRET (секреты
# CI). Секретов нет — КРАСНЫЙ, а не пропуск: молча пропущенная проба выглядит
# ровно как пройденная. PROBE_TOKEN, если задан, используется как есть (ручной
# прогон и самопроверка).
#
# КАК ДОХОДИМ ДО :4400. Джоб крутится в контейнере раннера на отдельной сети —
# его 127.0.0.1 это он сам. Поэтому workflow подставляет PROBE_CURL с
# одноразовым контейнером в сети хоста (`docker run --network host … curl`).
# Тело и код читаются со stdout (через -w), а не из файла: файл остался бы
# внутри одноразового контейнера.
#
# ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ. `--selftest` гоняет разбор ответа на подделках И
# настоящим curl'ом стучится в закрытый порт: проба, о которой не доказано,
# что она умеет краснеть, — декорация.
#
# Отдельным файлом, а не bash в `run:` — многострочный bash в workflow уже
# дважды ломал разбор у Forgejo (см. resolve-proxy.sh).
set -uo pipefail

# Вердикт по ответу. Печатает причину; код 0 — зелёный, 1 — красный.
# $1 — HTTP-код, $2 — тело, $3 — ожидаемый commit (может быть пуст).
judge() {
  local code="$1" body="$2" expect="$3" commit
  case "$code" in
    200) ;;
    000|"") echo "нет ответа (HTTP ${code:-пусто}) — порт не слушает или адрес недоступен"; return 1 ;;
    401)   echo "HTTP 401 — токен не принят бэкендом (issuer/realm/учётка пробы)"; return 1 ;;
    403)   echo "HTTP 403 — токен принят, но доступа к /lore/version нет"; return 1 ;;
    *)     echo "HTTP $code — ожидался 200"; return 1 ;;
  esac
  commit=$(printf '%s' "$body" | tr -d '\n\r' | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -z "$commit" ]; then
    echo "HTTP 200, но в теле нет JSON-поля commit — это не /lore/version (вероятно, SPA-заглушка: nginx не проксирует /lore/)"
    return 1
  fi
  if [ -n "$expect" ]; then
    case "$expect" in "$commit"*) ;; *)
      case "$commit" in "$expect"*) ;; *)
        echo "отвечает бэкенд коммита $commit, а выкатывали $expect — новый образ не поднялся"
        return 1 ;;
      esac ;;
    esac
  fi
  echo "ok: /lore/version отвечает, commit=$commit"
  return 0
}

# curl с выводом «тело\nКОД» на stdout. Команда curl — из PROBE_CURL (в CD это
# одноразовый контейнер в сети хоста).
http() {
  # shellcheck disable=SC2086 # PROBE_CURL — составная команда намеренно
  ${PROBE_CURL:-curl} -s -m "${PROBE_TIMEOUT:-15}" -w '\n%{http_code}' "$@" || true
  # При отказе соединения curl сам печатает «000» через -w; если curl не
  # запустился вовсе — код пуст, и judge() это тоже считает красным.
}

fetch_token() {
  local issuer="${LORE_OIDC_ISSUER:-}" out code body tok
  if [ -z "$issuer" ] || [ -z "${PROBE_CLIENT_ID:-}" ] || [ -z "${PROBE_CLIENT_SECRET:-}" ]; then
    echo "::error::BLOCKED: проба /lore/version без токена невозможна — не заданы LORE_OIDC_ISSUER и/или секреты LORE_CD_PROBE_CLIENT_ID / LORE_CD_PROBE_CLIENT_SECRET. Заведите в realm omilore confidential-клиент с service account (client_credentials) и положите его id/secret в Forgejo: Settings -> Actions -> Secrets." >&2
    return 1
  fi
  out=$(http -X POST "${issuer%/}/protocol/openid-connect/token" \
    -d grant_type=client_credentials \
    --data-urlencode "client_id=${PROBE_CLIENT_ID}" \
    --data-urlencode "client_secret=${PROBE_CLIENT_SECRET}")
  code=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')
  tok=$(printf '%s' "$body" | tr -d '\n\r' | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ "$code" != "200" ] || [ -z "$tok" ]; then
    # Тело не печатаем целиком: при ошибке KC там нет секрета, но и пользы мало.
    echo "::error::токен для пробы не получен: KC ответил HTTP $code ($(printf '%s' "$body" | head -c 200))" >&2
    return 1
  fi
  printf '%s' "$tok"
}

# Полная проба. $1 — базовый адрес (например http://127.0.0.1:4400).
probe() {
  local base="${1%/}" tok out code body verdict rc attempt=1
  local attempts="${PROBE_ATTEMPTS:-6}" delay="${PROBE_DELAY:-5}"
  tok="${PROBE_TOKEN:-}"
  if [ -z "$tok" ]; then
    tok=$(fetch_token) || return 1
  fi
  # Повторы — только на отказ соединения (000): nginx пересоздаётся последним
  # шагом и может не успеть открыть порт. 401/200-без-JSON повтором не лечатся.
  while : ; do
    out=$(http -H "Authorization: Bearer ${tok}" -H 'Accept: application/json' "${base}/lore/version")
    code=$(printf '%s' "$out" | tail -n 1)
    body=$(printf '%s' "$out" | sed '$d')
    verdict=$(judge "$code" "$body" "${EXPECT_COMMIT:-}"); rc=$?
    if [ "$rc" -eq 0 ] || [ "$code" != "000" ] || [ "$attempt" -ge "$attempts" ]; then break; fi
    echo "попытка $attempt: $verdict — повтор через ${delay}с"
    sleep "$delay"; attempt=$((attempt + 1))
  done
  if [ "$rc" -ne 0 ]; then
    echo "::error::проба ${base}/lore/version КРАСНАЯ: $verdict"
    printf '%s' "$body" | head -c 400; echo
    return 1
  fi
  echo "$verdict (через ${base})"
}

if [ "${1:-}" = "--selftest" ]; then
  rc=0
  ok()  { judge "$@" >/dev/null || { echo "::error::selftest FAIL — зелёный ответ признан красным: $*"; rc=1; }; }
  bad() { judge "$@" >/dev/null && { echo "::error::selftest FAIL — красный ответ признан зелёным: $*"; rc=1; }; }
  J='{"commit":"abc123def456","built_at":"2026-11-07T00:00:00Z","schema_version":90}'
  ok  200 "$J" ""
  ok  200 "$J" "abc123def456"
  ok  200 "$J" "abc123def4567890ffff"        # полный sha против короткого
  ok  200 '{"commit":"abc123def4567890ffff"}' "abc123def456"
  bad 200 "$J" "0000000"                      # старый бэкенд
  bad 200 '<!doctype html><html></html>' ""   # SPA-заглушка вместо прокси
  bad 401 '{"code":"UNAUTHENTICATED"}' ""
  bad 403 '{}' ""
  bad 502 'Bad Gateway' ""
  bad 000 '' ""
  bad ""  '' ""
  # Положительный контроль настоящим curl'ом: неверный порт обязан дать красный.
  # Порт 1 (tcpmux) на этих машинах не слушает никто.
  if command -v curl >/dev/null 2>&1; then
    PROBE_TOKEN=x PROBE_ATTEMPTS=1 PROBE_TIMEOUT=3 PROBE_CURL=curl probe "http://127.0.0.1:1" >/dev/null 2>&1 \
      && { echo "::error::selftest FAIL — проба по неверному порту прошла зелёной"; rc=1; }
  else
    echo "::error::selftest: curl не найден — контроль неверного порта не выполнен"; rc=1
  fi
  # Без секретов — красный, а не пропуск.
  ( unset PROBE_TOKEN PROBE_CLIENT_ID PROBE_CLIENT_SECRET
    LORE_OIDC_ISSUER=https://kc.invalid/realms/x probe "http://127.0.0.1:1" >/dev/null 2>&1 ) \
    && { echo "::error::selftest FAIL — проба без секретов прошла зелёной"; rc=1; }
  [ "$rc" -eq 0 ] && echo "selftest ok"; exit "$rc"
fi

if [ "$#" -ne 1 ]; then
  echo "::error::использование: version-probe.sh <базовый адрес, напр. http://127.0.0.1:4400> | --selftest"
  exit 2
fi
probe "$1"
