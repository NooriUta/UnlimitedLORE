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

# Запрос уходит ФАЙЛОМ, а не инлайновым -d. Причина не в удобстве: инлайновая
# передача бьёт не-ASCII на пути через оболочку, и кириллический кейс ниже
# ложно краснел («нашёл 0 вместо 2»), хотя на тех же данных, записанных
# файлом, поиск находил обе строки. Ловушка известная и уже стоила разбора в
# других инструментах — сломанная мерка выглядит как дефект СУБД.
sql() { # sql "<query>" — без двойных кавычек внутри
  local f; f=$(mktemp)
  printf '{"language":"sql","command":"%s"}' "$1" > "$f"
  api "command/$DB_NAME" "@$f"
  rm -f "$f"
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

# --- C0. Годность самого эталона ---------------------------------------------
# Все скан-кейсы ниже опираются на MATCHES. Если оператор не работает или
# экранирование не доходит до regex, скан вернёт 0 — и это прочитается как
# «данных нет», то есть как ЗДОРОВЬЕ индекса.
#
# Поймано на живом корпусе 2026-08-04: `MATCHES '(?s).*\blore\b.*'` вернул 0
# при 1506 совпадениях по подстроке. Ноль был сломанной меркой, а не находкой.
# Поэтому эталон проверяется заведомо истинным шаблоном ДО того, как по нему
# что-то утверждается.

sql "CREATE VERTEX TYPE RgOracle IF NOT EXISTS" >/dev/null
sql "INSERT INTO RgOracle SET body = 'kontrolnaya stroka'" >/dev/null
ORACLE_ALL=$(scalar "$(sql "SELECT count(*) AS n FROM RgOracle WHERE body MATCHES '(?s).*'")" n)
ORACLE_OK=0
if [ "${ORACLE_ALL:-0}" -ge 1 ]; then
  ORACLE_OK=1
  emit "oracle.matches_works" "PASS" "контрольный шаблон вернул $ORACLE_ALL — эталону можно верить"
else
  emit "oracle.matches_works" "FAIL" "контрольный шаблон вернул '$ORACLE_ALL' вместо >=1 — ВСЕ скан-кейсы ниже недостоверны"
fi

# --- C1. FULL_TEXT по СУЩЕСТВУЮЩИМ данным ------------------------------------
# Главный кейс. Дефект 2026-08: индекс, созданный на типе с данными,
# отчитывается числом записей, но находит только те строки, что записаны
# ПОСЛЕ создания. На копии прода: скан 979, индекс 256 (26%).

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

# --- C4b. Кириллица ----------------------------------------------------------
# Отдельным кейсом: анализатор у нас RussianAnalyzer, и кириллица уже дважды
# ломалась в других местах — java `\w` без UNICODE_CHARACTER_CLASS отбивал её
# как 400 BAD_PARAMS, а 400 маскировался под пустую выдачу. Латинская проба
# такую поломку не увидит вовсе.

sql "CREATE VERTEX TYPE RgRu IF NOT EXISTS" >/dev/null
sql "CREATE PROPERTY RgRu.body IF NOT EXISTS STRING" >/dev/null
sql "INSERT INTO RgRu SET body = 'решение принято по спринту'" >/dev/null
sql "INSERT INTO RgRu SET body = 'решение отложено до релиза'" >/dev/null
sql "INSERT INTO RgRu SET body = 'postoronnij tekst'" >/dev/null
sql "CREATE INDEX rgFtRu ON RgRu (body) FULL_TEXT METADATA {\\\"analyzer\\\":\\\"org.apache.lucene.analysis.ru.RussianAnalyzer\\\",\\\"similarity\\\":\\\"BM25\\\"}" >/dev/null
RU_IDX=$(scalar "$(sql "SELECT count(*) AS n FROM RgRu WHERE SEARCH_INDEX('rgFtRu', 'решение') = true")" n)
if [ "${RU_IDX:-0}" -ge 2 ]; then
  emit "ft.cyrillic_term" "PASS" "кириллический терм нашёл $RU_IDX из 2"
else
  emit "ft.cyrillic_term" "FAIL" "кириллический терм нашёл '$RU_IDX' вместо 2 — либо анализатор, либо кодировка по пути"
fi

# --- C4c. Многополевой индекс ------------------------------------------------
# У нас индекс на тип покрывает заголовок и все *_md (ADR-LORE-033 D10), то
# есть один вызов SEARCH_INDEX на тип. Сверять его сканом по ОДНОМУ полю —
# негодная мерка: на копии прода это дало «индекс 88 против скана 53» и
# читалось как «индекс находит лишнее». Эталон обязан покрывать те же поля.

sql "CREATE VERTEX TYPE RgMulti IF NOT EXISTS" >/dev/null
sql "CREATE PROPERTY RgMulti.a IF NOT EXISTS STRING" >/dev/null
sql "CREATE PROPERTY RgMulti.b IF NOT EXISTS STRING" >/dev/null
sql "INSERT INTO RgMulti SET a = 'ALPHA tut', b = 'nichego'" >/dev/null
sql "INSERT INTO RgMulti SET a = 'nichego', b = 'ALPHA tut'" >/dev/null
sql "INSERT INTO RgMulti SET a = 'nichego', b = 'nichego'" >/dev/null
sql "CREATE INDEX rgFtMulti ON RgMulti (a, b) FULL_TEXT" >/dev/null
M_SCAN=$(scalar "$(sql "SELECT count(*) AS n FROM RgMulti WHERE a LIKE '%ALPHA%' OR b LIKE '%ALPHA%'")" n)
M_IDX=$(scalar "$(sql "SELECT count(*) AS n FROM RgMulti WHERE SEARCH_INDEX('rgFtMulti', 'ALPHA') = true")" n)
if [ "$M_SCAN" = "$M_IDX" ]; then
  emit "ft.multifield_covers_all" "PASS" "скан по обоим полям=$M_SCAN == индекс=$M_IDX"
else
  emit "ft.multifield_covers_all" "FAIL" "скан по обоим полям=$M_SCAN, индекс=$M_IDX — индекс покрывает не все объявленные поля"
fi

# --- C4d. Индекс НЕ самолечится при восстановлении ---------------------------
# Установлено 2026-08-04 на копии прода: восстановленный из бэкапа индекс
# приезжает ровно таким, каким был собран (256 из 979), и новая версия СУБД
# сама его не чинит. Апгрейд без ПЕРЕСОЗДАНИЯ индексов не даёт ничего.
#
# Здесь проверяется вторая половина того же факта: пересоздание НА МЕСТЕ
# обязано дать полное покрытие. Если и оно не даёт — апгрейд бесполезен.

sql "DROP INDEX rgFtMulti" >/dev/null
sql "CREATE INDEX rgFtMulti ON RgMulti (a, b) FULL_TEXT" >/dev/null
M_IDX2=$(scalar "$(sql "SELECT count(*) AS n FROM RgMulti WHERE SEARCH_INDEX('rgFtMulti', 'ALPHA') = true")" n)
if [ "$M_SCAN" = "$M_IDX2" ]; then
  emit "ft.recreate_restores_coverage" "PASS" "после пересоздания индекс=$M_IDX2 == скан=$M_SCAN"
else
  emit "ft.recreate_restores_coverage" "FAIL" "после пересоздания индекс=$M_IDX2, скан=$M_SCAN — пересоздание не лечит"
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

# --- C10. Супернода и конкурентная запись рёбер (#5302) ----------------------
# В 26.7.3 исправлено: «edge-append merge больше не откатывает конкурентные
# записи на многостраничных чанках рёбер» — то есть ПОТЕРЯ ДАННЫХ в сценариях
# с супернодами. Мы сидели на 26.7.2, где дефект действует, и никогда его не
# проверяли.
#
# Для нас это не абстракция: суперноды штатные — спринт с сотней задач
# (PART_OF), актор со всеми сценариями (HAS_ACTOR), релиз со спринтами и PR.
# Конкурентная запись тоже штатная: параллельные сессии агентов пишут в один
# корпус.
#
# Проверка: набить вершине рёбер так, чтобы чанк стал многостраничным, затем
# добавлять параллельно и сверить ЧИСЛО рёбер с числом подтверждённых записей.

sql "CREATE VERTEX TYPE RgHub IF NOT EXISTS" >/dev/null
sql "CREATE VERTEX TYPE RgLeaf IF NOT EXISTS" >/dev/null
sql "CREATE EDGE TYPE RgHas IF NOT EXISTS" >/dev/null
sql "INSERT INTO RgHub SET k = 'hub'" >/dev/null

SEED=400          # чтобы чанк рёбер заведомо перестал быть одностраничным
PAR=6             # параллельных писателей
PER=40            # рёбер на писателя

seed_file="$(mktemp)"
{
  printf '{"language":"sqlscript","command":"'
  for i in $(seq 1 "$SEED"); do
    printf "INSERT INTO RgLeaf SET k = 's%s';" "$i"
    printf "CREATE EDGE RgHas FROM (SELECT FROM RgHub WHERE k = 'hub') TO (SELECT FROM RgLeaf WHERE k = 's%s');" "$i"
  done
  printf '"}'
} > "$seed_file"
api "command/$DB_NAME" "@$seed_file" >/dev/null
rm -f "$seed_file"

SEEDED=$(scalar "$(sql "SELECT out('RgHas').size() AS n FROM RgHub WHERE k = 'hub'")" n)

# Параллельные писатели. Каждый подтверждает свои записи кодом 200; сколько
# подтверждено — столько рёбер и обязано быть.
ok_dir="$(mktemp -d)"
for w in $(seq 1 "$PAR"); do
  (
    f="$(mktemp)"
    {
      printf '{"language":"sqlscript","command":"'
      for j in $(seq 1 "$PER"); do
        printf "INSERT INTO RgLeaf SET k = 'w%s_%s';" "$w" "$j"
        printf "CREATE EDGE RgHas FROM (SELECT FROM RgHub WHERE k = 'hub') TO (SELECT FROM RgLeaf WHERE k = 'w%s_%s');" "$w" "$j"
      done
      printf '"}'
    } > "$f"
    code=$(curl -s -u "$DB_USER:$DB_PASS" -H 'Content-Type: application/json' \
      -X POST "$DB_URL/api/v1/command/$DB_NAME" --data-binary "@$f" \
      -o /dev/null -w '%{http_code}')
    [ "$code" = "200" ] && printf '%s\n' "$PER" > "$ok_dir/$w"
    rm -f "$f"
  ) &
done
wait

CONFIRMED=0
WRITERS_OK=0
for f in "$ok_dir"/*; do
  if [ -f "$f" ]; then
    CONFIRMED=$((CONFIRMED + $(cat "$f")))
    WRITERS_OK=$((WRITERS_OK + 1))
  fi
done
rm -rf "$ok_dir"

ACTUAL=$(scalar "$(sql "SELECT out('RgHas').size() AS n FROM RgHub WHERE k = 'hub'")" n)
EXPECTED=$((SEEDED + CONFIRMED))

# Доля подтверждённых записей — ОТДЕЛЬНЫЙ вердикт, а не деталь предыдущего.
#
# Замер 2026-08-04: на 26.7.2 запись подтвердили 2 писателя из 6, на 26.8.1 —
# все 6. То есть #5302 проявляется у нас не тихой потерей, а ВИДИМЫМ отказом
# конкурентных писателей: рёбер ровно столько, сколько подтверждено, и кейс
# выше зелёный на обеих версиях. Без отдельного вердикта разница осела бы в
# строке детали и в глаза не бросилась — то есть проверка, ради которой всё
# затевалось, не отличала бы версии.
if [ "${WRITERS_OK:-0}" -eq "$PAR" ]; then
  emit "edges.concurrent_write_accepted" "PASS" "все $PAR писателей приняты"
else
  emit "edges.concurrent_write_accepted" "FAIL" "приняты $WRITERS_OK из $PAR — конкурентная запись в супернод отбивается"
fi

if [ -z "$ACTUAL" ] || [ -z "$SEEDED" ]; then
  emit "edges.supernode_concurrent" "UNAVAILABLE" "не удалось сосчитать рёбра: seeded='$SEEDED' actual='$ACTUAL'"
elif [ "$CONFIRMED" -eq 0 ]; then
  emit "edges.supernode_concurrent" "UNAVAILABLE" "ни один писатель не подтвердил запись — проверять нечего"
elif [ "$ACTUAL" = "$EXPECTED" ]; then
  emit "edges.supernode_concurrent" "PASS" "рёбер $ACTUAL == посеяно $SEEDED + подтверждено $CONFIRMED"
else
  emit "edges.supernode_concurrent" "FAIL" "рёбер $ACTUAL, ожидалось $EXPECTED (посеяно $SEEDED + подтверждено $CONFIRMED) — потеряно $((EXPECTED - ACTUAL)) при конкурентной записи"
fi

# --- C11. Проекции SCD2, на которых стоят ВСЕ слайсы -------------------------
# Открытая строка истории читается везде одинаково: HAS_STATE с фильтром по
# непустому полю и взятием [0]. Если эта форма поедет, молча поедут все слайсы
# разом — а выглядеть будет как «данные пропали».

sql "CREATE VERTEX TYPE RgEnt IF NOT EXISTS" >/dev/null
sql "CREATE VERTEX TYPE RgEntHist IF NOT EXISTS" >/dev/null
sql "CREATE EDGE TYPE RgHasState IF NOT EXISTS" >/dev/null
sql "INSERT INTO RgEnt SET uid = 'e1'" >/dev/null
sql "INSERT INTO RgEntHist SET sid = 'h1', status_raw = 'DONE', valid_to = 'closed'" >/dev/null
sql "INSERT INTO RgEntHist SET sid = 'h2', status_raw = 'OPEN'" >/dev/null
sql "CREATE EDGE RgHasState FROM (SELECT FROM RgEnt WHERE uid = 'e1') TO (SELECT FROM RgEntHist WHERE sid = 'h1')" >/dev/null
sql "CREATE EDGE RgHasState FROM (SELECT FROM RgEnt WHERE uid = 'e1') TO (SELECT FROM RgEntHist WHERE sid = 'h2')" >/dev/null

OPEN_ROW=$(sql "SELECT out('RgHasState')[valid_to IS NULL].status_raw[0] AS st FROM RgEnt WHERE uid = 'e1'")
if printf '%s' "$OPEN_ROW" | grep -q '"st":"OPEN"'; then
  emit "sql.scd2_open_row_projection" "PASS" "открытая строка истории читается: OPEN"
else
  emit "sql.scd2_open_row_projection" "FAIL" "проекция открытой строки сломана — на ней стоят все слайсы: $(printf '%s' "$OPEN_ROW" | head -c 200)"
fi

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
