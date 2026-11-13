#!/usr/bin/env bash
# Живая проверка миграций схемы на копии прода — SPRINT_LORE_PIPELINE_HOST/PL-MIGRATE-LIVE-CHECK.
#
# Повод (владелица 13.11.2026): «если схема меняется — проверить на реальном
# бэкапе, не поедут ли данные». Тесты гоняют миграции на пустой/синтетической
# базе; шаг, который на живых данных теряет записи или плодит вторые открытые
# версии SCD2, там зелёный.
#
# Что делает:
#   1. снимок прода (lore-host): `fresh` — BACKUP DATABASE кредом работающего
#      бэкенда прода (данные прода не меняются, в каталоге бэкапов LORE-ygg
#      lore-host появляется ещё один архив — как у PL-04); `latest` — самый
#      свежий уже лежащий архив, ничего на проде не делается; `auto` (по
#      умолчанию) — latest, если он моложе MAX_AGE_H часов, иначе fresh.
#      Архив потоком по ssh, сверка sha256;
#   2. разворачивает его в тест-контейнере CI (LORE-ygg-ci, порт 2482 только на
#      docker0) под ОДНОРАЗОВЫМ именем lore_migcheck_<метка>_<время>;
#   3. инвентарь ДО: число записей по каждому типу, образцы записей (типы до 500
#      записей — целиком), инвариант SCD2 «одна открытая версия на сущность»;
#   4. собирает образ бэкенда из проверяемого кода (SRC_DIR) и накатывает схему
#      тем же путём, что выкатка (lore.migrate.only, root-кред), → инвентарь ПОСЛЕ;
#   5. повтор накатки (ledger: «нечего накатывать») → должно совпасть с ПОСЛЕ;
#   6. повтор с ВЫПОЛНЕНИЕМ новых шагов заново (строки ledger этих шагов
#      удаляются на копии) → должно совпасть с ПОСЛЕ: шаг идемпотентен, даже если
#      ledger записан, а работа прервана (ловушка, найденная на live-DB тестах);
#   7. отчёт report.md в REPORT_DIR; база-копия удаляется ВСЕГДА (trap).
#
# Вердикт: 0 — зелёно, 1 — красно (убыль без объявления, пропажа записи, новая
# двойная открытая версия, неидемпотентный повтор, накатка упала), 2 — проверка
# не выполнилась (это НЕ «зелёно»).
#
# Окружение:
#   R                       ssh-команда до lore-host (шаг ssh из lore-host-deploy.sh);
#                           не нужна, если задан SNAPSHOT_FILE
#   ARCADEDB_ROOT_PASSWORD  root тест-контейнера (LORE-ygg-ci)
#   LABEL                   метка прогона, например pr1311 (в имени базы и отчёте)
#   SRC_DIR                 корень проверяемого кода (по умолчанию .)
#   IMAGE                   готовый образ бэкенда вместо сборки из SRC_DIR
#   SNAPSHOT                auto | fresh | latest (по умолчанию auto)
#   SNAPSHOT_FILE           готовый архив снимка на этой машине (снимок не снимается)
#   MAX_AGE_H               для auto: возраст «свежего» архива, часов (24)
#   ALLOW_DECREASE          типы, чья убыль объявлена миграцией, через запятую
#   REPORT_DIR              куда положить отчёт (./migrate-live-check-report)
#   YGG_CI                  own (по умолчанию) — своя одноразовая ArcadeDB той же
#                           версии, что на проде, в docker-сети задания (как
#                           db-regression.yml): ни общего секрета, ни места в tmpfs
#                           LORE-ygg-ci; удаляется вместе с копией. Иначе — имя уже
#                           работающего контейнера (тогда нужны ARCADE_URL и
#                           ARCADEDB_ROOT_PASSWORD)
#   ARCADE_URL              адрес не-own контейнера для скрипта и контейнера накатки
#   ARCADEDB_VERSION        версия движка для own при SNAPSHOT_FILE (иначе — с прода)
#   BASE_IMAGE / BASE_SRC_DIR  прежний код (то, что на проде; в workflow — main) для
#                           рантайм-фазы 7: эталон ответов до накатки; прежний образ
#                           на НОВОЙ схеме обязан подняться и ответить так же
#                           (откат кода без отката базы); новый образ — старт №1 и №2.
#                           Не задано — фаза 7 пропускается (в отчёте не упоминается)
set -uo pipefail

