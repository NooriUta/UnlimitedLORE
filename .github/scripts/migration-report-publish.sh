#!/usr/bin/env bash
# Отчёт переноса — в каталог раздела админки «Перенос на новую модель» препрода (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02).
#
# Бэкенд препрода читает отчёт из lore.migration.dir=/migration — том lore-preprod-migration (docker-compose.preprod.yml).
# Сюда кладутся dry-run.json (сухой прогон) и transfer.json (второй прогон этапа full). Файл решений стенда
# (decisions.json, decisions.log.jsonl) не трогается: это решения людей в админке.
#
# Копирование — через вспомогательный контейнер с томом и `docker cp`: шаг идёт внутри контейнера джоба, и путь
# его рабочего каталога для демона Docker не существует (bind-mount не годится).
#
#   MIG_REPORT_DIR  каталог отчётов конвейера (по умолчанию migration-report)
#   MIG_DST_DB      приёмник; публикуется только для migration_dst_preprod
#   MIG_VOLUME      том каталога переноса (по умолчанию lore-preprod-migration)
set -euo pipefail

OUT="${MIG_REPORT_DIR:-migration-report}"
VOLUME="${MIG_VOLUME:-lore-preprod-migration}"
die() { echo "::error::$*"; exit 1; }

if [ "${MIG_DST_DB:-}" != "migration_dst_preprod" ]; then
  echo "приёмник «${MIG_DST_DB:-}» — не база препрода, отчёт в админку препрода не публикую"
  exit 0
fi
[ -f "$OUT/dry-run.json" ] || die "нет $OUT/dry-run.json — без сухого прогона админка препрода скажет «прогона не было»"
transfer="$OUT/run2-transfer.json"
[ -f "$transfer" ] || transfer="$OUT/transfer.json"
[ -f "$transfer" ] || die "нет отчёта переноса ($OUT/run2-transfer.json или $OUT/transfer.json)"

helper="lore-mig-publish-${GITHUB_RUN_ID:-local}-$$"
docker rm -f "$helper" >/dev/null 2>&1 || true
trap 'docker rm -f "$helper" >/dev/null 2>&1 || true' EXIT
docker create --name "$helper" -v "$VOLUME:/migration" alpine:3 true >/dev/null
docker cp "$OUT/dry-run.json" "$helper:/migration/dry-run.json"
docker cp "$transfer" "$helper:/migration/transfer.json"
echo "отчёт переноса опубликован в том $VOLUME: dry-run.json, transfer.json ($(basename "$transfer"))"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- отчёт переноса опубликован в админку препрода (том $VOLUME)" >> "$GITHUB_STEP_SUMMARY"; fi
