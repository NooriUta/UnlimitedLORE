#!/usr/bin/env bash
# Гейт обновления ArcadeDB: «ни одна запись не потерялась» — честной меркой.
#
# Запускается ВРУЧНУЮ на хосте СУБД перед сменой версии. В CI не живёт: нужен
# доступ к прод-томам, которых у раннера нет.
#
#   bash ygg-upgrade-gate.sh --source <холодная-копия-тома> --old 26.9.1 --new 26.10.2
#                            [--heap 8G] [--port 2487] [--keep]
#
# Коды возврата: 0 — расхождений нет либо все объяснены объявленной политикой;
#                2 — есть расхождение у типа БЕЗ политики (поднимать нельзя);
#                1 — сам замер недостоверен (клоны разные, тип не ответил, …).
#
# ПОЧЕМУ ЭТОТ СКРИПТ СУЩЕСТВУЕТ
# 19.10.2026, подъём 26.9.1 -> 26.10.2. Гейт трижды останавливал работу на одном
# и том же расхождении, и трижды расхождение оказывалось измерением, а не
# потерей. На одном типе за два часа вышло СЕМЬ разных чисел:
#   9588953  9579277  9552816  9548620  9522676  9488172  9479278
# Четыре способа намерить неправду, все четыре воспроизводимы:
#
#   1. ОДНА копия, два открытия. Открывать один том сначала старой версией,
#      потом новой — значит сравнивать первое открытие со вторым. У TimeSeries
#      компакция идёт пошагово, и второе открытие даёт другое число само по
#      себе. Лечение: ДВА клона, каждый открывается РОВНО ОДИН РАЗ.
#   2. Клоны «наверное одинаковые». Лечение: манифест md5 обоих клонов и отказ
#      работать, если они не совпали. Числа сравнимы только на одних байтах.
#   3. docker rm -f вместо остановки. SIGKILL по работающей СУБД — сам источник
#      расхождений. Лечение: docker stop -t 180.
#   4. Малая куча. count(*) при нехватке памяти МОЛЧА отдаёт заниженное число
#      вместо ошибки. Лечение: одинаковая и заведомо достаточная куча в обеих
#      ветках + отказ, если хоть один тип не ответил.
#
# И пятое, не про измерение: расхождение бывает ЗАКОННЫМ. Тип ряда может нести
# retentionMs и downsamplingTiers, которые новая версия применяет, а старая не
# применяла. На таком типе число записей вообще не сравнимо между версиями — и
# направление расхождения непостоянно: в одном прогоне новая версия показала
# меньше, в другом больше, в зависимости от того, как далеко ушла компакция.
# Поэтому гейт различает два вида расхождений:
#   * у типа ЕСТЬ политика -> печатаем как ЗАКОННОЕ, гейт не падает;
#   * политики НЕТ          -> это находка, гейт падает.
#
# ЧТО ГЕЙТ НЕ ПРОВЕРЯЕТ. Он сравнивает число записей по типам. Содержимое
# записей, индексы и поведение запросов — это .github/scripts/db-regression.sh.
set -uo pipefail

SRC=""; OLD=""; NEW=""; HEAP=8G; PORT=2487; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SRC="${2:-}"; shift 2 ;;
    --old)    OLD="${2:-}"; shift 2 ;;
    --new)    NEW="${2:-}"; shift 2 ;;
    --heap)   HEAP="${2:-}"; shift 2 ;;
    --port)   PORT="${2:-}"; shift 2 ;;
    --keep)   KEEP=1; shift ;;
    -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
    *) echo "неизвестный аргумент: $1"; exit 64 ;;
  esac
done
if [ -z "$SRC" ] || [ -z "$OLD" ] || [ -z "$NEW" ]; then
  echo "нужны --source, --old и --new. Подробности: $0 --help"
  exit 64
fi
command -v jq >/dev/null || { echo "нужен jq: схему разбираем разбором, а не грепом"; exit 1; }

