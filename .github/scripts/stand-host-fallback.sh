#!/usr/bin/env bash
# Фолбэк имени препрода на IP для контейнера джобы — как у прода (владелец 26.11.2026: «как и для прода
# прописать fallback на IP»).
#
# Препрод внутренний: имя preprod.lore.odal разрешает CoreDNS на ci-server 131, публичных записей нет.
# 26.11 (прогоны 11164/11165) из контейнера джобы имя перестало разрешаться: «DNS: не разрешается»,
# через прокси — «SSL unexpected eof». Playwright не умеет --resolve, поэтому:
#   • имя разрешается — ничего не трогаем (печатаем, куда ведёт);
#   • не разрешается — дописываем «IP имя» в /etc/hosts контейнера и громко предупреждаем;
#   • в обоих случаях имя и IP идут мимо прокси (NO_PROXY в $GITHUB_ENV): прокси раннера внутренний
#     адрес не знает и рвёт TLS.
# Сертификат Traefik на 131 выписан на это имя — TLS проверяется как обычно.
set -uo pipefail

HOST="${STAND_HOST:-preprod.lore.odal.seidrstudio.pro}"
IP="${STAND_HOST_IP:-192.168.3.131}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"

if getent hosts "$HOST" >/dev/null 2>&1; then
  echo "имя $HOST разрешается: $(getent hosts "$HOST" | head -1)"
else
  if printf '%s %s\n' "$IP" "$HOST" >> "$HOSTS_FILE" 2>/dev/null; then
    echo "::warning::имя $HOST из контейнера джобы не разрешается — фолбэк на IP $IP (запись в $HOSTS_FILE)"
  else
    echo "::error::имя $HOST не разрешается, а $HOSTS_FILE не записывается — фолбэк на IP не поставлен"
    exit 1
  fi
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "NO_PROXY=${NO_PROXY:+$NO_PROXY,}$HOST,$IP" >> "$GITHUB_ENV"
  echo "no_proxy=${no_proxy:+$no_proxy,}$HOST,$IP" >> "$GITHUB_ENV"
fi
