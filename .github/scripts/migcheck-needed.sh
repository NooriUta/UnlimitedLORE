#!/usr/bin/env bash
# Нужна ли живая проверка миграций — SPRINT_LORE_PIPELINE_HOST/PL-MIGRATE-LIVE-CHECK (гейт preprod → main).
#
# Workflow lore-migrate-live-check.yml запускается на КАЖДОМ PR (без фильтра
# путей), чтобы его статус существовал всегда: только такой можно сделать
# обязательным в защите ветки main. Нужна ли сама проверка, решает этот скрипт:
# правка схемы бэкенда или самого инструмента → run=true; иначе run=false и джоб
# зеленеет за секунды с пометкой «проверять нечего». Ручной запуск — всегда true.
# Дифф не вычислился — true: сомнение в сторону проверки.
#
# Вход (env): EVENT_NAME, BASE_REF; CI_SCOPE_FILES — список путей вместо git (тесты).
set -uo pipefail

PATTERN='^(backend/src/main/java/studio/seer/heimdall/lore/LoreSchema(Migrations|MigrationRunner|Initializer)\.java|backend/db-schema/|scripts/migrate-live-check|\.github/workflows/lore-migrate-live-check\.yml|\.github/scripts/migcheck-needed\.sh)'

emit() { echo "$1=$2"; [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT"; return 0; }

if [ "${1:-}" = "--selftest" ]; then
  rc=0
  t() { # t <ожидание> <пути через \n>
    got="$(CI_SCOPE_FILES="$2" EVENT_NAME=pull_request BASE_REF=main GITHUB_OUTPUT= bash "$0" | sed -n 's/^run=//p')"
    [ "$got" = "$1" ] || { echo "::error::selftest: ожидали run=$1, получили run=$got для: $2"; rc=1; }
  }
  t true  "backend/src/main/java/studio/seer/heimdall/lore/LoreSchemaMigrations.java"
  t true  "scripts/migrate-live-check/inventory.py"
  t false "web-next/src/App.tsx"
  t false $'docs/x.md\nbackend/src/main/java/studio/seer/heimdall/lore/KcBridge.java'
  got="$(EVENT_NAME=workflow_dispatch GITHUB_OUTPUT= bash "$0" | sed -n 's/^run=//p')"
  [ "$got" = true ] || { echo "::error::selftest: ручной запуск обязан проверять"; rc=1; }
  [ "$rc" = 0 ] && echo "selftest ok"; exit "$rc"
fi

if [ "${EVENT_NAME:-}" = workflow_dispatch ]; then emit run true; emit why "ручной запуск"; exit 0; fi

if [ "${CI_SCOPE_FILES+set}" = set ]; then
  files="$CI_SCOPE_FILES"
else
  git rev-parse -q --verify "origin/${BASE_REF:-}" >/dev/null 2>&1 \
    || git fetch --no-tags -q origin "+refs/heads/${BASE_REF:-main}:refs/remotes/origin/${BASE_REF:-main}" >/dev/null 2>&1
  if ! files="$(git diff --name-only "origin/${BASE_REF:-main}...HEAD" 2>/dev/null)"; then
    emit run true; emit why "дифф с ${BASE_REF:-?} не вычислился — проверяем на всякий случай"; exit 0
  fi
fi

hit="$(printf '%s\n' "$files" | grep -E "$PATTERN" | head -5 | tr '\n' ' ')"
if [ -n "$hit" ]; then
  emit run true; emit why "менялись схема или инструмент: $hit"
else
  emit run false; emit why "схема бэкенда и инструмент проверки не менялись — проверять нечего"
  echo "::notice::живая проверка миграций не нужна: схема не менялась"
fi