# OH-17: метка своего прогона на каждом контейнере — шаг ci-teardown.sh с if: always()
# снимет их, даже если джоб убит (trap при SIGKILL не срабатывает).
CI_LABEL="--label lore.ci.run=${GITHUB_RUN_ID:-local}"

LABEL="$(printf '%s' "${LABEL:-manual}" | tr -c 'a-zA-Z0-9' '_' | cut -c1-24)"
SRC_DIR="${SRC_DIR:-.}"
SNAPSHOT="${SNAPSHOT:-auto}"
MAX_AGE_H="${MAX_AGE_H:-24}"
ALLOW_DECREASE="${ALLOW_DECREASE:-}"
REPORT_DIR="${REPORT_DIR:-./migrate-live-check-report}"
YGG_CI="${YGG_CI:-own}"
ARCADE_URL="${ARCADE_URL:-}"
MIG_NET=""
OWN_YGG=""
SOURCE_DB="${SOURCE_DB:-system_aida_lore}"
REMOTE_YGG="${REMOTE_YGG:-LORE-ygg}"
REMOTE_BACKEND_DIR="${REMOTE_BACKEND_DIR:-/home/nooriuta/UnlimitedLORE-deploy}"
DB_DIR=/home/arcadedb/databases
TS="$(date -u +%Y%m%d%H%M%S)"
DB="lore_migcheck_${LABEL}_${TS}"
API=""
HERE="$(cd "$(dirname "$0")" && pwd)"
INV="python3 $HERE/migrate-live-check/inventory.py"
SNAP=""
OWN_SNAP=no
BUILT_IMAGE=""
BUILT_BASE=""
RT_NAME="lore-migcheck-rt-$TS"
DB_CREATED=no

say()  { echo "── $*"; }
skip() { echo "::error::проверка НЕ выполнилась: $*"; note "**⚪ НЕ ВЫПОЛНИЛАСЬ:** $*"; exit 2; }
note() { mkdir -p "$REPORT_DIR"; printf '%s\n' "$*" >> "$REPORT_DIR/report.md"; }
# shellcheck disable=SC2086 # R — составная ssh-команда намеренно
r() { [ -n "${R:-}" ] || skip "ssh-команда R до lore-host не задана"; $R "$@"; }
acurl() { curl -s --noproxy '*' -m 600 -u "root:$ARCADEDB_ROOT_PASSWORD" -H 'Content-Type: application/json' "$@"; }
server_cmd() { acurl -X POST -d "{\"command\":\"$1\"}" "$API/server"; }
sql_cmd() { acurl -X POST -d "{\"language\":\"sql\",\"command\":\"$1\"}" "$API/command/$DB"; }

cleanup() {
  if [ "$DB_CREATED" = yes ] && [ -z "$OWN_YGG" ]; then
    out="$(server_cmd "drop database $DB")"
    case "$out" in *'"ok"'*) echo "копия $DB удалена" ;; *) echo "::warning::копия $DB НЕ удалена: $(printf '%s' "$out" | head -c 200)" ;; esac
    docker exec "$YGG_CI" sh -c "test -d '$DB_DIR/$DB'" 2>/dev/null \
      && echo "::warning::каталог $DB_DIR/$DB остался в $YGG_CI"
  fi
  [ "$OWN_SNAP" = yes ] && [ -n "$SNAP" ] && rm -f "$SNAP"
  docker rm -f "$RT_NAME" >/dev/null 2>&1
  [ -n "$BUILT_IMAGE" ] && docker rmi -f "$BUILT_IMAGE" >/dev/null 2>&1
  [ -n "$BUILT_BASE" ] && docker rmi -f "$BUILT_BASE" >/dev/null 2>&1
  [ -n "$OWN_YGG" ] && docker rm -f "$OWN_YGG" >/dev/null 2>&1 && echo "своя ArcadeDB $OWN_YGG удалена вместе с копией"
  return 0
}
trap cleanup EXIT