A="ygg-gate-clone-a"
B="ygg-gate-clone-b"
C="ygg-gate-server"
OUTDIR="${YGG_GATE_OUT:-/tmp/ygg-gate-$(date +%Y%m%d-%H%M%S)}"
PW=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 24)

say() { printf '\n== %s  [%s]\n' "$1" "$(date +%H:%M:%S)"; }
die() { echo "ОСТАНОВКА: $1"; exit 1; }

mkdir -p "$OUTDIR/schemas"

cleanup() {
  docker rm -f "$C" >/dev/null 2>&1
  if [ "$KEEP" = "0" ]; then
    docker volume rm -f "$A" "$B" >/dev/null 2>&1
  else
    echo "клоны оставлены: $A, $B"
  fi
}
trap cleanup EXIT

clone() { # clone <куда> <откуда>
  docker volume rm -f "$1" >/dev/null 2>&1
  docker volume create "$1" >/dev/null
  docker run --rm -v "$2":/from:ro -v "$1":/to alpine sh -c 'cp -a /from/. /to/' \
    || die "не удалось склонировать $2 -> $1"
}

# Манифест намеренно исключает следы запуска: .lck появляется у работающего
# сервера, .wal пересоздаётся. Их различие не означает различия данных.
manifest() {
  docker run --rm -v "$1":/v:ro alpine sh -c \
    'cd /v && find . -type f ! -name "*.lck" ! -name "*.wal" -print0 | sort -z | xargs -0 md5sum | md5sum | cut -d" " -f1'
}

# Схемы вынимаются из тома ОДИН раз и дальше читаются jq-ом с хоста. Грепать
# одну длинную строку JSON — как раз тот способ, которым этот гейт в первой
# редакции сказал «политики нет» про тип, у которого политика есть.
fetch_schemas() {
  local dbs db
  dbs=$(docker run --rm -v "$SRC":/v:ro alpine sh -c 'ls -1 /v' 2>/dev/null)
  for db in $dbs; do
    docker run --rm -v "$SRC":/v:ro alpine cat "/v/$db/schema.json" \
      > "$OUTDIR/schemas/$db.json" 2>/dev/null || true
    [ -s "$OUTDIR/schemas/$db.json" ] || rm -f "$OUTDIR/schemas/$db.json"
  done
  printf '  схем прочитано: %s\n' "$(ls -1 "$OUTDIR/schemas" | grep -c . || true)"
}

