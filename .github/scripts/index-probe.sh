#!/usr/bin/env bash
# Сверка «индексный поиск против скана» по каждому индексу базы.
#
# Зачем отдельно от db-regression.sh: тот работает на синтетике и этот класс
# дефектов НЕ воспроизводит. Установлено 2026-08-04 — и по FULL_TEXT, и по
# обычному вторичному индексу симптом один: индекс обслуживает только записи,
# сделанные ПОСЛЕ его сборки, а старые не находит. На свежесозданном типе
# «старых» записей не бывает, поэтому синтетический прогон всегда зелёный.
#
# Значит проверять надо на ВОССТАНОВЛЕННОЙ КОПИИ боевой базы. Этот скрипт для
# того и написан.
#
# Эталон — скан (`поле.asString() = ключ`), он индекса не касается.
#
# Вход: DB_URL, DB_USER, DB_PASS, DB_NAME; KEYS — сколько ключей на индекс.
set -uo pipefail

DB_URL="${DB_URL:?DB_URL обязателен}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:?DB_PASS обязателен}"
DB_NAME="${DB_NAME:?DB_NAME обязателен}"
KEYS="${KEYS:-40}"

api() { local f; f=$(mktemp)
  # Файлом, а не инлайновым -d: инлайн бьёт не-ASCII, и кириллические ключи
  # давали бы ложное «индекс не находит».
  printf '{"language":"sql","command":"%s"}' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')" > "$f"
  curl -s -m 180 -u "$DB_USER:$DB_PASS" -H 'Content-Type: application/json' \
    -X POST "$DB_URL/api/v1/command/$DB_NAME" --data-binary "@$f"
  rm -f "$f"; }

num() { printf '%s' "$1" | grep -o '"n":[0-9]*' | head -1 | cut -d: -f2; }

# Реестр индексов: берём именованные одно-свойственные не-полнотекстовые —
# по ним ходят обычные запросы WHERE ключ = значение. FULL_TEXT проверяется
# отдельно (db-regression.sh, кейс ft.*): там сверка идёт по токену.
LIST=$(api "SELECT name, typeName, properties, indexType FROM schema:indexes")

# Разбор без jq: он есть не на всяком раннере, а тащить зависимость ради
# трёх полей неоправданно.
PAIRS=$(printf '%s' "$LIST" | tr '{' '\n' \
  | grep -F '[' | grep -v '"indexType":"FULL_TEXT"' \
  | sed -nE 's/.*"name":"([^"]*\[[^"]*\])".*"typeName":"([^"]*)".*"properties":\[\["([^"]*)"\]\].*/\2\t\3/p' \
  | sort -u)

if [ -z "$PAIRS" ]; then
  echo "index.registry	UNAVAILABLE	реестр индексов не разобран — проверять нечего" >&2
  echo "# FAIL: 1"
  exit 1
fi

TOTAL=0; OKN=0; BROKEN=0; UNCHECKED=0
printf 'type.field\tstatus\tdetail\n'

while IFS=$'\t' read -r type field; do
  [ -z "${type:-}" ] && continue
  TOTAL=$((TOTAL + 1))

  # Ключи берём СКАНОМ. Через проверяемый индекс нельзя: выборка вернула бы
  # только те ключи, которые индекс и так обслуживает, и проба подтверждала
  # бы сама себя.
  keys=$(api "SELECT $field AS v FROM $type LIMIT $KEYS" \
    | grep -o '"v":"[^"]*"' | cut -d'"' -f4 | grep -v "'")
  if [ -z "$keys" ]; then
    UNCHECKED=$((UNCHECKED + 1))
    printf '%s.%s\tUNCHECKED\tнет строковых ключей — НЕ проверен\n' "$type" "$field"
    continue
  fi

  found=0; total=0
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    total=$((total + 1))
    n=$(num "$(api "SELECT count(*) AS n FROM $type WHERE $field = '$k'")")
    [ "${n:-0}" -ge 1 ] && found=$((found + 1))
  done <<< "$keys"

  if [ "$found" -eq "$total" ]; then
    OKN=$((OKN + 1))
    printf '%s.%s\tOK\t%s/%s\n' "$type" "$field" "$found" "$total"
  else
    BROKEN=$((BROKEN + 1))
    printf '%s.%s\tBROKEN\t%s/%s найдено индексом — остальное видит только скан\n' \
      "$type" "$field" "$found" "$total"
  fi
done <<< "$PAIRS"

# Непроверенные печатаются ОТДЕЛЬНЫМ числом и не идут в «исправно»: индекс без
# строковых ключей не проверен, а не здоров. Слить их в зелёное значит выдать
# незнание за результат.
printf '\n# индексов %s, исправны %s, сломаны %s, НЕ проверены %s\n' \
  "$TOTAL" "$OKN" "$BROKEN" "$UNCHECKED" >&2
printf '# FAIL: %s\n' "$BROKEN"
[ "$BROKEN" -eq 0 ]