# ── 0. защита имён и окружения ──────────────────────────────────────────────
case "$DB" in lore_migcheck_*) ;; *) skip "имя копии $DB не начинается с lore_migcheck_" ;; esac
if [ "$YGG_CI" != own ]; then
  [ -n "${ARCADEDB_ROOT_PASSWORD:-}" ] || skip "ARCADEDB_ROOT_PASSWORD (root $YGG_CI) не задан"
  [ -n "$ARCADE_URL" ] || skip "ARCADE_URL для $YGG_CI не задан"
fi
command -v python3 >/dev/null || skip "нет python3"
rm -rf "$REPORT_DIR"; mkdir -p "$REPORT_DIR"
SRC_SHA="${SRC_SHA:-$(git -C "$SRC_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo '?')}"
note "# Живая проверка миграций: $LABEL"
note ""
note "- код: \`$SRC_SHA\` (${SRC_DIR}); копия: \`$DB\` в $YGG_CI; объявленная убыль: ${ALLOW_DECREASE:-нет}"
prod_ver="${ARCADEDB_VERSION:-}"

# ── 1. снимок прода ─────────────────────────────────────────────────────────
if [ -n "${SNAPSHOT_FILE:-}" ]; then
  SNAP="$SNAPSHOT_FILE"; [ -s "$SNAP" ] || skip "SNAPSHOT_FILE=$SNAP пуст или не найден"
  snap_note="готовый файл $SNAP"
