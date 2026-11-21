#!/usr/bin/env bash
# Выкатка прода LORE на lore-host по тегу — SPRINT_LORE_PIPELINE_HOST/PL-05
# (ADR-LORE-046, D-2026-UXR-CD-PREPROD-PROD-SPLIT). Вызывается из lore-release.yml
# по шагам; состояние между шагами — в файле $DEPLOY_STATE (KEY=VALUE).
#
#   resolve  тег → коммит, прошедший препрод → образы unlimitedlore-<сервис>:<sha8>
#            НА 131. Кандидаты: сам коммит тега и его родители с ТЕМ ЖЕ деревом
#            (merge preprod → main даёт новый коммит при том же содержимом).
#            Нет всех образов (бэкенд, lore-mcp, v1, v2) — красный, без «пересоберём». Коммит сборки
#            бэкенда — из метки org.opencontainers.image.revision; по нему
#            сверяется /lore/version и считается версия схемы кода.
#   ssh      ключ CD (секрет LORE_HOST_SSH_KEY) + закреплённый отпечаток хоста.
#   state    только чтение: каталоги, compose, контейнеры, версия схемы прода
#            (строка «схема сверена: БД vN» в логе бэкенда).
#   plan     только чтение: что будет перевезено/заменено/накатано (dry-run).
#   ship     docker save | ssh docker load, сверка Id; уже есть с тем же Id — пропуск.
#   compose  бэкап docker-compose.yml.bak-<тег> в обоих каталогах, замена ТОЛЬКО
#            тегов образов. .env не трогается.
#   dbswap   1.18 (владелица 21.11: «старую базу бэкап, а новую под неё — на проде новые имена не делать»):
#            задан источник SWAP_FROM (база переноса migration_dst* в LORE-ygg lore-host), а база прода
#            ещё не собрана из модели → бэкенд стоп, прежняя база → <база>_bak_<время>, источник → <база>,
#            сверка отметки LoreModelSchema; не вышло — прежняя на место. Тот же алгоритм, что у
#            «LORE preprod DB refresh» с local_source. Бэкенд поднимает шаг up уже кодом тега.
#   db       если код новее схемы прода (или версия прода неизвестна) — бэкап
#            базы прода и накатка отдельным `compose run lore-migrate` (сервис
#            профиля migrate: root, basic, LORE_MIGRATE_ONLY — DBR-01 шаг 4.2,
#            у рантайма root-пароля нет). Упала — compose возвращается из
#            бэкапа, работающие контейнеры не тронуты.
#   up       сторож v2 → бэкенд (петля через публичное имя, сеть), затем compose up -d:
#            бэкенд → ждём healthy → lore-mcp → ждём healthy → v1 → v2.
#   theme    тема Keycloak из дерева тега → /home/nooriuta/keycloak/themes/lore,
#            сверка размера css внутри контейнера keycloak.
#   probe    хэш бандла v1/v2 (на lore-host по Host и по публичному имени),
#            /lore/version = коммит сборки через nginx v1 И v2, /mcp через оба имени = 401/405,
#            в логе «БД vN = код vN».
#   swap-file <файл> <сервис> <тег>   — замена тега образа в одном compose-файле
#            (её же выполняет compose на lore-host: скрипт уходит туда по stdin).
#   remote-backup <каталог> <база>    — BACKUP DATABASE кредом сервиса lore-migrate
#            (разовый compose run; выполняется на lore-host; пароль хоста не покидает).
#   remote-swap <каталог> <источник> <база> — замена базы (на lore-host; root — у lore-migrate).
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
# S8-02 (1.18.1): lore-mcp едет с релизом тем же :sha8, что прошёл препрод; живёт в каталоге
# бэкенда (сеть unlimitedlore_default), наружу — только через location /mcp nginx v1/v2.
SERVICES="lore-backend lore-mcp lore-app lore-app-next"
# Сеть бэкенда, к которой обязан быть подключён v2: lore-backend:9100 и lore-mcp:9200 — по ней.
NET_BE="${LORE_HOST_NET_BACKEND:-unlimitedlore_default}"

