#!/usr/bin/env bash
# Инсталлятор LORE для Linux — SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE.
#
#   install.sh [--dir DIR] --version vX.Y.0 [--build] [--port N] [--bind ADDR] [--dry-run]
#   install.sh [--dir DIR] --src DIR [--port N] [--bind ADDR] [--dry-run]   — сборка из рабочего чекаута (разработка)
#     … [--forgejo install|own|none] [--forgejo-url URL] [--forgejo-mcp-build] — Forgejo; forgejo-mcp — образ из images/ или исходник из src/ пакета
#   install.sh [--dir DIR] --build-from-source [--port N] [--bind ADDR] [--dry-run] — сборка из архива исходников пакета src/lore-<версия>.tar.gz
#     … [--files none|s3] — хранилище файлов: без файлов (по умолчанию) или своё S3 (S3_* в окружении или .env)
#     … [--minilore install|none] — сервер miniLORE (мобильный монитор сессий) в этой же установке; по умолчанию не ставится
#     … [--minilore-client-id <клиент>] [--minilore-owner <логин>] — обязательны при --minilore install: без них сервер
#         miniLORE не стартует и уходит в бесконечный перезапуск
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
# Окружение (необязательно): ARCADEDB_ROOT_PASSWORD — задать свой; S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY — своё S3 (--files s3)
# пароли вместо сгенерированных; LORE_BACKEND_IMAGE, LORE_WEB_IMAGE, LORE_MCP_IMAGE — готовые
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
# Forgejo (MIG-04, владелица 20.11.2026). Пусто — выбор в .env не трогается (по умолчанию без Forgejo, как раньше).
FORGEJO=""
FORGEJO_URL_ARG=""
# Хранилище файлов (решение владелицы 21.11.2026: «пока ставь указать s3 хранилище или без опции файлов»):
# none — без файлов (по умолчанию), s3 — своё S3. Своего хранилища пакет не ставит.
FILES=""
# MIG-01: свежая установка — база из модели (lore-migrate init-empty), шаги V не катятся. FRESH=1 — .env ещё не было.
FRESH=0
FRESH_DB="${LORE_FRESH_DB:-lore}"
MIGRATE_RUNNER_IMAGE="${MIGRATE_RUNNER_IMAGE:-debian:bookworm-slim}"
FORGEJO_VERSION_DEFAULT="17.0.2"   # та же версия, что на нашем стенде
# forgejo-mcp: коммит, образ, архив образа и исходник в пакете — те же, что в docker-compose.install.yml и
# scripts/model-migration/forgejo-mcp-image.mjs (сверяет forgejo-mcp-image.test.mjs). Сверка — по .sha256 рядом.
MINILORE=""                       # --minilore install|none: сервер miniLORE в этой установке (по умолчанию не ставится)
MINILORE_CLIENT_ID_ARG=""         # --minilore-client-id: клиент приложения miniLORE в Keycloak владельца (обязателен при install)
MINILORE_OWNER_ARG=""             # --minilore-owner: имя владельца, чьи сессии показывает монитор (обязателен при install)
# Образ сервера miniLORE — ЛОКАЛЬНОЕ имя, без реестра. Адрес нашего реестра в пакете держать нельзя: пакет едет
# чужим людям, и сторож noBakedHosts это ловит (поймал меня же 22.11.2026). Сам образ кладётся в пакет архивом
# images/minilore-srv-<версия>.tar, как у forgejo-mcp; свой образ задаётся переменной MINILORE_IMAGE.
MINILORE_IMAGE_DEFAULT="minilore-srv:0.4.19"   # версия сервера miniLORE; шлюз и приложение — следующей версией
MINILORE_ARCHIVE_REL="images/minilore-srv-0.4.19.tar"
FORGEJO_MCP_IMAGE_DEFAULT="lore-install-forgejo-mcp:bbe9f59c"
FORGEJO_MCP_ARCHIVE_REL="images/forgejo-mcp-bbe9f59c.tar"
FORGEJO_MCP_SRC_ARCHIVE_REL="src/forgejo-mcp-bbe9f59c.tar.gz"
FORGEJO_MCP_BUILD=0
# Сборка из архива исходников пакета (MIG-04, владелица 20.11.2026: «архивом наш проект для собственной сборки если
# что»): src/lore-<версия>.tar.gz и .sha256 рядом с install.sh (или LORE_SRC_ARCHIVE). Без флага — как раньше.
FROM_SOURCE=0
# MCP (1.18.2): причина, по которой lore-mcp не поднимается (нет образа); пусто — поднимается вместе со стеком.
MCP_OFF=""
SRC_ARCHIVE=""
SRC_TAG=""

