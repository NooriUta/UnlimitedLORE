#!/usr/bin/env bash
# DBU-14: лечение индексов базы — то, что после апгрейда СУБД обязано
# выполниться САМО, а не лечь на человека со списком SQL в руках.
#
# ЧТО ЛЕЧИМ. Индекс, собранный до исправления порядка строковых ключей
# (ArcadeDB #5321), обслуживает только записи, сделанные ПОСЛЕ сборки. Старое
# он не находит и при этом НЕ ПАДАЕТ — возвращает пустоту. Замерено 04.08 на
# копии прода под 26.8.1: `KnowDecision.decision_id` — 0 из 40 ключей, при том
# что скан находит всё.
#
# ЧЕМ ЛЕЧИМ. `REBUILD INDEX` — проверено: 268 индексов до и после, поиск
# 0 → 1. Для FULL_TEXT перестройка не годится: она теряет заданное имя
# (DBR-12), а ранжирование доступно только через `SEARCH_INDEX('<имя>', …)`.
# Их пересоздаём из реестра: DROP + CREATE.
#
# ЧЕГО НЕ ДЕЛАЕМ — и это важнее прочего.
#
#   Имена вида `Type_0_<цифры>` — НЕ ДУБЛИ. Это бакетные подындексы типового
#   индекса (`automatic: true`). Первая редакция скрипта приняла их за дубли и
#   снесла 134 штуки — база осталась с НУЛЁМ индексов из 268, потому что снос
#   подындекса уносит и родителя.
#
#   Хуже: сверка после этого отрапортовала «чисто». Запрос без индекса
#   отвечает СКАНОМ и возвращает верные строки — то есть проверка «индексный
#   поиск против скана» не отличает здоровый индекс от отсутствующего.
#   Отсюда страховка по числу индексов ниже: она обязательна, без неё лечение
#   способно уничтожить то, что чинит, и отчитаться успехом.
#
# Режимы:
#   (без аргументов)  только отчёт; ненулевой код, если есть что лечить
#   --apply           лечить; перед первой правкой делает бэкап базы
#
# Вход: DB_URL, DB_USER, DB_PASS, DB_NAME; FT_REGISTRY (по умолчанию
# backend/build/ft-indexes.tsv, пишет SliceSqlDumpTest); KEYS — ключей на сверку.
set -uo pipefail

MODE=check
[ "${1:-}" = "--apply" ] && MODE=apply

DB_URL="${DB_URL:?DB_URL обязателен}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:?DB_PASS обязателен}"
DB_NAME="${DB_NAME:?DB_NAME обязателен}"
FT_REGISTRY="${FT_REGISTRY:-backend/build/ft-indexes.tsv}"
KEYS="${KEYS:-40}"

api() {
  local f; f=$(mktemp)
  # Файлом, а не инлайновым -d: инлайн бьёт не-ASCII, а ключи бывают
  # кириллическими. Сломанная передача выглядела бы как поломка индекса.
  printf '{"language":"sql","command":"%s"}' \
    "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')" > "$f"
  curl -s -m 600 -u "$DB_USER:$DB_PASS" -H 'Content-Type: application/json' \
    -X POST "$DB_URL/api/v1/command/$DB_NAME" --data-binary "@$f"
  rm -f "$f"
}
failed() { printf '%s' "$1" | grep -q '"error"'; }
num()    { printf '%s' "$1" | grep -o '"n":[0-9]*' | head -1 | cut -d: -f2; }
say()    { printf '%s\n' "$*"; }
warn()   { printf '::warning::%s\n' "$*"; }
die()    { printf '::error::%s\n' "$*"; exit 1; }

index_count() { num "$(api "SELECT count(*) AS n FROM schema:indexes")"; }

