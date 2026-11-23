#!/usr/bin/env bash
# Снимок базы прода (lore-host) → база препрода на ci-server — SPRINT_LORE_PIPELINE_HOST/PL-04.
#
# Запускается ТОЛЬКО workflow «LORE preprod DB refresh» (.github/workflows/
# lore-preprod-db-refresh.yml, ручной запуск с подтверждением): на раннере 131
# есть docker-сокет 131 и ssh-ключ CD до lore-host. Руками — только с тем же
# окружением (R, ARCADEDB_ROOT_PASSWORD).
#
# Что делает:
#   1. на lore-host: BACKUP DATABASE <source> кредом сервиса lore-migrate прода (DBR-01)
#      (пароль прода lore-host не покидает); архив читается из контейнера
#      LORE-ygg и потоком по ssh переносится на 131, сверка sha256;
#   2. на 131: бэкенд препрода (compose-проект lore-preprod) останавливается,
#      прежняя база препрода закрывается и ПЕРЕИМЕНОВЫВАЕТСЯ в
#      <target>_bak_<время> (копия прежней, не удаление);
#   3. архив распаковывается в каталог баз LORE-ygg 131 под именем <target>
#      (restore по file:// сервер запрещает — RestoreImportUrlNotAllowedException;
#      архив backup плоский) и открывается командой сервера;
#   4. сверка: max(LoreSchemaVersion.version) в новой базе = в проде; бэкенд
#      препрода запускается обратно, если работал.
#
# Чего НЕ делает: не пишет в прод (только BACKUP — он создаёт файл в каталоге
# бэкапов LORE-ygg lore-host и оставляет его там как ещё одну копию), не трогает
# system_aida_lore и *_frozen_* на 131, не удаляет прежнюю базу препрода.
#
# Окружение:
#   R                       ssh-команда до lore-host (шаг ssh из lore-host-deploy.sh)
#   ARCADEDB_ROOT_PASSWORD  root LORE-ygg на 131
#   TARGET_DB               по умолчанию system_aida_lore_preprod
#   SOURCE_DB               по умолчанию system_aida_lore (на lore-host)
#   DRY_RUN=true            только проверки доступа и состояния, ничего не меняет
#   CREATE_ONLY=true        режим LORE CD: только создать ОТСУТСТВУЮЩУЮ базу из
#                           снимка; есть — выход 0 без изменений
set -uo pipefail

TARGET_DB="${TARGET_DB:-system_aida_lore_preprod}"
SOURCE_DB="${SOURCE_DB:-system_aida_lore}"
LOCAL_YGG="${LOCAL_YGG:-LORE-ygg}"
REMOTE_YGG="${REMOTE_YGG:-LORE-ygg}"
REMOTE_BACKEND_DIR="${REMOTE_BACKEND_DIR:-/home/nooriuta/UnlimitedLORE-deploy}"
PREPROD_PROJECT="${PREPROD_PROJECT:-lore-preprod}"
DB_DIR=/home/arcadedb/databases
TS="$(date -u +%Y%m%d%H%M%S)"
SNAP="/tmp/lore-prod-snapshot-$TS.zip"
DRY="${DRY_RUN:-true}"

say() { echo "── $*"; }
die() { echo "::error::$*"; exit 1; }
# shellcheck disable=SC2086 # R — составная ssh-команда намеренно
r() { [ -n "${R:-}" ] || die "ssh-команда R не задана"; $R "$@"; }

# ── 0. защита имён ──────────────────────────────────────────────────────────
case "$TARGET_DB" in
  "$SOURCE_DB"|system_aida_lore|*_frozen_*) die "TARGET_DB=$TARGET_DB — это база прода или замороженная копия; заливать в неё нельзя" ;;
  *_preprod) ;;
  *) die "TARGET_DB=$TARGET_DB — имя базы препрода обязано оканчиваться на _preprod" ;;