say()  { printf '── %s\n' "$*"; }
warn() { printf 'ВНИМАНИЕ: %s\n' "$*" >&2; }
die()  { printf 'ОШИБКА: %s\n' "$1" >&2; exit "${2:-1}"; }
usage() { sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# Мажорная версия: vX.Y.0 — то же правило, что у публикации образов и зеркала GitHub.
is_major() { [[ "$1" =~ ^v[0-9]+\.[0-9]+\.0$ ]]; }

# Образы мажорной версии — готовые из ghcr, если не задано своё и не просили --build.
default_images() {
  [ -n "$VERSION" ] && [ "$BUILD" = 0 ] || return 0
  : "${LORE_BACKEND_IMAGE:=ghcr.io/$GHCR_OWNER/lore-backend:$VERSION}"
  : "${LORE_WEB_IMAGE:=ghcr.io/$GHCR_OWNER/lore-web:$VERSION}"
  # MCP (1.18.2) — тот же мажор в ghcr; в выпусках до 1.18.2 его там нет — тогда images() говорит это громко.
  : "${LORE_MCP_IMAGE:=ghcr.io/$GHCR_OWNER/lore-mcp:$VERSION}"
  export LORE_BACKEND_IMAGE LORE_WEB_IMAGE LORE_MCP_IMAGE
}

# Команда, меняющая систему: в --dry-run только печатается.
run() {
  if [ "$DRY" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir|--version|--src|--port|--bind|--forgejo|--forgejo-url|--files|--minilore|--minilore-client-id|--minilore-owner)
        [ $# -ge 2 ] && [ -n "$2" ] && [ "${2#--}" = "$2" ] || die "у $1 нет значения" 2
        case "$1" in
          --dir) DIR="$2" ;; --version) VERSION="$2" ;; --src) SRC="$2" ;;
          --port) PORT="$2" ;; --bind) BIND="$2" ;;
          --forgejo) FORGEJO="$2" ;; --forgejo-url) FORGEJO_URL_ARG="$2" ;;
          --files) FILES="$2" ;;
          --minilore) MINILORE="$2" ;;
          --minilore-client-id) MINILORE_CLIENT_ID_ARG="$2" ;;
          --minilore-owner) MINILORE_OWNER_ARG="$2" ;;
        esac
        shift 2 ;;
      --uninstall) MODE="uninstall"; shift ;;
      --verify)    MODE="verify"; shift ;;
      --purge)     PURGE=1; shift ;;
      --dry-run)   DRY=1; shift ;;
      --build)     BUILD=1; shift ;;
      --forgejo-mcp-build) FORGEJO_MCP_BUILD=1; shift ;;
      --build-from-source) FROM_SOURCE=1; BUILD=1; shift ;;
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
  if [ "$FROM_SOURCE" = 1 ]; then
    [ -z "$VERSION" ] || die "--build-from-source: версия берётся из архива пакета (src/lore-<версия>.tar.gz) — --version не задавайте" 2
    { [ -z "${LORE_BACKEND_IMAGE:-}" ] && [ -z "${LORE_WEB_IMAGE:-}" ]; } \
      || die "--build-from-source и готовые образы (LORE_BACKEND_IMAGE / LORE_WEB_IMAGE) — одно из двух" 2
  fi
  if [ -n "$VERSION" ]; then
    is_major "$VERSION" || die "--version $VERSION: инсталлятор — только для мажорных версий vX.Y.0 (например v1.18.0); патчи vX.Y.Z (Z>0) и rc — нет" 2
  fi
  case "$FORGEJO" in
    ""|install|none) [ -z "$FORGEJO_URL_ARG" ] || die "--forgejo-url — только вместе с --forgejo own" 2 ;;
    own)
      [ -n "$FORGEJO_URL_ARG" ] || die "--forgejo own: нужен адрес своего Forgejo — --forgejo-url https://git.example.org" 2
      [[ "$FORGEJO_URL_ARG" =~ ^https?://[^[:space:]]+$ ]] || die "--forgejo-url: нужен адрес http(s)://…, а не «$FORGEJO_URL_ARG»" 2
      FORGEJO_URL_ARG="${FORGEJO_URL_ARG%/}" ;;
    *) die "--forgejo: install (поставить Forgejo $FORGEJO_VERSION_DEFAULT), own (свой Forgejo) или none" 2 ;;
  esac
  case "$MINILORE" in
    ""|install|none) ;;
    *) die "--minilore: install (поставить сервер miniLORE $MINILORE_IMAGE_DEFAULT) или none" 2 ;;
  esac
  case "$DIR" in /*) ;; *) DIR="$(pwd)/$DIR" ;; esac
  # miniLORE: клиент приложения и владелец ОБЯЗАТЕЛЬНЫ при установке (находка прогона на чужой машине 22.11.2026).
  # Без них сервер не стартует вообще — «Failed to load config value of type class java.lang.String for:
  # minilore.app.client-id» и бесконечный перезапуск контейнера. Раньше тут было предупреждение: установка
  # «проходила», а монитор крутился в рестарте, и человек узнавал об этом сам, разбирая журналы.
  # Значение берём из ключа, из окружения или из уже лежащего .env — в этом порядке.
  if [ "$MINILORE" = install ]; then
    MINILORE_CLIENT_ID_ARG="${MINILORE_CLIENT_ID_ARG:-${MINILORE_APP_CLIENT_ID:-$(env_get MINILORE_APP_CLIENT_ID "$DIR/.env" 2>/dev/null)}}"
    MINILORE_OWNER_ARG="${MINILORE_OWNER_ARG:-${MINILORE_OWNER:-$(env_get MINILORE_OWNER "$DIR/.env" 2>/dev/null)}}"
    local mmiss=""
    [ -n "$MINILORE_CLIENT_ID_ARG" ] || mmiss="$mmiss MINILORE_APP_CLIENT_ID (--minilore-client-id)"
    [ -n "$MINILORE_OWNER_ARG" ] || mmiss="$mmiss MINILORE_OWNER (--minilore-owner)"
    [ -z "$mmiss" ] || die "--minilore install: не заданы$mmiss. Без них сервер miniLORE не стартует и уходит в бесконечный перезапуск. Клиент приложения заводится в вашем Keycloak: public, PKCE S256, redirect pro.seidrstudio.minilore://auth/callback; владелец — имя человека, чьи сессии показывает монитор" 2
  else
    [ -z "$MINILORE_CLIENT_ID_ARG$MINILORE_OWNER_ARG" ] || die "--minilore-client-id и --minilore-owner — только вместе с --minilore install" 2
  fi
  case "$FILES" in
    ""|none) ;;
    s3)
      local k miss=""
      for k in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
        [ -n "${!k:-$(env_get "$k" "$DIR/.env" 2>/dev/null)}" ] || miss="$miss $k"
      done
      [ -z "$miss" ] || die "--files s3: не заданы$miss — впишите их в окружение или в $DIR/.env (адрес, бакет и ключи своего S3)" 2 ;;
    *) die "--files: none (без файлов) или s3 (своё S3)" 2 ;;
  esac
  return 0
}

# Профили compose после выбора Forgejo: чужие профили (guard) сохраняются, forgejo/forgejo-mcp ставятся по варианту.
merge_profiles() { # текущие-профили режим
  local out="" p
  for p in $(printf '%s' "$1" | tr ',' ' '); do
    case "$p" in forgejo|forgejo-mcp|minilore) ;; *) out="${out:+$out,}$p" ;; esac
  done
  case "$2" in
    install) out="${out:+$out,}forgejo,forgejo-mcp" ;;
    own)     out="${out:+$out,}forgejo-mcp" ;;
  esac
  # miniLORE — свой выбор, не зависящий от Forgejo: профиль добавляется, когда его попросили,
  # и сохраняется при повторном запуске (установка — это и обновление).
  case "$MINILORE" in
    install) out="${out:+$out,}minilore" ;;
    none)    ;;
    *)       case ",$1," in *",minilore,"*) out="${out:+$out,}minilore" ;; esac ;;
  esac
  printf '%s' "$out"
}

# Что выбор Forgejo пишет в .env — строки KEY=VALUE без секретов: токены вписывает владелец, ключ forgejo-mcp — генератор.
forgejo_env() { # текущие-профили
  printf 'COMPOSE_PROFILES=%s\n' "$(merge_profiles "$1" "$FORGEJO")"
  case "$FORGEJO" in
    install) printf 'FORGEJO_VERSION=%s\nFORGEJO_URL=http://forgejo:3000\nFORGEJO_BASE_OVERRIDE=http://forgejo:3000\n' "$FORGEJO_VERSION_DEFAULT" ;;
    own)     printf 'FORGEJO_URL=%s\nFORGEJO_BASE_OVERRIDE=\n' "$FORGEJO_URL_ARG" ;;
    none)    printf 'FORGEJO_URL=\nFORGEJO_BASE_OVERRIDE=\n' ;;
  esac
}
# Что выбор miniLORE пишет в .env. Клиент приложения и владельца НЕ подставляем: умолчания разработчика
# (mobilepoc-app, omiloreadmin) принадлежат нам, и тихо подставить их значит отдать владельцу чужую учётку.
minilore_env() {
  case "$MINILORE" in
    install)
      printf 'MINILORE_IMAGE=%s\n' "$MINILORE_IMAGE_DEFAULT"
      # Значения владельца — свои, из ключей запуска или окружения; пустыми они сюда не доходят (parse_args отказывает).
      printf 'MINILORE_APP_CLIENT_ID=%s\n' "$MINILORE_CLIENT_ID_ARG"
      printf 'MINILORE_OWNER=%s\n' "$MINILORE_OWNER_ARG"
      ;;
  esac
}

# Почему ArcadeDB не ответила — по её собственному журналу. «Authentication failed» значит не «база не поднялась»,
# а «пароль из .env не подходит к УЖЕ существующей базе»: том остался от прошлой установки с тем же именем проекта
# compose (поймано на чужой машине 22.11.2026 — два захода в каталогах с одинаковым именем lore).
arcadedb_hint() {
  case "$1" in
    *"Authentication failed"*)
      printf '%s' "в журнале базы «Authentication failed» — пароль ARCADEDB_ROOT_PASSWORD из .env не подходит к уже существующей базе. Так бывает, когда том остался от прошлой установки с тем же именем проекта compose: задайте своё COMPOSE_PROJECT_NAME в .env или уберите прежний том (docker volume rm <проект>_lore-db)" ;;
    *) printf '%s' "журнал базы: docker compose -f $DIR/docker-compose.yml logs arcadedb" ;;
  esac
}

has_profile() { case ",$(env_get COMPOSE_PROFILES "$DIR/.env")," in *",$1,"*) return 0 ;; esac; return 1; }

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
  if [ "$FROM_SOURCE" = 1 ]; then
    local out="$DIR/src/$SRC_TAG"
    if [ "$DRY" = 1 ]; then
      printf '[dry-run] mkdir -p %s && tar -xzf %s -C %s\n' "$out" "$SRC_ARCHIVE" "$out"
    elif [ ! -f "$out/backend/Dockerfile.local" ]; then
      mkdir -p "$out"
      tar -xzf "$SRC_ARCHIVE" -C "$out"
      [ -f "$out/backend/Dockerfile.local" ] || die "в архиве $SRC_ARCHIVE нет исходников LORE (backend/Dockerfile.local)"
    fi
    LORE_SRC_RESOLVED="$out"; VERSION="$SRC_TAG"
    say "сборка из исходников пакета: $(basename "$SRC_ARCHIVE") → $out"
    return 0
  fi
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
    else say "[dry-run] .env из .env.example; пароль ARCADEDB_ROOT_PASSWORD — сгенерировать"; fi
    files_say
    printf '[dry-run] cp %s %s\n' "$SCRIPT_DIR/docker-compose.install.yml" "$DIR/docker-compose.yml"
    if [ -n "$FORGEJO" ]; then
      say "[dry-run] Forgejo: $FORGEJO — в .env:"
      forgejo_env "$(env_get COMPOSE_PROFILES "$env")" | sed 's/^/[dry-run]   /'
      case "$FORGEJO" in
        install) say "[dry-run] поднять forgejo $FORGEJO_VERSION_DEFAULT (codeberg.org/forgejo/forgejo), администратора заводите в его первом окне" ;;
        own)     say "[dry-run] свой Forgejo $FORGEJO_URL_ARG — ставить его не нужно" ;;
      esac
      if [ "$FORGEJO" != none ]; then
        say "[dry-run] FORGEJO_MCP_API_KEY — сгенерировать; forgejo-mcp не запустится, пока нет FORGEJO_MCP_TOKEN (токен вписывает владелец)"
      fi
    fi
    if [ -n "$MINILORE" ]; then
      say "[dry-run] miniLORE: $MINILORE — профили compose: $(merge_profiles "$(env_get COMPOSE_PROFILES "$env")" "$FORGEJO")"
      minilore_env | sed 's/^/[dry-run]   /'
      case "$MINILORE" in
        install)
          say "[dry-run] поднять сервер miniLORE $MINILORE_IMAGE_DEFAULT (образ из images/ пакета или свой MINILORE_IMAGE); базы minilore и minilore_archive заводит установщик, порт наружу не публикуется"
          say "[dry-run] вписать свой MINILORE_APP_CLIENT_ID и MINILORE_OWNER: умолчания разработчика — чужая учётка и чужое имя, они не подставляются"
          say "[dry-run] шлюз (установщик) и приложение APK в этой версии НЕ входят — следующей версией" ;;
      esac
    fi
    return 0
  fi
  mkdir -p "$DIR"; chmod 700 "$DIR"
  cp "$SCRIPT_DIR/docker-compose.install.yml" "$DIR/docker-compose.yml"
  if [ ! -f "$env" ]; then
    (umask 077; cp "$SCRIPT_DIR/.env.example" "$env")
    say "создан $env"
    FRESH=1
  fi
  # Свежая установка: база из модели 1.18 под своим именем (не system_aida_lore — сторож переноса), шаги V выключены.
  if [ "$FRESH" = 1 ]; then
    env_set LORE_DB "$FRESH_DB" "$env"
    env_set LORE_MIGRATE false "$env"
  fi
  local k cur
  for k in ARCADEDB_ROOT_PASSWORD; do
    cur="$(env_get "$k" "$env")"
    if [ -z "$cur" ] || [ "$cur" = "CHANGE_ME" ]; then
      env_set "$k" "${!k:-$(gen_secret)}" "$env"
      say "$k: задан (значение в $env, на экран не выводится)"
    fi
  done
  env_set LORE_VERSION "$VERSION" "$env"
  env_set LORE_SRC "$LORE_SRC_RESOLVED" "$env"
  # Коммит исходников — в сборку образов (LORE_BUILD_COMMIT → /lore/version): в архиве пакета .git нет, коммит лежит
  # в backend/BUILD_COMMIT (git archive export-subst). Не подставлен (рабочий чекаут) — не трогаем: Gradle спросит git.
  local bc=""
  [ -n "$LORE_SRC_RESOLVED" ] && [ -f "$LORE_SRC_RESOLVED/backend/BUILD_COMMIT" ] && bc="$(tr -d '[:space:]' < "$LORE_SRC_RESOLVED/backend/BUILD_COMMIT")"
  case "$bc" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) env_set LORE_BUILD_COMMIT "$bc" "$env" ;; esac
  [ -z "${LORE_BACKEND_IMAGE:-}" ] || env_set LORE_BACKEND_IMAGE "$LORE_BACKEND_IMAGE" "$env"
  [ -z "${LORE_WEB_IMAGE:-}" ]     || env_set LORE_WEB_IMAGE "$LORE_WEB_IMAGE" "$env"
  [ -z "${LORE_MCP_IMAGE:-}" ]     || env_set LORE_MCP_IMAGE "$LORE_MCP_IMAGE" "$env"
  # Хранилище файлов: s3 — адрес, регион, бакет и ключи из окружения в .env (ключи на экран не выводятся);
  # none — S3 пуст. Без --files выбор в .env не трогается.
  if [ "$FILES" = s3 ]; then
    for k in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do [ -z "${!k:-}" ] || env_set "$k" "${!k}" "$env"; done
  elif [ "$FILES" = none ]; then
    for k in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY; do env_set "$k" "" "$env"; done
  fi
  files_say
  [ -z "$PORT" ] || env_set LORE_HTTP_PORT "$PORT" "$env"
  [ -z "$BIND" ] || env_set LORE_BIND "$BIND" "$env"
  [ -z "${FORGEJO_MCP_IMAGE:-}" ] || env_set FORGEJO_MCP_IMAGE "$FORGEJO_MCP_IMAGE" "$env"
  if [ -n "$FORGEJO" ]; then
    local line
    while IFS= read -r line; do env_set "${line%%=*}" "${line#*=}" "$env"; done < <(forgejo_env "$(env_get COMPOSE_PROFILES "$env")")
    say "Forgejo: $FORGEJO (профили compose: $(env_get COMPOSE_PROFILES "$env"))"
  fi
  # miniLORE — свой выбор, отдельно от Forgejo: профиль обновляется и когда Forgejo не трогали.
  if [ -n "$MINILORE" ]; then
    local mline
    env_set COMPOSE_PROFILES "$(merge_profiles "$(env_get COMPOSE_PROFILES "$env")" "$FORGEJO")" "$env"
    while IFS= read -r mline; do env_set "${mline%%=*}" "${mline#*=}" "$env"; done < <(minilore_env)
    say "miniLORE: $MINILORE (профили compose: $(env_get COMPOSE_PROFILES "$env"))"
    # Пустым значение тут уже быть не может — parse_args отказывает до установки. Проверка остаётся на случай,
    # когда .env правили руками: сервер miniLORE без клиента не стартует, и молча ставить его нельзя.
    [ "$MINILORE" != install ] || [ -n "$(env_get MINILORE_APP_CLIENT_ID "$env")" ] \
      || die "в $env пуст MINILORE_APP_CLIENT_ID — сервер miniLORE не стартует, а уходит в бесконечный перезапуск" 2
  fi
  # Ключ входа агентов в forgejo-mcp — только когда он включён; как пароли: своё значение из окружения или генератор.
  if has_profile forgejo-mcp; then
    cur="$(env_get FORGEJO_MCP_API_KEY "$env")"
    if [ -z "$cur" ] || [ "$cur" = "CHANGE_ME" ]; then
      env_set FORGEJO_MCP_API_KEY "${FORGEJO_MCP_API_KEY:-$(gen_secret)}" "$env"
      say "FORGEJO_MCP_API_KEY: задан (значение в $env, на экран не выводится)"
    fi
  fi
  chmod 600 "$env"
}

# Сервисы для `compose up`: forgejo-mcp без своего токена падает на старте (FORGEJO_TOKEN обязателен), поэтому
# без FORGEJO_MCP_TOKEN он не поднимается, а установщик громко говорит, что сделать.
start_stack() {
  local skip=()
  if has_profile forgejo-mcp && [ -z "$(env_get FORGEJO_MCP_TOKEN "$DIR/.env")" ]; then
    warn "forgejo-mcp не запущен: нет FORGEJO_MCP_TOKEN. Создайте токен в Forgejo (Настройки → Приложения), впишите в $DIR/.env и повторите install.sh — это обновление"
    skip+=(-e forgejo-mcp)
  fi
  # lore-mcp без образа (images() уже сказал почему) не поднимается — иначе `up` упал бы на всём стеке.
  [ -z "$MCP_OFF" ] || skip+=(-e lore-mcp)
  if [ "${#skip[@]}" -gt 0 ]; then
    # shellcheck disable=SC2046
    compose up -d $(compose config --services | grep -vxF "${skip[@]}")
  else
    compose up -d
  fi
}

# Базовые образы есть на машине? Нет — отказ с именем образа (молча упасть на `up` хуже).
need_images() {
  [ "$DRY" = 1 ] && return 0
  local s img
  for s in "$@"; do
    img="$(compose config --images "$s" 2>/dev/null | head -1)"
    [ -n "$img" ] || continue
    docker image inspect "$img" >/dev/null 2>&1 || die "образа $img нет на машине, и реестр его не отдал — загрузите образ (docker load) или задайте свой в .env"
  done
}

images() {
  if [ -n "${LORE_BACKEND_IMAGE:-}" ] && [ -n "${LORE_WEB_IMAGE:-}" ]; then
    say "загрузка образов"
    if ! run compose pull lore-backend lore-app-next lore-mcp; then
      # Выпуски до 1.18.2 публиковали в ghcr только бэкенд и веб: без образа MCP установка не падает, а говорит громко.
      run compose pull lore-backend lore-app-next
      MCP_OFF="образ ${LORE_MCP_IMAGE:-lore-mcp} не загружен"
      warn "MCP не будет запущен: $MCP_OFF. Агенты не подключатся к /mcp. Задайте свой LORE_MCP_IMAGE или поставьте с --build (сборка из исходников тега)"
    fi
  else
    say "сборка образов из $LORE_SRC_RESOLVED (первый раз — 10–20 минут)"
    run compose build lore-backend lore-app-next lore-mcp
  fi
  # Базовые образы: недоступный реестр не роняет установку, если образ уже есть на машине (эмуляция 21.11.2026:
  # Docker Hub перестал отдавать образ хранилища — потому его в пакете и нет); образа нет нигде — need_images называет его.
  run compose pull --ignore-pull-failures arcadedb
  need_images arcadedb
  if has_profile forgejo || [ "$FORGEJO" = install ]; then run compose pull forgejo; fi
  if has_profile forgejo-mcp || { [ -n "$FORGEJO" ] && [ "$FORGEJO" != none ]; }; then forgejo_mcp_image; fi
  if has_profile minilore || [ "$MINILORE" = install ]; then minilore_image; fi
}

# Образ сервера miniLORE. Порядок, как у forgejo-mcp, но без сборки из исходников: исходник сервера не наш.
#   1) MINILORE_IMAGE — свой готовый образ, перекрывает всё (его и тянем из своего реестра);
#   2) архив пакета images/minilore-srv-<версия>.tar — docker load при совпадении sha256;
#   3) образ уже лежит на машине (например, вы его сами собрали или притянули) — берём как есть;
#   4) ничего нет — отказ с перечнем выходов. Молча ничего не подставляется и в наш реестр установка не ходит:
#      адреса нашего реестра в пакете нет (сторож noBakedHosts).
minilore_image() {
  local img a
  img="${MINILORE_IMAGE:-$(env_get MINILORE_IMAGE "$DIR/.env")}"
  if [ -n "$img" ] && [ "$img" != "$MINILORE_IMAGE_DEFAULT" ]; then
    say "miniLORE: готовый образ $img"; run compose pull minilore-srv; return 0
  fi
  a="${MINILORE_ARCHIVE:-$SCRIPT_DIR/$MINILORE_ARCHIVE_REL}"
  if [ -f "$a" ]; then
    pkg_sha_ok "$a" "образ miniLORE"
    say "sha256 архива miniLORE сходится"
    run docker load -i "$a"
    if [ "$DRY" != 1 ]; then
      docker image inspect "$MINILORE_IMAGE_DEFAULT" >/dev/null 2>&1 || die "в архиве $a нет образа $MINILORE_IMAGE_DEFAULT"
    fi
    return 0
  fi
  if [ "$DRY" != 1 ] && docker image inspect "$MINILORE_IMAGE_DEFAULT" >/dev/null 2>&1; then
    say "miniLORE: образ $MINILORE_IMAGE_DEFAULT уже на машине"; return 0
  fi
  die "образа сервера miniLORE нет: ни архива $MINILORE_ARCHIVE_REL в пакете, ни своего MINILORE_IMAGE, ни образа $MINILORE_IMAGE_DEFAULT на машине. Задайте MINILORE_IMAGE=<ваш образ>, положите каталог images/ из пакета рядом с install.sh или ставьте без miniLORE (--minilore none)"
}

# Образ forgejo-mcp (владелица 20.11.2026: «не публиковать, включить в инсталятор»; 21.11.2026: «исходник кладём
# прямо в пакет установки», «в пакете установки не должно быть наших настроек»). Сетевого умолчания нет. Порядок:
#   1) FORGEJO_MCP_IMAGE — свой готовый образ, перекрывает всё;
#   2) FORGEJO_MCP_SRC — свои исходники (каталог или git-адрес#коммит), сборка;
#   3) архив образа пакета images/forgejo-mcp-<коммит>.tar — docker load при совпадении sha256 (--forgejo-mcp-build
#      его пропускает);
#   4) исходник пакета src/forgejo-mcp-<коммит>.tar.gz — при совпадении sha256 распаковка в $DIR/forgejo-mcp-src и сборка;
#   5) ничего нет — в терминале спросить источник (git-адрес, образ или «без forgejo-mcp»), без терминала — отказ
#      с подсказкой. Молча ничего не подставляется.
# Сверка sha256 архива пакета: нет .sha256 или не сходится — отказ.
pkg_sha_ok() { # архив подпись
  local a="$1" want got
  [ -f "$a.sha256" ] || die "у архива $a нет файла sha256 ($a.sha256) — непроверенный $2 не беру"
  want="$(awk '{print $1; exit}' "$a.sha256")"
  got="$(sha256sum "$a" | awk '{print $1}')"
  { [ -n "$want" ] && [ "$want" = "$got" ]; } || die "sha256 не сходится у $a — архив повреждён или подменён; не беру"
}
forgejo_mcp_image() {
  local img src a
  img="${FORGEJO_MCP_IMAGE:-$(env_get FORGEJO_MCP_IMAGE "$DIR/.env")}"
  if [ -n "$img" ]; then say "forgejo-mcp: готовый образ $img"; run compose pull forgejo-mcp; return 0; fi
  src="${FORGEJO_MCP_SRC:-$(env_get FORGEJO_MCP_SRC "$DIR/.env")}"
  if [ -n "$src" ]; then
    say "forgejo-mcp: сборка из своих исходников $src (FORGEJO_MCP_SRC)"
    FORGEJO_MCP_SRC="$src" run compose build forgejo-mcp; return 0
  fi
  a="${FORGEJO_MCP_ARCHIVE:-$SCRIPT_DIR/$FORGEJO_MCP_ARCHIVE_REL}"
  if [ "$FORGEJO_MCP_BUILD" != 1 ] && [ -f "$a" ]; then
    pkg_sha_ok "$a" "образ"
    say "sha256 архива forgejo-mcp сходится"
    run docker load -i "$a"
    if [ "$DRY" != 1 ]; then
      docker image inspect "$FORGEJO_MCP_IMAGE_DEFAULT" >/dev/null 2>&1 || die "в архиве $a нет образа $FORGEJO_MCP_IMAGE_DEFAULT"
    fi
    return 0
  fi
  a="${FORGEJO_MCP_SRC_ARCHIVE:-$SCRIPT_DIR/$FORGEJO_MCP_SRC_ARCHIVE_REL}"
  if [ -f "$a" ]; then
    pkg_sha_ok "$a" "исходник"
    say "sha256 исходника forgejo-mcp сходится — сборка из пакета, без сети к чужому git"
    if [ "$DRY" = 1 ]; then printf '[dry-run] распаковать %s в %s\n' "$a" "$DIR/forgejo-mcp-src"
    else rm -rf "$DIR/forgejo-mcp-src"; mkdir -p "$DIR/forgejo-mcp-src"; tar -xzf "$a" -C "$DIR/forgejo-mcp-src"; fi
    run compose build forgejo-mcp
    return 0
  fi
  forgejo_mcp_ask
}

# Источника нет ни в окружении, ни в пакете. Терминал — спросить; иначе — отказ с вариантами (без молчаливого фолбэка).
forgejo_mcp_ask() {
  local hint c v
  hint="FORGEJO_MCP_IMAGE=<готовый образ>, или FORGEJO_MCP_SRC=<каталог или git-адрес#коммит исходников forgejo-mcp>, или положите каталоги src/ и images/ из пакета установщика рядом с install.sh, или --forgejo none (без Forgejo и forgejo-mcp)"
  if [ "$DRY" = 1 ] || [ ! -t 0 ]; then
    die "источник forgejo-mcp не задан и в пакете его нет. Задайте: $hint"
  fi
  say "источник forgejo-mcp не задан и в пакете его нет. Откуда взять?"
  printf '  1) git-адрес исходников (https://…/forgejo-mcp.git#коммит)\n  2) готовый образ из своего реестра\n  3) без forgejo-mcp\n'
  read -r -p "1/2/3: " c
  case "$c" in
    1) read -r -p "git-адрес исходников forgejo-mcp: " v; [ -n "$v" ] || die "адрес не введён. $hint"
       env_set FORGEJO_MCP_SRC "$v" "$DIR/.env"; FORGEJO_MCP_SRC="$v" run compose build forgejo-mcp ;;
    2) read -r -p "образ forgejo-mcp: " v; [ -n "$v" ] || die "образ не введён. $hint"
       env_set FORGEJO_MCP_IMAGE "$v" "$DIR/.env"; FORGEJO_MCP_IMAGE="$v" run compose pull forgejo-mcp ;;
    3) env_set COMPOSE_PROFILES "$(printf '%s' "$(env_get COMPOSE_PROFILES "$DIR/.env")" | tr ',' '\n' | grep -vx 'forgejo-mcp' | paste -sd, -)" "$DIR/.env"
       say "forgejo-mcp не ставится (профиль снят в $DIR/.env)" ;;
    *) die "нет такого варианта: «$c». $hint" ;;
  esac
}

# Архив исходников пакета: LORE_SRC_ARCHIVE или единственный src/lore-<версия>.tar.gz рядом с install.sh.
# Как у архива forgejo-mcp: без .sha256 или при несовпадении — отказ, непроверенные исходники не собираются.
src_archive() {
  local a="" f n=0 want got base
  if [ -n "${LORE_SRC_ARCHIVE:-}" ]; then
    a="$LORE_SRC_ARCHIVE"
  else
    for f in "$SCRIPT_DIR"/src/lore-*.tar.gz; do [ -f "$f" ] && { a="$f"; n=$((n + 1)); }; done
    [ "$n" -le 1 ] || die "в $SCRIPT_DIR/src/ несколько архивов исходников — нужный задайте в LORE_SRC_ARCHIVE"
  fi
  [ -n "$a" ] && [ -f "$a" ] || die "нет архива исходников ${a:-$SCRIPT_DIR/src/lore-<версия>.tar.gz}. Положите каталог src/ из каталога версии пакета рядом с install.sh или задайте LORE_SRC_ARCHIVE"
  base="$(basename "$a")"
  [[ "$base" =~ ^lore-([0-9A-Za-z][0-9A-Za-z.+-]*)\.tar\.gz$ ]] || die "архив исходников не по образцу lore-<версия>.tar.gz: $base"
  SRC_TAG="${BASH_REMATCH[1]}"
  [ -f "$a.sha256" ] || die "у архива $a нет файла sha256 ($a.sha256) — непроверенные исходники не собираю"
  want="$(awk '{print $1; exit}' "$a.sha256")"
  got="$(sha256sum "$a" | awk '{print $1}')"
  { [ -n "$want" ] && [ "$want" = "$got" ]; } || die "sha256 не сходится у $a — архив повреждён или подменён; не собираю"
  say "sha256 архива исходников сходится ($base)"
  SRC_ARCHIVE="$a"
}

wait_db() {
  local db i
  db="$(env_get LORE_DB "$DIR/.env")"; db="${db:-system_aida_lore}"
  say "ожидание ArcadeDB"
  for i in $(seq 1 60); do
    dcurl "http://arcadedb:2480/api/v1/databases" 2>/dev/null | grep -q '"result"' && break
    if [ "$i" = 60 ]; then
      local alog; alog="$(docker compose -f "$DIR/docker-compose.yml" logs --tail 50 arcadedb 2>/dev/null || true)"
      die "ArcadeDB не ответила за 120 с. $(arcadedb_hint "$alog")"
    fi
    sleep 2
  done
  if dcurl "http://arcadedb:2480/api/v1/databases" | grep -q "\"$db\""; then
    say "база $db уже есть"
  else
    # MIG-01: базы установки ещё нет — свежая установка: база из модели под своим именем (не system_aida_lore), шаги V
    # не катятся. Признак — сама база, а не .env (его могли положить заранее, эмуляция 21.11.2026).
    if [ "$db" = system_aida_lore ]; then db="$FRESH_DB"; env_set LORE_DB "$db" "$DIR/.env"; fi
    env_set LORE_MIGRATE false "$DIR/.env"
    FRESH=1
    say "свежая установка: база $db, LORE_MIGRATE=false (шаги V не катятся)"
    say "создание базы $db"
    dcurl -X POST -H 'Content-Type: application/json' -d "{\"command\":\"create database $db\"}" \
      "http://arcadedb:2480/api/v1/server" | grep -q '"ok"' || die "база $db не создана"
  fi
  minilore_dbs
}

# Базы miniLORE заводит УСТАНОВЩИК, а не их сервер (находка прогона на чужой машине 22.11.2026).
# Сервер 0.4.19 сразу катит свои миграции и падает, если базы нет:
#   миграция schema/001-transcript.sql не применилась: ArcadeDB ответила 404 {"error":"Database not found"}
# — и уходит в бесконечный перезапуск. В README пакета было написано, что он заводит базы сам; это оказалось
# неверно, строку поправили. Создание идемпотентно: база уже есть — пропуск. Когда их сервер научится заводить
# базы сам, этот шаг просто перестанет находить работу.
minilore_dbs() {
  has_profile minilore || return 0
  local have db
  have="$(dcurl "http://arcadedb:2480/api/v1/databases" || true)"
  for db in "$(env_get MINILORE_ARCADE_DATABASE "$DIR/.env")" "$(env_get MINILORE_ARCHIVE_DATABASE "$DIR/.env")"; do
    [ -n "$db" ] || continue
    case "$have" in
      *"\"$db\""*) say "база miniLORE $db уже есть"; continue ;;
    esac
    say "создание базы miniLORE $db"
    dcurl -X POST -H 'Content-Type: application/json' -d "{\"command\":\"create database $db\"}" \
      "http://arcadedb:2480/api/v1/server" | grep -q '"ok"' || die "база miniLORE $db не создана"
  done
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

# MCP (1.18.2) — через тот же nginx веба v2, что увидит агент: /mcp/health — 200 с отметкой сборки, POST /mcp без входа —
# 401 (или 405). 502 — nginx не достал lore-mcp, 404 — /mcp не проксируется: установка выглядит целой, а агенту
# некуда подключиться. Сервис не поднят — строка «НЕТ» с причиной, а не тишина.
probe_mcp() {
  local c
  if [ -z "$(compose ps -q lore-mcp 2>/dev/null)" ]; then
    printf '  НЕТ   %-24s %s\n' "lore-mcp" "не запущен${MCP_OFF:+: $MCP_OFF} — /mcp ответит 502, агенты не подключатся"
    warn "MCP не запущен — агенты не подключатся к /mcp (README, раздел «Подключить агента к MCP»)"
    return 0
  fi
  base="http://lore-app-next"; probe "mcp /mcp/health" "/mcp/health" '"status":"ok"'
  c="$(acurl -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' --data '{}' "http://lore-app-next/mcp" 2>/dev/null || true)"
  case "$c" in
    401|405) printf '  OK    %-24s %s\n' "mcp /mcp без входа" "$c" ;;
    *) printf '  FAIL  %-24s %s\n' "mcp /mcp без входа" "${c:-нет ответа} (ждали 401/405; 502 — nginx не достал lore-mcp, 404 — /mcp не проксируется)"
       fails=$((fails + 1)) ;;
  esac
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
  probe_mcp
  if has_profile forgejo; then base="http://forgejo:3000"; probe "forgejo /api/v1/version" "/api/v1/version" '"version"'; fi
  if has_profile forgejo-mcp && [ -n "$(env_get FORGEJO_MCP_TOKEN "$DIR/.env")" ]; then
    base="http://forgejo-mcp:3000"; probe "forgejo-mcp /health" "/health"
  fi
  [ "$fails" = 0 ] || die "проверок не прошло: $fails"
  say "установка проверена"
}

# Хранилище файлов одной строкой — в план и на экран; ключи не печатаются.
files_val() { local v="${!1:-}"; [ -n "$v" ] || v="$(env_get "$1" "$DIR/.env" 2>/dev/null)"; printf '%s' "$v"; }
files_say() {
  local ep; ep="$(files_val S3_ENDPOINT)"
  if [ "$FILES" = none ] || { [ "$FILES" != s3 ] && [ -z "$ep" ]; }; then
    say "файлы: без файлов — загрузка и показ файлов ответят «хранилище файлов не подключено»"
  else say "файлы: своё S3 $ep, бакет $(files_val S3_BUCKET)"; fi
}

# Своё S3: проверка связи до запуска — положить и прочитать пробный объект (подпись SigV4 силами curl).
s3_probe() {
  [ "$FILES" = s3 ] || return 0
  say "проверка S3: положить и прочитать пробный объект"
  [ "$DRY" = 1 ] && return 0
  local ep bk rg ak sk key body got
  ep="$(files_val S3_ENDPOINT)"; ep="${ep%/}"; bk="$(files_val S3_BUCKET)"; rg="$(files_val S3_REGION)"; rg="${rg:-us-east-1}"
  ak="$(files_val S3_ACCESS_KEY)"; sk="$(files_val S3_SECRET_KEY)"
  key="lore-install-probe-$(date +%s).txt"; body="lore install probe $key"
  printf 'user = "%s:%s"\n' "$ak" "$sk" | docker run -i --rm "$CURL_IMAGE" -K - -sS -m 30 -f --aws-sigv4 "aws:amz:$rg:s3" \
    -X PUT --data-binary "$body" "$ep/$bk/$key" >/dev/null || die "S3: пробный объект не записан в $ep/$bk — проверьте адрес, бакет, регион и ключи"
  got="$(printf 'user = "%s:%s"\n' "$ak" "$sk" | docker run -i --rm "$CURL_IMAGE" -K - -sS -m 30 -f --aws-sigv4 "aws:amz:$rg:s3" "$ep/$bk/$key")" \
    || die "S3: пробный объект записан, но не читается из $ep/$bk"
  [ "$got" = "$body" ] || die "S3: прочитано не то, что записано ($ep/$bk/$key)"
  printf 'user = "%s:%s"\n' "$ak" "$sk" | docker run -i --rm "$CURL_IMAGE" -K - -sS -m 30 --aws-sigv4 "aws:amz:$rg:s3" -X DELETE "$ep/$bk/$key" >/dev/null 2>&1 || true
  say "S3: пробный объект записан и прочитан — хранилище файлов подключено"
}

# Исполняемый файл установщика (lore-migrate) — для базы из модели. LORE_MIGRATE_BIN, иначе путь, который оставила
# команда `lore-migrate install-bundle` рядом с install.sh (.lore-migrate-path).
migrate_bin() {
  local b="${LORE_MIGRATE_BIN-}"
  if [ -z "${LORE_MIGRATE_BIN+x}" ] && [ -f "$SCRIPT_DIR/.lore-migrate-path" ]; then b="$(head -1 "$SCRIPT_DIR/.lore-migrate-path")"; fi
  printf '%s' "$b"
}
migrate_bin_say() {
  local b; b="$(migrate_bin)"
  if [ -n "$b" ]; then printf '%s' "$b"; else printf 'исполняемый файл установщика не найден — задайте LORE_MIGRATE_BIN (lore-migrate-<версия>-linux-x64 из пакета)'; fi
}

# MIG-01: «схема и база собираются заново из нормализованной модели». Пустая база из модели — тем же кодом, что перенос,
# без источника: lore-migrate init-empty в одноразовом контейнере в сети стека (порт базы наружу не публикуется).
init_model_db() {
  local bin db pw envf
  bin="$(migrate_bin)"
  [ -n "$bin" ] && [ -f "$bin" ] || die "$(migrate_bin_say): без него свежая база из модели не собирается"
  db="$(env_get LORE_DB "$DIR/.env")"; pw="$(env_get ARCADEDB_ROOT_PASSWORD "$DIR/.env")"
  say "пустая база из модели: lore-migrate init-empty → $db"
  # файл доступа с паролем root базы — удаляется сразу после запуска, в том числе при отказе (без trap: он пережил бы функцию)
  envf="$(mktemp)"
  ( umask 077; {
    echo "MIG_DB_URL=http://arcadedb:2480"
    # источника у свежей установки нет — init-empty его не читает; ключи нужны разбору файла доступа
    echo "MIG_SRC_DB=fresh_install_no_source"; echo "MIG_SRC_USER=none"; echo "MIG_SRC_PASSWORD=none"
    echo "MIG_DST_DB=$db"; echo "MIG_DST_USER=root"; echo "MIG_DST_PASSWORD=$pw"
  } > "$envf" )
  local rc=0
  docker run --rm --network "$(project)_default" -v "$bin:/opt/lore-migrate:ro" -v "$envf:/run/mig.env:ro" \
    "$MIGRATE_RUNNER_IMAGE" /opt/lore-migrate init-empty --env /run/mig.env || rc=$?
  rm -f "$envf"
  [ "$rc" = 0 ] || die "пустая база из модели не собрана (lore-migrate init-empty) — схема и справочники не записаны"
  say "база $db собрана из модели: шаги V не катятся (LORE_MIGRATE=false)"
}

do_install() {
  [ "$FROM_SOURCE" = 0 ] || src_archive
  check_prereq
  default_images
  prepare_src
  write_env
  images
  s3_probe
  say "запуск ArcadeDB"
  run compose up -d arcadedb
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] ждать ArcadeDB, создать базу, если её нет\n'
    if [ ! -f "$DIR/.env" ]; then
      say "свежая установка: база $FRESH_DB, LORE_MIGRATE=false (шаги V не катятся)"
      say "пустая база из модели: lore-migrate init-empty — $(migrate_bin_say)"
    fi
    run compose up -d
    printf '[dry-run] ждать здоровья бэкенда, проверить dictionary и слайсы: %s use_cases_of_feature search; MCP: /mcp/health 200, POST /mcp без входа 401/405\n' "$SLICES"
    return 0
  fi
  wait_db
  [ "$FRESH" = 1 ] && init_model_db
  say "запуск бэкенда и фронта"
  start_stack
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
    say "остановка стека; данные (тома lore-db, lore-db-backups) и $DIR сохраняются"
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
    rc=0; out="$(PATH="/usr/bin:/bin" bash "$self" "$@" 2>&1 </dev/null)" || rc=$?
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
  printf '%s' "$out" | grep -q "ghcr.io/$GHCR_OWNER/lore-backend:v9.0.0" || fail "мажор без --build: нет готового образа ghcr: $out"; ok
  printf '%s' "$out" | grep -q 'compose build' && fail "мажор без --build собирает образы"; ok
  ARCADEDB_ROOT_PASSWORD=sekret-не-печатать expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --build --src "$t"
  printf '%s' "$out" | grep -q 'compose build lore-backend lore-app-next' || fail "в плане нет сборки: $out"; ok
  printf '%s' "$out" | grep -q 'compose up -d arcadedb' || fail "в плане нет подъёма базы"; ok
  # 1.18.2: MCP едет в пакете — собирается с бэкендом и вебом, проверяется через nginx веба (/mcp 401/405, не 502/404).
  printf '%s' "$out" | grep -q 'compose build lore-backend lore-app-next lore-mcp' || fail "--build: lore-mcp не собирается: $out"; ok
  printf '%s' "$out" | grep -q 'POST /mcp без входа 401/405' || fail "в плане нет пробы /mcp: $out"; ok
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0
  printf '%s' "$out" | grep -q 'compose pull lore-backend lore-app-next lore-mcp' || fail "мажор без --build: lore-mcp не тянется: $out"; ok
  local mc; mc="$(sed -n '/^  lore-mcp:$/,/^  [a-z][a-z0-9-]*:$/p' "$SCRIPT_DIR/docker-compose.install.yml")"
  [ -n "$mc" ] || fail "compose установки: нет сервиса lore-mcp"; ok
  printf '%s' "$mc" | grep -q 'LORE_BACKEND_URL=http://lore-backend:9100' || fail "lore-mcp: бэкенд не по имени в сети compose"; ok
  printf '%s' "$mc" | grep -qE '^\s+ports:' && fail "lore-mcp: порт опубликован — MCP мимо TLS nginx"; ok
  printf '%s' "$mc" | grep -q 'LORE_MCP_CLIENT_SECRET' && fail "lore-mcp: секрет клиента в compose"; ok
  # MIG-04, решение владелицы 21.11.2026: «пока ставь указать s3 хранилище или без опции файлов». MinIO пакет больше
  # не ставит (Docker Hub перестал отдавать образ): ни сервиса, ни тома, ни образа; файлы — своё S3 или без файлов.
  printf '%s' "$out" | grep -qi 'minio' && fail "план всё ещё ставит MinIO: $out"; ok
  printf '%s' "$out" | grep -q 'файлы: без файлов' || fail "по умолчанию — «без файлов», план должен сказать это: $out"; ok
  grep -qiE '^\s*minio:|minio/minio|lore-minio-data' "$SCRIPT_DIR/docker-compose.install.yml" && fail "compose установки ставит MinIO"; ok
  local k
  for k in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
    grep -qE "^$k=" "$SCRIPT_DIR/.env.example" || fail ".env.example: нет $k"; ok
    grep -qF "$k=\${$k:-}" "$SCRIPT_DIR/docker-compose.install.yml" || fail "бэкенд: $k не из .env"; ok
  done
  grep -qE '^MINIO_' "$SCRIPT_DIR/.env.example" && fail ".env.example: остались переменные MinIO"; ok
  expect_rc 2 --dry-run --dir "$t/inst" --files maybe
  S3_ENDPOINT= expect_rc 2 --dry-run --dir "$t/inst" --version v9.0.0 --files s3
  printf '%s' "$out" | grep -q 'S3_ENDPOINT' || fail "--files s3 без адреса: причина не названа: $out"; ok
  S3_ENDPOINT=https://s3.example S3_BUCKET=b S3_ACCESS_KEY=a S3_SECRET_KEY=sekret-s3 expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --files s3
  printf '%s' "$out" | grep -q 'проверка S3: положить и прочитать пробный объект' || fail "--files s3: нет проверки связи в плане: $out"; ok
  printf '%s' "$out" | grep -q 'sekret-s3' && fail "dry-run напечатал ключ S3"; ok
  # MIG-04, эмуляция 21.11.2026: сборка из архива исходников (.git там нет) давала /lore/version
  # «commit: unknown» — установка не говорила, из какого пакета она. Коммит едет в архиве (git archive export-subst,
  # backend/BUILD_COMMIT), install.sh передаёт его в сборку образов (LORE_BUILD_COMMIT в .env).
  grep -q 'BUILD_COMMIT export-subst' "$SCRIPT_DIR/../../.gitattributes" 2>/dev/null || [ ! -f "$SCRIPT_DIR/../../.gitattributes" ] \
    || fail ".gitattributes: backend/BUILD_COMMIT без export-subst — коммит не доедет до архива"; ok
  grep -q 'env_set LORE_BUILD_COMMIT' "$0" || fail "install.sh не передаёт коммит исходников в сборку (LORE_BUILD_COMMIT)"; ok
  # MIG-01: «схема и база собираются заново из нормализованной модели» — свежая установка строит пустую базу из модели
  # (lore-migrate init-empty) и запускает бэкенд без шагов V; база установки — lore, не system_aida_lore.
  LORE_MIGRATE_BIN=/opt/x/lore-migrate expect_rc 0 --dry-run --dir "$t/fresh" --version v9.0.0
  printf '%s' "$out" | grep -q 'пустая база из модели: lore-migrate init-empty' || fail "свежая установка: нет шага «пустая база из модели»: $out"; ok
  printf '%s' "$out" | grep -q 'LORE_MIGRATE=false' || fail "свежая установка: шаги V не выключены: $out"; ok
  printf '%s' "$out" | grep -q 'база lore' || fail "свежая установка: база установки не lore: $out"; ok
  # trap … RETURN остаётся после выхода из функции и срабатывает в чужом return, где её local уже нет (set -u) —
  # пробная установка 21.11 прошла, а код выхода был 1 («envf: unbound variable»).
  grep -qE "trap '[^']*' RETURN" "$0" && fail "trap … RETURN в install.sh — срабатывает после функции (set -u роняет установку)"; ok
  # признак свежей установки — отсутствие базы, а не отсутствие .env (труба кладёт .env заранее, эмуляция 21.11.2026)
  sed -n '/^wait_db()/,/^}/p' "$0" | grep -q 'FRESH=1' || fail "свежая установка определяется не по базе (wait_db не ставит FRESH)"; ok
  LORE_MIGRATE_BIN= expect_rc 0 --dry-run --dir "$t/fresh" --version v9.0.0
  printf '%s' "$out" | grep -q 'исполняемый файл установщика не найден' || fail "свежая установка без lore-migrate: причина не названа в плане: $out"; ok
  # дальше проверки читают план сборки — вернуть его в $out
  ARCADEDB_ROOT_PASSWORD=sekret-не-печатать expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --build --src "$t"
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
  # Свежая установка катит шаги V (по умолчанию true); база, перенесённая в модель 1.18, требует false — иначе бэкенд
  # честно отказывает старт «схема собрана из модели, а lore.migrate=true» (эмуляция 21.11.2026).
  grep -qF 'lore.migrate=${LORE_MIGRATE:-true}' "$SCRIPT_DIR/docker-compose.install.yml" || fail "в профиле нет lore.migrate=\${LORE_MIGRATE:-true}"; ok
  grep -qE '^\s*- (lore\.bootstrap|LORE_BOOTSTRAP)' "$SCRIPT_DIR/docker-compose.install.yml" && fail "профиль снова зависит от LORE_BOOTSTRAP"; ok
  grep -qE '^[A-Z_]*PASSWORD=(CHANGE_ME)?$' "$SCRIPT_DIR/.env.example" || fail ".env.example: пароли — только заглушки"; ok
  grep -E 'PASSWORD=' "$SCRIPT_DIR/.env.example" | grep -vqE 'PASSWORD=(CHANGE_ME)?$' && fail ".env.example содержит пароль"; ok
  # 7. вход через Keycloak — по выбору (MIG-04, владелица 17.11.2026: «на новой установке ты заводишь kc»).
  #    По умолчанию входа нет, как раньше; включается LORE_AUTH_ENABLED=true в .env вместе с адресом области.
  #    У бэкенда флаг читается и на сборке (build-arg OIDC Quarkus), и в рантайме (фильтр ролей). У веба вход — только
  #    настройка запуска (SELF-PROVISION-STANDALONE): env контейнера → /config.json, в бандл ничего не впекается.
  local c="$SCRIPT_DIR/docker-compose.install.yml"
  grep -qE '^\s*- LORE_AUTH_ENABLED=false\s*$' "$c" && fail "вход прибит гвоздём: LORE_AUTH_ENABLED=false в профиле"; ok
  grep -q 'LORE_AUTH_ENABLED=${LORE_AUTH_ENABLED:-false}' "$c" || fail "бэкенд: нет LORE_AUTH_ENABLED с умолчанием false в окружении"; ok
  grep -q 'LORE_AUTH_ENABLED: ${LORE_AUTH_ENABLED:-false}' "$c" || fail "бэкенд: нет build-arg LORE_AUTH_ENABLED"; ok
  grep -q 'VITE_LORE_AUTH_ENABLED\|VITE_OIDC_' "$c" && fail "веб: вход снова впекается в бандл (VITE_*) — должен быть env контейнера"; ok
  grep -q 'LORE_OIDC_ISSUER: ${LORE_OIDC_ISSUER:-}' "$c" || fail "веб: адрес входа не задаётся при запуске"; ok
  grep -q 'LORE_OIDC_CLIENT_ID: ${LORE_OIDC_CLIENT_ID:-lore-app}' "$c" || fail "веб: нет клиента входа lore-app"; ok
  grep -q 'LORE_OIDC_ORIGIN: ${LORE_OIDC_ORIGIN:-}' "$c" || fail "веб: адрес Keycloak не настраивается"; ok
  # 7a. базовые образы (arcadedb): недоступный реестр не роняет установку, если образ уже есть на машине;
  #     образа нет нигде — отказ с именем образа (Docker Hub перестал отдавать minio/minio — эмуляция 21.11.2026).
  grep -q 'pull --ignore-pull-failures arcadedb' "$0" || fail "базовые образы: pull без --ignore-pull-failures — недоступный реестр валит установку при образе на машине"; ok
  grep -q 'need_images arcadedb' "$0" || fail "базовые образы: нет проверки, что образ есть на машине после pull"; ok
  for k in LORE_AUTH_ENABLED LORE_OIDC_ISSUER LORE_OIDC_ORIGIN LORE_OIDC_CLIENT_ID LORE_VOLVA_ORIGIN LORE_VOLVA_EMBED_SITE_URL LORE_VOLVA_EMBED_ISSUER; do
    grep -qE "^$k=" "$SCRIPT_DIR/.env.example" || fail ".env.example: нет $k"; ok
  done
  # 8. Forgejo — по выбору (MIG-04, владелица 20.11.2026): install — поставить Forgejo нашей версии, own — свой Forgejo
  #    владельца, none — без Forgejo (по умолчанию, как раньше). В install и own едет forgejo-mcp.
  #    Исходник forgejo-mcp — в пакете (владелица 21.11.2026): поддельный архив с .sha256 вместо src/ пакета.
  mkdir -p "$t/pkg/src/fmcp"; printf 'FROM scratch\n' > "$t/pkg/src/fmcp/Dockerfile"
  tar -czf "$t/pkg/src/fmcp.tar.gz" -C "$t/pkg/src/fmcp" .
  ( cd "$t/pkg/src" && sha256sum fmcp.tar.gz > fmcp.tar.gz.sha256 )
  export FORGEJO_MCP_SRC_ARCHIVE="$t/pkg/src/fmcp.tar.gz"
  expect_rc 2 --dry-run --dir "$t/inst" --forgejo maybe
  expect_rc 2 --dry-run --dir "$t/inst" --forgejo own
  printf '%s' "$out" | grep -q 'forgejo-url' || fail "own без адреса: причина не названа: $out"; ok
  expect_rc 2 --dry-run --dir "$t/inst" --forgejo own --forgejo-url 'ftp://x'
  expect_rc 2 --dry-run --dir "$t/inst" --forgejo-url https://git.example.org
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install --forgejo-mcp-build
  printf '%s' "$out" | grep -q 'COMPOSE_PROFILES=forgejo,forgejo-mcp' || fail "install: нет профилей forgejo и forgejo-mcp: $out"; ok
  printf '%s' "$out" | grep -q 'FORGEJO_BASE_OVERRIDE=http://forgejo:3000' || fail "install: мост LORE не направлен на forgejo:3000"; ok
  printf '%s' "$out" | grep -q 'forgejo 17.0.2' || fail "install: версия Forgejo не названа"; ok
  printf '%s' "$out" | grep -q 'forgejo-mcp не запустится, пока нет FORGEJO_MCP_TOKEN' || fail "install: нет предупреждения про токен forgejo-mcp"; ok
  FORGEJO_API_TOKEN=tok-не-печатать expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo own --forgejo-url https://git.example.org/ --forgejo-mcp-build
  printf '%s' "$out" | grep -q 'COMPOSE_PROFILES=forgejo-mcp$' || fail "own: профиль только forgejo-mcp: $out"; ok
  printf '%s' "$out" | grep -q 'FORGEJO_URL=https://git.example.org$' || fail "own: адрес своего Forgejo не дошёл"; ok
  printf '%s' "$out" | grep -q 'tok-' && fail "dry-run напечатал токен"; ok
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo none
  printf '%s' "$out" | grep -q 'COMPOSE_PROFILES=$' || fail "none: профили Forgejo не сняты: $out"; ok

  # miniLORE (D-2026-INSTALL-MINILORE-IN-PACKAGE): свой выбор, не зависящий от Forgejo.
  # Образ сервера едет архивом в images/ — как у forgejo-mcp. Поддельный архив с подписью: проверки ниже про
  # выбор и настройки, а не про образ, но без образа установка теперь честно отказывает (и это проверено отдельно).
  mkdir -p "$t/pkg/images"; printf 'образ-miniLORE' > "$t/pkg/images/m0.tar"
  ( cd "$t/pkg/images" && sha256sum m0.tar > m0.tar.sha256 )
  export MINILORE_ARCHIVE="$t/pkg/images/m0.tar"
  expect_rc 2 --dry-run --dir "$t/inst" --minilore maybe
  printf '%s' "$out" | grep -q -- '--minilore' || fail "--minilore: неизвестное значение без причины: $out"; ok
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install --minilore-client-id their-app --minilore-owner their-owner
  printf '%s' "$out" | grep -q 'minilore' || fail "--minilore install: miniLORE не назван в плане: $out"; ok
  printf '%s' "$out" | grep -q 'minilore-srv:0.4.19' || fail "--minilore install: версия сервера miniLORE не названа: $out"; ok
  # Умолчания разработчика (их клиент и их владелец) в чужую установку не подставляются.
  printf '%s' "$out" | grep -q 'mobilepoc-app' && fail "в план попал ЧУЖОЙ клиент mobilepoc-app"; ok
  printf '%s' "$out" | grep -q 'omiloreadmin' && fail "в план попал ЧУЖОЙ владелец omiloreadmin"; ok
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --minilore none
  # 22.11.2026, прогон на чужой машине: без клиента приложения и владельца сервер miniLORE НЕ стартует
  # («Failed to load config value ... minilore.app.client-id») и уходит в бесконечный перезапуск. Раньше тут было
  # предупреждение — установка «проходила», а контейнер крутился в рестарте. Теперь отказ до установки.
  expect_rc 2 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install
  printf '%s' "$out" | grep -q 'MINILORE_APP_CLIENT_ID' || fail "miniLORE без клиента: имя настройки не названо: $out"; ok
  printf '%s' "$out" | grep -q 'MINILORE_OWNER' || fail "miniLORE без владельца: имя настройки не названо: $out"; ok
  printf '%s' "$out" | grep -qi 'перезапуск' || fail "miniLORE: не сказано, ЧТО будет без этих настроек: $out"; ok
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install --minilore-client-id minilore-app --minilore-owner someone
  printf '%s' "$out" | grep -q 'MINILORE_APP_CLIENT_ID=minilore-app' || fail "miniLORE: клиент не доехал до .env: $out"; ok
  printf '%s' "$out" | grep -q 'MINILORE_OWNER=someone' || fail "miniLORE: владелец не доехал до .env: $out"; ok
  MINILORE_APP_CLIENT_ID=env-app MINILORE_OWNER=env-owner expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install
  printf '%s' "$out" | grep -q 'MINILORE_APP_CLIENT_ID=env-app' || fail "miniLORE: клиент из окружения не взят: $out"; ok
  # Образ сервера miniLORE: адреса нашего реестра в пакете быть не должно (пакет едет чужим людям — сторож
  # noBakedHosts поймал это у меня 22.11.2026). Образ едет архивом в images/, как у forgejo-mcp; подпись сверяется.
  for f in install.sh .env.example docker-compose.install.yml README.md; do
    grep -q 'git\.seidrstudio\.pro' "$SCRIPT_DIR/$f" && fail "$f: в пакете снова наш реестр — он чужим людям не доступен"; ok
  done
  mkdir -p "$t/pkg/images"; printf 'образ-miniLORE' > "$t/pkg/images/m.tar"
  ( cd "$t/pkg/images" && sha256sum m.tar > m.tar.sha256 )
  MINILORE_ARCHIVE="$t/pkg/images/m.tar" expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install --minilore-client-id a --minilore-owner b
  printf '%s' "$out" | grep -q "docker load -i $t/pkg/images/m.tar" || fail "архив miniLORE есть — в плане нет docker load: $out"; ok
  printf 'подмена' > "$t/pkg/images/m.tar"
  MINILORE_ARCHIVE="$t/pkg/images/m.tar" expect_rc 1 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install --minilore-client-id a --minilore-owner b
  printf '%s' "$out" | grep -q 'sha256 не сходится' || fail "подменённый архив miniLORE взят молча: $out"; ok
  rm -f "$t/pkg/images/m.tar.sha256"
  MINILORE_ARCHIVE="$t/pkg/images/m.tar" expect_rc 1 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install --minilore-client-id a --minilore-owner b
  printf '%s' "$out" | grep -q 'sha256' || fail "архив miniLORE без подписи взят молча: $out"; ok
  MINILORE_ARCHIVE="$t/pkg/нет.tar" expect_rc 1 --dry-run --dir "$t/inst" --version v9.0.0 --minilore install --minilore-client-id a --minilore-owner b
  printf '%s' "$out" | grep -q 'MINILORE_IMAGE' || fail "образа нет — не названы выходы: $out"; ok
  # Базы miniLORE заводит установщик: их сервер 0.4.19 падает с «Database not found» и уходит в перезапуск.
  grep -q 'minilore_dbs' "$0" || fail "нет шага создания баз miniLORE"; ok
  grep -q 'create database \$db' "$0" || fail "базы miniLORE создаются не командой create database"; ok
  expect_rc 2 --dry-run --dir "$t/inst" --minilore none --minilore-client-id x
  printf '%s' "$out" | grep -q -- '--minilore install' || fail "ключи miniLORE без установки: причина не названа: $out"; ok
  # Отказ ArcadeDB называет ПРИЧИНУ, а не только «не ответила»: в журнале базы «Authentication failed» значит,
  # что пароль в .env не подходит к УЖЕ существующей базе (том прошлой установки с тем же именем проекта).
  case "$(arcadedb_hint 'INFO [GetDatabasesHandler] Authentication failed: User/Password not valid')" in
    *пароль*) ok ;; *) fail "подсказка ArcadeDB: про пароль не сказано" ;;
  esac
  case "$(arcadedb_hint 'INFO [ArcadeDBServer] <ArcadeDB_0> Starting ArcadeDB Server...')" in
    *пароль*) fail "подсказка ArcadeDB: пароль назван там, где его в журнале нет" ;; *) ok ;;
  esac
  printf '%s' "$out" | grep -q 'minilore-srv' && fail "--minilore none: сервер miniLORE всё равно в плане: $out"; ok
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0
  printf '%s' "$out" | grep -qi 'forgejo' && fail "без --forgejo план не должен трогать Forgejo: $out"; ok
  [ "$(merge_profiles 'guard,forgejo' install)" = 'guard,forgejo,forgejo-mcp' ] || fail "профили: guard теряется"; ok
  [ "$(merge_profiles 'forgejo,forgejo-mcp,guard' none)" = 'guard' ] || fail "профили: none не снимает forgejo"; ok
  [ "$(merge_profiles '' own)" = 'forgejo-mcp' ] || fail "профили: own"; ok
  grep -q '^FORGEJO_MCP_API_KEY=CHANGE_ME$' "$SCRIPT_DIR/.env.example" || fail ".env.example: ключ forgejo-mcp — заглушка CHANGE_ME"; ok
  grep -qE '^FORGEJO_(API|MCP)_TOKEN=$' "$SCRIPT_DIR/.env.example" || fail ".env.example: токены Forgejo — пустые"; ok
  # 9. образ forgejo-mcp — из архива пакета (владелица 20.11.2026: «не публиковать, включить в инсталятор»):
  #    есть архив — docker load со сверкой sha256; нет — сборка из исходника пакета (src/), сети к git не нужно.
  mkdir -p "$t/pkg/images"; printf 'образ' > "$t/pkg/images/a.tar"
  ( cd "$t/pkg/images" && sha256sum a.tar > a.tar.sha256 )
  FORGEJO_MCP_ARCHIVE="$t/pkg/images/a.tar" expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install
  printf '%s' "$out" | grep -q "docker load -i $t/pkg/images/a.tar" || fail "архив есть — в плане нет docker load: $out"; ok
  printf '%s' "$out" | grep -q 'sha256 архива forgejo-mcp сходится' || fail "архив: нет сверки sha256: $out"; ok
  printf '%s' "$out" | grep -q 'compose build forgejo-mcp' && fail "архив есть, а план собирает forgejo-mcp из git"; ok
  printf 'подмена' > "$t/pkg/images/a.tar"
  FORGEJO_MCP_ARCHIVE="$t/pkg/images/a.tar" expect_rc 1 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install
  printf '%s' "$out" | grep -q 'sha256 не сходится' || fail "подменённый архив: отказ без причины: $out"; ok
  rm -f "$t/pkg/images/a.tar.sha256"; printf 'образ' > "$t/pkg/images/a.tar"
  FORGEJO_MCP_ARCHIVE="$t/pkg/images/a.tar" expect_rc 1 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install
  printf '%s' "$out" | grep -q 'нет файла sha256' || fail "архив без sha256: принят молча: $out"; ok
  # Нет образа — сборка из исходника пакета: без сети к чьему-либо git (владелица 21.11.2026).
  FORGEJO_MCP_ARCHIVE="$t/none.tar" expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install
  printf '%s' "$out" | grep -q "распаковать $t/pkg/src/fmcp.tar.gz" || fail "нет образа: исходник пакета не распакован: $out"; ok
  printf '%s' "$out" | grep -q 'compose build forgejo-mcp' || fail "исходник пакета: нет сборки: $out"; ok
  printf '%s' "$out" | grep -qiE 'git clone|https?://[^ ]*forgejo-mcp' && fail "сборка forgejo-mcp ходит в сеть: $out"; ok
  grep -qE 'context: \$\{FORGEJO_MCP_SRC:-\./forgejo-mcp-src\}$' "$SCRIPT_DIR/docker-compose.install.yml" || fail "compose: умолчание сборки forgejo-mcp — не исходник пакета"; ok
  # --forgejo-mcp-build пропускает архив образа и собирает из исходника пакета.
  FORGEJO_MCP_ARCHIVE="$t/pkg/images/a.tar" expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install --forgejo-mcp-build
  printf '%s' "$out" | grep -q 'docker load' && fail "--forgejo-mcp-build: план всё равно грузит образ"; ok
  printf '%s' "$out" | grep -q 'compose build forgejo-mcp' || fail "--forgejo-mcp-build: нет сборки: $out"; ok
  # Подменённый исходник пакета — отказ.
  cp "$t/pkg/src/fmcp.tar.gz" "$t/pkg/src/bad.tar.gz"; printf 'x  bad.tar.gz\n' > "$t/pkg/src/bad.tar.gz.sha256"
  FORGEJO_MCP_SRC_ARCHIVE="$t/pkg/src/bad.tar.gz" FORGEJO_MCP_ARCHIVE="$t/none.tar" expect_rc 1 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install
  printf '%s' "$out" | grep -q 'sha256 не сходится' || fail "подменённый исходник: принят: $out"; ok
  # Своя замена: FORGEJO_MCP_SRC.
  FORGEJO_MCP_SRC=/opt/my-fmcp FORGEJO_MCP_ARCHIVE="$t/none.tar" expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install
  printf '%s' "$out" | grep -q 'своих исходников /opt/my-fmcp' || fail "FORGEJO_MCP_SRC не взят: $out"; ok
  # Ничего нет и терминала нет — честный отказ с вариантами, без молчаливого фолбэка.
  FORGEJO_MCP_SRC_ARCHIVE="$t/none.tar.gz" FORGEJO_MCP_ARCHIVE="$t/none.tar" expect_rc 1 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo own --forgejo-url https://git.example.org
  printf '%s' "$out" | grep -q 'источник forgejo-mcp не задан' || fail "нет источника: причина не названа: $out"; ok
  for k in FORGEJO_MCP_IMAGE FORGEJO_MCP_SRC 'forgejo none'; do
    printf '%s' "$out" | grep -q -- "$k" || fail "нет источника: отказ не называет вариант $k: $out"; ok
  done
  FORGEJO_MCP_IMAGE=reg.example/fmcp:1 FORGEJO_MCP_ARCHIVE="$t/pkg/images/a.tar" expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0 --forgejo install
  printf '%s' "$out" | grep -q 'compose pull forgejo-mcp' || fail "FORGEJO_MCP_IMAGE не перекрыл архив: $out"; ok
  printf '%s' "$out" | grep -q 'docker load' && fail "FORGEJO_MCP_IMAGE задан, а план грузит архив"; ok
  # 10. локальная LLM — по выбору (MIG-04, владелица 20.11.2026): бэкенд получает адрес, модель и ключ; по умолчанию пусто
  for k in LORE_LLM_LOCAL_URL LORE_LLM_LOCAL_MODEL LORE_LLM_LOCAL_API_KEY; do
    grep -qE "^$k=$" "$SCRIPT_DIR/.env.example" || fail ".env.example: $k — пустая строка"; ok
    grep -q -- "- $k=\${$k:-" "$c" || fail "бэкенд: $k не передаётся"; ok
  done
  grep -q 'host.docker.internal:host-gateway' "$c" || fail "бэкенд: модель на этой машине не видна из контейнера"; ok
  # 11. сборка из архива исходников пакета (MIG-04, владелица 20.11.2026: «архивом наш проект для собственной сборки
  #     если что»): --build-from-source сверяет sha256, распаковывает в <dir>/src/<версия>/ и собирает образы;
  #     без флага всё как раньше — архив не трогается.
  mkdir -p "$t/pkg/src/x/backend"; printf 'FROM scratch\n' > "$t/pkg/src/x/backend/Dockerfile.local"
  ( cd "$t/pkg/src" && tar -czf lore-9.1.0.tar.gz -C x . && sha256sum lore-9.1.0.tar.gz > lore-9.1.0.tar.gz.sha256 )
  local sa="$t/pkg/src/lore-9.1.0.tar.gz"
  LORE_SRC_ARCHIVE="$sa" expect_rc 0 --dry-run --dir "$t/inst" --build-from-source
  printf '%s' "$out" | grep -q 'sha256 архива исходников сходится' || fail "--build-from-source: нет сверки sha256: $out"; ok
  printf '%s' "$out" | grep -qF "tar -xzf $sa -C $t/inst/src/9.1.0" || fail "--build-from-source: нет распаковки в <dir>/src/<версия>: $out"; ok
  printf '%s' "$out" | grep -q 'compose build lore-backend lore-app-next' || fail "--build-from-source: образы не собираются: $out"; ok
  printf '%s' "$out" | grep -q 'ghcr.io' && fail "--build-from-source: план тянет готовые образы ghcr"; ok
  [ ! -e "$t/inst" ] || fail "dry-run --build-from-source создал каталог установки"; ok
  printf 'подмена' >> "$sa"
  LORE_SRC_ARCHIVE="$sa" expect_rc 1 --dry-run --dir "$t/inst" --build-from-source
  printf '%s' "$out" | grep -q 'sha256 не сходится' || fail "подменённый архив исходников: отказ без причины: $out"; ok
  rm -f "$sa.sha256"
  LORE_SRC_ARCHIVE="$sa" expect_rc 1 --dry-run --dir "$t/inst" --build-from-source
  printf '%s' "$out" | grep -q 'нет файла sha256' || fail "архив исходников без sha256 принят молча: $out"; ok
  LORE_SRC_ARCHIVE="$t/none.tar.gz" expect_rc 1 --dry-run --dir "$t/inst" --build-from-source
  printf '%s' "$out" | grep -q 'нет архива исходников' || fail "нет архива исходников: отказ без причины: $out"; ok
  LORE_SRC_ARCHIVE="$t/pkg/src/x/backend/Dockerfile.local" expect_rc 1 --dry-run --dir "$t/inst" --build-from-source
  printf '%s' "$out" | grep -q 'lore-<версия>.tar.gz' || fail "архив с чужим именем: отказ без образца: $out"; ok
  expect_rc 2 --dry-run --dir "$t/inst" --build-from-source --version v9.0.0
  printf '%s' "$out" | grep -q 'из архива' || fail "--version с --build-from-source: причина не названа: $out"; ok
  LORE_BACKEND_IMAGE=r/b:1 LORE_WEB_IMAGE=r/w:1 expect_rc 2 --dry-run --dir "$t/inst" --build-from-source
  expect_rc 0 --dry-run --dir "$t/inst" --version v9.0.0
  printf '%s' "$out" | grep -q 'tar -xzf' && fail "без --build-from-source план распаковывает архив исходников"; ok
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