err()  { echo "::error::$*"; }
die()  { err "$*"; exit 1; }
put()  { echo "$1=$2" >> "$STATE"; echo "  $1=$2"; }
load() { [ -f "$STATE" ] && . "$STATE"; return 0; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }
# shellcheck disable=SC2086 # R — составная ssh-команда намеренно
r() { [ -n "${R:-}" ] || die "ssh-команда R не задана (шаг ssh не выполнялся)"; $R "$@"; }
img_of() { echo "unlimitedlore-$1:$2"; }
var_of() { case "$1" in lore-backend) echo BACKEND ;; lore-mcp) echo MCP ;; lore-app) echo APP ;; lore-app-next) echo NEXT ;; esac; }
dir_of() { case "$1" in lore-app-next) echo "$DIR_NEXT" ;; *) echo "$DIR_BE" ;; esac; }
rollback_hint() {
  echo "ОТКАТ на lore-host: cd $DIR_BE && cp docker-compose.yml.bak-${TAG:-<тег>} docker-compose.yml && docker compose up -d lore-backend lore-mcp lore-app;"
  echo "                    cd $DIR_NEXT && cp docker-compose.yml.bak-${TAG:-<тег>} docker-compose.yml && docker compose up -d"
}

# ── сторож v2 → бэкенд (S8-02, 1.18.1) ───────────────────────────────────────
# Правило: nginx v2 ходит в бэкенд НАПРЯМУЮ по docker-сети, никогда через публичное имя LORE.
# 21.11 v2 стоял с LORE_BACKEND_URL=https://lore.odal.seidrstudio.pro: пока lore.odal вёл на v1,
# это работало, а после переключения lore.odal на v2 nginx v2 проксировал сам в себя —
# /lore/version висел. Публичное имя LORE (HOST_V1, HOST_V2 и любой поддомен HOST_V1) в
# LORE_BACKEND_URL или LORE_BACKEND_HOST — петля в момент переключения, громкий отказ ДО up.
# compose config не прочитан — тоже отказ: «не смогли проверить» ≠ «петли нет».
host_of() { local u="$1"; u="${u#*://}"; u="${u%%/*}"; u="${u%%:*}"; printf '%s' "${u,,}"; }
is_lore_public() {
  local h="${1,,}"
  [ -n "$h" ] || return 1
  [ "$h" = "$HOST_V1" ] || [ "$h" = "$HOST_V2" ] && return 0
  case "$h" in *".$HOST_V1") return 0 ;; esac
  return 1
}
v2_guard() {
  local cfg url hh bad=0
  cfg="$(r "cd $DIR_NEXT && docker compose config" 2>&1)" \
    || { err "compose config v2 ($DIR_NEXT) не прочитан — петлю v2 → публичное имя LORE проверить нечем, выкатка не идёт: ${cfg:0:300}"; return 1; }
  url="$(sed -nE 's/^[[:space:]]*LORE_BACKEND_URL:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' <<<"$cfg" | head -1)"
  hh="$(sed -nE 's/^[[:space:]]*LORE_BACKEND_HOST:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' <<<"$cfg" | head -1)"
  if is_lore_public "$(host_of "$url")"; then
    err "петля: у v2 LORE_BACKEND_URL=$url — публичное имя самого LORE; после переключения на v2 nginx проксирует сам в себя. Нужно LORE_BACKEND_URL=http://lore-backend:9100 в $DIR_NEXT"
    bad=1
  fi
  if is_lore_public "$hh"; then
    err "петля: у v2 LORE_BACKEND_HOST=$hh — с этим Host Traefik вернёт запрос в LORE же. Нужно LORE_BACKEND_HOST=lore-backend в $DIR_NEXT"
    bad=1
  fi
  if ! grep -qE "^[[:space:]]*name:[[:space:]]*\"?${NET_BE}\"?[[:space:]]*$" <<<"$cfg"; then
    err "v2 ($DIR_NEXT) не подключён к сети бэкенда $NET_BE — lore-backend:9100 и lore-mcp:9200 из nginx v2 не резолвятся (502)"
    bad=1
  fi
  [ "$bad" -eq 0 ] && echo "v2 → бэкенд: ${url:-<пусто: lore-backend:9100>} (Host ${hh:-\$host}), сеть $NET_BE — напрямую, петли нет"
  return "$bad"
}