esac
# LOCAL_SOURCE (1.18): источник замены — только база переноса migration_dst*, проверка до сети.
LOCAL_SOURCE="${LOCAL_SOURCE:-}"
case "$LOCAL_SOURCE" in
  ""|migration_dst*) ;;
  *) die "LOCAL_SOURCE=$LOCAL_SOURCE — источником замены может быть только база переноса migration_dst*" ;;
esac
[ "$LOCAL_SOURCE" != "$TARGET_DB" ] || die "LOCAL_SOURCE совпадает с TARGET_DB"
[ -n "${ARCADEDB_ROOT_PASSWORD:-}" ] || die "ARCADEDB_ROOT_PASSWORD (root LORE-ygg 131) не задан"

# Адрес ArcadeDB 131 из контейнера джоба — шлюз по умолчанию (как в lore-cd.yml).
GW="${ARCADE_HOST:-}"
if [ -z "$GW" ]; then
  hex=$(awk '$2=="00000000" && $8=="00000000" {print $3; exit}' /proc/net/route 2>/dev/null)
  [ -n "$hex" ] && [ ${#hex} -eq 8 ] && GW="$((16#${hex:6:2})).$((16#${hex:4:2})).$((16#${hex:2:2})).$((16#${hex:0:2}))"
fi
[ -n "$GW" ] || die "адрес ArcadeDB 131 не определён"
API="http://$GW:2480/api/v1"
acurl() { curl -s -m 600 -u "root:$ARCADEDB_ROOT_PASSWORD" -H 'Content-Type: application/json' "$@"; }
server_cmd() { acurl -X POST -d "{\"command\":\"$1\"}" "$API/server"; }
model_n() { # model_n <база> → число отметок модели LoreModelSchema (модельная схема, 1.18+)
  acurl -X POST -d '{"language":"sql","command":"SELECT count(*) AS n FROM LoreModelSchema"}' "$API/command/$1" | tr -d '\n ' | sed -nE 's/.*"n":([0-9]+).*/\1/p'
}
query_ver() { # query_ver <база> → max(version)
  acurl -X POST -d '{"language":"sql","command":"SELECT max(version) AS v FROM LoreSchemaVersion"}' "$API/command/$1" \
    | tr -d '\n ' | sed -nE 's/.*"v":([0-9]+).*/\1/p'
}

# ── 1. состояние (и в dry-run) ──────────────────────────────────────────────
say "131: LORE-ygg и базы"
dbs="$(acurl "$API/databases")" || die "ArcadeDB 131 ($API) не ответил под root"
echo "$dbs" | head -c 600; echo
case "$dbs" in *"\"$TARGET_DB\""*) had_target=yes ;; *) had_target=no ;; esac
# Каталог без открытой базы (остаток прерванной заливки) — тоже «есть»: его
# переименуем в _bak, иначе mkdir упадёт.
if [ "$had_target" = no ] && docker exec "$LOCAL_YGG" test -d "$DB_DIR/$TARGET_DB" 2>/dev/null; then
  had_target=yes; echo "каталог $DB_DIR/$TARGET_DB есть, а базы в списке сервера нет — остаток прерванной заливки"
fi
echo "база $TARGET_DB на 131: $had_target"
# CREATE_ONLY=true — режим LORE CD: только СОЗДАТЬ отсутствующую базу из снимка
# прода. Существующую CD не перезаливает никогда (это делает ручной workflow).
if [ "${CREATE_ONLY:-false}" = true ] && [ "$had_target" = yes ]; then
  echo "база $TARGET_DB уже есть — в режиме CREATE_ONLY не трогаю"
  exit 0
fi

