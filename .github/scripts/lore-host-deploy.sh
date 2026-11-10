#!/usr/bin/env bash
# Выкатка прода LORE на lore-host по тегу — SPRINT_LORE_PIPELINE_HOST/PL-05
# (ADR-LORE-046, D-2026-UXR-CD-PREPROD-PROD-SPLIT). Вызывается из lore-release.yml
# по шагам; состояние между шагами — в файле $DEPLOY_STATE (KEY=VALUE).
#
#   resolve  тег → коммит, прошедший препрод → образы unlimitedlore-<сервис>:<sha8>
#            НА 131. Кандидаты: сам коммит тега и его родители с ТЕМ ЖЕ деревом
#            (merge preprod → main даёт новый коммит при том же содержимом).
#            Нет всех трёх образов — красный, без «пересоберём». Коммит сборки
#            бэкенда — из метки org.opencontainers.image.revision; по нему
#            сверяется /lore/version и считается версия схемы кода.
#   ssh      ключ CD (секрет LORE_HOST_SSH_KEY) + закреплённый отпечаток хоста.
#   state    только чтение: каталоги, compose, контейнеры, версия схемы прода
#            (строка «схема сверена: БД vN» в логе бэкенда).
#   plan     только чтение: что будет перевезено/заменено/накатано (dry-run).
#   ship     docker save | ssh docker load, сверка Id; уже есть с тем же Id — пропуск.
#   compose  бэкап docker-compose.yml.bak-<тег> в обоих каталогах, замена ТОЛЬКО
#            тегов образов. .env не трогается.
#   db       если код новее схемы прода (или версия прода неизвестна) — бэкап
#            базы прода и накатка отдельным `compose run` с LORE_MIGRATE_ONLY и
#            LORE_MART_AUTH=basic (как шаг CD). Упала — compose возвращается из
#            бэкапа, работающие контейнеры не тронуты.
#   up       compose up -d по сервисам: бэкенд → ждём healthy → v1 → v2.
#   theme    тема Keycloak из дерева тега → /home/nooriuta/keycloak/themes/lore,
#            сверка размера css внутри контейнера keycloak.
#   probe    хэш бандла v1/v2 (на lore-host по Host и по публичному имени),
#            /lore/version = коммит сборки через nginx v1 И v2, в логе «БД vN = код vN».
#   swap-file <файл> <сервис> <тег>   — замена тега образа в одном compose-файле
#            (её же выполняет compose на lore-host: скрипт уходит туда по stdin).
#   remote-backup <каталог> <база>    — BACKUP DATABASE кредом работающего
#            бэкенда (выполняется на lore-host; пароль хоста не покидает).
#
# Окружение: TAG, DEPLOY_STATE, LORE_HOST, LORE_HOST_USER, LORE_HOST_FP,
# LORE_HOST_SSH_KEY (ssh), R (ssh-команда, ставит шаг ssh), DRY_RUN.
set -uo pipefail

SELF="${BASH_SOURCE[0]:-}"
STATE="${DEPLOY_STATE:-/tmp/lore-deploy.env}"
DIR_BE="${LORE_HOST_DIR_BACKEND:-/home/nooriuta/UnlimitedLORE-deploy}"
DIR_NEXT="${LORE_HOST_DIR_NEXT:-/home/nooriuta/lore-app-next}"
THEME_DIR="${LORE_HOST_THEME_DIR:-/home/nooriuta/keycloak/themes/lore}"
PROD_DB="${LORE_PROD_DB:-system_aida_lore}"
HOST_V1="${LORE_PROD_V1_HOST:-lore.odal.seidrstudio.pro}"
HOST_V2="${LORE_PROD_V2_HOST:-new.lore.odal.seidrstudio.pro}"
MIGR_JAVA="backend/src/main/java/studio/seer/heimdall/lore/LoreSchemaMigrations.java"
BUNDLE_RE='assets/index-[A-Za-z0-9_-]+\.js'
SERVICES="lore-backend lore-app lore-app-next"