else
  prod_img="$(r "docker inspect -f '{{.Config.Image}}' $REMOTE_YGG")" || skip "lore-host: контейнер $REMOTE_YGG не найден"
  prod_ver="${prod_img##*:}"
  latest="$(r "docker exec $REMOTE_YGG sh -c 'ls -1t /home/arcadedb/backups/$SOURCE_DB/$SOURCE_DB-backup-*.zip 2>/dev/null | head -1'")"
  age_h=999999
  if [ -n "$latest" ]; then
    mt="$(r "docker exec $REMOTE_YGG stat -c %Y '$latest'")"
    [ -n "$mt" ] && age_h=$(( ( $(date +%s) - mt ) / 3600 ))
  fi
  mode="$SNAPSHOT"
  if [ "$mode" = auto ]; then
    if [ -n "$latest" ] && [ "$age_h" -le "$MAX_AGE_H" ]; then mode=latest; else mode=fresh; fi
  fi
  if [ "$mode" = fresh ]; then
    say "lore-host: BACKUP DATABASE $SOURCE_DB (данные прода не меняются)"
    bcid="$(r "cd $REMOTE_BACKEND_DIR && docker compose ps -q lore-backend" | head -1)"
    [ -n "$bcid" ] || skip "бэкенд прода на lore-host не запущен — снимок его кредом невозможен"
    out="$(r "docker exec $bcid sh -c 'curl -s -m 600 -u \"\$ARCADEDB_USER:\$ARCADEDB_ROOT_PASSWORD\" -H \"Content-Type: application/json\" -d \"{\\\"language\\\":\\\"sql\\\",\\\"command\\\":\\\"BACKUP DATABASE\\\"}\" \"\$MART_ARCADE_URL/api/v1/command/$SOURCE_DB\"'")"
    grep -q '"result":"OK"' <<< "$out" || skip "BACKUP DATABASE на проде не подтверждён: $(printf '%s' "$out" | head -c 300)"
    bfile="$(printf '%s' "$out" | sed -nE 's/.*"backupFile":"([^"]*)".*/\1/p')"
    latest="$(r "docker exec $REMOTE_YGG sh -c 'find /home/arcadedb/backups -name \"$(basename "$bfile")\" -type f | head -1'")"
    [ -n "$latest" ] || skip "файл бэкапа $bfile не найден в $REMOTE_YGG"
    age_h=0
  elif [ -z "$latest" ]; then
    skip "на lore-host нет ни одного архива $SOURCE_DB, а SNAPSHOT=latest"
  fi
  SNAP="/tmp/lore-migcheck-$TS.zip"; OWN_SNAP=yes
  say "перенос снимка $latest → $(hostname)"
  r "docker exec $REMOTE_YGG cat '$latest'" > "$SNAP" || skip "снимок не перенесён"
  rsum="$(r "docker exec $REMOTE_YGG sha256sum '$latest'" | awk '{print $1}')"
  lsum="$(sha256sum "$SNAP" | awk '{print $1}')"
  [ -n "$rsum" ] && [ "$rsum" = "$lsum" ] || skip "sha256 снимка не совпал: lore-host $rsum, здесь $lsum"
  snap_note="$mode: \`$(basename "$latest")\` (возраст ${age_h} ч, sha256 ${lsum:0:12}…), ArcadeDB прода $prod_ver"
fi

# ── 1б. тест-ArcadeDB: своя (own) или указанная ─────────────────────────────
if [ "$YGG_CI" = own ]; then
  [ -n "$prod_ver" ] || skip "версия ArcadeDB прода неизвестна (задайте ARCADEDB_VERSION при SNAPSHOT_FILE)"
  NET="$(docker inspect "$(hostname)" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null | head -1)"
  [ -n "$NET" ] || skip "не определить docker-сеть задания (YGG_CI=own работает изнутри контейнера задания)"
  OWN_YGG="lore-migcheck-ygg-$TS"; YGG_CI="$OWN_YGG"; MIG_NET="--network $NET"
  ARCADEDB_ROOT_PASSWORD="migcheck-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  export ARCADEDB_ROOT_PASSWORD
  ARCADE_URL="http://$OWN_YGG:2480"
  say "своя ArcadeDB $prod_ver: $OWN_YGG в сети $NET"
  docker run -d $CI_LABEL --name "$OWN_YGG" --network "$NET" \
    -e JAVA_OPTS="-Darcadedb.server.rootPassword=$ARCADEDB_ROOT_PASSWORD" "arcadedata/arcadedb:$prod_ver" >/dev/null \
    || skip "контейнер arcadedata/arcadedb:$prod_ver не запустился"
fi
API="$ARCADE_URL/api/v1"
dbs=""
for _ in $(seq 1 60); do
  dbs="$(acurl -m 4 "$API/databases" 2>/dev/null)" || true
  case "$dbs" in *'"result"'*) break ;; esac
  sleep 1
done
case "$dbs" in *'"result"'*) ;; *) skip "$API не пустил под root за 60 с: $(printf '%s' "$dbs" | head -c 200)" ;; esac
ci_ver="$(printf '%s' "$dbs" | sed -nE 's/.*"version":"([0-9.]+).*/\1/p')"
if [ -n "$prod_ver" ] && [ -n "$ci_ver" ] && [ "$prod_ver" != "$ci_ver" ]; then
  skip "версия ArcadeDB прода ($prod_ver) ≠ тест-контейнера ($ci_ver): проверка на другом движке — не та проверка"
fi
note "- снимок прода: $snap_note; тест-ArcadeDB ${ci_ver:-?} ($YGG_CI)"

