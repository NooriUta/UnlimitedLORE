#!/usr/bin/env bash
# Заморозка образа LORE v1 (сервис lore-app) в CD.
# SPRINT_UXR_S3_V2_INFRA/S3-10, решение D-2026-UXR-V2-FOLDER-V1-FROZEN.
#
# CD v1 больше не собирает (ci-scope.sh cd: frontend=true только при ручном
# service=frontend). Этого мало: «не пересобираем» — обещание, а не факт.
# Скрипт делает его проверяемым:
#
#   pin    — до выкатки: запоминает id работающего образа lore-app
#            (V1_IMAGE_BEFORE в $GITHUB_ENV) и закрепляет его тегом
#            FROZEN_TAG (по умолчанию lore-app:v1-frozen), если тега ещё нет.
#            Тег — якорь отката: им же v1 поднимается заново, если стенд
#            потеряет образ. Работает НЕ закреплённый образ — громкое
#            предупреждение (v1 пересобрали мимо CD), тег не переписывается.
#   verify — после выкатки (v1 не выкатывали): образ lore-app тот же, что до.
#            Сменился или контейнер пропал — деплой красный.
#   repin  — после хотфикса v1 (service=frontend): тег переезжает на новый образ.
#
# Id образа (sha256 конфигурации) — и есть digest локально собранного образа:
# RepoDigests у него нет, он не пушится в реестр.
set -uo pipefail

MODE="${1:-}"
TAG="${FROZEN_TAG:-lore-app:v1-frozen}"

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }

running_image() {
  local cid
  cid="$(docker compose ps -q lore-app 2>/dev/null | head -1)"
  [ -n "$cid" ] || return 1
  docker inspect -f '{{.Image}}' "$cid" 2>/dev/null | head -1
}

frozen_image() { docker image inspect -f '{{.Id}}' "$TAG" 2>/dev/null | head -1; }

case "$MODE" in
  pin)
    if ! cur="$(running_image)" || [ -z "$cur" ]; then
      echo "::warning::lore-app (v1) не запущен — закреплять нечего. Образ v1 этим прогоном не собирается; поднять: LORE CD, service=frontend."
      exit 0
    fi
    [ -n "${GITHUB_ENV:-}" ] && echo "V1_IMAGE_BEFORE=$cur" >> "$GITHUB_ENV"
    frozen="$(frozen_image || true)"
    if [ -z "$frozen" ]; then
      docker tag "$cur" "$TAG" || { echo "::error::не удалось поставить тег $TAG на $cur"; exit 1; }
      echo "::notice::v1 закреплён впервые: $TAG → $cur"
    elif [ "$frozen" = "$cur" ]; then
      echo "v1 заморожен: работает $cur = $TAG"
    else
      echo "::warning::lore-app работает на $cur, а закреплён $TAG → $frozen: v1 пересобрали/перезапустили мимо CD. Тег не переписан; вернуть закреплённый — docker tag $TAG <образ lore-app> и up --no-deps lore-app, принять новый — LORE CD, service=frontend."
    fi
    summary "LORE v1 (lore-app): образ \`$cur\`, тег \`$TAG\`"
    ;;

  verify)
    before="${V1_IMAGE_BEFORE:-}"
    if [ -z "$before" ]; then
      echo "::warning::до выкатки lore-app не работал (шаг pin) — сверять не с чем"
      exit 0
    fi
    if ! cur="$(running_image)" || [ -z "$cur" ]; then
      echo "::error::контейнер lore-app (v1) пропал за выкатку (до неё работал образ $before)"
      exit 1
    fi
    if [ "$cur" != "$before" ]; then
      echo "::error::образ lore-app (v1) сменился за выкатку: был $before, стал $cur. v1 заморожен — его пересобирает только service=frontend."
      exit 1
    fi
    echo "ok: v1 не тронут, образ $cur"
    ;;

  repin)
    if ! cur="$(running_image)" || [ -z "$cur" ]; then
      echo "::error::хотфикс v1 выкатывался, но контейнер lore-app не найден — перезакреплять нечего"
      exit 1
    fi
    docker tag "$cur" "$TAG" || { echo "::error::не удалось переставить тег $TAG на $cur"; exit 1; }
    echo "::notice::хотфикс v1: $TAG → $cur"
    summary "LORE v1 (lore-app): хотфикс, тег \`$TAG\` → \`$cur\`"
    ;;

  *)
    echo "::error::v1-freeze.sh: неизвестный режим '$MODE' (pin | verify | repin)"
    exit 2
    ;;
esac