# ── LOCAL_SOURCE: новая база из переноса встаёт под прежнее имя (1.18, MIG-01) ──
# Владелица 21.11: «просто старую базу бэкап, а новую под неё … а то нам и на проде придётся новые
# имена делать». Снимка прода нет: база-источник уже на 131 (собрана переносом, migration_dst_*).
# Прежняя <target> → <target>_bak_<время> (не удаление), источник → <target>, сверка — отметка модели
# LoreModelSchema в новой базе. Откат — обратное переименование.
if [ -n "$LOCAL_SOURCE" ]; then
  case "$dbs" in *"\"$LOCAL_SOURCE\""*) ;; *) die "базы $LOCAL_SOURCE на 131 нет — сначала перенос (lore-migration-snapshot.yml, action=migrate)" ;; esac
  src_n="$(model_n "$LOCAL_SOURCE")"
  [ -n "$src_n" ] && [ "$src_n" -gt 0 ] || die "в $LOCAL_SOURCE нет отметки LoreModelSchema — это не база, собранная из модели; не ставлю"
  echo "источник $LOCAL_SOURCE: отметка модели есть ($src_n)"
  pcid="$(docker ps -q --filter "label=com.docker.compose.project=$PREPROD_PROJECT" --filter "label=com.docker.compose.service=lore-backend" | head -1)"
  echo "бэкенд препрода: ${pcid:-не запущен}"
  if [ "$DRY" = true ]; then
    echo "::notice::DRY-RUN: дальше было бы: $TARGET_DB → ${TARGET_DB}_bak_$TS, $LOCAL_SOURCE → $TARGET_DB. Ничего не менялось."
    exit 0
  fi
  restart_preprod() { [ -n "$pcid" ] && docker start "$pcid" >/dev/null && echo "бэкенд препрода запущен обратно"; return 0; }
  if [ -n "$pcid" ]; then say "131: стоп бэкенда препрода"; docker stop "$pcid" >/dev/null || die "бэкенд препрода не остановился"; fi
  if [ "$had_target" = yes ]; then
    say "131: прежняя $TARGET_DB → ${TARGET_DB}_bak_$TS"
    server_cmd "close database $TARGET_DB" >/dev/null || true
    docker exec "$LOCAL_YGG" mv "$DB_DIR/$TARGET_DB" "$DB_DIR/${TARGET_DB}_bak_$TS" \
      || { restart_preprod; die "прежняя база не переименована — замену не делаю"; }
  fi
  say "131: $LOCAL_SOURCE → $TARGET_DB"
  server_cmd "close database $LOCAL_SOURCE" >/dev/null || true
  if ! docker exec "$LOCAL_YGG" mv "$DB_DIR/$LOCAL_SOURCE" "$DB_DIR/$TARGET_DB"; then
    [ "$had_target" = yes ] && docker exec "$LOCAL_YGG" mv "$DB_DIR/${TARGET_DB}_bak_$TS" "$DB_DIR/$TARGET_DB" && server_cmd "open database $TARGET_DB" >/dev/null
    restart_preprod; die "источник не переименован — прежняя база возвращена на место"
  fi
  echo "open database: $(server_cmd "open database $TARGET_DB" | head -c 200)"
  dst_n="$(model_n "$TARGET_DB")"
  [ -n "$dst_n" ] && [ "$dst_n" -gt 0 ] || die "в $TARGET_DB после замены нет отметки LoreModelSchema — препрод НЕ запускаю; прежняя база — ${TARGET_DB}_bak_$TS"
  restart_preprod
  echo "готово: $TARGET_DB = база переноса $LOCAL_SOURCE (отметка модели есть); прежняя база — ${TARGET_DB}_bak_$TS"
  exit 0
fi

docker exec "$LOCAL_YGG" sh -c "command -v unzip >/dev/null && df -h $DB_DIR | tail -1" || die "в $LOCAL_YGG нет unzip или каталога $DB_DIR"

say "lore-host: база $SOURCE_DB"
r "docker exec $REMOTE_YGG sh -c 'du -sh $DB_DIR/$SOURCE_DB'" || die "на lore-host нет $DB_DIR/$SOURCE_DB в контейнере $REMOTE_YGG"

pcid="$(docker ps -q --filter "label=com.docker.compose.project=$PREPROD_PROJECT" --filter "label=com.docker.compose.service=lore-backend" | head -1)"
echo "бэкенд препрода: ${pcid:-не запущен}"

