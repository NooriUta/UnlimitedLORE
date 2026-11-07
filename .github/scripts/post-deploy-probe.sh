#!/usr/bin/env bash
# Пробы стенда ПОСЛЕ выкатки (SPRINT_UXR_S3_V2_INFRA/S3-06).
#
# ЗАЧЕМ. Шаги «Verify …» в lore-cd.yml смотрят изнутри контейнера: процесс
# поднят, бандл на месте. Они не видят того, что видит клиент: дошёл ли
# запрос через nginx до бэкенда и ТОТ ли это бэкенд. SPA отдаёт 200 с
# index.html на любой путь, поэтому «200 на /lore/version» без проверки типа
# ответа подтверждает не бэкенд, а заглушку фронта.
#
#   post-deploy-probe.sh version <метка> <url> [ожидаемый_коммит]
#       Ручка /lore/version (SE-10). Успех — JSON от бэкенда; с третьим
#       аргументом — ещё и коммит сборки совпадает с выкатываемым.
#       401/403 — бэкенд за прокси жив, но коммит НЕ ПРОВЕРЕН (ручка закрыта
#       auth); это не провал, но и не «всё сверено» — говорится вслух.
#
#   post-deploy-probe.sh v2-page <url>
#       Публичный адрес v2 (D-2026-UXR-V2-HOST). Успех — отдаётся index именно
#       v2 (<title>LORE v2</title>), а не v1 через временный роутер Traefik.
#       Строгость — LORE_V2_PUBLIC_PROBE: required (провал валит деплой) |
#       warn (по умолчанию: громкое предупреждение, деплой зелёный). warn —
#       пока DNS/сертификат/роутер (S3-03/04) не доделаны; после — required.
#
# Запрос идёт одноразовым контейнером curl, а не curl раннера: раннер живёт в
# своей сети, и его 127.0.0.1 — он сам (см. комментарии в lore-cd.yml).
# PROBE_NETWORK — сеть compose-проекта для адресов вида http://lore-app-next/.
set -uo pipefail

IMAGE="${PROBE_CURL_IMAGE:-curlimages/curl:latest}"

say_summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"
  return 0
}

# fetch URL → глобальные BODY, CODE, CTYPE. Код выхода curl не роняет скрипт:
# «нет ответа» — это CODE=000, и решает классификатор ниже, а не set -e.
fetch() {
  local net=() raw
  [ -n "${PROBE_NETWORK:-}" ] && net=(--network "$PROBE_NETWORK")
  raw="$(docker run --rm "${net[@]}" "$IMAGE" curl -s -m 15 \
    -w '\n%{http_code} %{content_type}' "$1" 2>/dev/null)"
  local last="${raw##*$'\n'}"
  BODY="${raw%$'\n'*}"
  [ "$BODY" = "$raw" ] && BODY=""
  CODE="${last%% *}"
  CTYPE="${last#* }"
  [ "$CTYPE" = "$last" ] && CTYPE=""
  case "$CODE" in [0-9][0-9][0-9]) ;; *) CODE=000 ;; esac
}

probe_version() {
  local label="$1" url="$2" want="${3:-}"
  fetch "$url"
  echo "[$label] GET $url → HTTP $CODE ${CTYPE:-<без типа>}"
  case "$CODE" in
    200)
      case "$CTYPE" in
        *json*) ;;
        *)
          echo "::error::[$label] $url отдал 200 ${CTYPE:-без типа}, а не JSON — это SPA-заглушка фронта (index.html), запрос до бэкенда не дошёл: прокси /lore/ в nginx не работает"
          return 1 ;;
      esac
      local got
      got="$(printf '%s' "$BODY" | tr -d '\n' | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      if [ -z "$want" ]; then
        echo "[$label] бэкенд отвечает за прокси (коммит ${got:-?}, сверка не требовалась — бэкенд в этом прогоне не выкатывался)"
        say_summary "- $label: бэкенд за прокси жив (коммит ${got:-?})"
        return 0
      fi
      case "$got" in
        "")
          echo "::error::[$label] в ответе $url нет поля commit — ручка не та или сломана: $BODY"
          return 1 ;;
        unknown)
          echo "::warning::[$label] бэкенд отвечает, но коммит сборки unknown — build-info.properties не попал в образ, сверка НЕ ПРОВЕРЕНА"
          say_summary "- $label: бэкенд жив, коммит НЕ ПРОВЕРЕН (unknown)"
          return 0 ;;
      esac
      case "$want" in
        "$got"*)
          echo "[$label] коммит сборки совпал: $got"
          say_summary "- $label: коммит $got совпал с выкатываемым"
          return 0 ;;
      esac
      echo "::error::[$label] $url отвечает сборкой $got, а выкатывался $want — по этому адресу работает НЕ новый бэкенд"
      return 1 ;;
    401|403)
      echo "::warning::[$label] $url → HTTP $CODE: бэкенд за прокси отвечает, но ручка закрыта auth — коммит сборки НЕ ПРОВЕРЕН"
      say_summary "- $label: бэкенд жив (HTTP $CODE), коммит НЕ ПРОВЕРЕН"
      return 0 ;;
    000)
      echo "::error::[$label] $url не ответил вовсе (таймаут/отказ соединения/DNS)"
      return 1 ;;
    *)
      echo "::error::[$label] $url → HTTP $CODE: $(printf '%s' "$BODY" | head -c 300)"
      return 1 ;;
  esac
}

probe_v2_page() {
  local url="$1" mode="${LORE_V2_PUBLIC_PROBE:-warn}" problem=""
  case "$mode" in
    required|warn) ;;
    *)
      echo "::error::LORE_V2_PUBLIC_PROBE=$mode — допустимо только required или warn"
      return 2 ;;
  esac
  fetch "$url"
  echo "[v2 public] GET $url → HTTP $CODE ${CTYPE:-<без типа>} (режим $mode)"
  if [ "$CODE" = 200 ]; then
    if printf '%s' "$BODY" | grep -q '<title>LORE v2</title>'; then
      echo "[v2 public] $url отдаёт v2"
      say_summary "- v2 public: $url отдаёт v2"
      return 0
    fi
    problem="$url отдаёт не v2 (заголовок: $(printf '%s' "$BODY" | grep -o '<title>[^<]*</title>' | head -1)) — вероятно, v1 через временный роутер Traefik: метки lore-app-next его ещё не перебили (S3-04)"
  elif [ "$CODE" = 000 ]; then
    problem="$url не ответил — нет DNS-записи/сертификата (S3-03) или роутера Traefik (S3-04)"
  else
    problem="$url → HTTP $CODE"
  fi
  if [ "$mode" = required ]; then
    echo "::error::[v2 public] $problem"
    return 1
  fi
  echo "::warning::[v2 public] НЕ ПРОВЕРЕНО как v2: $problem. Деплой не валится (LORE_V2_PUBLIC_PROBE=warn); после S3-03/04 переключить переменную репозитория на required."
  say_summary "- v2 public: НЕ v2 / НЕ ПРОВЕРЕНО — $problem"
  return 0
}

case "${1:-}" in
  version)
    [ "$#" -ge 3 ] || { echo "::error::usage: $0 version <метка> <url> [коммит]"; exit 2; }
    probe_version "$2" "$3" "${4:-}"; exit $? ;;
  v2-page)
    [ "$#" -ge 2 ] || { echo "::error::usage: $0 v2-page <url>"; exit 2; }
    probe_v2_page "$2"; exit $? ;;
  *)
    echo "::error::usage: $0 version|v2-page …"; exit 2 ;;
esac
