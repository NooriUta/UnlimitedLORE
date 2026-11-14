#!/usr/bin/env bash
# Инсталлятор LORE для Linux — SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE.
#
#   install.sh [--dir DIR] --version vX.Y.0 [--build] [--port N] [--bind ADDR] [--dry-run]
#   install.sh [--dir DIR] --src DIR [--port N] [--bind ADDR] [--dry-run]   — сборка из рабочего чекаута (разработка)
#   install.sh --verify    [--dir DIR]           — только проверки готовой установки
#   install.sh --uninstall [--purge] [--dir DIR] — остановить (данные остаются; --purge — стереть)
#   install.sh --selftest                        — самопроверка разбора аргументов и плана, без docker
#
# Что делает: проверяет docker и compose, создаёт каталог установки, пишет .env
# из .env.example (пароли генерирует, на экран не выводит), собирает образы из
# исходников на теге (или берёт готовые LORE_BACKEND_IMAGE / LORE_WEB_IMAGE),
# поднимает ArcadeDB, создаёт базу, поднимает бэкенд и фронт, ждёт здоровья и
# ПРОВЕРЯЕТ результат: здоровье бэкенда, непустой справочник dictionary и
# продуктовые слайсы (features, use_cases_of_feature, pains, gains, jobs,
# actors, asset_orphans) плюс поиск — тот набор, что 17.08 отдавал 500 на
# чистой установке.
#
# Повторный запуск в тот же --dir = обновление: пароли из .env сохраняются,
# образы пересобираются, бэкенд накатывает новые шаги схемы на старте (с бэкапом).
#
# Схема на пустой базе: флаг LORE_BOOTSTRAP не нужен — ядро поднимается само
# (D-2026-LORE-AUTO-BOOTSTRAP-CORE), шаги миграций добирают остальное.
#
# Окружение (необязательно): ARCADEDB_ROOT_PASSWORD, MINIO_PASSWORD — задать свои
# пароли вместо сгенерированных; LORE_BACKEND_IMAGE, LORE_WEB_IMAGE — готовые
# образы; WAIT_SECS (900) — сколько ждать первого старта; CURL_IMAGE; GHCR_OWNER.
#
# Версии — ТОЛЬКО мажорные vX.Y.0 (решение владелицы 14.11.2026; то же правило, что у
# публикации на GitHub, D-2026-GITHUB-ONLY-MAJOR-VERSIONS). Образы мажорной версии берутся
# готовыми из ghcr.io/<GHCR_OWNER>/lore-backend и lore-web (публикует lore-release.yml);
# --build собирает их из исходников тега на месте.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

DIR="/opt/lore"
VERSION=""
BUILD=0
GHCR_OWNER="${GHCR_OWNER:-nooriuta}"
SRC="$REPO_DIR"
PORT=""
BIND=""
MODE="install"
PURGE=0
DRY=0
WAIT_SECS="${WAIT_SECS:-900}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:latest}"