# ── 2. копия в тест-контейнере ──────────────────────────────────────────────
say "$YGG_CI: распаковка снимка в $DB"
docker cp "$SNAP" "$YGG_CI:/tmp/$DB.zip" || skip "архив не скопирован в $YGG_CI"
DB_CREATED=yes
unz=ok
docker exec "$YGG_CI" sh -c "set -e; mkdir -p '$DB_DIR'; mkdir '$DB_DIR/$DB'; cd '$DB_DIR/$DB'; unzip -q /tmp/$DB.zip" || unz=no
docker exec -u 0 "$YGG_CI" rm -f "/tmp/$DB.zip" || true
[ "$unz" = ok ] || skip "распаковка в $DB_DIR/$DB не удалась"
o="$(server_cmd "open database $DB")"
case "$o" in *'"ok"'*) ;; *) skip "open database $DB: $(printf '%s' "$o" | head -c 200)" ;; esac

say "инвентарь ДО"
$INV snapshot "$API" "$DB" "$REPORT_DIR/before.json" || skip "инвентарь ДО не снят"

# Объявленная убыль из проверяемого кода (declared-decrease.tsv едет в PR вместе с
# шагом): берутся только шаги НОВЕЕ схемы снимка — после выкатки шага на прод его
# объявление перестаёт действовать само. На pull_request вход ALLOW_DECREASE пуст,
# и без файла каждый PR со схемой краснел бы на чужом уже смерженном шаге (#1316).
snap_ver="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["schema_version"] or 0)' "$REPORT_DIR/before.json")"
for decl in "$SRC_DIR/scripts/migrate-live-check/declared-decrease.tsv" "$HERE/migrate-live-check/declared-decrease.tsv"; do
  [ -f "$decl" ] || continue
  while IFS=$'\t' read -r ver types why; do
    case "$ver" in ''|\#*) continue ;; esac
    [ "$ver" -gt "$snap_ver" ] 2>/dev/null || continue
    case ",$ALLOW_DECREASE," in *",$types,"*) continue ;; esac
    ALLOW_DECREASE="${ALLOW_DECREASE:+$ALLOW_DECREASE,}$types"
    note "- объявлено в declared-decrease.tsv: V$ver — $types ($why)"
  done < "$decl"
  break
done

# ── 3. образ проверяемого кода ──────────────────────────────────────────────
ARGS="--add-host=host.docker.internal:host-gateway"
for v in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy LORE_MAVEN_MIRROR LORE_PLUGIN_MIRROR; do
  eval "val=\${$v:-}"; [ -n "$val" ] && ARGS="$ARGS --build-arg $v=$val"
done
IMG="${IMAGE:-}"
if [ -z "$IMG" ]; then
  IMG="lore-migcheck:$LABEL-$TS"
  say "сборка образа $IMG из $SRC_DIR/backend"
  # shellcheck disable=SC2086
  docker build -q $ARGS -f "$SRC_DIR/backend/Dockerfile.local" -t "$IMG" "$SRC_DIR/backend" > "$REPORT_DIR/build.log" 2>&1 \
    || { tail -30 "$REPORT_DIR/build.log"; skip "образ проверяемого кода не собрался (build.log)"; }
  BUILT_IMAGE="$IMG"
fi
# Образа нет — проверка не выполнилась (2), а не «накатка упала» (1): прогон
# 13.11 после сбоя сборки отрапортовал красное на данных, которых не трогал.
docker image inspect "$IMG" >/dev/null 2>&1 || skip "образа $IMG нет — накатывать нечем"

# Прежний образ (код, который сейчас на проде) — для рантайм-фазы 7: эталон
# ответов до накатки и «откат кода без отката базы». BASE_IMAGE или BASE_SRC_DIR.
BASE_IMG="${BASE_IMAGE:-}"
if [ -z "$BASE_IMG" ] && [ -n "${BASE_SRC_DIR:-}" ]; then
  BASE_IMG="lore-migcheck:base-$LABEL-$TS"
  say "сборка прежнего образа $BASE_IMG из $BASE_SRC_DIR/backend"
  # shellcheck disable=SC2086
  docker build -q $ARGS -f "$BASE_SRC_DIR/backend/Dockerfile.local" -t "$BASE_IMG" "$BASE_SRC_DIR/backend" > "$REPORT_DIR/build-base.log" 2>&1 \
    || skip "прежний образ не собрался (build-base.log)"
  BUILT_BASE="$BASE_IMG"