read_inventory() { # имя, тип, свойства, вид, метка, тип ключа
  local raw; raw=$(api "SELECT name, typeName, properties, indexType, keyTypes, upgradeWarning FROM schema:indexes")
  failed "$raw" && return 1
  # Разбор без jq: его нет в раннер-образе, а зависимость ради четырёх полей
  # неоправданна.
  printf '%s' "$raw" | tr '{' '\n' | grep -F '"name"' | while IFS= read -r o; do
    n=$(printf '%s' "$o" | sed -nE 's/.*"name":"([^"]*)".*/\1/p')
    t=$(printf '%s' "$o" | sed -nE 's/.*"typeName":"([^"]*)".*/\1/p')
    p=$(printf '%s' "$o" | sed -nE 's/.*"properties":\[\[([^]]*)\]\].*/\1/p' | tr -d '"')
    k=$(printf '%s' "$o" | sed -nE 's/.*"indexType":"([^"]*)".*/\1/p')
    kt=$(printf '%s' "$o" | sed -nE 's/.*"keyTypes":\[([^]]*)\].*/\1/p' | tr -d '"')
    w=no; printf '%s' "$o" | grep -q '"upgradeWarning":"' && w=yes
    [ -n "$n" ] && printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$n" "$t" "$p" "$k" "$w" "$kt"
  done
}

# ─── страховка: сколько индексов было ────────────────────────────────────────
BEFORE=$(index_count)
[ -z "${BEFORE:-}" ] && die "не сосчитать индексы — лечить вслепую нельзя"
[ "$BEFORE" -eq 0 ] && die "в базе НОЛЬ индексов. Это не «нечего лечить», это авария"
say "индексов в базе: $BEFORE"

INV=$(read_inventory) || die "инвентарь индексов не прочитан"
[ -z "$INV" ] && die "инвентарь пуст при $BEFORE индексах — разбор ответа сломан"

BACKUP_DONE=no
ensure_backup() {
  [ "$BACKUP_DONE" = yes ] && return 0
  say "── бэкап перед правкой"
  local r; r=$(api "BACKUP DATABASE")
  if failed "$r" || ! printf '%s' "$r" | grep -q '"result":"OK"'; then
    die "бэкап не сделан — лечение отменено, править индексы без отката нельзя"
  fi
  say "   $(printf '%s' "$r" | sed -nE 's/.*"backupFile":"([^"]*)".*/\1/p')"
  BACKUP_DONE=yes
}

FIXED=0
heal_one() { # heal_one <имя> <вид>
  local name="$1" kind="$2" r sql
  if [ "$kind" = FULL_TEXT ]; then
    sql=$(awk -F'\t' -v n="$name" '$1==n{print $4}' "$FT_REGISTRY" 2>/dev/null)
    if [ -z "$sql" ]; then
      # Бакетные подындексы FT в реестре отсутствуют по построению — они и не
      # чинятся отдельно, их чинит перестройка родителя. Молча пропускать
      # нельзя: неизвестное состояние обязано быть названо.
      warn "$name: в реестре нет — пропущен (если это подындекс, лечится через родителя)"
      return 0
    fi
    api "DROP INDEX \`$name\`" >/dev/null
    r=$(api "$sql")
  else
    r=$(api "REBUILD INDEX \`$name\`")
  fi
  if failed "$r"; then
    warn "$name: вылечить не удалось: $(printf '%s' "$r" | head -c 140)"
    return 1
  fi
  FIXED=$((FIXED + 1))
}

# ─── A. индексы с меткой upgradeWarning ──────────────────────────────────────
# Движок сам сообщает: страницы отсортированы в другом порядке ключей, чем
# применяют поиски. Пока не перестроен — поиск может вернуть меньше записей,
# чем скан, ЛИБО записи посторонних ключей.
say "── A. метка upgradeWarning"
WARNED=$(printf '%s\n' "$INV" | awk -F'\t' '$5=="yes"{print $1"\t"$4}')
WARN_N=$(printf '%s\n' "$WARNED" | grep -c . || true)
say "   помечено: ${WARN_N:-0}"
if [ "${WARN_N:-0}" -gt 0 ] && [ "$MODE" = apply ]; then
  ensure_backup
  while IFS=$'\t' read -r n k; do
    [ -n "${n:-}" ] && heal_one "$n" "$k"
  done <<< "$WARNED"
fi

# ─── B. сверка фактом ────────────────────────────────────────────────────────
# Метки недостаточно: сломанный KnowDecision.decision_id её НЕ имел. Ключи
# берём СКАНОМ — через проверяемый индекс выборка вернёт лишь то, что он и так
# обслуживает, и проба подтвердит сама себя.
probe() { # probe -> печатает "тип\tсвойство" по сломанным
  while IFS=$'\t' read -r name type props kind wflag ktype; do
    [ -z "${name:-}" ] && continue
    [ "$kind" = FULL_TEXT ] && continue            # у FT сверка по токену, отдельно
    case "$props" in *,*) continue ;; esac         # составные ключи — отдельный разговор
    case "$name" in *\[*\]) ;; *) continue ;; esac # бакетные подындексы не проверяем поимённо
    # Только строковые ключи. Проба сравнивает со строковым литералом, и на
    # DATETIME это негодная мерка: три индекса по valid_to объявлялись
    # сломанными (37/40, 39/40, 10/11) на ОБЕИХ версиях — а поле оказалось
    # DATETIME, и часть значений просто не совпадала со строкой посимвольно.
    # Ложная тревога, поданная как «сломано на боевой», едва не породила
    # лишнюю задачу на прод.
    [ "$ktype" != "STRING" ] && continue

    local keys found=0 total=0 n
    keys=$(api "SELECT $props AS v FROM $type LIMIT $KEYS" | grep -o '"v":"[^"]*"' | cut -d'"' -f4 | grep -v "'")
    [ -z "$keys" ] && continue
    while IFS= read -r kk; do
      [ -z "$kk" ] && continue
      total=$((total + 1))
      n=$(num "$(api "SELECT count(*) AS n FROM $type WHERE $props = '$kk'")")
      [ "${n:-0}" -ge 1 ] && found=$((found + 1))
    done <<< "$keys"
    [ "$found" -ne "$total" ] && printf '%s\t%s\t%s\n' "$name" "$type" "$props"
  done <<< "$INV"
}

