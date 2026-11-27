#!/usr/bin/env bash
# Диагностика сервиса артефактов изнутри контейнера джобы (26.11.2026, Forgejo 17).
# Прогон 11182: upload-artifact@v3 → «Create Artifact Container: socket hang up» ×5 на ПЕРВОМ
# запросе. Печатает хост из ACTIONS_RUNTIME_URL (без токена и пути), его DNS и ответ TCP/HTTP —
# чтобы отличить «имя не разрешается» от «сервер рвёт соединение». Ничего не роняет.
set -uo pipefail

url="${ACTIONS_RUNTIME_URL:-}"
if [ -z "$url" ]; then
  echo "::warning::ACTIONS_RUNTIME_URL в окружении шага нет — раннер отдаёт его только JS-действиям; диагностика без адреса"
  exit 0
fi
hostport="$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^/]+).*#\1#')"
host="${hostport%%:*}"
base="$(printf '%s' "$url" | sed -E 's#^([a-z]+://[^/]+).*#\1#')"
echo "сервис артефактов: $base"
if getent hosts "$host" >/dev/null 2>&1; then
  echo "DNS: $(getent hosts "$host" | head -1)"
else
  echo "::warning::DNS: имя $host из контейнера джобы не разрешается — вероятная причина «socket hang up»"
fi
echo "напрямую: $(env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy curl -sS -o /dev/null --max-time 15 -w '%{http_code} %{remote_ip} %{time_total}s' "$base/" 2>&1)"
echo "через прокси (${HTTPS_PROXY:-нет}): $(curl -sS -o /dev/null --max-time 15 -w '%{http_code} %{remote_ip} %{time_total}s' "$base/" 2>&1)"
exit 0