fi
[ -z "$BASE_IMG" ] || docker image inspect "$BASE_IMG" >/dev/null 2>&1 || skip "прежнего образа $BASE_IMG нет"

migrate() { # migrate <имя-лога> → 0, если накатка подтверждена
  # shellcheck disable=SC2086 # MIG_NET — «--network сеть» или пусто
  docker run --rm $CI_LABEL $MIG_NET --add-host=host.docker.internal:host-gateway \
    -e MART_ARCADE_URL="$ARCADE_URL" -e ARCADEDB_USER=root -e ARCADEDB_ROOT_PASSWORD \
    -e LORE_DB="$DB" -e LORE_MIGRATE=true -e LORE_MIGRATE_ONLY=true -e LORE_MART_AUTH=basic \
    -e LORE_MIGRATE_BACKUP=false -e LORE_AUTH_ENABLED=false \
    "$IMG" > "$REPORT_DIR/$1.log" 2>&1
  local rc=$?
  grep -E "LORE MIGRATE" "$REPORT_DIR/$1.log" | tail -40
  [ "$rc" = 0 ] && grep -q "lore.migrate.only=true — схема накатана" "$REPORT_DIR/$1.log"
}

VERDICT=0
section() { # section <заголовок> <до> <после> <режим>
  note ""; note "## $1"; note ""
  $INV compare "$REPORT_DIR/$2.json" "$REPORT_DIR/$3.json" "$4" "$ALLOW_DECREASE" "$REPORT_DIR/$3-$4.md"
  local rc=$?
  cat "$REPORT_DIR/$3-$4.md" >> "$REPORT_DIR/report.md"
  [ "$rc" -gt "$VERDICT" ] && VERDICT=$rc
  return 0
}