# Проба /mcp по публичному имени: 401/405 — вход MCP ответил (lore-mcp жив за nginx).
# 502/504 — nginx не достучался до lore-mcp:9200; 404 — нет location /mcp; 200 — SPA-заглушка.
mcp_probe() {
  local h="$1" code="" i n="${PROBE_ATTEMPTS:-1}"
  for i in $(seq 1 "$n"); do
    # shellcheck disable=SC2086 # PROBE_CURL — составная команда намеренно
    code="$(${PROBE_CURL:-curl} -s -o /dev/null -m "${PROBE_TIMEOUT:-15}" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "https://$h/mcp" 2>/dev/null)"
    case "$code" in 401|405) echo "ok: https://$h/mcp → $code (вход MCP, lore-mcp отвечает)"; return 0 ;; esac
    [ "$i" -lt "$n" ] && sleep "${PROBE_DELAY:-10}"
  done
  case "$code" in
    502|503|504) err "https://$h/mcp → $code: nginx не достучался до lore-mcp:9200 (контейнера нет или он не в сети $NET_BE)" ;;
    404) err "https://$h/mcp → 404: location /mcp не отвечает (не тот образ nginx?)" ;;
    *)   err "https://$h/mcp → ${code:-нет ответа}: ждали 401/405 (вход MCP)" ;;
  esac
  return 1
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
  local dir="$1" db="$2" out
  # DBR-01 шаг 4.2: root-пароль есть только у сервиса lore-migrate (профиль migrate) — у рантайма
  # его нет, поэтому не docker exec в работающий бэкенд, а разовый compose run.
  # shellcheck disable=SC2016 # переменные раскрываются ВНУТРИ контейнера lore-migrate
  out="$(cd "$dir" && docker compose run --rm --no-deps -T --entrypoint sh lore-migrate -c 'curl -s -m 600 -u "$ARCADEDB_USER:$ARCADEDB_ROOT_PASSWORD" -H "Content-Type: application/json" -d "{\"language\":\"sql\",\"command\":\"BACKUP DATABASE\"}" "$MART_ARCADE_URL/api/v1/command/'"$db"'"')"
  grep -q '"result":"OK"' <<< "$out" || die "BACKUP DATABASE $db не подтверждён: $(printf '%s' "$out" | head -c 300)"
  echo "бэкап $db: $(printf '%s' "$out" | sed -nE 's/.*"backupFile":"([^"]*)".*/\1/p')"
}

# ── remote-swap (выполняется НА lore-host) ───────────────────────────────────
# Запросы к ArcadeDB — разовым compose run lore-migrate (root есть только у него, DBR-01 4.2).
acmd() { # acmd <каталог> <путь api> [тело json]
  local dir="$1" path="$2" body="${3:-}"
  # shellcheck disable=SC2016 # переменные раскрываются ВНУТРИ контейнера lore-migrate
  (cd "$dir" && docker compose run --rm --no-deps -T -e "Q_PATH=$path" -e "Q_BODY=$body" --entrypoint sh lore-migrate -c \
    'if [ -n "$Q_BODY" ]; then curl -s -m 120 -u "$ARCADEDB_USER:$ARCADEDB_ROOT_PASSWORD" -H "Content-Type: application/json" -d "$Q_BODY" "$MART_ARCADE_URL/api/v1/$Q_PATH"; else curl -s -m 60 -u "$ARCADEDB_USER:$ARCADEDB_ROOT_PASSWORD" "$MART_ARCADE_URL/api/v1/$Q_PATH"; fi')
}
model_marks() { # model_marks <каталог> <база> → число строк LoreModelSchema (пусто — не прочитано)
  acmd "$1" "query/$2" '{"language":"sql","command":"SELECT count(*) AS n FROM LoreModelSchema"}' | tr -d '\n ' | sed -nE 's/.*"n":([0-9]+).*/\1/p'
}
remote_swap() {
  local dir="$1" src="$2" dst="$3" ygg="${LORE_HOST_YGG:-LORE-ygg}" dbdir=/home/arcadedb/databases ts dbs n
  case "$src" in migration_dst*) ;; *) die "источник замены — только база переноса migration_dst*: $src" ;; esac
  [ "$src" != "$dst" ] || die "источник совпадает с базой прода"
  ts="$(date -u +%Y%m%d%H%M%S)"
  dbs="$(acmd "$dir" databases)"
  case "$dbs" in *"\"$src\""*) ;; *) die "базы $src в $ygg lore-host нет — сначала перенос; ответ: $(printf '%s' "$dbs" | head -c 300)" ;; esac
  n="$(model_marks "$dir" "$src")"
  [ -n "$n" ] && [ "$n" -gt 0 ] || die "в $src нет отметки LoreModelSchema — это не база из модели; замену не делаю"
  echo "источник $src: отметка модели есть ($n)"
  (cd "$dir" && docker compose stop lore-backend) || die "бэкенд прода не остановился — замену не делаю"
  acmd "$dir" server "{\"command\":\"close database $dst\"}" >/dev/null || true
  if ! docker exec "$ygg" mv "$dbdir/$dst" "$dbdir/${dst}_bak_$ts"; then
    (cd "$dir" && docker compose start lore-backend); die "прежняя база не переименована — замену не делаю, бэкенд запущен обратно"
  fi
  acmd "$dir" server "{\"command\":\"close database $src\"}" >/dev/null || true
  if ! docker exec "$ygg" mv "$dbdir/$src" "$dbdir/$dst"; then
    docker exec "$ygg" mv "$dbdir/${dst}_bak_$ts" "$dbdir/$dst"
    acmd "$dir" server "{\"command\":\"open database $dst\"}" >/dev/null || true
    (cd "$dir" && docker compose start lore-backend); die "источник не переименован — прежняя база возвращена, бэкенд запущен"
  fi
  acmd "$dir" server "{\"command\":\"open database $dst\"}" >/dev/null || true
  n="$(model_marks "$dir" "$dst")"
  [ -n "$n" ] && [ "$n" -gt 0 ] || die "после замены в $dst нет отметки модели — бэкенд НЕ запущен; прежняя база — ${dst}_bak_$ts"
  echo "готово: $dst = база переноса $src; прежняя — ${dst}_bak_$ts (откат: обратное переименование)"
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
    if [ -z "$miss" ]; then chosen="$c"; echo "  кандидат $c8: все образы на 131 есть"; break; fi
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
  # S8-02: петля v2 → публичное имя LORE видна уже здесь, до ship/compose (повторно — в up).
  v2_guard || bad=1
  # Метка версии: не ошибка выкатки, а честное предупреждение — без строки тег не доедет.
  r "grep -q 'LORE_RELEASE_TAG' $DIR_BE/docker-compose.yml" \
    || echo "::warning::в $DIR_BE/docker-compose.yml нет LORE_RELEASE_TAG — /lore/version отдаст release: null (метка в углу покажет коммит). Добавить в environment lore-backend: - LORE_RELEASE_TAG=\${LORE_RELEASE_TAG:-}"
  echo "── контейнеры"
  r "docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'lore|keycloak' || true"
  local line n
  # 1.18: база из модели (перенос MIG-01) пишет «схема собрана из модели (LoreModelSchema)», а не «схема
  # сверена: БД vN» — это признанное состояние PROD_SCHEMA=model, а не «неизвестно».
  line="$(r "cd $DIR_BE && docker compose logs --no-color lore-backend 2>&1 | grep -oE 'схема сверена: БД v[0-9]+ = код v[0-9]+|схема собрана из модели \(LoreModelSchema\)' | tail -1" || true)"
  case "$line" in
    *"собрана из модели"*) n=model ;;
    *) n="$(printf '%s' "$line" | sed -nE 's/.*БД v([0-9]+).*/\1/p')" ;;
  esac
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
dbswap() {
  load
  local src="${SWAP_FROM:-}"
  if [ -z "$src" ]; then
    if [ "${PROD_SCHEMA:-}" != model ]; then
      echo "::warning::источник замены базы (SWAP_FROM / vars.LORE_PROD_SWAP_FROM) не задан — прод остаётся на прежней базе $PROD_DB"
      summary "- база: замены нет (источник не задан)"
    fi
    return 0
  fi
  if [ "${PROD_SCHEMA:-}" = model ]; then echo "база прода уже собрана из модели — замена не нужна ($src не тронут)"; return 0; fi
  echo "── замена базы прода: $src → $PROD_DB (прежняя → ${PROD_DB}_bak_<время>)"
  r "bash -s -- remote-swap $DIR_BE $src $PROD_DB" < "$SELF" || { restore_compose; die "замена базы прода не выполнена — compose возвращён из бэкапа"; }
  put PROD_SCHEMA model
  summary "- база: $PROD_DB заменена базой переноса $src (прежняя — _bak)"
}