say "── B. сверка индексного поиска со сканом"
BROKEN=$(probe)
BROKEN_N=$(printf '%s\n' "$BROKEN" | grep -c . || true)
say "   сломано: ${BROKEN_N:-0}"
printf '%s\n' "$BROKEN" | while IFS=$'\t' read -r n t p; do
  [ -n "${n:-}" ] && warn "$t.$p — индекс не отдаёт часть ключей"
done

if [ "${BROKEN_N:-0}" -gt 0 ] && [ "$MODE" = apply ]; then
  ensure_backup
  while IFS=$'\t' read -r n t p; do
    [ -n "${n:-}" ] && heal_one "$n" LSM_TREE
  done <<< "$BROKEN"
fi

# ─── C. итог со страховкой ───────────────────────────────────────────────────
AFTER=$(index_count)
[ -z "${AFTER:-}" ] && die "после лечения не сосчитать индексы"

if [ "$MODE" = apply ]; then
  say "── итог: правок $FIXED, индексов было $BEFORE, стало $AFTER"
  # Главная страховка. Проверка «поиск против скана» НЕ отличает здоровый
  # индекс от отсутствующего: без индекса запрос идёт сканом и отдаёт верные
  # строки. Первая редакция на этом и обманулась — снесла все 268 индексов и
  # отчиталась «сверка чистая».
  [ "$AFTER" -lt "$BEFORE" ] && die "индексов стало МЕНЬШЕ ($BEFORE → $AFTER) — лечение уничтожает то, что чинит. Восстановить из бэкапа"
  REST=$(probe); REST_N=$(printf '%s\n' "$REST" | grep -c . || true)
  [ "${REST_N:-0}" -gt 0 ] && die "после лечения осталось сломанных: $REST_N"
  say "лечение завершено, сверка чистая, индексы на месте"
  exit 0
fi

TODO=$(( ${WARN_N:-0} + ${BROKEN_N:-0} ))
say "── итог: к лечению $TODO"
[ "$TODO" -gt 0 ] && { say "запустить с --apply"; exit 1; }
say "база в порядке"
