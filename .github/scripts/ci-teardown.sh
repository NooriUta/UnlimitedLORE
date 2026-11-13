#!/usr/bin/env bash
# Уборка контейнеров СВОЕГО прогона — SPRINT_LORE_OWN_HOST/OH-17.
#
# Факт 08–13.11.2026: от прогонов CI на ci-server оставались сервисные контейнеры
# (≈8,4 ГБ RAM на 13 штук) — шаг очистки не выполнялся, когда джоб падал или его
# отменяли: trap в скрипте при SIGKILL не срабатывает, а `docker run --rm` в
# убитом джобе оставляет контейнер жить (клиент docker умер, демон — нет).
#
# Правило: каждый контейнер, который поднимает наш CI, несёт метку
# lore.ci.run=<github.run_id>; этот скрипт — шаг с `if: always()` — снимает только
# контейнеры с меткой СВОЕГО прогона. Чужие прогоны и боевые контейнеры не трогает:
# фильтр по точному значению метки, пустой run id — отказ.
#
#   ci-teardown.sh <run_id>      снять контейнеры прогона
#   ci-teardown.sh --selftest    проверка без docker
set -uo pipefail

if [ "${1:-}" = "--selftest" ]; then
  out="$(bash "$0" "" 2>&1)"; rc=$?
  [ "$rc" = 2 ] && grep -q "пустой run id" <<< "$out" || { echo "::error::selftest: пустой run id обязан давать отказ"; exit 1; }
  echo "selftest ok"; exit 0
fi

RUN="${1:-}"
[ -n "$RUN" ] || { echo "::error::ci-teardown: пустой run id — без него фильтр снял бы чужие контейнеры, отказ"; exit 2; }
ids="$(docker ps -aq --filter "label=lore.ci.run=$RUN" 2>/dev/null)"
if [ -z "$ids" ]; then
  echo "контейнеров прогона $RUN не осталось — убирать нечего"
  exit 0
fi
echo "снимаю контейнеры прогона $RUN:"
docker ps -a --filter "label=lore.ci.run=$RUN" --format '  {{.Names}} ({{.Status}})'
# shellcheck disable=SC2086
docker rm -f $ids >/dev/null 2>&1 || echo "::warning::не все контейнеры прогона $RUN сняты"
exit 0
