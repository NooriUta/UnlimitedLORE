#!/usr/bin/env bash
# Регресс-набор СУБД (DBU-08): прогоняется на ЛЮБОЙ версии ArcadeDB и печатает
# TSV «кейс → вердикт → деталь». Сравнение версий делает вызывающий, диффом
# двух выдач — так набор не зашивает представления автора как эталон.
#
# Два вида кейсов, и различие принципиальное:
#   EXPECT — есть проверяемый факт, который обязан держаться на любой версии
#            (скан против индекса, имя индекса после REBUILD). Расхождение —
#            это FAIL прямо здесь, без сравнения с чем-либо.
#   OBSERVE — контракт грамматики. Верного ответа набор не знает; он
#            ЗАПИСЫВАЕТ поведение, а вывод делает дифф между версиями. Так
#            найдётся молчаливое изменение грамматики, которого никто не ждал
#            (ровно так пропала форма DELETE EDGE между версиями).
#
# Вход: DB_URL, DB_USER, DB_PASS, DB_NAME.
set -uo pipefail

DB_URL="${DB_URL:-http://localhost:2480}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:?DB_PASS обязателен}"
DB_NAME="${DB_NAME:-dbregress}"

FAILED=0

# --- транспорт ---------------------------------------------------------------

api() { # api <path> <json-file-or-inline>
  curl -s -u "$DB_USER:$DB_PASS" -H 'Content-Type: application/json' \
       -X POST "$DB_URL/api/v1/$1" --data-binary "$2"
}

sql() { # sql "<query>" — без двойных кавычек внутри
  api "command/$DB_NAME" "{\"language\":\"sql\",\"command\":\"$1\"}"
}

script_sql() { # script_sql <file with payload json>
  api "command/$DB_NAME" "@$1"
}

# Одно скалярное поле из ответа. Отсутствие поля даёт пустоту, а НЕ ноль:
# подменять «не удалось прочитать» нулём — тот самый дефект, ради которого
# этот набор и существует.
scalar() { # scalar <json> <field>
  printf '%s' "$1" | grep -o "\"$2\":[0-9-]*" | head -1 | cut -d: -f2
}

emit() { # emit <case> <verdict> <detail>
  printf '%s\t%s\t%s\n' "$1" "$2" "$3"
  [ "$2" = "FAIL" ] && FAILED=$((FAILED + 1))
  return 0
}

# --- подготовка --------------------------------------------------------------

curl -s -u "$DB_USER:$DB_PASS" -X POST "$DB_URL/api/v1/server" \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"create database $DB_NAME\"}" >/dev/null 2>&1