# ── рантайм: приложение на копии и его ответы ──────────────────────────────
RT_PORT="${RT_PORT:-9191}"
if [ -n "$MIG_NET" ]; then RT_URL="http://$RT_NAME:9100"; RT_PUB=""; else RT_URL="http://172.17.0.1:$RT_PORT"; RT_PUB="-p 172.17.0.1:$RT_PORT:9100"; fi
rt_up() { # rt_up <образ> <метка> → 0, если поднялось
  docker rm -f "$RT_NAME" >/dev/null 2>&1
  # shellcheck disable=SC2086
  docker run -d $CI_LABEL --name "$RT_NAME" $MIG_NET $RT_PUB --add-host=host.docker.internal:host-gateway \
    -e MART_ARCADE_URL="$ARCADE_URL" -e ARCADEDB_USER=root -e ARCADEDB_ROOT_PASSWORD \
    -e LORE_DB="$DB" -e LORE_MART_AUTH=basic -e LORE_AUTH_ENABLED=false -e LORE_MIGRATE=false \
    "$1" >/dev/null || return 1
  for _ in $(seq 1 90); do
    curl -sf --noproxy '*' -m 3 "$RT_URL/q/health/live" >/dev/null 2>&1 && return 0
    sleep 2
  done
  docker logs "$RT_NAME" > "$REPORT_DIR/rt-$2.log" 2>&1
  return 1
}
rt_down() { docker logs "$RT_NAME" > "$REPORT_DIR/rt-$1.log" 2>&1; docker rm -f "$RT_NAME" >/dev/null 2>&1; }
first_id() { # first_id <тип> <поле>
  acurl -X POST -d "{\"language\":\"sql\",\"command\":\"SELECT $2 AS v FROM $1 ORDER BY @rid LIMIT 1\"}" "$API/query/$DB" \
    | python3 -c 'import json,sys;r=json.load(sys.stdin).get("result") or [{}];print(r[0].get("v") or "")'
}
RT_PATHS=""
rt_get() { # rt_get <метка>: ответы ключевых адресов в rt-<метка>/
  local d="$REPORT_DIR/rt-$1" i=0 p
  mkdir -p "$d"
  for p in $RT_PATHS; do
    i=$((i + 1))
    curl -s --noproxy '*' -m 60 -H 'X-Seer-Role: admin' -o "$d/$i.json" -w '%{http_code}\n' "$RT_URL$p" > "$d/$i.code"
  done
}
rt_same() { # rt_same <a> <b> → печатает расходящиеся адреса; код 0 — всё равно
  python3 - "$REPORT_DIR/rt-$1" "$REPORT_DIR/rt-$2" $RT_PATHS <<'PY'
import json, os, sys
a, b, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
def load(d, i):
    code = open(os.path.join(d, f"{i}.code")).read().strip()
    raw = open(os.path.join(d, f"{i}.json"), encoding="utf-8", errors="replace").read()
    try: body = json.dumps(json.loads(raw), sort_keys=True, ensure_ascii=False)
    except Exception: body = raw
    return code, body
bad = 0
for i, p in enumerate(paths, 1):
    ca, ba = load(a, i); cb, bb = load(b, i)
    if ca != cb or ba != bb:
        bad += 1
        keys = ""
        try:
            ja, jb = json.loads(ba), json.loads(bb)
            if isinstance(ja, dict) and isinstance(jb, dict):
                keys = " ключи: " + ", ".join(k for k in sorted(set(ja) | set(jb)) if json.dumps(ja.get(k), sort_keys=True) != json.dumps(jb.get(k), sort_keys=True))[:300]
        except Exception: pass
        print(f"  {p}: {ca} → {cb}{keys}")
sys.exit(1 if bad else 0)
PY
}
if [ -n "$BASE_IMG" ]; then
  T_ID="$(first_id KnowTask task_uid)"; A_ID="$(first_id KnowADR adr_id)"
  RT_PATHS="/lore/model /lore/record/task/$T_ID /lore/record/adr/$A_ID /lore/slice/sprints?limit=20 /lore/slice/adrs?limit=20"
  say "рантайм: эталон ответов прежнего образа на схеме снимка"
  rt_up "$BASE_IMG" base-old || skip "прежний образ $BASE_IMG не поднялся на схеме снимка (rt-base-old.log)"
  rt_get base-old; rt_down base-old
fi

# ── 4. накатка ──────────────────────────────────────────────────────────────
say "накатка №1 (как в выкатке)"
if ! migrate migrate-1; then
  note ""; note "## 🔴 Накатка упала"; note ""; note '```'; tail -40 "$REPORT_DIR/migrate-1.log" >> "$REPORT_DIR/report.md"; note '```'
  echo "::error::накатка на копии прода упала — хвост в migrate-1.log"; exit 1
fi
$INV snapshot "$API" "$DB" "$REPORT_DIR/after.json" || skip "инвентарь ПОСЛЕ не снят"
section "Накатка: до → после" before after migrate

# ── 5. повтор: ledger говорит «нечего накатывать» ───────────────────────────
say "накатка №2 (повтор, ledger)"
migrate migrate-2 || { note "## 🔴 Повторная накатка упала"; echo "::error::повтор накатки упал"; exit 1; }
$INV snapshot "$API" "$DB" "$REPORT_DIR/repeat.json" || skip "инвентарь после повтора не снят"
section "Повтор накатки (ledger): после → повтор" after repeat repeat

