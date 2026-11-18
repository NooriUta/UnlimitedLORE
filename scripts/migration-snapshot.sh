#!/usr/bin/env bash
# Снимок прода для переезда на новую модель — SPRINT_LORE_OWN_HOST/OH-MIG-SNAPSHOT-WF
# (заказ MIG-01, SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01).
#
# Что делает (прод только читается):
#   1. lore-host: BACKUP DATABASE system_aida_lore кредом работающего прод-бэкенда — тем же
#      путём, что migrate-live-check.sh (fresh). Пароль хоста не покидает, агенту не виден.
#   2. архив потоком по ssh сюда, сверка sha256 с lore-host;
#   3. счёт записей по типам — в своей одноразовой ArcadeDB той же версии, что на проде
#      (в docker-сети задания, свой временный root; контейнер удаляется);
#   4. разворачивает архив на препроде (LORE-ygg на ci-server) отдельной базой NAME.
#      Имя занято — отказ, ничего не трогается. Рабочие базы препрода не трогаются.
#
# Вердикт: 0 — снимок развёрнут; 1 — отказ (имя занято/недопустимо); 2 — не выполнился.
#
# Окружение: R (ssh-команда до lore-host, шаг ssh из lore-host-deploy.sh), NAME (имя базы,
# по умолчанию migration_src_<дата>), REPORT_DIR, PREPROD_YGG (LORE-ygg).
set -uo pipefail

SOURCE_DB=system_aida_lore
REMOTE_YGG=LORE-ygg
REMOTE_BACKEND_DIR=/home/nooriuta/UnlimitedLORE-deploy
PREPROD_YGG="${PREPROD_YGG:-LORE-ygg}"
DB_DIR=/home/arcadedb/databases
NAME="${NAME:-}"; [ -n "$NAME" ] || NAME="migration_src_$(date -u +%Y_%m_%d)"
REPORT_DIR="${REPORT_DIR:-./migration-snapshot-report}"
TS="$(date -u +%Y%m%d%H%M%S)"
COUNT_TYPES="KnowSprint KnowTask KnowPhase"
OWN=""; SNAP=""

mkdir -p "$REPORT_DIR"
say()  { echo "── $*"; }
note() { printf '%s\n' "$*" >> "$REPORT_DIR/report.md"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; return 0; }
skip() { echo "::error::снимок НЕ выполнился: $*"; note "**⚪ НЕ ВЫПОЛНИЛСЯ:** $*"; exit 2; }
deny() { echo "::error::отказ: $*"; note "**🔴 ОТКАЗ:** $*"; exit 1; }
# shellcheck disable=SC2086 # R — составная ssh-команда намеренно
r() { [ -n "${R:-}" ] || skip "ssh-команда R до lore-host не задана"; $R "$@"; }
cleanup() { [ -n "$OWN" ] && docker rm -f "$OWN" >/dev/null 2>&1; [ -n "$SNAP" ] && rm -f "$SNAP"; return 0; }
trap cleanup EXIT

note "## Снимок прода → $NAME"

# ── 0. имя ──────────────────────────────────────────────────────────────────
[[ "$NAME" =~ ^migration_src_[a-z0-9_]+$ ]] || deny "имя $NAME недопустимо: только migration_src_<a-z0-9_>"
docker inspect "$PREPROD_YGG" >/dev/null 2>&1 || skip "контейнер препрода $PREPROD_YGG не найден на этом хосте"
docker exec "$PREPROD_YGG" test -e "$DB_DIR/$NAME" && deny "база $NAME на препроде уже есть — не трогаю (удаление только по слову владелицы)"