VERSION=$(curl -s -u "$DB_USER:$DB_PASS" "$DB_URL/api/v1/databases" \
  | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
emit "meta.version" "INFO" "${VERSION:-unknown}"

# --- C1. FULL_TEXT по СУЩЕСТВУЮЩИМ данным ------------------------------------
# Главный кейс. Дефект 2026-08: индекс, созданный на типе с данными,
# отчитывается числом записей, но находит только те строки, что записаны
# ПОСЛЕ создания. На проде скан находил токен в 714 строках, индекс — в одной.

sql "CREATE VERTEX TYPE RgDoc IF NOT EXISTS" >/dev/null
sql "CREATE PROPERTY RgDoc.body IF NOT EXISTS STRING" >/dev/null

PAYLOAD="$(mktemp)"
{
  printf '{"language":"sqlscript","command":"'
  for i in $(seq 1 700); do printf "INSERT INTO RgDoc SET body = 'zapis pro TOKEN nomer %s';" "$i"; done
  for i in $(seq 701 800); do printf "INSERT INTO RgDoc SET body = 'postoronnij tekst nomer %s';" "$i"; done
  printf '"}'
} > "$PAYLOAD"
script_sql "$PAYLOAD" >/dev/null
rm -f "$PAYLOAD"

SCAN=$(scalar "$(sql "SELECT count(*) AS n FROM RgDoc WHERE body LIKE '%TOKEN%'")" n)
CREATED=$(sql "CREATE INDEX rgFt ON RgDoc (body) FULL_TEXT")
TOTAL_INDEXED=$(scalar "$CREATED" totalIndexed)
TERM=$(scalar "$(sql "SELECT count(*) AS n FROM RgDoc WHERE SEARCH_INDEX('rgFt', 'TOKEN') = true")" n)

if [ -z "$SCAN" ] || [ -z "$TERM" ]; then
  emit "ft.existing_rows.term" "UNAVAILABLE" "запрос не дал числа: scan='$SCAN' term='$TERM'"
elif [ "$SCAN" = "$TERM" ]; then
  emit "ft.existing_rows.term" "PASS" "скан=$SCAN индекс=$TERM totalIndexed=$TOTAL_INDEXED"
else
  emit "ft.existing_rows.term" "FAIL" "скан=$SCAN индекс=$TERM totalIndexed=$TOTAL_INDEXED — индекс не покрывает данные, записанные ДО его создания"
fi

# --- C2. Префиксный запрос ---------------------------------------------------
# Именно такие шлёт наш поиск (слово*). На 26.7.2 падали с NPE, тогда как
# термовые отвечали — из-за чего поломка выглядела как рабочий поиск.

PREFIX_RAW=$(sql "SELECT count(*) AS n FROM RgDoc WHERE SEARCH_INDEX('rgFt', 'TOKE*') = true")
PREFIX=$(scalar "$PREFIX_RAW" n)
if printf '%s' "$PREFIX_RAW" | grep -q '"error"'; then
  emit "ft.prefix_query" "FAIL" "префиксный запрос дал ошибку: $(printf '%s' "$PREFIX_RAW" | head -c 200)"
elif [ "$PREFIX" = "$SCAN" ]; then
  emit "ft.prefix_query" "PASS" "префикс=$PREFIX == скан=$SCAN"
else
  emit "ft.prefix_query" "FAIL" "префикс=$PREFIX, скан=$SCAN"
fi

# --- C3. REBUILD INDEX сохраняет имя -----------------------------------------
# Воспроизведено на 26.8.1: ftTDoc -> TDoc[body], запрос по имени падает.
# Имя не косметика: ранжирование доступно только через SEARCH_INDEX('<имя>',…),
# а retireLegacyFullTextIndexes() снесёт автоимя на следующем старте.

sql "REBUILD INDEX rgFt" >/dev/null
NAMES=$(sql "SELECT name FROM schema:indexes WHERE name LIKE '%RgDoc%'")
if printf '%s' "$NAMES" | grep -q '"rgFt"'; then
  emit "index.rebuild_keeps_name" "PASS" "имя rgFt на месте"
else
  emit "index.rebuild_keeps_name" "FAIL" "после REBUILD имени rgFt нет; индексы: $(printf '%s' "$NAMES" | head -c 200)"
fi

# --- C4. CREATE INDEX <имя> IF NOT EXISTS действительно создаёт имя ----------
# Воспроизведено на 26.8.1: возвращает created:true с ЗАПРОШЕННЫМ именем и
# подставляет существующий индекс по совпадению свойств. Имя не появляется.

CRE=$(sql "CREATE INDEX rgFt2 IF NOT EXISTS ON RgDoc (body) FULL_TEXT")
NAMES2=$(sql "SELECT name FROM schema:indexes WHERE name LIKE '%RgDoc%'")
if printf '%s' "$NAMES2" | grep -q '"rgFt2"'; then
  emit "index.create_if_not_exists_names" "PASS" "имя rgFt2 создано"
elif printf '%s' "$CRE" | grep -q '"created":true'; then
  emit "index.create_if_not_exists_names" "FAIL" "ответ created:true, но имени rgFt2 в схеме нет — успех при несделанной работе"
else
  emit "index.create_if_not_exists_names" "OBSERVE" "не создано и не отрапортовано созданием: $(printf '%s' "$CRE" | head -c 200)"
fi

# --- C5..C9. Контракты грамматики (OBSERVE) ----------------------------------
# Верного ответа набор не знает — он фиксирует поведение, а вывод делает дифф
# между версиями. Так ловится молчаливое изменение грамматики.

observe() { # observe <case> <sql>
  local out; out=$(sql "$2")
  if printf '%s' "$out" | grep -q '"error"'; then
    emit "$1" "OBSERVE" "ERROR: $(printf '%s' "$out" | grep -o '"detail":"[^"]*"' | head -c 200)"
  else
    emit "$1" "OBSERVE" "OK: $(printf '%s' "$out" | head -c 160)"
  fi
}

sql "CREATE VERTEX TYPE RgA IF NOT EXISTS" >/dev/null
sql "CREATE VERTEX TYPE RgB IF NOT EXISTS" >/dev/null
sql "CREATE EDGE TYPE RgLink IF NOT EXISTS" >/dev/null
sql "INSERT INTO RgA SET k = 'a1'" >/dev/null
sql "INSERT INTO RgB SET k = 'b1'" >/dev/null
sql "CREATE EDGE RgLink FROM (SELECT FROM RgA WHERE k = 'a1') TO (SELECT FROM RgB WHERE k = 'b1') SET role = 'primary'" >/dev/null

observe "sql.delete_edge_grammar"   "DELETE EDGE RgLink FROM (SELECT FROM RgA WHERE k = 'a1') TO (SELECT FROM RgB WHERE k = 'b1')"
observe "sql.edge_prop_filter"      "SELECT outE('RgLink')[role='primary'].size() AS n FROM RgA WHERE k = 'a1'"
observe "sql.edge_in_out_fields"    "SELECT @out.k AS src, @in.k AS dst FROM RgLink"
observe "sql.traverse_where"        "SELECT FROM (TRAVERSE out('RgLink') FROM (SELECT FROM RgA WHERE k = 'a1')) WHERE @class = 'RgB'"
observe "sql.contains_on_traversal" "SELECT FROM RgA WHERE out('RgLink').k CONTAINS 'b1'"

# --- Самоконтроль: кейс, который ОБЯЗАН покраснеть ---------------------------
# Без него зелёный прогон означал бы «набор ничего не смотрит» — ровно та
# ошибка, что с выкаченным за флагом скоупом.

BOGUS=$(sql "SELECT count(*) AS n FROM RgDoc WHERE SEARCH_INDEX('rgNoSuchIndex', 'TOKEN') = true")
if printf '%s' "$BOGUS" | grep -q '"error"'; then
  emit "selfcheck.detects_missing_index" "PASS" "запрос по несуществующему индексу отбит — набор способен видеть поломку"
else
  emit "selfcheck.detects_missing_index" "FAIL" "запрос по НЕСУЩЕСТВУЮЩЕМУ индексу не дал ошибки — вердиктам этого прогона верить нельзя"
fi

# --- уборка ------------------------------------------------------------------

curl -s -u "$DB_USER:$DB_PASS" -X POST "$DB_URL/api/v1/server" \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"drop database $DB_NAME\"}" >/dev/null 2>&1

printf '\n# FAIL: %s\n' "$FAILED" >&2
exit 0   # вердикт выносит вызывающий по TSV: набор — разведка, а не гейт