if [ "$DRY" = true ]; then
  echo "::notice::DRY-RUN: дальше был бы снимок $SOURCE_DB → $TARGET_DB (прежняя база → ${TARGET_DB}_bak_$TS). Ничего не менялось."
  exit 0
fi

# ── 2. снимок прода ─────────────────────────────────────────────────────────
say "lore-host: BACKUP DATABASE $SOURCE_DB"
out="$(r "cd $REMOTE_BACKEND_DIR && docker compose run --rm --no-deps -T --entrypoint sh lore-migrate -c 'curl -s -m 600 -u \"\$ARCADEDB_USER:\$ARCADEDB_ROOT_PASSWORD\" -H \"Content-Type: application/json\" -d \"{\\\"language\\\":\\\"sql\\\",\\\"command\\\":\\\"BACKUP DATABASE\\\"}\" \"\$MART_ARCADE_URL/api/v1/command/$SOURCE_DB\"'")"
grep -q '"result":"OK"' <<< "$out" || die "BACKUP DATABASE на проде не подтверждён: $(printf '%s' "$out" | head -c 300)"
bfile="$(printf '%s' "$out" | sed -nE 's/.*"backupFile":"([^"]*)".*/\1/p')"
[ -n "$bfile" ] || die "имя файла бэкапа не прочитано из ответа: $(printf '%s' "$out" | head -c 300)"
bpath="$(r "docker exec $REMOTE_YGG sh -c 'find /home/arcadedb -name \"$(basename "$bfile")\" -type f | head -1'")"
[ -n "$bpath" ] || die "файл бэкапа $bfile не найден в $REMOTE_YGG"
echo "снимок прода: $bpath"

say "перенос снимка lore-host → 131"
r "docker exec $REMOTE_YGG cat '$bpath'" > "$SNAP" || die "снимок не перенесён"
rsum="$(r "docker exec $REMOTE_YGG sha256sum '$bpath'" | awk '{print $1}')"
lsum="$(sha256sum "$SNAP" | awk '{print $1}')"
[ -n "$rsum" ] && [ "$rsum" = "$lsum" ] || die "sha256 снимка не совпал: lore-host $rsum, 131 $lsum"
echo "снимок на 131: $SNAP ($(du -h "$SNAP" | cut -f1)), sha256 совпал"
src_ver="$(r "cd $REMOTE_BACKEND_DIR && docker compose run --rm --no-deps -T --entrypoint sh lore-migrate -c 'curl -s -m 60 -u \"\$ARCADEDB_USER:\$ARCADEDB_ROOT_PASSWORD\" -H \"Content-Type: application/json\" -d \"{\\\"language\\\":\\\"sql\\\",\\\"command\\\":\\\"SELECT max(version) AS v FROM LoreSchemaVersion\\\"}\" \"\$MART_ARCADE_URL/api/v1/command/$SOURCE_DB\"'" | tr -d '\n ' | sed -nE 's/.*"v":([0-9]+).*/\1/p')"
echo "схема прода: v${src_ver:-?}"
# С 1.18 схема модельная: LoreSchemaVersion нет, номер пуст — тогда сверяем отметку модели LoreModelSchema,
# как ветка local_source. Без этого сверка не проходила НИКОГДА и оставляла препрод остановленным (run 40542, 23.11.2026).
src_model=""
if [ -z "$src_ver" ]; then
  src_model="$(r "cd $REMOTE_BACKEND_DIR && docker compose run --rm --no-deps -T --entrypoint sh lore-migrate -c 'curl -s -m 60 -u \"\$ARCADEDB_USER:\$ARCADEDB_ROOT_PASSWORD\" -H \"Content-Type: application/json\" -d \"{\\\"language\\\":\\\"sql\\\",\\\"command\\\":\\\"SELECT count(*) AS n FROM LoreModelSchema\\\"}\" \"\$MART_ARCADE_URL/api/v1/command/$SOURCE_DB\"'" | tr -d '\n ' | sed -nE 's/.*"n":([0-9]+).*/\1/p')"
  echo "схема прода модельная: отметок LoreModelSchema ${src_model:-?}"
  [ -n "$src_model" ] && [ "$src_model" -gt 0 ] || die "у прода нет ни номера схемы, ни отметки модели — снимок не заливаю"
fi

# ── 3. замена базы препрода ─────────────────────────────────────────────────
restart_preprod() { [ -n "$pcid" ] && docker start "$pcid" >/dev/null && echo "бэкенд препрода запущен обратно"; return 0; }
trap 'rm -f "$SNAP"' EXIT
if [ -n "$pcid" ]; then say "131: стоп бэкенда препрода"; docker stop "$pcid" >/dev/null || die "бэкенд препрода не остановился"; fi
if [ "$had_target" = yes ]; then
  say "131: прежняя $TARGET_DB → ${TARGET_DB}_bak_$TS"
  server_cmd "close database $TARGET_DB" >/dev/null || true
  docker exec "$LOCAL_YGG" mv "$DB_DIR/$TARGET_DB" "$DB_DIR/${TARGET_DB}_bak_$TS" \
    || { restart_preprod; die "прежняя база препрода не переименована — снимок не заливаю"; }
fi
say "131: распаковка снимка в $DB_DIR/$TARGET_DB"
docker cp "$SNAP" "$LOCAL_YGG:/tmp/snap.zip" || die "архив не скопирован в $LOCAL_YGG"
if [ "$had_target" = yes ]; then prev_note="прежняя база лежит как ${TARGET_DB}_bak_$TS"; else prev_note="прежней базы не было"; fi
unzip_ok=yes
docker exec "$LOCAL_YGG" sh -c "set -e; mkdir '$DB_DIR/$TARGET_DB'; cd '$DB_DIR/$TARGET_DB'; unzip -q /tmp/snap.zip; ls | head -5" || unzip_ok=no
# docker cp кладёт архив от root, а LORE-ygg работает под arcadedb: убирать — от root,
# и неудача уборки не роняет распаковку (run 3973, 08.11).
docker exec -u 0 "$LOCAL_YGG" rm -f /tmp/snap.zip || echo "::warning::/tmp/snap.zip в $LOCAL_YGG не удалён"
[ "$unzip_ok" = yes ] || die "распаковка в $DB_DIR/$TARGET_DB не удалась — $prev_note; бэкенд препрода остановлен"
r_open="$(server_cmd "open database $TARGET_DB")"
echo "open database: $(printf '%s' "$r_open" | head -c 200)"

# ── 4. сверка ───────────────────────────────────────────────────────────────
dst_ver="$(query_ver "$TARGET_DB")"
echo "схема $TARGET_DB на 131: v${dst_ver:-?}"
if [ -n "$src_model" ]; then
  dst_model="$(model_n "$TARGET_DB")"
  echo "отметок модели в $TARGET_DB: ${dst_model:-?} (у прода $src_model)"
  [ -z "$dst_ver" ] && [ "${dst_model:-}" = "$src_model" ] \
    || die "отметка модели снимка (${dst_model:-?}) ≠ прода ($src_model) — препрод НЕ запускаю, разберитесь руками"
  restart_preprod
  echo "готово: $TARGET_DB = снимок $SOURCE_DB (модельная схема, отметок $src_model) от $TS; прежняя база — ${TARGET_DB}_bak_$TS"
  exit 0
fi
[ -n "$dst_ver" ] && [ "$dst_ver" = "${src_ver:-}" ] || die "версия схемы снимка (v${dst_ver:-?}) ≠ прода (v${src_ver:-?}) — препрод НЕ запускаю, разберитесь руками"
restart_preprod
echo "готово: $TARGET_DB = снимок $SOURCE_DB (v$dst_ver) от $TS; прежняя база — ${TARGET_DB}_bak_$TS"
