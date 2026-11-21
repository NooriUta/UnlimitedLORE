#!/usr/bin/env bash
# Публикация образов мажорного релиза LORE в GitHub Container Registry
# (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE, решение владелицы 14.11.2026:
# «ghcr.io через наше зеркало, только мажорные версии»). Внешний установщик
# (deploy/install/install.sh) берёт эти образы без входа.
#
#   ghcr-publish.sh is-major <TAG>   — код 0, если тег мажорный (vX.Y.0)
#   ghcr-publish.sh publish          — тег и SRC8 из $DEPLOY_STATE (lore-host-deploy.sh resolve)
#   ghcr-publish.sh --selftest       — проверка правила без docker
#
# Правило мажора — то же, что у github-major-sync (D-2026-GITHUB-ONLY-MAJOR-VERSIONS):
# строго ^vX.Y.0$ (X.Y.0 — слово владелицы 14.11.2026). Меняется в одном месте вместе с ним — иначе ghcr и GitHub разойдутся.
# Публикуются ТЕ ЖЕ образы, что прошли препрод и уехали на прод (:sha8 на 131), без пересборки.
# Токен — секрет организации GHCR_PUSH_TOKEN (только write:packages), логин — NooriUta.
set -euo pipefail

GHCR_OWNER="${GHCR_OWNER:-nooriuta}"
GHCR_LOGIN="${GHCR_LOGIN:-NooriUta}"
# Сервис на 131 → имя пакета в ghcr.
# 1.18.2: lore-mcp — MCP пакета установки (deploy/install, сервис lore-mcp).
PAIRS="lore-backend:lore-backend lore-app-next:lore-web lore-mcp:lore-mcp"

is_major() { [[ "${1:-}" =~ ^v[0-9]+\.[0-9]+\.0$ ]]; }

publish() {
  local state="${DEPLOY_STATE:-/tmp/lore-deploy.env}" tag src8 pair svc pkg src dst
  [ -f "$state" ] || { echo "::error::нет $state — сначала lore-host-deploy.sh resolve"; exit 1; }
  tag="$(sed -n 's/^TAG=//p' "$state" | tail -1)"
  src8="$(sed -n 's/^SRC8=//p' "$state" | tail -1)"
  [ -n "$tag" ] && [ -n "$src8" ] || { echo "::error::в $state нет TAG/SRC8"; exit 1; }
  if ! is_major "$tag"; then echo "тег $tag не мажорный (vX.Y.0) — в ghcr не публикуется"; return 0; fi
  if [ -z "${GHCR_PUSH_TOKEN:-}" ]; then
    echo "::error::BLOCKED: публикация $tag в ghcr невозможна — нет секрета GHCR_PUSH_TOKEN (организация AIDA, write:packages). Завести — через CICDGitHub."
    exit 1
  fi
  printf '%s' "$GHCR_PUSH_TOKEN" | docker login ghcr.io -u "$GHCR_LOGIN" --password-stdin >/dev/null
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
  for pair in $PAIRS; do
    svc="${pair%%:*}"; pkg="${pair##*:}"
    src="unlimitedlore-$svc:$src8"
    dst="ghcr.io/$GHCR_OWNER/$pkg:$tag"
    docker image inspect "$src" >/dev/null 2>&1 || { echo "::error::нет образа $src на 131 — он не прошёл препрод"; exit 1; }
    docker tag "$src" "$dst"
    docker push "$dst"
    echo "опубликовано: $dst (из $src)"
  done
}

selftest() {
  local n=0 t
  for t in v1.0.0 v2.0.0 v12.0.0 v1.17.0 v1.18.0; do is_major "$t" || { echo "selftest FAIL: $t — мажор"; exit 1; }; n=$((n + 1)); done
  for t in v1.17.21 v1.18.3 v2.0.1 v9a0b0 v1a18b0 1.0.0 v1.0.0-rc1 ""; do
    is_major "$t" && { echo "selftest FAIL: «$t» — не мажор"; exit 1; }; n=$((n + 1))
  done
  # Без токена на мажоре — громкий отказ, а не тихий пропуск.
  local d; d="$(mktemp -d)"; printf 'TAG=v3.0.0\nSRC8=abcdef12\n' > "$d/s"
  if out="$(DEPLOY_STATE="$d/s" GHCR_PUSH_TOKEN="" bash "${BASH_SOURCE[0]}" publish 2>&1)"; then
    echo "selftest FAIL: мажор без токена прошёл"; exit 1
  fi
  printf '%s' "$out" | grep -q 'BLOCKED' || { echo "selftest FAIL: нет BLOCKED: $out"; exit 1; }; n=$((n + 1))
  printf 'TAG=v1.17.22\nSRC8=abcdef12\n' > "$d/s"
  out="$(DEPLOY_STATE="$d/s" GHCR_PUSH_TOKEN="" bash "${BASH_SOURCE[0]}" publish 2>&1)" || { echo "selftest FAIL: не-мажор упал: $out"; exit 1; }
  n=$((n + 1)); rm -rf "$d"
  echo "selftest ok ($n проверок)"
}

case "${1:-}" in
  is-major)   is_major "${2:-}" ;;
  publish)    publish ;;
  --selftest) selftest ;;
  *) echo "::error::ghcr-publish.sh: is-major <TAG> | publish | --selftest"; exit 2 ;;
esac
