#!/usr/bin/env bash
# Пустая база LORE версии N → lore-schema-vN.zip и развёртывание распаковкой —
# SPRINT_LORE_PIPELINE_HOST/PL-03, решение D-2026-LORE-SCHEMA-TEMPLATE-VN.
#
#   deploy-empty-db.sh build  — собрать архив пустой базы из кода (SRC_DIR или IMAGE)
#   deploy-empty-db.sh verify <zip> — развернуть архив распаковкой в свежую ArcadeDB
#                                    и сверить: версия схемы, число типов и индексов
#                                    = эталону из <zip>.json
#
# build:
#   1. своя одноразовая ArcadeDB (версия ARCADEDB_VERSION) с пустой базой;
#   2. образ бэкенда (IMAGE или сборка из SRC_DIR/backend) с lore.bootstrap=true +
#      lore.migrate=true + lore.migrate.only=true — ядро и все шаги схемы, затем выход;
#   3. BACKUP DATABASE → OUT_DIR/lore-schema-v<N>.zip и рядом .json-эталон
#      {version, types, indexes, sha256}.
# verify: распаковка в каталог баз (restore по file:// сервер запрещает —
#   RestoreImportUrlNotAllowedException), open database, сверка с эталоном.
#
# Ничего не трогает, кроме своих контейнеров lore-emptydb-*; всё убирается в конце.
# Запуск — где есть docker (ci-server, job-контейнер CI). Прод не трогается вовсе.
#
# Окружение: SRC_DIR (.) | IMAGE; ARCADEDB_VERSION (26.11.1); OUT_DIR (./empty-db);
#            LORE_MAVEN_MIRROR, LORE_PLUGIN_MIRROR, *_PROXY — в сборку образа.
set -uo pipefail

MODE="${1:-}"
SRC_DIR="${SRC_DIR:-.}"
VER="${ARCADEDB_VERSION:-26.11.1}"
OUT_DIR="${OUT_DIR:-./empty-db}"
TS="$(date -u +%Y%m%d%H%M%S)"
YGG="lore-emptydb-ygg-$TS"
DB="lore_empty"
PW="emptydb-$(head -c 9 /dev/urandom | od -An -tx1 | tr -d ' \n')"
DB_DIR=/home/arcadedb/databases
BUILT=""

say() { echo "── $*"; }
die() { echo "::error::$*"; exit 1; }
cleanup() {
  docker rm -f "$YGG" >/dev/null 2>&1
  [ -n "$BUILT" ] && docker rmi -f "$BUILT" >/dev/null 2>&1
  return 0
}
trap cleanup EXIT

# Сеть: изнутри job-контейнера — его сеть по имени контейнера; на хосте — свой порт на docker0.
NET="$(docker inspect "$(hostname)" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null | head -1)"
start_ygg() {
  if [ -n "$NET" ]; then
    docker run -d --name "$YGG" --network "$NET" -e JAVA_OPTS="-Darcadedb.server.rootPassword=$PW" "arcadedata/arcadedb:$VER" >/dev/null || die "ArcadeDB $VER не запустилась"
    URL="http://$YGG:2480"; NETARG="--network $NET"
  else
    PORT="${EMPTYDB_PORT:-2498}"
    docker run -d --name "$YGG" -p "172.17.0.1:$PORT:2480" -e JAVA_OPTS="-Darcadedb.server.rootPassword=$PW" "arcadedata/arcadedb:$VER" >/dev/null || die "ArcadeDB $VER не запустилась"
    URL="http://172.17.0.1:$PORT"; NETARG=""
  fi
  for _ in $(seq 1 60); do ac "$URL/api/v1/databases" | grep -q '"result"' && return 0; sleep 1; done
  die "ArcadeDB $VER не пустила под root за 60 с"
}
ac() { curl -s --noproxy '*' -m 300 -u "root:$PW" -H 'Content-Type: application/json' "$@"; }
srv() { ac -X POST -d "{\"command\":\"$1\"}" "$URL/api/v1/server"; }
sqlq() { ac -X POST -d "{\"language\":\"sql\",\"command\":\"$1\"}" "$URL/api/v1/query/$DB"; }
facts() { # → «version types indexes»
  local v t i
  v="$(sqlq 'SELECT max(version) AS v FROM LoreSchemaVersion' | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"][0]["v"])')"
  t="$(sqlq 'SELECT count(*) AS c FROM schema:types' | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"][0]["c"])')"
  i="$(sqlq 'SELECT count(*) AS c FROM schema:indexes' | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"][0]["c"])')"
  echo "$v $t $i"
}

