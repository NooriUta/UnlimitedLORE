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
#   4. Время замера. Компакция рядов идёт фоном, и число у типа с политикой
#      зависит от того, ЧЕРЕЗ СКОЛЬКО после старта сервера его спросили: на
#      свежем 26.10.2 — 9552816, после обхода остальных 2036 типов (~25 с) —
#      9479278. Лечение: снимок обеих версий одним и тем же обходом, в одном и
#      том же порядке, и отказ, если хоть один тип не ответил.
#      ПОПРАВКА (20.10.2026): сначала я приписала этот разброс малой куче
#      («count(*) при нехватке памяти молча занижает»). Замер это опроверг: на
#      4G и на 16G гейт дал одинаковые числа, а на одном клоне число падало с
#      каждым повторным открытием, не с размером кучи. С кучей связано другое:
#      у 26.9.1 на 2G падают в OutOfMemory запросы, возвращающие строки
#      (count(*) при этом отвечает). Отсюда --heap: с запасом, одинаково.
#
# И пятое, не про измерение: расхождение бывает ЗАКОННЫМ. Тип ряда может нести
# retentionMs и downsamplingTiers, и компакция по этой политике меняет число
# записей — по-разному у разных версий и в разные моменты (обе версии сокращают
# ряд при повторном открытии; в пределах одного открытия после обхода — только
# 26.10.2). На таком типе число записей между версиями не сравнимо вовсе — и
# направление расхождения непостоянно: в одном прогоне новая версия показала
# меньше, в другом больше, в зависимости от того, как далеко ушла компакция.
# Поэтому гейт различает два вида расхождений:
#   * у типа ЕСТЬ политика -> печатаем как ЗАКОННОЕ, гейт не падает;
#   * политики НЕТ          -> это находка, гейт падает.
#
# ЧТО ГЕЙТ НЕ ПРОВЕРЯЕТ. Он сравнивает число записей по типам. Содержимое
# записей, индексы и поведение запросов — это .github/scripts/db-regression.sh.
set -uo pipefail

SRC=""; OLD=""; NEW=""; HEAP=8G; PORT=2487; KEEP=0; SELFTEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SRC="${2:-}"; shift 2 ;;
    --old)    OLD="${2:-}"; shift 2 ;;
    --new)    NEW="${2:-}"; shift 2 ;;
    --heap)   HEAP="${2:-}"; shift 2 ;;
    --port)   PORT="${2:-}"; shift 2 ;;
    --keep)   KEEP=1; shift ;;
    # Самопроверка: классификатор расхождений на сфабрикованных снимках, без
    # ArcadeDB и без docker. Гейт, не умеющий краснеть, — декорация, поэтому
    # главные случаи самопроверки — те, где он ОБЯЗАН упасть.
    --selftest) SELFTEST=1; shift ;;
    -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
    *) echo "неизвестный аргумент: $1"; exit 64 ;;
  esac
done
if [ "$SELFTEST" = "0" ] && { [ -z "$SRC" ] || [ -z "$OLD" ] || [ -z "$NEW" ]; }; then
  echo "нужны --source, --old и --new (или --selftest). Подробности: $0 --help"
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

cleanup() {
  docker rm -f "$C" >/dev/null 2>&1
  if [ "$KEEP" = "0" ]; then
    docker volume rm -f "$A" "$B" >/dev/null 2>&1
  else
    echo "клоны оставлены: $A, $B"
  fi
}

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
  printf '  баз %s, строк %s, не отвеченных типов %s\n' \
    "$(printf '%s\n' $dbs | grep -c . || true)" "$(grep -c . "$out" || true)" "$(grep -c 'ОШИБКА' "$out" || true)"
  validate_snapshot "$out" || die "снимок $out недостоверен — куча мала или данные повреждены"
}

# Не отвеченный тип — это не ноль записей. Молча записать его в снимок значит
# сравнить неизвестное с неизвестным. Пустой снимок — тоже не «записей нет»,
# а «замер не состоялся».
validate_snapshot() { # validate_snapshot <файл> -> 0 годен, 1 нет
  [ -s "$1" ] || return 1
  ! grep -q 'ОШИБКА' "$1"
}