# Политика одного типа: пусто, если её нет. Это и есть ответ на вопрос
# «законна ли убыль».
policy_of() { # policy_of <база> <тип>
  local f="$OUTDIR/schemas/$1.json"
  [ -f "$f" ] || return 0
  jq -r --arg t "$2" '
    .types[$t] // {} | select(.type == "t")
    | ((.retentionMs // 0) as $r | (.downsamplingTiers // []) as $d
       | if ($r > 0) or (($d | length) > 0)
         then "retentionMs=\($r) (\(($r/86400000)|floor) сут), прореживание: "
              + (if ($d|length) == 0 then "нет"
                 else ($d | map("старше \((.afterMs/86400000)|floor) сут -> шаг \((.granularityMs/1000)|floor) с") | join("; "))
                 end)
         else empty end)' "$f" 2>/dev/null
}

# Все типы с политикой — печатается ДО сравнения, чтобы законная убыль не
# выглядела катастрофой. Нулевой retentionMs есть почти у каждой базы с рядами
# и в вывод не идёт.
policies_all() {
  local f db found=0
  for f in "$OUTDIR"/schemas/*.json; do
    [ -f "$f" ] || continue
    db=$(basename "$f" .json)
    local out
    out=$(jq -r '
      .types // {} | to_entries[] | select(.value.type == "t")
      | ((.value.retentionMs // 0) as $r | (.value.downsamplingTiers // []) as $d
         | if ($r > 0) or (($d|length) > 0)
           then "      \(.key): retentionMs=\($r) (\(($r/86400000)|floor) сут), шардов \(.value.shardCount // "?"), поле времени \(.value.timestampColumn // "?")"
                + (if ($d|length) > 0
                   then "\n        прореживание: " + (($d | map("старше \((.afterMs/86400000)|floor) сут -> шаг \((.granularityMs/1000)|floor) с") | join("; ")))
                   else "" end)
           else empty end)' "$f" 2>/dev/null)
    if [ -n "$out" ]; then printf '  %s\n%s\n' "$db" "$out"; found=1; fi
  done
  [ "$found" = "1" ] || echo "  ни у одного типа ряда нет политики — любая убыль подозрительна"
}

up() { # up <версия> <том>
  docker rm -f "$C" >/dev/null 2>&1
  docker run -d --name "$C" -p "127.0.0.1:$PORT:2480" \
    -e JAVA_OPTS="-Darcadedb.server.rootPassword=$PW" \
    -e ARCADEDB_OPTS_MEMORY="-Xms2G -Xmx$HEAP" \
    -v "$2":/home/arcadedb/databases "arcadedata/arcadedb:$1" >/dev/null \
    || die "контейнер $1 не создался"
  local i
  for i in $(seq 1 120); do
    curl -sf -m 5 -u "root:$PW" "http://127.0.0.1:$PORT/api/v1/ready" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -sf -m 5 -u "root:$PW" "http://127.0.0.1:$PORT/api/v1/ready" >/dev/null 2>&1 \
    || die "$1 не ответила ready за 240 с"
  printf '  %s поднялась, SEVERE в логе %s\n' "$1" "$(docker logs "$C" 2>&1 | grep -c SEVERE || true)"
}

# Мягко. Не docker rm -f: жёсткое убийство СУБД само портит замер.
down() { docker stop -t 180 "$C" >/dev/null 2>&1; docker rm -f "$C" >/dev/null 2>&1; sleep 2; }

snapshot() { # snapshot <файл>
  local out="$1"; : > "$out"
  local dbs db types t n
  dbs=$(curl -s -m 30 -u "root:$PW" "http://127.0.0.1:$PORT/api/v1/databases" \
        | grep -o '"result":\[[^]]*\]' | grep -o '"[^"]*"' | tr -d '"' | grep -v '^result$')
  [ -n "$dbs" ] || die "список баз пуст — сервер есть, а данных не видно"
  for db in $dbs; do
    types=$(curl -s -m 60 -u "root:$PW" -H 'Content-Type: application/json' -X POST \
      "http://127.0.0.1:$PORT/api/v1/query/$db" -d '{"language":"sql","command":"SELECT name FROM schema:types"}' \
      | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sort)
    for t in $types; do
      n=$(curl -s -m 600 -u "root:$PW" -H 'Content-Type: application/json' -X POST \
        "http://127.0.0.1:$PORT/api/v1/query/$db" -d "{\"language\":\"sql\",\"command\":\"SELECT count(*) AS n FROM \`$t\`\"}" \
        | grep -o '"n":[0-9]*' | head -1 | cut -d: -f2)
      printf '%s\t%s\t%s\n' "$db" "$t" "${n:-ОШИБКА}" >> "$out"
    done
  done
  local bad; bad=$(grep -c 'ОШИБКА' "$out" || true)
  printf '  баз %s, строк %s, не отвеченных типов %s\n' \
    "$(printf '%s\n' $dbs | grep -c . || true)" "$(grep -c . "$out" || true)" "$bad"
  # Не отвеченный тип — это не ноль записей. Молча записать его в снимок
  # значит сравнить неизвестное с неизвестным.
  [ "$bad" = "0" ] || die "$bad типов не ответили — куча мала или данные повреждены; снимок недостоверен"
}

say "схемы из $SRC"
fetch_schemas

say "объявленная политика хранения и прореживания"
policies_all
echo "  У типов из этого списка число записей между версиями НЕ сравнимо:"
echo "  новая версия может применять политику, которую старая не применяла."

say "два клона из $SRC"
clone "$A" "$SRC"
clone "$B" "$SRC"
MA=$(manifest "$A"); MB=$(manifest "$B")
echo "  манифест A: $MA"
echo "  манифест B: $MB"
[ "$MA" = "$MB" ] && echo "  клоны побайтово одинаковы" || die "клоны различаются — сравнивать нельзя"

say "снимок клона A: $OLD, куча $HEAP, одно открытие"
up "$OLD" "$A"; snapshot "$OUTDIR/old.tsv"; down

say "снимок клона B: $NEW, куча $HEAP, одно открытие"
up "$NEW" "$B"; snapshot "$OUTDIR/new.tsv"
docker logs "$C" 2>&1 | grep -i -E 'SEVERE|corrupt|Unsupported|OutOfMemory' | head -5 | sed 's/^/  /'
down

say "ГЕЙТ"
if diff -u "$OUTDIR/old.tsv" "$OUTDIR/new.tsv" > "$OUTDIR/diff.txt"; then
  echo "ЗЕЛЁНО: $(grep -c . "$OUTDIR/old.tsv") строк совпали. На одних и тех же байтах"
  echo "$OLD и $NEW видят одинаковое число записей в каждом типе каждой базы."
  echo "Снимки: $OUTDIR"
  exit 0
fi

# Разбор по типам: законное расхождение против находки.
LEGIT=0; FATAL=0
: > "$OUTDIR/verdict.txt"
grep -E '^-[a-zA-Z]' "$OUTDIR/diff.txt" | sed 's/^-//' | while IFS=$'\t' read -r db t nold; do
  nnew=$(awk -F'\t' -v d="$db" -v y="$t" '$1==d && $2==y {print $3}' "$OUTDIR/new.tsv")
  pol=$(policy_of "$db" "$t")
  if [ -n "$pol" ]; then
    printf 'LEGIT\t%s.%s\t%s -> %s\t%s\n' "$db" "$t" "$nold" "$nnew" "$pol" >> "$OUTDIR/verdict.txt"
  else
    printf 'FATAL\t%s.%s\t%s -> %s\tполитики нет\n' "$db" "$t" "$nold" "$nnew" >> "$OUTDIR/verdict.txt"
  fi
done
LEGIT=$(grep -c '^LEGIT' "$OUTDIR/verdict.txt" || true)
FATAL=$(grep -c '^FATAL' "$OUTDIR/verdict.txt" || true)

if [ "$LEGIT" != "0" ]; then
  echo "ЗАКОННЫЕ расхождения ($LEGIT) — у типа объявлена политика, число не сравнимо:"
  grep '^LEGIT' "$OUTDIR/verdict.txt" | cut -f2- | sed 's/^/  /'
fi

if [ "$FATAL" = "0" ]; then
  echo
  echo "ЗЕЛЁНО С ОГОВОРКОЙ: расхождения есть только у типов с объявленной политикой."
  echo "Ни один тип без политики не изменился. Поднимать можно, но помнить: по"
  echo "перечисленным типам новая версия применит политику необратимо."
  echo "Снимки: $OUTDIR"
  exit 0
fi

echo
echo "КРАСНО: расхождения у типов БЕЗ политики ($FATAL) — объяснять нечем:"
grep '^FATAL' "$OUTDIR/verdict.txt" | cut -f2- | sed 's/^/  /'
cat <<'EOF'

Прежде чем звать это потерей, проверить двумя независимыми мерками:
  1) подсчёт по окнам: SELECT count(*) FROM <тип> WHERE <поле-времени> >= ... AND < ...
  2) сумму групп:      SELECT <поле>, count(*) FROM <тип> GROUP BY <поле>
count(@rid) и sum(1) НЕ годятся: первое в обратных кавычках тихо даёт 0,
второе оптимизируется в тот же счётчик типа.
И проверить устойчивость: закрыть мягко, открыть снова. Число вернулось —
дефект чтения; осталось — изменение на диске.
EOF
echo "Снимки, дифф и вердикт: $OUTDIR"
exit 2