say()  { printf '── %s\n' "$*"; }
warn() { printf 'ВНИМАНИЕ: %s\n' "$*" >&2; }
die()  { printf 'ОШИБКА: %s\n' "$1" >&2; exit "${2:-1}"; }
usage() { sed -n '3,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# Мажорная версия: vX.Y.0 — то же правило, что у публикации образов и зеркала GitHub.
is_major() { [[ "$1" =~ ^v[0-9]+\.[0-9]+\.0$ ]]; }

# Образы мажорной версии — готовые из ghcr, если не задано своё и не просили --build.
default_images() {
  [ -n "$VERSION" ] && [ "$BUILD" = 0 ] || return 0
  : "${LORE_BACKEND_IMAGE:=ghcr.io/$GHCR_OWNER/lore-backend:$VERSION}"
  : "${LORE_WEB_IMAGE:=ghcr.io/$GHCR_OWNER/lore-web:$VERSION}"
  export LORE_BACKEND_IMAGE LORE_WEB_IMAGE
}

# Команда, меняющая систему: в --dry-run только печатается.
run() {
  if [ "$DRY" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir|--version|--src|--port|--bind)
        [ $# -ge 2 ] && [ -n "$2" ] && [ "${2#--}" = "$2" ] || die "у $1 нет значения" 2
        case "$1" in
          --dir) DIR="$2" ;; --version) VERSION="$2" ;; --src) SRC="$2" ;;
          --port) PORT="$2" ;; --bind) BIND="$2" ;;
        esac
        shift 2 ;;
      --uninstall) MODE="uninstall"; shift ;;
      --verify)    MODE="verify"; shift ;;
      --purge)     PURGE=1; shift ;;
      --dry-run)   DRY=1; shift ;;
      --build)     BUILD=1; shift ;;
      --selftest)  MODE="selftest"; shift ;;
      -h|--help)   usage; exit 0 ;;
      *) die "неизвестный аргумент: $1 (см. --help)" 2 ;;
    esac
  done
  if [ "$PURGE" = 1 ] && [ "$MODE" != "uninstall" ]; then die "--purge имеет смысл только с --uninstall" 2; fi
  if [ -n "$PORT" ]; then
    case "$PORT" in *[!0-9]*) die "--port: нужно число, а не «$PORT»" 2 ;; esac
    [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port вне 1..65535" 2
  fi
  if [ -n "$VERSION" ]; then
    is_major "$VERSION" || die "--version $VERSION: инсталлятор — только для мажорных версий vX.Y.0 (например v1.18.0); патчи vX.Y.Z (Z>0) и rc — нет" 2
  fi
  case "$DIR" in /*) ;; *) DIR="$(pwd)/$DIR" ;; esac
  return 0
}

gen_secret() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# KEY=VALUE в env-файле: заменить строку или дописать. Значение идёт через
# окружение awk, а не через sed — пароль с / & | не ломает подстановку.
env_set() {
  local key="$1" val="$2" file="$3" tmp
  tmp="$(mktemp "$file.XXXXXX")"
  K="$key" V="$val" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; done=0}
    index($0, k "=") == 1 { print k "=" v; done=1; next } { print }
    END { if (!done) print k "=" v }' "$file" > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$file"
}
env_get() { # значение KEY из env-файла (пусто, если нет)
  [ -f "$2" ] || return 0
  awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$2"
}

compose() {
  docker compose --project-directory "$DIR" -f "$DIR/docker-compose.yml" --env-file "$DIR/.env" "$@"
}
project() { local p; p="$(env_get COMPOSE_PROJECT_NAME "$DIR/.env")"; printf '%s' "${p:-lore}"; }

# curl одноразовым контейнером в сети стека: порты базы и бэкенда наружу не
# публикуются. Пароль — через конфиг на stdin (-K -), не через argv.
dcurl() {
  local pw; pw="$(env_get ARCADEDB_ROOT_PASSWORD "$DIR/.env")"
  printf 'user = "root:%s"\n' "$pw" | docker run -i --rm --network "$(project)_default" "$CURL_IMAGE" -K - -sS -m 30 "$@"
}
# То же без кредов базы — для проб приложения: пароль root ArcadeDB бэкенду LORE не нужен.
acurl() { docker run --rm --network "$(project)_default" "$CURL_IMAGE" -sS -m 30 "$@"; }

check_prereq() {
  say "проверка окружения"
  if [ "$DRY" = 1 ]; then
    command -v docker >/dev/null 2>&1 && say "docker найден" || warn "docker не найден (dry-run продолжает)"
    return 0
  fi
  command -v docker >/dev/null 2>&1 || die "нет docker — установите Docker Engine: https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "нет плагина docker compose v2 (пакет docker-compose-plugin)"
  docker info >/dev/null 2>&1 || die "демон docker недоступен этому пользователю (запущен ли он? состоите ли в группе docker?)"
  if [ "$VERSION" != "" ] || [ -z "${LORE_BACKEND_IMAGE:-}" ]; then
    command -v git >/dev/null 2>&1 || [ -z "$VERSION" ] || die "нет git — нужен, чтобы взять исходники тега $VERSION"
  fi
  local port; port="$(env_get LORE_HTTP_PORT "$DIR/.env")"; port="${PORT:-${port:-4400}}"
  if [ -f "$DIR/.env" ] && [ -n "$(compose ps -q lore-app-next 2>/dev/null)" ]; then
    say "порт $port занят своей установкой — это обновление"
  elif command -v ss >/dev/null 2>&1; then
    [ -z "$(ss -ltnH "sport = :$port" 2>/dev/null)" ] || die "порт $port занят — выберите другой: --port N"
  else
    warn "нет ss — свободность порта $port не проверена"
  fi
}

# Исходники для сборки: на теге — выгрузка git archive в $DIR/src/<тег>
# (рабочий чекаут не трогается); без тега — каталог --src как есть.
prepare_src() {
  if [ -n "${LORE_BACKEND_IMAGE:-}" ] && [ -n "${LORE_WEB_IMAGE:-}" ]; then
    say "готовые образы: $LORE_BACKEND_IMAGE, $LORE_WEB_IMAGE — сборки нет"
    LORE_SRC_RESOLVED=""; return 0
  fi
  if [ -n "$VERSION" ]; then
    local out="$DIR/src/$VERSION"
    if [ "$DRY" = 1 ]; then
      printf '[dry-run] git -C %s archive %s | tar -x -C %s\n' "$SRC" "$VERSION" "$out"
    elif [ ! -f "$out/backend/Dockerfile.local" ]; then
      git -C "$SRC" rev-parse -q --verify "$VERSION^{commit}" >/dev/null \
        || die "в $SRC нет тега/коммита $VERSION (git fetch --tags?)"
      mkdir -p "$out"
      git -C "$SRC" archive "$VERSION" | tar -x -C "$out"
    fi
    LORE_SRC_RESOLVED="$out"
  else
    [ "$DRY" = 1 ] || [ -f "$SRC/backend/Dockerfile.local" ] || die "в $SRC нет исходников LORE (backend/Dockerfile.local) — укажите --src"
    LORE_SRC_RESOLVED="$SRC"
    VERSION="$(git -C "$SRC" describe --tags --always 2>/dev/null || echo local)"
  fi
}

write_env() {
  local env="$DIR/.env"
  if [ "$DRY" = 1 ]; then
    if [ -f "$env" ]; then say "[dry-run] .env есть — пароли сохраняются, обновятся версия/исходники"
    else say "[dry-run] .env из .env.example; пароли ARCADEDB_ROOT_PASSWORD, MINIO_PASSWORD — сгенерировать"; fi
    printf '[dry-run] cp %s %s\n' "$SCRIPT_DIR/docker-compose.install.yml" "$DIR/docker-compose.yml"
    return 0
  fi
  mkdir -p "$DIR"; chmod 700 "$DIR"
  cp "$SCRIPT_DIR/docker-compose.install.yml" "$DIR/docker-compose.yml"
  if [ ! -f "$env" ]; then
    (umask 077; cp "$SCRIPT_DIR/.env.example" "$env")
    say "создан $env"
  fi
  local k cur
  for k in ARCADEDB_ROOT_PASSWORD MINIO_PASSWORD; do
    cur="$(env_get "$k" "$env")"
    if [ -z "$cur" ] || [ "$cur" = "CHANGE_ME" ]; then
      env_set "$k" "${!k:-$(gen_secret)}" "$env"
      say "$k: задан (значение в $env, на экран не выводится)"
    fi
  done
  env_set LORE_VERSION "$VERSION" "$env"
  env_set LORE_SRC "$LORE_SRC_RESOLVED" "$env"
  [ -z "${LORE_BACKEND_IMAGE:-}" ] || env_set LORE_BACKEND_IMAGE "$LORE_BACKEND_IMAGE" "$env"
  [ -z "${LORE_WEB_IMAGE:-}" ]     || env_set LORE_WEB_IMAGE "$LORE_WEB_IMAGE" "$env"
  [ -z "$PORT" ] || env_set LORE_HTTP_PORT "$PORT" "$env"
  [ -z "$BIND" ] || env_set LORE_BIND "$BIND" "$env"
  chmod 600 "$env"
}

images() {
  if [ -n "${LORE_BACKEND_IMAGE:-}" ] && [ -n "${LORE_WEB_IMAGE:-}" ]; then
    say "загрузка образов"
    run compose pull
  else
    say "сборка образов из $LORE_SRC_RESOLVED (первый раз — 10–20 минут)"
    run compose build lore-backend lore-app-next
    run compose pull arcadedb minio
  fi
}

wait_db() {
  local db i
  db="$(env_get LORE_DB "$DIR/.env")"; db="${db:-system_aida_lore}"
  say "ожидание ArcadeDB"
  for i in $(seq 1 60); do
    dcurl "http://arcadedb:2480/api/v1/databases" 2>/dev/null | grep -q '"result"' && break
    [ "$i" = 60 ] && die "ArcadeDB не ответила за 120 с: docker compose -f $DIR/docker-compose.yml logs arcadedb"
    sleep 2
  done
  if dcurl "http://arcadedb:2480/api/v1/databases" | grep -q "\"$db\""; then
    say "база $db уже есть"
  else
    say "создание базы $db"
    dcurl -X POST -H 'Content-Type: application/json' -d "{\"command\":\"create database $db\"}" \
      "http://arcadedb:2480/api/v1/server" | grep -q '"ok"' || die "база $db не создана"
  fi
}

wait_backend() {
  local id st t=0
  say "ожидание бэкенда (первый старт катит схему — до ${WAIT_SECS} с)"
  while :; do
    id="$(compose ps -a -q lore-backend)"
    st="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    case "$st" in
      running/healthy) say "бэкенд здоров"; return 0 ;;
      exited/*|dead/*|missing)
        compose logs --tail 60 lore-backend >&2 || true
        die "бэкенд не поднялся ($st) — хвост лога выше" ;;
    esac
    [ "$t" -ge "$WAIT_SECS" ] && { compose logs --tail 60 lore-backend >&2 || true; die "бэкенд не стал здоровым за ${WAIT_SECS} с"; }
    sleep 5; t=$((t + 5))
  done
}

# Проверки результата — через фронт (заодно проверяется его прокси /lore/ к
# бэкенду). Аутентификация в профиле установки выключена, токен не нужен.
SLICES="features pains gains jobs actors asset_orphans"
verify() {
  local base="http://lore-app-next" fails=0 code body p
  say "проверка установки"
  probe() { # имя путь [шаблон-в-теле]
    body="$(acurl -w '\n%{http_code}' "$base$2" 2>/dev/null || true)"
    code="${body##*$'\n'}"; body="${body%$'\n'*}"
    if [ "$code" = 200 ] && { [ -z "${3:-}" ] || printf '%s' "$body" | grep -q "$3"; }; then
      printf '  OK    %-24s %s\n' "$1" "$code"
    else
      printf '  FAIL  %-24s %s %s\n' "$1" "${code:-нет ответа}" "$(printf '%s' "$body" | head -c 160)"
      fails=$((fails + 1))
    fi
  }
  probe "version"              "/lore/version"
  probe "dictionary непустой"  "/lore/slice/dictionary" '"dict_type"'
  for p in $SLICES; do probe "$p" "/lore/slice/$p" '"rows"'; done
  probe "use_cases_of_feature" "/lore/slice/use_cases_of_feature?id=install-probe" '"rows"'
  probe "search"               "/lore/search?q=lore"
  if ! acurl -f "http://lore-backend:9100/q/health/ready" >/dev/null 2>&1; then
    printf '  FAIL  %-24s\n' "backend /q/health/ready"; fails=$((fails + 1))
  else
    printf '  OK    %-24s\n' "backend /q/health/ready"
  fi
  [ "$fails" = 0 ] || die "проверок не прошло: $fails"
  say "установка проверена"
}

do_install() {
  check_prereq
  default_images
  prepare_src
  write_env
  images
  say "запуск ArcadeDB и MinIO"
  run compose up -d arcadedb minio
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] ждать ArcadeDB, создать базу, если её нет\n'
    run compose up -d
    printf '[dry-run] ждать здоровья бэкенда, проверить dictionary и слайсы: %s use_cases_of_feature search\n' "$SLICES"
    return 0
  fi
  wait_db
  say "запуск бэкенда и фронта"
  compose up -d
  wait_backend
  verify
  local bind port
  bind="$(env_get LORE_BIND "$DIR/.env")"; port="$(env_get LORE_HTTP_PORT "$DIR/.env")"
  say "готово: LORE $VERSION — http://${bind:-127.0.0.1}:${port:-4400}/"
}

do_uninstall() {
  [ -f "$DIR/docker-compose.yml" ] || [ "$DRY" = 1 ] || die "в $DIR нет установки LORE"
  if [ "$PURGE" = 1 ]; then
    say "удаление стека, томов с данными и каталога $DIR"
    run compose down -v --remove-orphans
    run rm -rf "$DIR"
  else
    say "остановка стека; данные (тома lore-db, lore-minio-data) и $DIR сохраняются"
    run compose down --remove-orphans
  fi
}

selftest() {
  local self="${BASH_SOURCE[0]}" t out rc n=0
  t="$(mktemp -d)"
  ok()   { n=$((n + 1)); }
  fail() { echo "selftest FAIL: $*" >&2; exit 1; }
  expect_rc() { # код аргументы…
    local want="$1"; shift
    rc=0; out="$(PATH="/usr/bin:/bin" bash "$self" "$@" 2>&1)" || rc=$?
    [ "$rc" = "$want" ] || fail "«$*» → код $rc, ждали $want: $out"; ok
  }
  # 1. разбор аргументов
  expect_rc 2 --bogus
  expect_rc 2 --dir
  expect_rc 2 --dir --dry-run
  expect_rc 2 --purge
  expect_rc 2 --port abc --dry-run
  expect_rc 2 --port 70000 --dry-run
  expect_rc 0 --help
  # 2. dry-run установки: план без docker, ничего не пишет, секретов не печатает
  is_major v12.0.0 || fail "is_major: v12.0.0 — мажор"; ok
  is_major v9a0b0 && fail "is_major: точка в регулярке не экранирована (v9a0b0)"; ok
  is_major v1.18.0 || fail "is_major: v1.18.0 — мажор (правило X.Y.0, владелица 14.11.2026)"; ok
  is_major v1.18.3 && fail "is_major: v1.18.3 — патч, не мажор"; ok
  is_major v1.18.0-rc1 && fail "is_major: rc — не мажор"; ok
  expect_rc 2 --dry-run --dir "$t/inst" --version v9.9.9
  printf '%s' "$out" | grep -q 'мажорных' || fail "не-мажорная версия: причина не названа: $out"; ok
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0
  printf '%s' "$out" | grep -q 'ghcr.io/nooriuta/lore-backend:v9.0.0' || fail "мажор без --build: нет готового образа ghcr: $out"; ok
  printf '%s' "$out" | grep -q 'compose build' && fail "мажор без --build собирает образы"; ok
  ARCADEDB_ROOT_PASSWORD=sekret-не-печатать expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --build --src "$t"
  printf '%s' "$out" | grep -q 'compose build lore-backend lore-app-next' || fail "в плане нет сборки: $out"; ok
  printf '%s' "$out" | grep -q 'compose up -d arcadedb minio' || fail "в плане нет подъёма базы"; ok
  printf '%s' "$out" | grep -q "archive v9.0.0" || fail "--version не дошёл до выгрузки исходников"; ok
  printf '%s' "$out" | grep -q 'dictionary' || fail "в плане нет проверки слайсов"; ok
  printf '%s' "$out" | grep -q 'sekret' && fail "dry-run напечатал пароль"; ok
  [ ! -e "$t/inst" ] || fail "dry-run создал каталог установки"; ok
  # 3. dry-run удаления: без --purge данные остаются, с --purge — down -v
  expect_rc 0 --uninstall --dry-run --dir "$t/inst"
  printf '%s' "$out" | grep -q 'compose down --remove-orphans' || fail "uninstall: нет down"; ok
  printf '%s' "$out" | grep -q 'down -v' && fail "uninstall без --purge стирает тома"; ok
  expect_rc 0 --uninstall --purge --dry-run --dir "$t/inst"
  printf '%s' "$out" | grep -q 'compose down -v' || fail "--purge: нет down -v"; ok
  # 4. env_set/env_get: спецсимволы в значении, существующий пароль не перетирается
  printf 'A=1\nARCADEDB_ROOT_PASSWORD=keep/me&|x\n' > "$t/e"
  env_set A '2/&|$x' "$t/e"; [ "$(env_get A "$t/e")" = '2/&|$x' ] || fail "env_set со спецсимволами"; ok
  env_set NEW v "$t/e";      [ "$(env_get NEW "$t/e")" = v ] || fail "env_set дописывает ключ"; ok
  [ "$(env_get ARCADEDB_ROOT_PASSWORD "$t/e")" = 'keep/me&|x' ] || fail "env_get читает значение целиком"; ok
  [ "$(grep -c '^A=' "$t/e")" = 1 ] || fail "env_set задвоил ключ"; ok
  # 5. генератор паролей: 48 hex, каждый раз новый
  local s1 s2; s1="$(gen_secret)"; s2="$(gen_secret)"
  printf '%s' "$s1" | grep -qE '^[0-9a-f]{48}$' || fail "gen_secret: $s1"; ok
  [ "$s1" != "$s2" ] || fail "gen_secret повторился"; ok
  # 6. профиль установки не требует LORE_BOOTSTRAP и катит схему
  grep -q 'lore.migrate=true' "$SCRIPT_DIR/docker-compose.install.yml" || fail "в профиле нет lore.migrate=true"; ok
  grep -qE '^\s*- (lore\.bootstrap|LORE_BOOTSTRAP)' "$SCRIPT_DIR/docker-compose.install.yml" && fail "профиль снова зависит от LORE_BOOTSTRAP"; ok
  grep -qE '^[A-Z_]*PASSWORD=(CHANGE_ME)?$' "$SCRIPT_DIR/.env.example" || fail ".env.example: пароли — только заглушки"; ok
  grep -E 'PASSWORD=' "$SCRIPT_DIR/.env.example" | grep -vqE 'PASSWORD=(CHANGE_ME)?$' && fail ".env.example содержит пароль"; ok
  rm -rf "$t"
  echo "selftest ok ($n проверок)"
}

main() {
  parse_args "$@"
  case "$MODE" in
    selftest)  selftest ;;
    uninstall) do_uninstall ;;
    verify)    [ -f "$DIR/.env" ] || die "в $DIR нет установки LORE"; verify ;;
    install)   do_install ;;
  esac
}

main "$@"
