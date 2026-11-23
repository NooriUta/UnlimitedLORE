#!/usr/bin/env bash
# Труба установщика LORE: «пустая машина → пакет из kkRepo → установка → перенос → сверка → проба».
# SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04. Владелица 21.11.2026: «давай сделаем трубу, которая будет тестировать установку
# с нуля и миграцию»; «отдельную у инсталлера на основе наших наработок».
#
# Свой здесь только каркас. Шаги — переиспользованные:
#   fetch    пакет, выложенный lore-installer-publish.yml (kkRepo, каталог версии, SHA256SUMS) — скачать и сверить
#   install  deploy/install/install.sh из архива исходников пакета (--build-from-source), вход выключен, без KC/Infisical
#   migrate  .github/scripts/model-migration-run.sh STAGE=full (тот же, что lore-migration-snapshot.yml): connect
#            --create-dst, два прогона transfer → edges → dst-fingerprint и сверка отпечатков; конвейер — бинарь пакета
#   switch   LORE_DB установки → перенесённая база, перезапуск бэкенда
#   probe    /lore/version отвечает, срезы open_tasks и organizations не пусты
#
# Запуск: lore-install-e2e.sh <plan|fetch|install|probe-fresh|migrate|pr-data|switch|probe|all|down>
# Входы (env):
#   E2E_VERSION   версия пакета в kkRepo (1.18.0-rc.<sha8>) — обязательна
#   KKREPO_BASE   http://192.168.3.131:8081/repository; KKREPO_REPO lore-installer
#   E2E_WORK      рабочий каталог (по умолчанию ./install-e2e); E2E_DIR — каталог установки ($E2E_WORK/lore)
#   E2E_BIND / E2E_HTTP_PORT / E2E_DB_PORT — 127.0.0.1 / 14400 / 2491 (ArcadeDB установки — только для переноса)
#   E2E_REACH     host — по портам на E2E_BIND (машина); network — джоба в контейнере подключается к сети compose
#   E2E_DST_DB    приёмник переноса в ArcadeDB установки (migration_dst_install; только migration_dst*)
#   MIG_SRC_DB    снимок прода migration_src_* (только читается); MIG_DB_URL / MIG_DB_USER / MIG_DB_PASSWORD — его сервер
#   E2E_SRC_ENV   файл доступа источника вместо трёх переменных (MIG_DB_URL, MIG_SRC_USER, MIG_SRC_PASSWORD) — значения
#                 не печатаются
#   E2E_DECISIONS файл решений (по умолчанию из исходников пакета: scripts/model-migration/rules/decisions.lore.json)
#   E2E_WAIT_MIN  ожидание ответа LORE (20); E2E_KEEP=1 — `down` ничего не убирает
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die() { echo "::error::$1"; exit "${2:-1}"; }
say() { echo "── $*"; }
lc() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

