#!/usr/bin/env bash
# Проба «по публичному имени отдаётся ИМЕННО этот бандл» —
# SPRINT_LORE_PIPELINE_HOST/PL-04 (препрод) и PL-05 (прод).
#
# Использование: bundle-probe.sh <метка> <ожидаемое> <url>
#   <ожидаемое>:
#     container:<сервис>  — бандл из index.html работающего контейнера проекта
#                           (docker compose ps -q <сервис>), препрод;
#     image:<образ>       — бандл из index.html внутри образа, прод: образ на 131
#                           тот же, что уехал на lore-host (сверен по Id);
#     assets/index-….js   — готовое значение.
#
# Зачем: «200 на /» отдаёт и старый контейнер, и чужой маршрут Traefik, и SPA
# другого фронта. Совпадение хэша бандла в index.html по ИМЕНИ с бандлом нового
# образа — единственный признак, что пользователь получит новую сборку.
#
# Публичный адрес берётся одноразовым curl в сети ХОСТА (PROBE_CURL): своё
# 127.0.0.1 и DNS у контейнера джоба — его собственные. Повторы — только на «нет
# ответа» (000): первый сертификат regru выписывается DNS-01 и может опоздать.
set -uo pipefail

label="${1:-}" want="${2:-}" url="${3:-}"
if [ -z "$label" ] || [ -z "$want" ] || [ -z "$url" ]; then
  echo "::error::использование: bundle-probe.sh <метка> <container:svc|image:img|assets/index-….js> <url>"
  exit 2
fi

RE='assets/index-[A-Za-z0-9_-]+\.js'
first_bundle() { grep -oE "$RE" | head -1; }

case "$want" in
  container:*)
    svc="${want#container:}"
    cid="$(docker compose ps -q "$svc" 2>/dev/null | head -1)"
    [ -n "$cid" ] || { echo "::error::[$label] контейнер $svc не найден — сверять не с чем"; exit 1; }
    want="$(docker exec "$cid" curl -s -m 10 http://127.0.0.1/ | first_bundle)"
    ;;
  image:*)
    img="${want#image:}"
    want="$(docker run --rm --entrypoint cat "$img" /usr/share/nginx/html/index.html 2>/dev/null | first_bundle)"
    ;;
esac
[ -n "$want" ] || { echo "::error::[$label] ожидаемый бандл не определён (в index.html нет $RE)"; exit 1; }

# shellcheck disable=SC2206 # PROBE_CURL — составная команда намеренно
CURL=(${PROBE_CURL:-docker run --rm --network host curlimages/curl:latest curl})
attempts="${PROBE_ATTEMPTS:-12}" delay="${PROBE_DELAY:-10}" i=1 got="" code=""
while :; do
  raw="$("${CURL[@]}" -s -m 15 -w '\n%{http_code}' "$url" 2>/dev/null || true)"
  code="$(printf '%s' "$raw" | tail -n1)"
  got="$(printf '%s' "$raw" | sed '$d' | first_bundle)"
  case "$code" in [0-9][0-9][0-9]) ;; *) code=000 ;; esac
  [ "$code" != "000" ] || [ "$i" -ge "$attempts" ] && break
  echo "[$label] попытка $i: $url не ответил — повтор через ${delay}с"
  sleep "$delay"; i=$((i + 1))
done

echo "[$label] $url → HTTP $code, бандл ${got:-<нет>}; ждём $want"
if [ "$code" != "200" ]; then
  echo "::error::[$label] $url → HTTP $code — по имени страница не отдаётся (DNS, сертификат, маршрут Traefik)"
  exit 1
fi
if [ "$got" != "$want" ]; then
  echo "::error::[$label] по $url отдаётся бандл ${got:-<нет>}, а у нового образа $want — по имени работает НЕ новая сборка (или маршрут ведёт не туда)"
  exit 1
fi
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- $label: $url отдаёт $got" >> "$GITHUB_STEP_SUMMARY"
echo "ok: [$label] бандл совпал"
