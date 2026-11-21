#!/usr/bin/env bash
# Шаг CD «Migrate schema» (DBR-06): накатка схемы отдельным видимым шагом — тот же образ бэкенда,
# root-кред, lore.migrate=true + lore.migrate.only=true; процесс накатывает и выходит.
#
# SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 (выкатка 1.18 на препрод): на базе, собранной из модели
# (отметка LoreModelSchema, MIG-03), журнала шагов V нет по построению, и накатывать их нельзя —
# они записали бы старую схему поверх новой. Бэкенд в этом режиме шаги V пропускает и выходит с 0
# строкой «… схема собрана из модели (LoreModelSchema), шаги V пропущены …» (MODEL_SKIP_LINE в
# LoreSchemaMigrationRunner). Этот скрипт принимает её как законный исход; на старой базе — прежняя
# строка «lore.migrate.only=true — схема накатана». Ни одной из двух — красный: исход не подтверждён.
#
# Переменные для тестов: MIGRATE_LOG (куда писать лог), MIGRATE_TIMEOUT (секунды, по умолчанию 1800).
set -uo pipefail

LOG="${MIGRATE_LOG:-/tmp/migrate.log}"
rc=0
timeout "${MIGRATE_TIMEOUT:-1800}" docker compose run --rm --no-deps -T lore-backend > "$LOG" 2>&1 || rc=$?
grep -E "LORE MIGRATE|LORE MART|ERROR|Exception" "$LOG" | tail -80 || true

if [ "$rc" != "0" ]; then
  echo "::error::накатка схемы упала (код $rc) — работающий бэкенд НЕ подменён. Хвост лога:"
  tail -60 "$LOG"
  exit 1
fi

if grep -q "схема собрана из модели (LoreModelSchema), шаги V пропущены" "$LOG"; then
  echo "база собрана из модели (LoreModelSchema, 1.18) — шаги V пропущены, накатка не нужна"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- схема: база собрана из модели (1.18) — шаги V пропущены" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

if ! grep -q "lore.migrate.only=true — схема накатана" "$LOG"; then
  echo "::error::процесс вышел с 0, но строки о завершённой накатке (или о базе из модели) нет — накатка не подтверждена"
  tail -60 "$LOG"
  exit 1
fi
echo "накатка подтверждена"