err()  { echo "::error::$*"; }
die()  { err "$*"; exit 1; }
put()  { echo "$1=$2" >> "$STATE"; echo "  $1=$2"; }
load() { [ -f "$STATE" ] && . "$STATE"; return 0; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }
# shellcheck disable=SC2086 # R — составная ssh-команда намеренно
r() { [ -n "${R:-}" ] || die "ssh-команда R не задана (шаг ssh не выполнялся)"; $R "$@"; }
img_of() { echo "unlimitedlore-$1:$2"; }
var_of() { case "$1" in lore-backend) echo BACKEND ;; lore-app) echo APP ;; lore-app-next) echo NEXT ;; esac; }
dir_of() { case "$1" in lore-app-next) echo "$DIR_NEXT" ;; *) echo "$DIR_BE" ;; esac; }
rollback_hint() {
  echo "ОТКАТ на lore-host: cd $DIR_BE && cp docker-compose.yml.bak-${TAG:-<тег>} docker-compose.yml && docker compose up -d lore-backend lore-app;"
  echo "                    cd $DIR_NEXT && cp docker-compose.yml.bak-${TAG:-<тег>} docker-compose.yml && docker compose up -d"
}

# ── swap-file ────────────────────────────────────────────────────────────────
swap_file() {
  local f="$1" svc="$2" tag="$3" re
  [ -f "$f" ] || die "нет файла $f"
  re="^([[:space:]]*image:[[:space:]]*)unlimitedlore-${svc}:[A-Za-z0-9._-]+[[:space:]]*$"
  grep -qE "$re" "$f" || die "в $f нет строки image: unlimitedlore-${svc}:<тег> — заменять нечего (файл не тронут)"
  sed -i -E "s#${re}#\\1unlimitedlore-${svc}:${tag}#" "$f"
  grep -qE "^[[:space:]]*image:[[:space:]]*unlimitedlore-${svc}:${tag}[[:space:]]*$" "$f" \
    || die "замена тега ${svc} в $f не подтвердилась"
  echo "$f: unlimitedlore-${svc} → :${tag}"
}