STAGE="${1:-plan}"
V="${E2E_VERSION:-}"
[ -n "$V" ] || die "E2E_VERSION не задана — какую версию пакета из kkRepo ставить (1.18.0-rc.<sha8>)" 2
BASE="${KKREPO_BASE:-http://192.168.3.131:8081/repository}"; REPO="${KKREPO_REPO:-lore-installer}"
WORK="${E2E_WORK:-$PWD/install-e2e}"; case "$WORK" in /*|[A-Za-z]:/*) ;; *) WORK="$PWD/$WORK" ;; esac
DIR="${E2E_DIR:-$WORK/lore}"; PKG="$WORK/pkg"; TREE="$WORK/tree"
# Бинарь пакета — lore-migrate-<версия>-linux-x64 (имена каталога версии — publish-plan.mjs).
BIN="$PKG/lore-migrate-$V-linux-x64"
BIND="${E2E_BIND:-127.0.0.1}"; PORT="${E2E_HTTP_PORT:-14400}"; DBPORT="${E2E_DB_PORT:-2491}"; REACH="${E2E_REACH:-host}"
DST="${E2E_DST_DB:-migration_dst_install}"; WAIT_MIN="${E2E_WAIT_MIN:-20}"

# Сторож приёмника — до любых действий (тот же, что в model-migration-run.sh и env.mjs).
case "$(lc "$DST")" in system_aida_lore*) die "приёмник — рабочая база: $DST (нужен migration_dst*)" ;; esac
case "$(lc "$DST")" in migration_dst*) ;; *) die "приёмник должен называться migration_dst*: $DST" ;; esac

# Имя проекта compose — одно на всё: из .env установки (его же читают помощники install.sh: dcurl, сеть
# <проект>_default). Переменная окружения перекрыла бы .env для compose, но не для install.sh — так было на ryzenai
# 21.11: compose поднял lore-e2e, а install.sh ходил в lore_default. Поэтому имя из окружения кладётся в .env до
# install.sh, а все вызовы — без переменной.
PROJECT_WANT="${COMPOSE_PROJECT_NAME:-}"
compose() {
  local f=(-f "$DIR/docker-compose.yml"); [ -f "$DIR/docker-compose.e2e.yml" ] && f+=(-f "$DIR/docker-compose.e2e.yml")
  env -u COMPOSE_PROJECT_NAME docker compose --project-directory "$DIR" "${f[@]}" --env-file "$DIR/.env" "$@"
}
env_get() { [ -f "$2" ] && sed -n "s/^$1=//p" "$2" | tail -1; }
project() { local p; p="$(env_get COMPOSE_PROJECT_NAME "$DIR/.env")"; printf '%s' "${p:-lore}"; }
web() { if [ "$REACH" = network ]; then echo "http://lore-app-next:80"; else echo "http://$BIND:$PORT"; fi; }

plan() {
  echo "план трубы установщика, версия $V:"
  echo "  fetch    $BASE/$REPO/$V/ — пакет из lore-installer-publish.yml, сверка SHA256SUMS"
  echo "  install  lore-migrate install-bundle (пакет установки из бинаря, командный режим) → install.sh --selftest → install.sh --build-from-source --files none из src/lore-$V.tar.gz, вход выключен, без файлов, порт $BIND:$PORT"
  echo "  probe    свежая установка: /lore/version — версия пакета (коммит ${V##*.}); /lore/model, seed_drift=false; списки пусты честно (200, rows []); загрузка ассета — 503 «хранилище файлов не подключено»; schema_version — модель; organizations, repositories, project_prs — 200 и пусто"
  echo "  migrate  model-migration-run.sh STAGE=full: ${MIG_SRC_DB:-<MIG_SRC_DB>} → $DST в ArcadeDB установки, бинарь пакета, два прогона и отпечатки"
  echo "  pr-data  «Дотянуть данные PR» из git-хоста: пробный прогон lore-migrate pr-backfill --dry-run («без заголовка N, дотянулось бы M»); мост не настроен — пропуск с причиной"
  echo "  switch   LORE_DB=$DST, LORE_MIGRATE=false (база из модели 1.18), перезапуск lore-backend"
  echo "  probe    /lore/version, /lore/slice/open_tasks, /lore/slice/organizations и /lore/slice/repositories — не пусты"
}

# Строка отчёта: шаг и итог — в $WORK/report/summary.md (артефакт трубы).
note() { mkdir -p "$WORK/report"; echo "- $*" >> "$WORK/report/summary.md"; echo "$*"; }

fetch() {
  mkdir -p "$PKG"; cd "$PKG" || die "нет каталога $PKG"
  say "пакет $V из $BASE/$REPO"
  curl -fsS "$BASE/$REPO/$V/SHA256SUMS" -o SHA256SUMS || die "SHA256SUMS версии $V не читается из kkRepo — пакета нет или kkRepo недоступен"
  local n=0 name
  while read -r _ name; do
    [ -n "$name" ] || continue
    # Образы (images/) нужны только с Forgejo — труба ставит без него; их сумма не проверяется, раз файла нет.
    case "$name" in images/*) [ "${E2E_WITH_IMAGES:-0}" = 1 ] || continue ;; esac
    mkdir -p "$(dirname "$name")"
    curl -fsS "$BASE/$REPO/$V/$name" -o "$name" || die "файл пакета не скачан: $name"
    n=$((n + 1))
  done < SHA256SUMS
  # SPEC-LORE-INSTALLER-PIPELINE «Готово, когда»: намеренно сломанный пакет обязан дать красную трубу с причиной.
  if [ "${E2E_SABOTAGE:-none}" = sha256 ]; then
    echo "намеренная порча (E2E_SABOTAGE=sha256): дописываю байт в $(basename "$BIN") — сверка обязана упасть"
    printf 'x' >> "$BIN"
  fi
  sha256sum -c --ignore-missing --quiet SHA256SUMS || die "SHA256SUMS не сошлись — пакет повреждён или подменён, установки не будет"
  [ -f "$BIN" ] && [ -f "src/lore-$V.tar.gz" ] || die "в пакете нет $(basename "$BIN") или src/lore-$V.tar.gz"
  chmod +x "$BIN"
  note "пакет $V: SHA256SUMS сошлись, файлов сверено: $n"
}

install_() {
  [ -f "$PKG/src/lore-$V.tar.gz" ] || die "пакет не скачан — сначала fetch"
  # Исходники — только ради файла решений пакета (rules/decisions.lore.json) для переноса.
  mkdir -p "$TREE"; tar -xzf "$PKG/src/lore-$V.tar.gz" -C "$TREE" || die "архив исходников пакета не распаковался"
  # Пакет установки — из бинаря, командой (как кнопка «План установки» окна, но без окна). В архиве исходников
  # .env.example нет намеренно (сторож секретов), поэтому install.sh из архива не годится.
  local b="$WORK/bundle"
  "$BIN" install-bundle --out "$b" --force \
    || die "пакет установки не выложен командой install-bundle — в этой сборке пакета нет командного режима установки (появился в MIG-04 e2e); нужна новая сборка lore-installer-publish.yml"
  say "самопроверка установщика: install.sh --selftest"
  bash "$b/install.sh" --selftest >"$WORK/selftest.log" 2>&1 || { tail -20 "$WORK/selftest.log"; die "install.sh --selftest не прошёл — каркас установки сломан"; }
  if [ -n "$PROJECT_WANT" ] && [ ! -f "$DIR/.env" ]; then
    mkdir -p "$DIR"; (umask 077; cp "$b/.env.example" "$DIR/.env")
    sed -i "s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=$PROJECT_WANT/" "$DIR/.env"
    grep -q "^COMPOSE_PROJECT_NAME=$PROJECT_WANT$" "$DIR/.env" || echo "COMPOSE_PROJECT_NAME=$PROJECT_WANT" >> "$DIR/.env"
  fi
  say "установка с нуля: install.sh --build-from-source (вход выключен, без KC, Infisical и Forgejo), проект $(project)"
  LORE_SRC_ARCHIVE="$PKG/src/lore-$V.tar.gz" LORE_MIGRATE_BIN="$BIN" env -u COMPOSE_PROJECT_NAME bash "$b/install.sh" \
    --dir "$DIR" --port "$PORT" --bind "$BIND" --forgejo none --files none --build-from-source || die "install.sh упал"
  note "установка с нуля: install.sh прошёл (selftest — зелёный)"
  # Джоба в контейнере раннера: порты установки на 127.0.0.1 хоста ей не видны — подключаемся к сети compose и ходим
  # по именам сервисов (arcadedb, lore-app-next). Сеть — <проект>_default; проект — COMPOSE_PROJECT_NAME (по умолчанию lore).
  if [ "$REACH" = network ] && [ -f /.dockerenv ]; then
    docker network connect "$(project)_default" "$(hostname)" || die "джоба не подключилась к сети установки $(project)_default"
  fi
}

# get <путь> — тело ответа; код не 200 — пусто и ненулевой выход.
get() { curl -fsS -m 30 "$(web)$1"; }
wait_up() {
  local until=$(( $(date +%s) + WAIT_MIN * 60 ))
  while [ "$(date +%s)" -lt "$until" ]; do get /lore/version >/dev/null 2>&1 && return 0; sleep 10; done
  die "LORE не ответил на $(web)/lore/version за $WAIT_MIN мин — смотрите: docker compose logs lore-backend"
}
nonempty() { # nonempty <срез> — строк больше нуля, иначе причина словами
  local b; b="$(get "/lore/slice/$1?limit=5")" || die "срез $1 не отвечает (ответ не 200)"
  printf '%s' "$b" | grep -q '"rows":\[{' || die "срез $1 пуст: ${b:0:200}"
  echo "срез $1: строки есть"
}

probe_fresh() {
  wait_up
  local ver sha="${V##*.}"; ver="$(get /lore/version)"; echo "/lore/version: $ver"
  # Версия пакета 1.18.0-rc.<sha8> — LORE обязана быть собрана из того же коммита.
  case "$sha" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
    printf '%s' "$ver" | grep -q "\"commit\":\"$sha" || die "/lore/version не версия пакета: ждали коммит $sha, ответ $ver" ;;
  esac
  local m; m="$(get /lore/model)" || die "/lore/model не отвечает на свежей установке"
  printf '%s' "$m" | grep -q '"seed_drift":false' || die "/lore/model не модель пакета: seed_drift не false (${m:0:120}…)"
  # MIG-01: база свежей установки собрана из модели — schema_version модели, а не номер шага V.
  printf '%s' "$ver" | grep -q '"schema_version":"model:' || die "свежая установка: схема не из модели (schema_version не model:…): $ver"
  # Списки на пустой базе пусты честно: 200 и rows [] — и у типов 1.18 (KnowOrganization, KnowRepository, KnowPR).
  local s b; for s in open_tasks organizations repositories 'project_prs?project=e2e-probe&'; do
    case "$s" in *\?*) b="$(get "/lore/slice/${s}limit=1")" ;; *) b="$(get "/lore/slice/$s?limit=1")" ;; esac \
      || die "свежая установка: срез ${s%%\?*} не отвечает (ошибка, а не пусто)"
    printf '%s' "$b" | grep -q '"rows":\[\]' || die "свежая установка: срез ${s%%\?*} не пуст или не список: ${b:0:200}"
  done
  # Установка «без файлов» (решение владелицы 21.11.2026): загрузка ассета — 503 со словами, а не 500 и не тишина.
  local f code body; f="$(mktemp)"; printf '\x89PNG\r\n\x1a\nprobe' > "$f"
  code="$(curl -sS -m 30 -o "$f.out" -w '%{http_code}' -X POST -H 'X-Seer-Role: admin' \
    -F "file=@$f;type=image/png" -F entity_type=task -F entity_id=E2E-PROBE "$(web)/lore/asset/upload")" || true
  body="$(cat "$f.out" 2>/dev/null)"; rm -f "$f" "$f.out"
  [ "$code" = 503 ] && printf '%s' "$body" | grep -q 'FILES_NOT_CONFIGURED' && printf '%s' "$body" | grep -q 'хранилище файлов не подключено' \
    || die "без файлов: загрузка ассета ответила $code, а не 503 «хранилище файлов не подключено»: ${body:0:200}"
  note "свежая установка: /lore/version — коммит пакета, /lore/model — seed_drift=false, списки отвечают (пусто — честно), без файлов — 503 словами"
}

migrate() {
  [ -x "$BIN" ] || die "нет бинаря пакета — сначала fetch"
  if [ -n "${E2E_SRC_ENV:-}" ]; then
    [ -f "$E2E_SRC_ENV" ] || die "файла доступа источника нет: $E2E_SRC_ENV"
    MIG_DB_URL="${MIG_DB_URL:-$(env_get MIG_DB_URL "$E2E_SRC_ENV")}"
    MIG_DB_USER="$(env_get MIG_SRC_USER "$E2E_SRC_ENV")"; MIG_DB_PASSWORD="$(env_get MIG_SRC_PASSWORD "$E2E_SRC_ENV")"
  fi
  local dst_url
  if [ "$REACH" = network ]; then dst_url="http://arcadedb:2480"
  else
    printf 'services:\n  arcadedb:\n    ports:\n      - "%s:%s:2480"\n' "$BIND" "$DBPORT" > "$DIR/docker-compose.e2e.yml"
    compose up -d arcadedb >/dev/null || die "ArcadeDB установки не поднялась с портом $DBPORT"
    dst_url="http://$BIND:$DBPORT"
  fi
  # Пересозданная с портом ArcadeDB отвечает не сразу (ryzenai 21.11: connect получил ECONNRESET и приёмник не создался).
  local i; for i in $(seq 1 60); do
    curl -fsS -m 5 -o /dev/null "$dst_url/api/v1/ready" && break
    [ "$i" = 60 ] && die "ArcadeDB установки не ответила на $dst_url/api/v1/ready за 120 с"
    sleep 2
  done
  local dec="${E2E_DECISIONS:-$TREE/scripts/model-migration/rules/decisions.lore.json}"
  say "перенос: model-migration-run.sh STAGE=full, бинарь пакета, приёмник $DST на $dst_url"
  MIG_SRC_DB="${MIG_SRC_DB:-}" MIG_DST_DB="$DST" STAGE=full \
  MIG_DB_URL="${MIG_DB_URL:-}" MIG_DB_USER="${MIG_DB_USER:-}" MIG_DB_PASSWORD="${MIG_DB_PASSWORD:-}" \
  MIG_DST_URL="$dst_url" MIG_DST_USER=root MIG_DST_PASSWORD="$(env_get ARCADEDB_ROOT_PASSWORD "$DIR/.env")" \
  MIG_DECISIONS="$dec" MIG_NODE=env MIG_CLI="$BIN" MIG_REPORT_DIR="$WORK/report" \
    bash "$HERE/model-migration-run.sh" | tee "$WORK/migrate.log"
  [ "${PIPESTATUS[0]}" = 0 ] || die "перенос упал — отчёт в $WORK/report"
  note "перенос: $(grep -m1 'отпечатки двух прогонов совпали' "$WORK/migrate.log")"
}

switch() {
  local env="$DIR/.env"
  if grep -q '^LORE_DB=' "$env"; then sed -i "s/^LORE_DB=.*/LORE_DB=$DST/" "$env"; else echo "LORE_DB=$DST" >> "$env"; fi
  # База из модели 1.18: шаги V не катятся — иначе бэкенд честно откажет старт (ryzenai 21.11.2026).
  if grep -q '^LORE_MIGRATE=' "$env"; then sed -i "s/^LORE_MIGRATE=.*/LORE_MIGRATE=false/" "$env"; else echo "LORE_MIGRATE=false" >> "$env"; fi
  say "LORE_DB=$DST, LORE_MIGRATE=false (база из модели), перезапуск lore-backend"
  compose up -d --force-recreate lore-backend >/dev/null || die "lore-backend не перезапустился"
}