# Сравнение двух снимков по ключу «база + тип». Не разбором диффа: так видны
# и пропавшие, и новые типы, а не только изменившиеся числа.
#   ЗАКОННО — у типа объявлены retentionMs > 0 или downsamplingTiers;
#   НАХОДКА — политики нет (в том числе retentionMs = 0), тип пропал или
#             появился. На побайтово одинаковых клонах число у такого типа
#             обязано совпасть — в любую сторону, рост тоже находка.
# Пишет $OUTDIR/verdict.txt. Возврат: 0 — находок нет, 2 — есть.
classify() { # classify <old.tsv> <new.tsv>
  local old="$1" new="$2" db t o n pol
  : > "$OUTDIR/verdict.txt"
  awk -F'\t' '
    NR==FNR { a[$1"\t"$2]=$3; next }
            { b[$1"\t"$2]=$3 }
    END {
      for (k in a) if (!(k in b)) print k "\t" a[k] "\t-"
      for (k in b) if (!(k in a)) print k "\t-\t" b[k]
      for (k in a) if ((k in b) && a[k] != b[k]) print k "\t" a[k] "\t" b[k]
    }' "$old" "$new" | sort > "$OUTDIR/changed.tsv"
  while IFS=$'\t' read -r db t o n; do
    [ -n "$db" ] || continue
    if [ "$o" = "-" ]; then
      printf 'FATAL\t%s.%s\tтипа не было -> %s\tпоявился тип\n' "$db" "$t" "$n" >> "$OUTDIR/verdict.txt"; continue
    fi
    if [ "$n" = "-" ]; then
      printf 'FATAL\t%s.%s\t%s -> типа нет\tтип пропал\n' "$db" "$t" "$o" >> "$OUTDIR/verdict.txt"; continue
    fi
    pol=$(policy_of "$db" "$t")
    if [ -n "$pol" ]; then
      printf 'LEGIT\t%s.%s\t%s -> %s\t%s\n' "$db" "$t" "$o" "$n" "$pol" >> "$OUTDIR/verdict.txt"
    else
      printf 'FATAL\t%s.%s\t%s -> %s\tполитики нет\n' "$db" "$t" "$o" "$n" >> "$OUTDIR/verdict.txt"
    fi
  done < "$OUTDIR/changed.tsv"

  local legit fatal
  legit=$(grep -c '^LEGIT' "$OUTDIR/verdict.txt" || true)
  fatal=$(grep -c '^FATAL' "$OUTDIR/verdict.txt" || true)

  if [ "$legit" = "0" ] && [ "$fatal" = "0" ]; then
    echo "ЗЕЛЁНО: $(grep -c . "$old" || true) строк совпали. На одних и тех же байтах"
    echo "обе версии видят одинаковое число записей в каждом типе каждой базы."
    return 0
  fi
  if [ "$legit" != "0" ]; then
    echo "ЗАКОННЫЕ расхождения ($legit) — у типа объявлена политика, число не сравнимо:"
    grep '^LEGIT' "$OUTDIR/verdict.txt" | cut -f2- | sed 's/^/  /'
  fi
  if [ "$fatal" = "0" ]; then
    echo
    echo "ЗЕЛЁНО С ОГОВОРКОЙ: расхождения есть только у типов с объявленной политикой."
    echo "Ни один тип без политики не изменился. Поднимать можно, но помнить: по"
    echo "перечисленным типам новая версия применит политику необратимо."
    return 0
  fi
  echo
  echo "КРАСНО: находки ($fatal) — у этих типов расхождение объяснять нечем:"
  grep '^FATAL' "$OUTDIR/verdict.txt" | cut -f2- | sed 's/^/  /'
  return 2
}