# ── 6. повтор с выполнением новых шагов заново ──────────────────────────────
vb="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["schema_version"] or 0)' "$REPORT_DIR/before.json")"
say "накатка №3: шаги > v$vb выполняются заново (строки ledger удалены на копии)"
d="$(sql_cmd "DELETE FROM LoreSchemaVersion WHERE version > $vb")"
case "$d" in *'"result"'*) ;; *) skip "строки ledger на копии не удалены: $(printf '%s' "$d" | head -c 200)" ;; esac
migrate migrate-3 || { note "## 🔴 Повторное выполнение шагов упало"; echo "::error::повторное выполнение шагов упало"; exit 1; }
$INV snapshot "$API" "$DB" "$REPORT_DIR/rerun.json" || skip "инвентарь после повторного выполнения не снят"
section "Шаги заново (идемпотентность): после → заново" after rerun repeat

# ── 7. рантайм на новой схеме ───────────────────────────────────────────────
# Красно: прежний образ (код прода) не поднимается на новой схеме или отвечает на
# ней иначе, чем на старой, — то есть откат кода без отката базы сломан. Ответы
# нового кода и запись при его повторном старте — 🟡 для глаз (это изменения
# кода и фоновые сервисы, а не данные).
if [ -n "$BASE_IMG" ]; then
  note ""; note "## Рантайм"; note ""
  note "Адреса: \`$RT_PATHS\`"
  say "рантайм: прежний образ на новой схеме (откат кода без отката базы)"
  if rt_up "$BASE_IMG" base-new; then
    rt_get base-new; rt_down base-new
    if diff_out="$(rt_same base-old base-new)"; then
      note "- 🟢 прежний образ на новой схеме отвечает так же, как на старой"
    else
      note "- 🔴 прежний образ на новой схеме отвечает иначе:"; note "$diff_out"
      VERDICT=1
    fi
  else
    note "- 🔴 прежний образ не поднялся на новой схеме (rt-base-new.log) — откат кода без отката базы невозможен"
    VERDICT=1
  fi
  say "рантайм: новый образ, старт №1 и №2"
  if rt_up "$IMG" new-1; then
    rt_get new-1; rt_down new-1
    $INV snapshot "$API" "$DB" "$REPORT_DIR/start1.json" >/dev/null || skip "инвентарь после старта №1 не снят"
    if rt_up "$IMG" new-2; then
      rt_down new-2
      $INV snapshot "$API" "$DB" "$REPORT_DIR/start2.json" >/dev/null || skip "инвентарь после старта №2 не снят"
      $INV compare "$REPORT_DIR/start1.json" "$REPORT_DIR/start2.json" repeat "" "$REPORT_DIR/start2-repeat.md" >/dev/null \
        && note "- 🟢 повторный старт нового образа ничего не пишет" \
        || { note "- 🟡 повторный старт нового образа изменил данные (сверить: фоновые сервисы или сид):"; grep -E '^- |^\| `' "$REPORT_DIR/start2-repeat.md" | head -15 >> "$REPORT_DIR/report.md"; }
    else
      note "- 🔴 новый образ не поднялся повторно (rt-new-2.log)"; VERDICT=1
    fi
    if diff_out="$(rt_same base-old new-1)"; then
      note "- 🟢 новый образ отвечает так же, как прежний до накатки"
    else
      note "- 🟡 ответы нового образа отличаются от прежнего до накатки (изменения кода — сверить с составом релиза):"; note "$diff_out"
    fi
  else
    note "- 🔴 новый образ не поднялся на новой схеме (rt-new-1.log)"; VERDICT=1
  fi
fi

case "$VERDICT" in
  0) echo "ИТОГ: зелёно"; note ""; note "**ИТОГ: 🟢 зелёно**" ;;
  1) echo "::error::ИТОГ: красно — см. $REPORT_DIR/report.md"; note ""; note "**ИТОГ: 🔴 красно**" ;;
  *) echo "::error::ИТОГ: сравнение не выполнилось"; note ""; note "**ИТОГ: ⚪ сравнение не выполнилось**" ;;
esac
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$REPORT_DIR/report.md" >> "$GITHUB_STEP_SUMMARY"
exit "$VERDICT"