# ── remote-backup (выполняется НА lore-host) ─────────────────────────────────
remote_backup() {
  local dir="$1" db="$2" cid out
  cid="$(cd "$dir" && docker compose ps -q lore-backend | head -1)"
  [ -n "$cid" ] || die "бэкенд прода не запущен — бэкап его кредом невозможен, накатка отменена"
  # shellcheck disable=SC2016 # переменные раскрываются ВНУТРИ контейнера бэкенда
  out="$(docker exec "$cid" sh -c 'curl -s -m 600 -u "$ARCADEDB_USER:$ARCADEDB_ROOT_PASSWORD" -H "Content-Type: application/json" -d "{\"language\":\"sql\",\"command\":\"BACKUP DATABASE\"}" "$MART_ARCADE_URL/api/v1/command/'"$db"'"')"
  grep -q '"result":"OK"' <<< "$out" || die "BACKUP DATABASE $db не подтверждён: $(printf '%s' "$out" | head -c 300)"
  echo "бэкап $db: $(printf '%s' "$out" | sed -nE 's/.*"backupFile":"([^"]*)".*/\1/p')"
}

# ── resolve ──────────────────────────────────────────────────────────────────
resolve() {
  [ -n "${TAG:-}" ] || die "TAG не задан"
  : > "$STATE"
  local t tt c c8 cands="" missing="" chosen="" svc img id
  t="$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}" 2>/dev/null || git rev-parse -q --verify "${TAG}^{commit}" 2>/dev/null)" \
    || die "тег $TAG не найден в репозитории (checkout без тегов?)"
  tt="$(git rev-parse "${t}^{tree}")"
  cands="$t $(git rev-list --parents -n 1 "$t" | cut -d' ' -f2-)"
  echo "тег $TAG → коммит $t, дерево $tt"
  for c in $cands; do
    if [ "$(git rev-parse "${c}^{tree}")" != "$tt" ]; then
      echo "  кандидат ${c:0:8}: дерево другое — не то, что прошло препрод"; continue
    fi
    c8="${c:0:8}"
    local miss=""
    for svc in $SERVICES; do
      img="$(img_of "$svc" "$c8")"
      docker image inspect "$img" --format '{{.Id}}' >/dev/null 2>&1 || miss="$miss $img"
    done
    if [ -z "$miss" ]; then chosen="$c"; echo "  кандидат $c8: все три образа на 131 есть"; break; fi
    echo "  кандидат $c8: нет образов:$miss"
    missing="$missing$miss"
  done
  if [ -z "$chosen" ]; then
    err "образов, прошедших препрод, для $TAG нет на 131:$missing"
    err "релиз не пересобирает образы (ADR-LORE-046): сначала выкатите этот коммит на препрод (пуш в preprod / LORE CD), затем перезапустите релиз"
    return 1
  fi
  c8="${chosen:0:8}"
  put TAG "$TAG"; put TAG_SHA "$t"; put SRC_SHA "$chosen"; put SRC8 "$c8"
  for svc in $SERVICES; do
    img="$(img_of "$svc" "$c8")"
    id="$(docker image inspect "$img" --format '{{.Id}}')"
    put "ID_$(var_of "$svc")" "$id"
  done
  local rev
  rev="$(docker image inspect "$(img_of lore-backend "$c8")" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null)"
  [ "$rev" = "<no value>" ] && rev=""
  if [ -z "$rev" ]; then
    err "у $(img_of lore-backend "$c8") нет метки org.opencontainers.image.revision — /lore/version прода нечем сверить (образ собран до PL-04). Пересоберите бэкенд на препроде: LORE CD, service=backend."
    return 1
  fi
  put EXPECT_COMMIT "$rev"
  local n
  n="$(git show "${rev}:${MIGR_JAVA}" 2>/dev/null | grep -oE 'new Step\([0-9]+,' | tail -1 | grep -oE '[0-9]+')"
  [ -n "$n" ] || { err "версия схемы кода не прочитана: коммит сборки $rev не найден в истории или в нём нет $MIGR_JAVA"; return 1; }
  put CODE_SCHEMA "$n"
  local b1 b2
  b1="$(docker run --rm --entrypoint cat "$(img_of lore-app "$c8")" /usr/share/nginx/html/index.html 2>/dev/null | grep -oE "$BUNDLE_RE" | head -1)"
  b2="$(docker run --rm --entrypoint cat "$(img_of lore-app-next "$c8")" /usr/share/nginx/html/index.html 2>/dev/null | grep -oE "$BUNDLE_RE" | head -1)"
  [ -n "$b1" ] && [ -n "$b2" ] || { err "бандл не прочитан из образа (v1='${b1}', v2='${b2}')"; return 1; }
  put BUNDLE_V1 "$b1"; put BUNDLE_V2 "$b2"
  summary "### Прод $TAG: коммит препрода \`$c8\`, бэкенд собран из \`${rev:0:8}\`, схема кода v$n"
  return 0
}

# ── ssh ──────────────────────────────────────────────────────────────────────
ssh_setup() {
  [ -n "${LORE_HOST_SSH_KEY:-}" ] || die "секрет LORE_HOST_SSH_KEY пуст или не виден репо (уровень организации AIDA?)"
  [ -n "${LORE_HOST:-}" ] && [ -n "${LORE_HOST_USER:-}" ] && [ -n "${LORE_HOST_FP:-}" ] || die "LORE_HOST / LORE_HOST_USER / LORE_HOST_FP не заданы"
  install -d -m 700 ~/.ssh
  printf '%s\n' "$LORE_HOST_SSH_KEY" > ~/.ssh/lore_host && chmod 600 ~/.ssh/lore_host
  ssh-keyscan -t ed25519 "$LORE_HOST" 2>/dev/null > /tmp/kh
  local got; got="$(ssh-keygen -lf /tmp/kh 2>/dev/null | awk '{print $2}')"
  [ "$got" = "$LORE_HOST_FP" ] || die "отпечаток хоста ${got:-<нет ответа>} ≠ закреплённого $LORE_HOST_FP — не доверяем"
  cp /tmp/kh ~/.ssh/known_hosts
  local cmd="ssh -i $HOME/.ssh/lore_host -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 $LORE_HOST_USER@$LORE_HOST"
  [ -n "${GITHUB_ENV:-}" ] && echo "R=$cmd" >> "$GITHUB_ENV"
  R="$cmd"
  r 'echo "вход: $(id -un)@$(hostname)"' || die "вход на $LORE_HOST по ключу CD не удался"
}

# ── state (чтение) ───────────────────────────────────────────────────────────
state() {
  load
  local d bad=0 s
  for d in "$DIR_BE" "$DIR_NEXT"; do
    echo "── $d"
    r "test -f $d/docker-compose.yml && test -w $d" || { err "на lore-host нет $d/docker-compose.yml или каталог не доступен на запись"; bad=1; continue; }
    r "grep -n 'image:' $d/docker-compose.yml"
  done
  for s in $SERVICES; do
    r "grep -qE '^[[:space:]]*image:[[:space:]]*unlimitedlore-${s}:' $(dir_of "$s")/docker-compose.yml" \
      || { err "в $(dir_of "$s")/docker-compose.yml нет image: unlimitedlore-${s}:<тег>"; bad=1; }
  done
  r "test -d $THEME_DIR && test -w $THEME_DIR" || { err "каталог темы $THEME_DIR на lore-host не существует или не на запись"; bad=1; }
  # Метка версии: не ошибка выкатки, а честное предупреждение — без строки тег не доедет.
  r "grep -q 'LORE_RELEASE_TAG' $DIR_BE/docker-compose.yml" \
    || echo "::warning::в $DIR_BE/docker-compose.yml нет LORE_RELEASE_TAG — /lore/version отдаст release: null (метка в углу покажет коммит). Добавить в environment lore-backend: - LORE_RELEASE_TAG=\${LORE_RELEASE_TAG:-}"
  echo "── контейнеры"
  r "docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'lore|keycloak' || true"
  local line n
  line="$(r "cd $DIR_BE && docker compose logs --no-color lore-backend 2>&1 | grep -oE 'схема сверена: БД v[0-9]+ = код v[0-9]+' | tail -1" || true)"
  n="$(printf '%s' "$line" | sed -nE 's/.*БД v([0-9]+).*/\1/p')"
  echo "схема прода по логу бэкенда: ${line:-<строки нет в логе>}"
  sed -i '/^PROD_SCHEMA=/d' "$STATE" 2>/dev/null || true
  put PROD_SCHEMA "${n:-}"
  [ "$bad" -eq 0 ] || return 1
}

# ── plan (чтение, dry-run) ───────────────────────────────────────────────────
plan() {
  load
  echo "── план выкатки $TAG (ничего не меняется)"
  local s img id rid
  if [ -z "${SRC8:-}" ]; then
    echo "  resolve не прошёл — образы, замена тегов и решение по базе не определены; ниже только текущее состояние прода"
    CODE_SCHEMA=""
  fi
  for s in $SERVICES; do
    [ -n "${SRC8:-}" ] || break
    img="$(img_of "$s" "${SRC8:-?}")"; id="$(eval echo "\${ID_$(var_of "$s"):-}")"
    rid="$(r "docker image inspect '$img' --format '{{.Id}}' 2>/dev/null || true")"
    if [ -n "$id" ] && [ "$rid" = "$id" ]; then echo "  $img: уже на lore-host ($id)"; else echo "  $img: будет перевезён (на 131: ${id:-?}, на lore-host: ${rid:-нет})"; fi
  done
  echo "  compose: бэкап docker-compose.yml.bak-$TAG в $DIR_BE и $DIR_NEXT, замена тегов на :${SRC8:-?}"
  if [ -z "${CODE_SCHEMA:-}" ]; then echo "  база: прод v${PROD_SCHEMA:-?}, версия схемы кода не определена (resolve)"
  elif [ -z "${PROD_SCHEMA:-}" ]; then echo "  база: версия прода неизвестна → бэкап $PROD_DB и накатка (безопасная сторона)"
  elif [ "${CODE_SCHEMA:-0}" -gt "$PROD_SCHEMA" ]; then echo "  база: прод v$PROD_SCHEMA < код v$CODE_SCHEMA → бэкап $PROD_DB и накатка отдельным compose run"
  elif [ "${CODE_SCHEMA:-0}" -eq "$PROD_SCHEMA" ]; then echo "  база: прод v$PROD_SCHEMA = код v$CODE_SCHEMA → накатка не нужна"
  else echo "  база: прод v$PROD_SCHEMA НОВЕЕ кода v${CODE_SCHEMA:-?} (откат на старый тег) — накатки нет, форвард-совместимый режим"; fi
  local want got
  want="$(git archive "${TAG_SHA:-$TAG}" backend/keycloak/themes/lore/login/resources/css/lore.css 2>/dev/null | tar -xO 2>/dev/null | wc -c | tr -d ' ')"
  got="$(r "docker exec keycloak wc -c /opt/keycloak/themes/lore/login/resources/css/lore.css 2>/dev/null" | awk '{print $1}')"
  echo "  тема KC: lore.css в теге ${want:-?} байт, в контейнере keycloak ${got:-не прочитан}"
  for s in "v1 $HOST_V1 4400 ${BUNDLE_V1:-?}" "v2 $HOST_V2 4402 ${BUNDLE_V2:-?}"; do
    set -- $s
    got="$(r "curl -s -m 10 -H 'Host: $2' http://127.0.0.1:$3/" | grep -oE "$BUNDLE_RE" | head -1)"
    echo "  бандл $1: сейчас ${got:-?} → будет $4"
  done
}

# ── ship ─────────────────────────────────────────────────────────────────────
ship() {
  load
  local s img id rid
  for s in $SERVICES; do
    img="$(img_of "$s" "$SRC8")"; id="$(eval echo "\${ID_$(var_of "$s")}")"
    rid="$(r "docker image inspect '$img' --format '{{.Id}}' 2>/dev/null || true")"
    if [ "$rid" = "$id" ]; then echo "$img уже на lore-host ($id) — перенос не нужен"; continue; fi
    echo "перенос $img ($id) …"
    docker save "$img" | r "docker load" || die "docker save | ssh docker load для $img не удался"
    rid="$(r "docker image inspect '$img' --format '{{.Id}}' 2>/dev/null || true")"
    [ "$rid" = "$id" ] || die "Id $img на lore-host ${rid:-<нет>} ≠ $id на 131"
    echo "ok: $img на lore-host, Id совпал"
  done
}

# ── compose ──────────────────────────────────────────────────────────────────
restore_compose() {
  local d
  for d in "$DIR_BE" "$DIR_NEXT"; do
    r "test -f $d/docker-compose.yml.bak-$TAG && cp -p $d/docker-compose.yml.bak-$TAG $d/docker-compose.yml" \
      && echo "compose $d возвращён из бэкапа" || err "compose $d из бэкапа НЕ возвращён — проверьте руками"
  done
}
compose_swap() {
  load
  local d s
  for d in "$DIR_BE" "$DIR_NEXT"; do
    if r "test -f $d/docker-compose.yml.bak-$TAG"; then
      echo "$d: бэкап docker-compose.yml.bak-$TAG уже есть (повторный прогон) — НЕ перезаписываю, в нём состояние до первой попытки"
    else
      r "cp -p $d/docker-compose.yml $d/docker-compose.yml.bak-$TAG" || die "бэкап compose в $d не сделан — дальше не иду"
      echo "$d: бэкап docker-compose.yml.bak-$TAG"
    fi
  done
  for s in $SERVICES; do
    r "bash -s -- swap-file $(dir_of "$s")/docker-compose.yml $s $SRC8" < "$SELF" \
      || { err "замена тега $s не прошла"; restore_compose; exit 1; }
  done
  summary "- compose: теги → :$SRC8, бэкапы \`docker-compose.yml.bak-$TAG\`"
}

# ── db ───────────────────────────────────────────────────────────────────────
db() {
  load
  local need=no
  if [ -z "${PROD_SCHEMA:-}" ]; then
    echo "::warning::версия схемы прода неизвестна (строки «схема сверена» нет в логе) — бэкап и накатка на всякий случай: накатка идемпотентна"
    need=yes
  elif [ "$CODE_SCHEMA" -gt "$PROD_SCHEMA" ]; then
    echo "тег несёт миграции: прод v$PROD_SCHEMA → код v$CODE_SCHEMA"; need=yes
  elif [ "$CODE_SCHEMA" -eq "$PROD_SCHEMA" ]; then
    echo "схема прода v$PROD_SCHEMA = код v$CODE_SCHEMA — бэкап и накатка не нужны"
  else
    echo "::warning::прод v$PROD_SCHEMA НОВЕЕ кода v$CODE_SCHEMA (откат?) — накатки нет; бэкенд стартует в форвард-совместимом режиме, если шаги аддитивные"
  fi
  [ "$need" = yes ] || return 0
  echo "── бэкап базы прода $PROD_DB"
  r "bash -s -- remote-backup $DIR_BE $PROD_DB" < "$SELF" || { restore_compose; die "без бэкапа накатка на прод не выполняется"; }
  echo "── накатка схемы (compose run, LORE_MIGRATE_ONLY, LORE_MART_AUTH=basic)"
  local rc=0
  r "cd $DIR_BE && LORE_MIGRATE=true LORE_MIGRATE_ONLY=true LORE_MART_AUTH=basic timeout 1800 docker compose run --rm --no-deps -T lore-backend" > /tmp/migrate.log 2>&1 || rc=$?
  grep -E "LORE MIGRATE|LORE MART|ERROR|Exception" /tmp/migrate.log | tail -80 || true
  if [ "$rc" != 0 ] || ! grep -q "lore.migrate.only=true — схема накатана" /tmp/migrate.log; then
    err "накатка на проде не подтверждена (код $rc) — работающие контейнеры НЕ подменены, compose возвращается из бэкапа"
    tail -60 /tmp/migrate.log
    restore_compose
    exit 1
  fi
  echo "накатка подтверждена"
  summary "- база: бэкап $PROD_DB и накатка v${PROD_SCHEMA:-?} → v$CODE_SCHEMA"
}

# ── up ───────────────────────────────────────────────────────────────────────
up() {
  load
  local at st i
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sed -i '/^UP_AT=/d' "$STATE"; put UP_AT "$at"
  # Тег релиза — в контейнер (/lore/version → release, метка версии в углу). В compose на
  # хосте должна быть строка LORE_RELEASE_TAG=${LORE_RELEASE_TAG:-}; нет её — release: null
  # (state предупреждает), выкатке это не мешает.
  r "cd $DIR_BE && LORE_RELEASE_TAG=$TAG docker compose up -d lore-backend" || { rollback_hint; die "compose up lore-backend не прошёл"; }
  for i in $(seq 1 60); do
    st="$(r "docker inspect -f '{{.State.Health.Status}}' \$(cd $DIR_BE && docker compose ps -q lore-backend) 2>/dev/null" || echo missing)"
    [ "$st" = healthy ] && { echo "бэкенд прода healthy (${i}×5с)"; break; }
    sleep 5
  done
  if [ "$st" != healthy ]; then
    r "cd $DIR_BE && docker compose logs --no-color --tail 80 lore-backend" || true
    rollback_hint; die "бэкенд прода не стал healthy за 300с (последний статус: $st)"
  fi
  r "cd $DIR_BE && docker compose up -d lore-app" || { rollback_hint; die "compose up lore-app не прошёл"; }
  r "cd $DIR_NEXT && docker compose up -d" || { rollback_hint; die "compose up v2 не прошёл"; }
  r "docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'lore'" || true
}

# ── theme ────────────────────────────────────────────────────────────────────
theme() {
  load
  local tmp want got
  tmp="$(mktemp -d)"
  git archive "${TAG_SHA:-$TAG}" backend/keycloak/themes/lore | tar -x -C "$tmp" || die "тема не извлечена из дерева тега"
  [ -f "$tmp/backend/keycloak/themes/lore/login/theme.properties" ] || die "в теге нет backend/keycloak/themes/lore/login/theme.properties"
  r "docker inspect keycloak >/dev/null" || die "контейнера keycloak на lore-host нет"
  # Копирование поверх, а не rm -rf: удалённые в репо файлы останутся — размен в пользу безопасности.
  tar czf - -C "$tmp/backend/keycloak/themes" lore | r "tar xzf - -C $(dirname "$THEME_DIR")" || die "тема не скопирована на lore-host"
  want="$(wc -c < "$tmp/backend/keycloak/themes/lore/login/resources/css/lore.css" | tr -d ' ')"
  got="$(r "docker exec keycloak wc -c /opt/keycloak/themes/lore/login/resources/css/lore.css" | awk '{print $1}')"
  rm -rf "$tmp"
  [ "$want" = "$got" ] || die "контейнер keycloak видит lore.css в ${got:-?} байт, а в теге $want — тема не доехала"
  echo "тема применена: lore.css $got байт"
}

# ── probe ────────────────────────────────────────────────────────────────────
probe() {
  load
  local here rc=0 s got line
  here="$(cd "$(dirname "$SELF")" && pwd)"
  for s in "v1 $HOST_V1 4400 $BUNDLE_V1" "v2 $HOST_V2 4402 $BUNDLE_V2"; do
    set -- $s
    got="$(r "curl -s -m 10 -H 'Host: $2' http://127.0.0.1:$3/" | grep -oE "$BUNDLE_RE" | head -1)"
    if [ "$got" = "$4" ]; then echo "ok: $1 на lore-host:$3 отдаёт $got"; else err "$1 на lore-host:$3 отдаёт ${got:-<нет>}, ждали $4"; rc=1; fi
  done
  bash "$here/bundle-probe.sh" "v1 прод" "$BUNDLE_V1" "https://$HOST_V1/" || rc=1
  bash "$here/bundle-probe.sh" "v2 прод" "$BUNDLE_V2" "https://$HOST_V2/" || rc=1
  # /lore/version — через nginx ОБОИХ фронтов (SPRINT_UXR_S8_SWITCH/S8-01): шаблон
  # nginx общий, но после переключения основной адрес — v2, и телефон с MCP идут
  # через его прокси /lore/. Проба только по имени v1 этого пути не видела.
  EXPECT_COMMIT="$EXPECT_COMMIT" bash "$here/version-probe.sh" "https://$HOST_V1" || rc=1
  EXPECT_COMMIT="$EXPECT_COMMIT" bash "$here/version-probe.sh" "https://$HOST_V2" || rc=1
  line="$(r "cd $DIR_BE && docker compose logs --no-color --since $UP_AT lore-backend 2>&1 | grep -oE 'схема сверена: БД v[0-9]+ = код v[0-9]+' | tail -1" || true)"
  case "$line" in
    *"БД v$CODE_SCHEMA = код v$CODE_SCHEMA") echo "ok: $line" ;;
    *"= код v$CODE_SCHEMA") echo "::warning::$line — БД и код расходятся (откат на старый тег?)" ;;
    *) err "в логе нового бэкенда нет «схема сверена: БД v$CODE_SCHEMA = код v$CODE_SCHEMA» (есть: ${line:-ничего})"; rc=1 ;;
  esac
  if [ "$rc" -ne 0 ]; then rollback_hint; return 1; fi
  summary "- пробы: бандлы v1/v2, /lore/version (v1 и v2) = ${EXPECT_COMMIT:0:8}, БД v$CODE_SCHEMA = код v$CODE_SCHEMA"
}

case "${1:-}" in
  resolve)
    if resolve; then exit 0; fi
    if [ "${DRY_RUN:-false}" = true ]; then echo "::warning::dry-run: боевой релиз упал бы на resolve (выше)"; exit 0; fi
    exit 1 ;;
  ssh)            ssh_setup ;;
  state)          if state; then exit 0; elif [ "${DRY_RUN:-false}" = true ]; then echo "::warning::dry-run: боевой релиз упал бы на state"; exit 0; else exit 1; fi ;;
  plan)           plan ;;
  ship)           ship ;;
  compose)        compose_swap ;;
  db)             db ;;
  up)             up ;;
  theme)          theme ;;
  probe)          probe ;;
  swap-file)      swap_file "$2" "$3" "$4" ;;
  remote-backup)  remote_backup "$2" "$3" ;;
  *) echo "::error::lore-host-deploy.sh: режим resolve|ssh|state|plan|ship|compose|db|up|theme|probe|swap-file|remote-backup"; exit 2 ;;
esac
