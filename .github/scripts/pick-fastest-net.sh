#!/usr/bin/env bash
# Выбор быстрого пути в интернет для шага джобы: через прокси (VPN ci-server) или напрямую.
# Владелица 15.11.2026: «поставь проверку и так и так и выбор быстрого варианта».
# Меряет скачивание одного и того же куска (PROBE_BYTES) по каждому пути, побеждает больший КБ/с.
# В Actions пишет выбор в $GITHUB_ENV: напрямую → HTTP_PROXY/HTTPS_PROXY пустые до конца джобы.
#   PROBE_URL   — что качать (по умолчанию CDN Playwright; ставьте адрес, откуда реально тянет шаг)
#   PROBE_BYTES — сколько байт (по умолчанию 2 МБ), PROBE_TIMEOUT — секунд на путь (20)
# Код всегда 0: проба не должна ронять джобу. Печатает: «сеть: <путь> (прокси N КБ/с, напрямую M КБ/с)».
set -u
URL="${PROBE_URL:-https://playwright.azureedge.net/builds/chromium/1148/chromium-headless-shell-linux.zip}"
BYTES="${PROBE_BYTES:-2097152}"; TO="${PROBE_TIMEOUT:-20}"
P="${HTTPS_PROXY:-${HTTP_PROXY:-}}"
speed(){ # $1 = proxy или пусто → КБ/с целым, 0 при ошибке
  local s; s=$(curl -sL -o /dev/null --max-time "$TO" -r "0-$((BYTES-1))" ${1:+-x "$1"} \
                -w '%{speed_download}' "$URL" 2>/dev/null) || s=0
  awk -v s="${s:-0}" 'BEGIN{printf "%d", s/1024}'
}
direct=$(HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= speed "")
if [ -n "$P" ]; then via=$(speed "$P"); else via=0; fi
if [ -z "$P" ] || [ "$direct" -ge "$via" ]; then
  choice=напрямую
  [ -n "${GITHUB_ENV:-}" ] && printf 'HTTP_PROXY=\nHTTPS_PROXY=\nhttp_proxy=\nhttps_proxy=\n' >> "$GITHUB_ENV"
else
  choice=прокси
fi
echo "сеть: $choice (прокси ${via} КБ/с, напрямую ${direct} КБ/с; проба ${URL%%\?*})"
exit 0