# ── 1. BACKUP на проде ──────────────────────────────────────────────────────
prod_img="$(r "docker inspect -f '{{.Config.Image}}' $REMOTE_YGG")" || skip "lore-host: контейнер $REMOTE_YGG не найден"
prod_ver="${prod_img##*:}"
say "lore-host: BACKUP DATABASE $SOURCE_DB (данные прода не меняются)"
bcid="$(r "cd $REMOTE_BACKEND_DIR && docker compose ps -q lore-backend" | head -1)"
[ -n "$bcid" ] || skip "бэкенд прода на lore-host не запущен — снимок его кредом невозможен"
out="$(r "docker exec $bcid sh -c 'curl -s -m 600 -u \"\$ARCADEDB_USER:\$ARCADEDB_ROOT_PASSWORD\" -H \"Content-Type: application/json\" -d \"{\\\"language\\\":\\\"sql\\\",\\\"command\\\":\\\"BACKUP DATABASE\\\"}\" \"\$MART_ARCADE_URL/api/v1/command/$SOURCE_DB\"'")"
grep -q '"result":"OK"' <<< "$out" || skip "BACKUP DATABASE на проде не подтверждён: $(printf '%s' "$out" | head -c 300)"
bfile="$(printf '%s' "$out" | sed -nE 's/.*"backupFile":"([^"]*)".*/\1/p')"
remote="$(r "docker exec $REMOTE_YGG sh -c 'find /home/arcadedb/backups -name \"$(basename "$bfile")\" -type f | head -1'")"
[ -n "$remote" ] || skip "файл бэкапа $bfile не найден в $REMOTE_YGG"
taken="$(date -u +%FT%TZ)"

# ── 2. перенос и sha256 ─────────────────────────────────────────────────────
SNAP="/tmp/migration-snapshot-$TS.zip"
r "docker exec $REMOTE_YGG cat '$remote'" > "$SNAP" || skip "снимок не перенесён"
rsum="$(r "docker exec $REMOTE_YGG sha256sum '$remote'" | awk '{print $1}')"
lsum="$(sha256sum "$SNAP" | awk '{print $1}')"
[ -n "$rsum" ] && [ "$rsum" = "$lsum" ] || skip "sha256 снимка не совпал: lore-host $rsum, здесь $lsum"
note "- архив: \`$(basename "$remote")\`, снят $taken, $(stat -c %s "$SNAP") Б, sha256 \`$lsum\`; ArcadeDB прода $prod_ver"

# ── 3. счёт в своей одноразовой ArcadeDB ────────────────────────────────────
NET="$(docker inspect "$(hostname)" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null | head -1)"
[ -n "$NET" ] || skip "не определить docker-сеть задания"
OWN="lore-migsnap-ygg-$TS"
PW="snap-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
docker run -d --label "lore.ci.run=${GITHUB_RUN_ID:-local}" --name "$OWN" --network "$NET" \
  -e JAVA_OPTS="-Darcadedb.server.rootPassword=$PW" "arcadedata/arcadedb:$prod_ver" >/dev/null \
  || skip "контейнер arcadedata/arcadedb:$prod_ver не запустился"
A="http://$OWN:2480/api/v1"
ac() { curl -s --noproxy '*' -m 300 -u "root:$PW" -H 'Content-Type: application/json' "$@"; }
for _ in $(seq 1 60); do ac -m 4 "$A/databases" 2>/dev/null | grep -q '"result"' && break; sleep 1; done
docker cp "$SNAP" "$OWN:/tmp/s.zip" || skip "архив не скопирован в $OWN"
docker exec "$OWN" sh -c "set -e; mkdir -p $DB_DIR/count; cd $DB_DIR/count; unzip -q /tmp/s.zip" || skip "распаковка в $OWN не удалась"
ac -d '{"command":"open database count"}' "$A/server" | grep -q '"ok"' || skip "open database в $OWN не удался"
types="$(ac -d '{"language":"sql","command":"select name, records from schema:types"}' "$A/command/count")"
note ""
note "| тип | записей в снимке |"
note "|---|---|"
for t in $COUNT_TYPES; do
  n="$(python3 -c 'import json,sys; r={x["name"]:x.get("records") for x in json.load(sys.stdin)["result"]}; print(r.get(sys.argv[1],"нет типа"))' "$t" <<< "$types")"
  note "| $t | $n |"
done
total="$(python3 -c 'import json,sys; print(sum((x.get("records") or 0) for x in json.load(sys.stdin)["result"]))' <<< "$types")"
note "| (всего, все типы) | $total |"
printf '%s' "$types" > "$REPORT_DIR/counts.json"

# ── 4. на препрод отдельной базой ───────────────────────────────────────────
say "$PREPROD_YGG: распаковка снимка в $NAME"
docker exec "$PREPROD_YGG" test -e "$DB_DIR/$NAME" && deny "база $NAME появилась на препроде во время прогона — не трогаю"
docker cp "$SNAP" "$PREPROD_YGG:/tmp/$NAME.zip" || skip "архив не скопирован в $PREPROD_YGG"
docker exec "$PREPROD_YGG" sh -c "set -e; mkdir '$DB_DIR/$NAME'; cd '$DB_DIR/$NAME'; unzip -q /tmp/$NAME.zip" \
  || { docker exec -u 0 "$PREPROD_YGG" rm -f "/tmp/$NAME.zip"; skip "распаковка в $PREPROD_YGG:$DB_DIR/$NAME не удалась"; }
# Архив кладёт docker cp от root, а exec по умолчанию — пользователь контейнера: rm без -u 0 давал
# «Operation not permitted» и под set -e ронял уже развёрнутый снимок (прогон #8933, 18.11.2026).
# Уборка — не повод для красного: снимок к этому моменту развёрнут.
docker exec -u 0 "$PREPROD_YGG" rm -f "/tmp/$NAME.zip" || note "⚠ временный архив /tmp/$NAME.zip в $PREPROD_YGG не удалён — убрать вручную"
files="$(docker exec "$PREPROD_YGG" sh -c "ls '$DB_DIR/$NAME' | wc -l")"
size="$(docker exec "$PREPROD_YGG" sh -c "du -sh '$DB_DIR/$NAME' | cut -f1")"
note ""
note "**🟢 Развёрнуто:** \`$PREPROD_YGG:$DB_DIR/$NAME\` — файлов $files, $size. Рабочие базы препрода не тронуты."
note "Источник для конвейера: MIG_SRC_DB=$NAME (сервер открывает базу при первом обращении)."
exit 0
