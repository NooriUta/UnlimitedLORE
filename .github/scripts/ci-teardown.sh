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
#   ci-teardown.sh --stale <часы>  снять брошенное отменёнными прогонами (старше порога)
#   ci-teardown.sh --selftest    проверка без docker
set -uo pipefail

if [ "${1:-}" = "--selftest" ]; then
  out="$(bash "$0" "" 2>&1)"; rc=$?
  [ "$rc" = 2 ] && grep -q "пустой run id" <<< "$out" || { echo "::error::selftest: пустой run id обязан давать отказ"; exit 1; }
  # --stale: порог в часах обязателен, число, не меньше MIN_STALE_H — иначе снимались бы живые прогоны.
  for bad in "" "abc" "0" "1"; do
    out="$(bash "$0" --stale "$bad" 2>&1)"; rc=$?
    [ "$rc" = 2 ] || { echo "::error::selftest: --stale «$bad» обязан давать отказ (rc=$rc): $out"; exit 1; }
  done
  # Решение «брошен ли» — чистая функция возраста: ровно на пороге ещё живой.
  source <(sed -n '/^is_stale()/,/^}/p' "$0")
  is_stale 1000 $((1000 + 6*3600 + 1)) 6 || { echo "::error::selftest: старше порога — брошен"; exit 1; }
  ! is_stale 1000 $((1000 + 6*3600)) 6 || { echo "::error::selftest: ровно на пороге — ещё живой"; exit 1; }
  ! is_stale 1000 1500 6 || { echo "::error::selftest: свежий — живой"; exit 1; }
  # Возраст образа — по метке времени в ТЕГЕ (UTC, как TS в migrate-live-check.sh), а не по
  # CreatedAt: образ из кэша сборки несёт старый CreatedAt и сошёл бы за брошенный посреди
  # живого прогона (замер 14.11: base-pr1401 «6 ч» в первую минуту прогона).
  source <(sed -n '/^tag_epoch()/,/^}/p' "$0")
  [ "$(tag_epoch lore-migcheck:base-pr1401-20261114213428)" = "$(date -u -d '2026-11-14 21:34:28' +%s)" ]     || { echo "::error::selftest: время из тега base-pr1401-20261114213428 разобрано неверно"; exit 1; }
  [ -z "$(tag_epoch lore-migcheck:latest)" ] || { echo "::error::selftest: тег без метки времени — не наш, не трогать"; exit 1; }
  echo "selftest ok"; exit 0
fi

# Время из тега вида <...>-YYYYMMDDHHMMSS (UTC). Нет метки — пусто: такой образ не трогаем.
tag_epoch() { # image_ref
  local ts="${1##*-}"
  [[ "$ts" =~ ^[0-9]{14}$ ]] || return 0
  date -u -d "${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:8:2}:${ts:10:2}:${ts:12:2}" +%s 2>/dev/null
}

# Брошен ли объект: создан раньше, чем «сейчас минус порог». Ровно на пороге — ещё живой.
is_stale() { # created_epoch now_epoch hours
  [ $(( $2 - $1 )) -gt $(( $3 * 3600 )) ]
}

# --stale <часы>: уборка БРОШЕННОГО чужими прогонами. Повод (OH-17, 14.11.2026):
# отмена прогона по concurrency (cancel-in-progress) не выполняет шаги `if: always()`,
# поэтому уборка «своего прогона» не срабатывает, и на ci-server копились контейнеры
# lore-migcheck-*, образы lore-migcheck:* и архивы /tmp/lore-migcheck-*.zip (прогон 14117).
# Снимается только наше: контейнеры с меткой lore.ci.run (любой прогон), образы
# lore-migcheck:* и архивы /tmp/lore-migcheck-*.zip — и только старше порога. Порог не
# меньше MIN_STALE_H: самый долгий прогон live-check идёт меньше часа, живое не задеть.
MIN_STALE_H=2
if [ "${1:-}" = "--stale" ]; then
  H="${2:-}"
  [[ "$H" =~ ^[0-9]+$ ]] && [ "$H" -ge "$MIN_STALE_H" ] \
    || { echo "::error::ci-teardown --stale: нужен порог в часах, не меньше $MIN_STALE_H (получено «$H») — отказ"; exit 2; }
  now=$(date +%s); n=0
  while read -r id created; do
    [ -n "$id" ] || continue
    c=$(date -d "$created" +%s 2>/dev/null) || continue
    if is_stale "$c" "$now" "$H"; then
      echo "  брошенный контейнер $(docker inspect -f '{{.Name}} run={{index .Config.Labels "lore.ci.run"}}' "$id" 2>/dev/null)"
      docker rm -f "$id" >/dev/null 2>&1 && n=$((n+1))
    fi
  done < <(docker ps -aq --filter "label=lore.ci.run" 2>/dev/null | xargs -r docker inspect -f '{{.Id}} {{.Created}}' 2>/dev/null)
  m=0
  while read -r ref; do
    [ -n "$ref" ] || continue
    c=$(tag_epoch "$ref"); [ -n "$c" ] || continue
    if is_stale "$c" "$now" "$H"; then
      docker rmi "$ref" >/dev/null 2>&1 && { echo "  брошенный образ $ref"; m=$((m+1)); }
    fi
  done < <(docker images --filter 'reference=lore-migcheck' --format '{{.Repository}}:{{.Tag}}' 2>/dev/null)
  k=$(find /tmp -maxdepth 1 -name 'lore-migcheck-*.zip' -mmin +$((H * 60)) -print -delete 2>/dev/null | wc -l)
  echo "уборка брошенного старше ${H} ч: контейнеров $n, образов $m, архивов $k"
  exit 0
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
