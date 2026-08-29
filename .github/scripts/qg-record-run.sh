#!/usr/bin/env bash
# SPRINT_QG_REBUILD/QG-12 — запись прогона канала 1 (Forgejo Actions) в LORE.
#
# ЗАЧЕМ. Канал 1 физически работает и гейтит каждый merge, но не оставляет в
# корпусе НИ ОДНОЙ записи: `ClRoutineRun` от Actions нет ни одного. Покрытие
# гейтов считалось по рутинам, которых почти не осталось, показывало 4.5% и
# полностью игнорировало работающий пайплайн (SPEC-QG-ARCHITECTURE §4.8).
#
# ЗАПИСЬ ИДЁТ ПРИ ЛЮБОМ ИСХОДЕ. Роль «триггер» обязана оставить след о попытке
# даже когда прогон упал (§11.2): красная сборка — это результат измерения, а не
# его отсутствие. Поэтому шаг вызывается с `if: always()`, а сюда приходит
# фактический исход джоба.
#
# ЧЕГО ЭТОТ ШАГ НЕ ДЕЛАЕТ. Он не блокирует merge и не меняет условия слияния:
# это открытый вопрос 2 спеки, решает владелец. CI как был условием merge, так и
# остаётся; здесь только запись факта.
#
# ОТКАЗ ЗАПИСИ НЕ ВАЛИТ СБОРКУ, НО И НЕ МОЛЧИТ. Красный CI из-за недоступного
# LORE скрыл бы настоящий результат сборки. Но тихий пропуск воспроизвёл бы
# исходный дефект — «прогонов нет» неотличимо от «нечего записывать». Поэтому
# любой неуспех печатается как ::warning:: с кодом и телом ответа.
set -uo pipefail

: "${QG_ROUTINE:?QG_ROUTINE required, e.g. qg-ci-backend}"
: "${QG_JOB_STATUS:?QG_JOB_STATUS required: success|failure|cancelled}"

LORE_URL="${LORE_URL:-}"
CLIENT_ID="${LORE_QG_CLIENT_ID:-}"
CLIENT_SECRET="${LORE_QG_CLIENT_SECRET:-}"
TOKEN_URL="${LORE_QG_TOKEN_URL:-}"

# Учётной записи может не быть — она заводится вручную в Keycloak, и до тех пор
# писать некому. Это ЗАКОННОЕ состояние, но не бесшумное: сообщение говорит, чего
# именно не хватает, иначе отсутствие записей снова будет выглядеть как норма.
if [ -z "$LORE_URL" ] || [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$TOKEN_URL" ]; then
  echo "::warning::[qg] запись прогона пропущена — не настроена сервисная учётка."
  echo "[qg] нужны секреты организации: LORE_QG_CLIENT_ID, LORE_QG_CLIENT_SECRET, LORE_QG_TOKEN_URL и переменная LORE_URL."
  echo "[qg] пока их нет, канал 1 не оставляет следа в LORE — это и есть SPRINT_QG_REBUILD/QG-12."
  exit 0
fi

# Токен по client_credentials. Секрет живёт в секретах организации, а не в коде
# воркфлоу (§4.9) — здесь он только читается из окружения.
TOKEN=$(curl -sf -m 20 -X POST "$TOKEN_URL" \
  -d grant_type=client_credentials \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "::warning::[qg] не удалось получить токен у ${TOKEN_URL} — прогон не записан."
  exit 0
fi

# Исход джоба → статус прогона. `cancelled` НЕ приравнивается к провалу: отмена
# не измерение и не его провал, это отсутствие измерения по внешней причине.
case "$QG_JOB_STATUS" in
  success)   RUN_STATUS=OK;     BUILD_VALUE=1; METRIC_STATUS=PASS ;;
  failure)   RUN_STATUS=FAIL;   BUILD_VALUE=0; METRIC_STATUS=FAIL ;;
  *)         RUN_STATUS=PARTIAL; BUILD_VALUE=-1; METRIC_STATUS=NOT_MEASURED ;;
esac

RUN_DATE=$(date -u +%Y-%m-%d)

# Тело собирается jq, а не printf: заголовок коммита и ветка приходят из внешних
# данных и могут содержать кавычки. Ровно на этом уже обжигались с кириллицей в
# curl -d — битый JSON уходил как пустой 400 и выглядел как отказ сервера.
jq -n \
  --arg rn   "$QG_ROUTINE" \
  --arg rd   "$RUN_DATE" \
  --arg st   "$RUN_STATUS" \
  --arg ch   "actions" \
  --arg su   "${QG_RUN_URL:-}" \
  --arg cs   "${QG_COMMIT_SHA:-}" \
  --arg ms   "$METRIC_STATUS" \
  --argjson pr "${QG_PR_NUMBER:-null}" \
  --argjson bv "$BUILD_VALUE" \
  --arg nmr  "$( [ "$METRIC_STATUS" = "NOT_MEASURED" ] && echo "no_evidence" || echo "" )" \
  '{routine_name:$rn, run_date:$rd, status:$st, channel:$ch,
    source_url:$su, commit_sha:$cs, pr_number:$pr,
    metrics:[({key:"build_result", value:$bv, unit:"bool", target:1, status:$ms}
              + (if $nmr == "" then {} else {not_measured_reason:$nmr} end))]}' \
  > /tmp/qg-run.json

code=$(curl -s -o /tmp/qg-run.out -w '%{http_code}' -m 25 -X POST \
  "${LORE_URL%/}/lore/qg/run" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/qg-run.json || echo 000)

if [ "$code" = "200" ]; then
  echo "[qg] прогон записан: ${QG_ROUTINE} ${RUN_DATE} → ${RUN_STATUS}"
else
  echo "::warning::[qg] запись прогона отклонена (HTTP $code): $(head -c 400 /tmp/qg-run.out)"
fi
exit 0