# «Дотянуть данные PR» (владелица 21.11: «ок и шагом» · «в инсталляции»). Команда появилась в 1.18.2 (#1730),
# поэтому заглушка снята. Прогон — ПРОБНЫЙ (--dry-run): труба меряет, сколько PR дотянулось бы, и ничего не пишет.
# Мост не настроен (у установки нет токена git-хоста) — это законный исход, а не падение: шаг говорит причину
# и идёт дальше. Непредвиденный отказ — красный.
pr_data() {
  [ -x "$BIN" ] || die "нет бинаря пакета — сначала fetch"
  wait_up
  local out="$WORK/report/pr-backfill.txt" rc=0
  mkdir -p "$WORK/report"
  LORE_TOKEN="${E2E_LORE_TOKEN:-}" "$BIN" pr-backfill --url "$(web)" --dry-run > "$out" 2>&1 || rc=$?
  if [ "$rc" = 0 ]; then
    note "pr-data: пробная дотяжка — $(grep -m1 '^PR:' "$out" || echo 'отчёт в report/pr-backfill.txt')"
    return 0
  fi
  if grep -q 'FORGEJO_NOT_CONFIGURED' "$out"; then
    note "pr-data: мост git-хоста в установке не настроен (FORGEJO_API_TOKEN не задан) — дотягивать неоткуда, пропущено"
    return 0
  fi
  cat "$out"
  die "pr-data: пробная дотяжка PR упала не по причине «мост не настроен» — отчёт в $out"
}

probe() {
  wait_up
  echo "/lore/version: $(get /lore/version)"
  nonempty open_tasks; nonempty organizations; nonempty repositories
  note "LORE на перенесённой базе $DST: срезы open_tasks, organizations, repositories не пусты"
}

down() {
  [ "${E2E_KEEP:-0}" = 1 ] && { echo "E2E_KEEP=1 — установка оставлена: $DIR"; return 0; }
  [ -f "$DIR/docker-compose.yml" ] && compose down -v --remove-orphans || true
}

case "$STAGE" in
  plan) plan ;;
  fetch) fetch ;;
  install) install_ ;;
  probe-fresh) probe_fresh ;;
  migrate) migrate ;;
  pr-data) pr_data ;;
  switch) switch ;;
  probe) probe ;;
  all) plan; fetch; install_; probe_fresh; migrate; switch; probe ;;
  down) down ;;
  *) die "шаг «$STAGE» неизвестен: plan | fetch | install | probe-fresh | migrate | pr-data | switch | probe | all | down" 2 ;;
esac