db() {
  load
  local need=no
  if [ "${PROD_SCHEMA:-}" = model ]; then
    # 1.18: схему собрал установщик из модели — журнала шагов V нет по построению, накатывать нечего.
    echo "база прода собрана из модели (LoreModelSchema, 1.18) — шагов V нет, бэкап и накатка не нужны"
    summary "- база: собрана из модели (1.18) — накатка не нужна"
    return 0
  fi
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
  echo "── накатка схемы (compose run lore-migrate: root, basic, LORE_MIGRATE_ONLY)"
  local rc=0
  r "cd $DIR_BE && timeout 1800 docker compose run --rm --no-deps -T lore-migrate" > /tmp/migrate.log 2>&1 || rc=$?
  grep -E "LORE MIGRATE|LORE MART|ERROR|Exception" /tmp/migrate.log | tail -80 || true
  if [ "$rc" = 0 ] && grep -q "схема собрана из модели (LoreModelSchema), шаги V пропущены" /tmp/migrate.log; then
    # Версия прода была неизвестна, а база оказалась собранной из модели: накатывать нечего — это успех.
    echo "база прода собрана из модели (1.18) — шаги V пропущены, накатка не нужна"
    summary "- база: бэкап $PROD_DB; собрана из модели (1.18) — накатка не нужна"
    return 0
  fi
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
  # S8-02: петля v2 → публичное имя LORE и сеть бэкенда — до любого compose up.
  v2_guard || { rollback_hint; die "v2 на lore-host настроен ходить в бэкенд не напрямую (см. выше) — выкатка остановлена до up, контейнеры не тронуты"; }
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
  # S8-02: lore-mcp — после healthy бэкенда, до фронтов (их location /mcp шлёт на lore-mcp:9200).
  # --no-deps: бэкенд уже поднят с LORE_RELEASE_TAG, пересоздавать его зависимостью нельзя.
  r "cd $DIR_BE && LORE_RELEASE_TAG=$TAG docker compose up -d --no-deps lore-mcp" || { rollback_hint; die "compose up lore-mcp не прошёл"; }
  for i in $(seq 1 24); do
    st="$(r "docker inspect -f '{{.State.Health.Status}}' \$(cd $DIR_BE && docker compose ps -q lore-mcp) 2>/dev/null" || echo missing)"
    [ "$st" = healthy ] && { echo "lore-mcp прода healthy (${i}×5с)"; break; }
    sleep 5
  done
  if [ "$st" != healthy ]; then
    r "cd $DIR_BE && docker compose logs --no-color --tail 80 lore-mcp" || true
    rollback_hint; die "lore-mcp прода не стал healthy за 120с (последний статус: $st)"
  fi
  r "cd $DIR_BE && LORE_RELEASE_TAG=$TAG docker compose up -d lore-app" || { rollback_hint; die "compose up lore-app не прошёл"; }
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
  # S8-02: /mcp через оба публичных имени — вход MCP (401/405), а не 502 (нет lore-mcp) / 404.
  mcp_probe "$HOST_V1" || rc=1
  mcp_probe "$HOST_V2" || rc=1
  line="$(r "cd $DIR_BE && docker compose logs --no-color --since $UP_AT lore-backend 2>&1 | grep -oE 'схема сверена: БД v[0-9]+ = код v[0-9]+|схема собрана из модели \(LoreModelSchema\)' | tail -1" || true)"
  case "$line" in
    *"собрана из модели"*) echo "ok: $line (1.18: база из модели, шагов V нет)" ;;
    *"БД v$CODE_SCHEMA = код v$CODE_SCHEMA") echo "ok: $line" ;;
    *"= код v$CODE_SCHEMA") echo "::warning::$line — БД и код расходятся (откат на старый тег?)" ;;
    *) err "в логе нового бэкенда нет «схема сверена: БД v$CODE_SCHEMA = код v$CODE_SCHEMA» (есть: ${line:-ничего})"; rc=1 ;;
  esac
  if [ "$rc" -ne 0 ]; then rollback_hint; return 1; fi
  summary "- пробы: бандлы v1/v2, /mcp (v1 и v2) = вход, /lore/version (v1 и v2) = ${EXPECT_COMMIT:0:8}, БД v$CODE_SCHEMA = код v$CODE_SCHEMA"
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
  dbswap)         dbswap ;;
  db)             db ;;
  up)             up ;;
  theme)          theme ;;
  probe)          probe ;;
  swap-file)      swap_file "$2" "$3" "$4" ;;
  remote-backup)  remote_backup "$2" "$3" ;;
  remote-swap)    remote_swap "$2" "$3" "$4" ;;
  *) echo "::error::lore-host-deploy.sh: режим resolve|ssh|state|plan|ship|compose|dbswap|db|up|theme|probe|swap-file|remote-backup|remote-swap"; exit 2 ;;
esac