case "$MODE" in
  build)
    mkdir -p "$OUT_DIR"
    IMG="${IMAGE:-}"
    if [ -z "$IMG" ]; then
      IMG="lore-emptydb:$TS"; BUILT="$IMG"
      ARGS="--add-host=host.docker.internal:host-gateway"
      for v in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy LORE_MAVEN_MIRROR LORE_PLUGIN_MIRROR; do
        eval "val=\${$v:-}"; [ -n "$val" ] && ARGS="$ARGS --build-arg $v=$val"
      done
      say "сборка образа из $SRC_DIR/backend"
      # shellcheck disable=SC2086
      docker build -q $ARGS -f "$SRC_DIR/backend/Dockerfile.local" -t "$IMG" "$SRC_DIR/backend" > "$OUT_DIR/build.log" 2>&1 \
        || { tail -30 "$OUT_DIR/build.log"; die "образ не собрался (build.log)"; }
    fi
    start_ygg
    srv "create database $DB" | grep -q '"ok"' || die "пустая база $DB не создана"
    say "накатка схемы с нуля (bootstrap + все шаги)"
    # shellcheck disable=SC2086
    docker run --rm $NETARG --add-host=host.docker.internal:host-gateway \
      -e MART_ARCADE_URL="$URL" -e ARCADEDB_USER=root -e ARCADEDB_ROOT_PASSWORD="$PW" -e LORE_DB="$DB" \
      -e LORE_BOOTSTRAP=true -e LORE_MIGRATE=true -e LORE_MIGRATE_ONLY=true -e LORE_MART_AUTH=basic \
      -e LORE_MIGRATE_BACKUP=false -e LORE_AUTH_ENABLED=false "$IMG" > "$OUT_DIR/migrate.log" 2>&1
    rc=$?
    { [ "$rc" = 0 ] && grep -q "lore.migrate.only=true — схема накатана" "$OUT_DIR/migrate.log"; } \
      || { tail -30 "$OUT_DIR/migrate.log"; die "накатка на пустую базу не подтверждена (migrate.log)"; }
    read -r V T I <<< "$(facts)"
    [ -n "$V" ] && [ "$V" != None ] || die "версия схемы не прочитана"
    say "схема v$V: типов $T, индексов $I — BACKUP DATABASE"
    out="$(ac -X POST -d '{"language":"sql","command":"BACKUP DATABASE"}' "$URL/api/v1/command/$DB")"
    grep -q '"result":"OK"' <<< "$out" || die "BACKUP DATABASE не подтверждён: $(printf '%s' "$out" | head -c 300)"
    bfile="$(printf '%s' "$out" | sed -nE 's/.*"backupFile":"([^"]*)".*/\1/p')"
    bpath="$(docker exec "$YGG" sh -c "find /home/arcadedb -name '$(basename "$bfile")' -type f | head -1")"
    [ -n "$bpath" ] || die "файл бэкапа $bfile не найден"
    ZIP="$OUT_DIR/lore-schema-v$V.zip"
    docker cp "$YGG:$bpath" "$ZIP" || die "архив не скопирован"
    sum="$(sha256sum "$ZIP" | awk '{print $1}')"
    printf '{"version": %s, "types": %s, "indexes": %s, "sha256": "%s", "arcadedb": "%s"}\n' "$V" "$T" "$I" "$sum" "$VER" > "$ZIP.json"
    echo "готово: $ZIP ($(du -h "$ZIP" | cut -f1)), эталон $ZIP.json"
    ;;

  verify)
    ZIP="${2:-}"; [ -s "$ZIP" ] && [ -s "$ZIP.json" ] || die "нужен архив и эталон рядом: verify <zip> (и <zip>.json)"
    start_ygg
    say "развёртывание распаковкой $ZIP → $DB"
    docker cp "$ZIP" "$YGG:/tmp/e.zip" || die "архив не скопирован в $YGG"
    docker exec "$YGG" sh -c "set -e; mkdir -p '$DB_DIR/$DB'; cd '$DB_DIR/$DB'; unzip -q /tmp/e.zip" || die "распаковка не удалась"
    srv "open database $DB" | grep -q '"ok"' || die "open database $DB не прошёл"
    read -r V T I <<< "$(facts)"
    read -r EV ET EI <<< "$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["version"],d["types"],d["indexes"])' "$ZIP.json")"
    echo "развёрнуто: v$V, типов $T, индексов $I; эталон: v$EV, типов $ET, индексов $EI"
    [ "$V" = "$EV" ] && [ "$T" = "$ET" ] && [ "$I" = "$EI" ] || die "развёрнутая база не совпала с эталоном"
    echo "сверка зелёная"
    ;;

  --selftest)
    # Разбор ответов facts на подставном JSON — без docker.
    r='{"result":[{"v":84}]}'
    [ "$(printf '%s' "$r" | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"][0]["v"])')" = 84 ] || { echo "::error::selftest: разбор версии"; exit 1; }
    echo "selftest ok"
    ;;

  *) die "режим: build | verify <zip> | --selftest" ;;
esac