# Самопроверка классификатора. Сфабрикованные схемы и снимки, ни ArcadeDB, ни
# docker не нужны — поэтому её может гонять CI на каждом PR.
#
# Главные случаи — отрицательные: где гейт ОБЯЗАН покраснеть. Два из них
# воспроизводят настоящие ловушки этого гейта:
#   * retentionMs = 0 — это НЕ политика (у MetricSnapshot LORE ровно так);
#   * рост числа на типе без политики — тоже находка: байты одни.
selftest() {
  local root fails=0 rc
  root=$(mktemp -d)
  OUTDIR="$root"
  mkdir -p "$OUTDIR/schemas"
  cat > "$OUTDIR/schemas/mdh.json" <<'J'
{"types":{
  "reading":{"type":"t","timestampColumn":"ts","shardCount":23,"retentionMs":31536000000,
             "downsamplingTiers":[{"afterMs":604800000,"granularityMs":60000},
                                  {"afterMs":2592000000,"granularityMs":3600000}]},
  "journal":{"type":"t","timestampColumn":"ts","retentionMs":7776000000},
  "node":{"type":"v"}
}}
J
  cat > "$OUTDIR/schemas/lore.json" <<'J'
{"types":{
  "MetricSnapshot":{"type":"t","timestampColumn":"ts","retentionMs":0},
  "KnowTask":{"type":"v"}
}}
J
  printf 'lore\tKnowTask\t120\nlore\tMetricSnapshot\t300\nmdh\tjournal\t500\nmdh\tnode\t5\nmdh\treading\t1000\n' > "$root/base.tsv"

  # mk <имя> <sed-выражение> — снимок «новой версии» правкой базового
  mk() { sed "$2" "$root/base.tsv" > "$root/$1.tsv"; }
  # case_ <описание> <файл> <ожидаемый код> <ожидаемых LEGIT> <ожидаемых FATAL>
  case_() {
    classify "$root/base.tsv" "$root/$2.tsv" >/dev/null; rc=$?
    local l f
    l=$(grep -c '^LEGIT' "$OUTDIR/verdict.txt" || true)
    f=$(grep -c '^FATAL' "$OUTDIR/verdict.txt" || true)
    if [ "$rc" = "$3" ] && [ "$l" = "$4" ] && [ "$f" = "$5" ]; then
      printf '  ок    %s (код %s, законных %s, находок %s)\n' "$1" "$rc" "$l" "$f"
    else
      printf '  ПРОВАЛ %s: ждали код %s/%s/%s, получили %s/%s/%s\n' "$1" "$3" "$4" "$5" "$rc" "$l" "$f"
      sed 's/^/          /' "$OUTDIR/verdict.txt"
      fails=$((fails + 1))
    fi
  }

  echo "самопроверка гейта:"
  cp "$root/base.tsv" "$root/same.tsv"
  mk legit_down  's/\treading\t1000$/\treading\t900/'
  mk legit_up    's/\treading\t1000$/\treading\t1100/'
  mk node_down   's/\tnode\t5$/\tnode\t4/'
  mk zero_ret    's/\tMetricSnapshot\t300$/\tMetricSnapshot\t299/'
  mk grow_plain  's/\tKnowTask\t120$/\tKnowTask\t121/'
  mk mixed       's/\treading\t1000$/\treading\t900/; s/\tnode\t5$/\tnode\t4/'
  mk type_gone   '/\tnode\t/d'
  cat "$root/base.tsv" > "$root/type_new.tsv"; printf 'mdh\tbrand_new\t7\n' >> "$root/type_new.tsv"

  case_ "одинаковые снимки — зелено"                             same       0 0 0
  case_ "убыль у типа с прореживанием — законно"                 legit_down 0 1 0
  case_ "рост у типа с прореживанием — тоже законно"             legit_up   0 1 0
  case_ "убыль у графового типа без политики — КРАСНО"           node_down  2 0 1
  case_ "retentionMs=0 — это не политика — КРАСНО"               zero_ret   2 0 1
  case_ "рост у типа без политики на одних байтах — КРАСНО"      grow_plain 2 0 1
  case_ "законное и находка вместе — КРАСНО, оба учтены"         mixed      2 1 1
  case_ "тип пропал — КРАСНО"                                    type_gone  2 0 1
  case_ "появился тип — КРАСНО"                                  type_new   2 0 1

  # Снимок с неотвеченным типом и пустой снимок обязаны отвергаться.
  printf 'mdh\treading\tОШИБКА\n' > "$root/err.tsv"; : > "$root/empty.tsv"
  if validate_snapshot "$root/err.tsv"; then
    echo "  ПРОВАЛ снимок с ОШИБКА принят как годный"; fails=$((fails + 1))
  else echo "  ок    снимок с неотвеченным типом отвергнут"; fi
  if validate_snapshot "$root/empty.tsv"; then
    echo "  ПРОВАЛ пустой снимок принят как годный"; fails=$((fails + 1))
  else echo "  ок    пустой снимок отвергнут"; fi
  if validate_snapshot "$root/base.tsv"; then echo "  ок    годный снимок принят"
  else echo "  ПРОВАЛ годный снимок отвергнут"; fails=$((fails + 1)); fi

  rm -rf "$root"
  if [ "$fails" = "0" ]; then echo "самопроверка: всё сошлось"; return 0; fi
  echo "самопроверка: ПРОВАЛОВ $fails"; return 1
}

if [ "$SELFTEST" = "1" ]; then
  selftest; exit $?
fi
mkdir -p "$OUTDIR/schemas"
trap cleanup EXIT

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
classify "$OUTDIR/old.tsv" "$OUTDIR/new.tsv"; RC=$?
echo "Снимки и вердикт: $OUTDIR"
[ "$RC" = "0" ] && exit 0
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
