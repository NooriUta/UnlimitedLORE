#!/usr/bin/env bash
# Готовый пакет установки — вложением к релизу Forgejo.
#
# Слово владелицы 22.11.2026: «мне нужна сборка инсталятор для друзей». Друг
# должен СКАЧАТЬ ОДИН ФАЙЛ со страницы релиза, а не клонировать репозиторий и
# собирать установщик сам. До этого шага пакет установки существовал только в
# двух местах: в дереве репозитория (deploy/install) и в kkRepo — внутренней
# сети, куда у друга доступа нет.
#
# Что кладётся (лёгкая часть — то, с чего начинается установка):
#   lore-installer-<тег>.tar.gz — install.sh, docker-compose.install.yml,
#                                 .env.example, README.md и lore-migrate.mjs;
#   SHA256SUMS                  — отдельным файлом рядом, как у выкладки в kkRepo.
#
# Исполняемый файл на 125 МБ в релиз НЕ кладётся по умолчанию: он собирается на
# месте из lore-migrate.mjs и Node, а в каждом релизе весил бы больше всего
# остального вместе взятого. Нужен — ручной запуск workflow с with_exe=true, и
# тогда он едет ОТДЕЛЬНЫМ вложением, а архив остаётся лёгким.
#
# Отказ здесь НЕ ОТМЕНЯЕТ РЕЛИЗ. Описание уже опубликовано, и «сборщик не
# поставился» — не повод прятать выпуск. Поэтому каждый сбой — ::warning:: с
# причиной, а общий ненулевой код ловит отдельный шаг «Вердикт вложений»
# (тот же приём, что у зеркала GitHub, SE-12).
#
# Почему отдельным файлом, а не `run:` в YAML: разбор многострочного bash у
# Forgejo уже дважды ломался (см. шапку resolve-proxy.sh), а так в workflow
# остаётся одна строка вызова. Заодно шаг проверяем тестами с подменёнными
# node/npm/curl — web-next/src/pipeline-host.test.ts.
#
# Вход (переменные окружения):
#   TAG         — тег релиза, напр. v1.18.2 (обязательно)
#   API         — база API репозитория, напр. http://forgejo:3000/api/v1/repos/AIDA/UnlimitedLORE
#   TOKEN       — токен Forgejo для загрузки вложений
#   WITH_EXE    — true: собрать и приложить исполняемый файл Linux x64 (по умолчанию false)
#   OUT         — каталог сборки (по умолчанию <репозиторий>/build)
#   CREATED_JSON / EXISTING_JSON — ответы шага Publish, откуда берётся id релиза
#
# Команды: build | pack | upload | all (по умолчанию all).
set -u

CMD="${1:-all}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAG="${TAG:-}"
OUT="${OUT:-$ROOT/build}"
WITH_EXE="${WITH_EXE:-false}"
TOOLS="${INSTALLER_TOOLS_DIR:-$ROOT/.installer-tools}"
SRC_DIR="$ROOT/deploy/install"
CREATED_JSON="${CREATED_JSON:-/tmp/created.json}"
EXISTING_JSON="${EXISTING_JSON:-/tmp/existing.json}"
# curl — переменной, а не просто из PATH: тесты подменяют его заглушкой, а на
# Windows подмена через PATH невозможна в принципе — Git Bash ставит свои
# /mingw64/bin:/usr/bin ПЕРЕД унаследованным PATH, и настоящий curl всегда
# находится первым. Тот же приём, что у PROBE_CURL в lore-host-deploy.sh.
CURL="${CURL_BIN:-curl}"

# Лёгкая часть пакета установки. Тот же перечень, что вшивает в установщик
# install-bundle-sync.mjs, плюс сам собранный lore-migrate.mjs.
BUNDLE_FILES=(install.sh docker-compose.install.yml .env.example README.md)
STAGE_NAME="lore-installer-$TAG"
ARCHIVE="$STAGE_NAME.tar.gz"
EXE_ASSET="lore-migrate-linux-x64"
ASSET_DIR="$OUT/asset"

warn() { echo "::warning::$*"; }
die()  { warn "$*"; exit 1; }

[ -n "$TAG" ] || die "пакет установки не собран: не задан TAG"

# ── сборщики ────────────────────────────────────────────────────────────────
# esbuild нужен build-installer.mjs всегда, postject — только для --exe. Берём
# из kkRepo (use-nexus.sh), как в lore-installer-publish.yml; зеркало недоступно —
# скрипт молча ничего не меняет и npm идёт напрямую.
need_tools() {
  local want=(esbuild)
  [ "$WITH_EXE" = true ] && want+=(postject)
  local missing=0
  for p in "${want[@]}"; do [ -d "$TOOLS/node_modules/$p" ] || missing=1; done
  if [ "$missing" = 0 ]; then
    echo "сборщики уже на месте: $TOOLS"
    return 0
  fi
  bash "$ROOT/.github/scripts/use-nexus.sh" >/dev/null 2>&1 || true
  local pkgs=(esbuild@0.28.1)
  [ "$WITH_EXE" = true ] && pkgs+=(postject@1.0.0-alpha.6)
  local i
  for i in 1 2 3; do
    npm install --no-save --no-audit --no-fund --prefix "$TOOLS" "${pkgs[@]}" && return 0
    echo "попытка $i установить сборщики не удалась"
  done
  return 1
}

cmd_build() {
  need_tools || die "сборщики установщика (esbuild, при with_exe — postject) не поставились — пакет установки к релизу $TAG не приложен"
  local args=(--out "$OUT")
  [ "$WITH_EXE" = true ] && args+=(--exe)
  ESBUILD_DIR="$TOOLS" POSTJECT_DIR="$TOOLS" \
    node "$ROOT/scripts/model-migration/build-installer.mjs" "${args[@]}" \
    || die "сборка lore-migrate не удалась — пакет установки к релизу $TAG не приложен"
}

# ── пакет ───────────────────────────────────────────────────────────────────
cmd_pack() {
  [ -f "$OUT/lore-migrate.mjs" ] || die "нет $OUT/lore-migrate.mjs — собирать нечего"
  rm -rf "$ASSET_DIR"
  mkdir -p "$ASSET_DIR/$STAGE_NAME" || die "каталог $ASSET_DIR не создан"
  local f
  for f in "${BUNDLE_FILES[@]}"; do
    [ -f "$SRC_DIR/$f" ] || die "в $SRC_DIR нет $f — пакет установки неполон"
    cp "$SRC_DIR/$f" "$ASSET_DIR/$STAGE_NAME/$f" || die "не скопирован $f"
  done
  cp "$OUT/lore-migrate.mjs" "$ASSET_DIR/$STAGE_NAME/lore-migrate.mjs" || die "не скопирован lore-migrate.mjs"
  # Права на install.sh: в архив он обязан попасть запускаемым — на Windows-
  # чекауте бит теряется, и `bash install.sh` у друга был бы единственным путём.
  chmod +x "$ASSET_DIR/$STAGE_NAME/install.sh" 2>/dev/null || true

  # Только относительные имена внутри каталога: абсолютный путь с двоеточием
  # (C:/… на машине разработчика) GNU tar читает как «хост:файл» и лезет в сеть.
  ( cd "$ASSET_DIR" && tar -czf "$ARCHIVE" "$STAGE_NAME" ) \
    || die "архив $ARCHIVE не собрался"
  rm -rf "${ASSET_DIR:?}/$STAGE_NAME"

  # Исполняемый файл — ОТДЕЛЬНЫМ вложением, не внутри архива: иначе лёгкий
  # пакет превращается в 125 МБ, которые почти никому не нужны.
  if [ "$WITH_EXE" = true ]; then
    [ -f "$OUT/lore-migrate" ] || die "нет $OUT/lore-migrate — исполняемый файл не собрался"
    cp "$OUT/lore-migrate" "$ASSET_DIR/$EXE_ASSET" || die "не скопирован исполняемый файл"
  fi

  # Формат — тот же, что у выкладки в kkRepo (sha256sums() в publish-plan.mjs):
  # «хэш», два пробела, имя файла. Считаем в двоичном режиме (архив — не текст),
  # а метку режима `*` приводим ко второму пробелу: на Linux двоичного маркера
  # нет, на MSYS он есть, и без нормализации формат зависел бы от машины.
  ( cd "$ASSET_DIR" && sha256sum -b ./* > SHA256SUMS.tmp 2>/dev/null \
      && sed 's#^\([0-9a-f]\{64\}\) [* ]\./#\1  #' SHA256SUMS.tmp > SHA256SUMS && rm -f SHA256SUMS.tmp ) \
    || die "SHA256SUMS не посчитан"
  echo "пакет установки собран:"
  ls -l "$ASSET_DIR"
}

# ── вложения релиза ─────────────────────────────────────────────────────────
# id релиза: ответ создания (Publish), иначе ответ по уже существующему релизу,
# иначе спрашиваем API по тегу. jq здесь намеренно не обязателен — шаг обязан
# работать и там, где его нет.
json_id() {
  grep -o '"id"[[:space:]]*:[[:space:]]*[0-9][0-9]*' "$1" 2>/dev/null | head -1 | grep -o '[0-9][0-9]*$'
}

release_id() {
  local f id
  for f in "$CREATED_JSON" "$EXISTING_JSON"; do
    [ -s "$f" ] || continue
    id="$(json_id "$f")"
    [ -n "$id" ] && { printf '%s' "$id"; return 0; }
  done
  local body="$OUT/release-by-tag.json" code
  code="$("$CURL" -s -o "$body" -w '%{http_code}' -H "Authorization: token ${TOKEN:-}" "$API/releases/tags/$TAG")"
  [ "$code" = "200" ] || return 1
  id="$(json_id "$body")"
  [ -n "$id" ] || return 1
  printf '%s' "$id"
}

# Повторный прогон (dispatch идемпотентен) не должен плодить одноимённые
# вложения: прежние с тем же именем снимаем. Без jq чистка пропускается — хуже
# будет дубль имени, а не отсутствие файла, и загрузку это не отменяет.
drop_same_name() {
  local id="$1" name="$2"
  command -v jq >/dev/null 2>&1 || return 0
  local list aid
  list="$("$CURL" -s -H "Authorization: token ${TOKEN:-}" "$API/releases/$id")" || return 0
  for aid in $(printf '%s' "$list" | jq -r --arg n "$name" '.assets[]? | select(.name==$n) | .id' 2>/dev/null); do
    "$CURL" -s -o /dev/null -X DELETE -H "Authorization: token ${TOKEN:-}" "$API/releases/$id/assets/$aid" \
      && echo "прежнее вложение $name (id $aid) снято"
  done
}

upload_one() {
  local id="$1" name="$2" path="$ASSET_DIR/$2" code resp="$OUT/asset-upload.json"
  [ -f "$path" ] || { warn "вложение $name не найдено в $ASSET_DIR"; return 1; }
  drop_same_name "$id" "$name"
  code="$("$CURL" -s -o "$resp" -w '%{http_code}' -X POST \
    -H "Authorization: token ${TOKEN:-}" \
    -F "attachment=@$path" \
    "$API/releases/$id/assets?name=$name")"
  case "$code" in
    200|201) echo "вложение $name загружено ($(wc -c < "$path") байт)"; return 0 ;;
  esac
  warn "загрузка вложения $name вернула HTTP $code"
  head -c 300 "$resp" 2>/dev/null
  echo
  return 1
}

cmd_upload() {
  local id
  id="$(release_id)" || die "id релиза $TAG не определён (ни ответ публикации, ни API по тегу) — вложения не загружены"
  echo "релиз $TAG — id $id"
  local names=("$ARCHIVE" SHA256SUMS)
  [ "$WITH_EXE" = true ] && names+=("$EXE_ASSET")
  local bad=0 n
  for n in "${names[@]}"; do
    upload_one "$id" "$n" || bad=1
  done
  [ "$bad" = 0 ] || die "вложения релиза $TAG загружены не полностью — скачать готовый пакет нельзя. Перезапустите lore-release.yml с tag=$TAG (шаг идемпотентен)"
  echo "готовый пакет установки приложен к релизу $TAG"
}

case "$CMD" in
  build)  cmd_build ;;
  pack)   cmd_pack ;;
  upload) cmd_upload ;;
  all)    cmd_build && cmd_pack && cmd_upload ;;
  *)      die "неизвестная команда: $CMD (build|pack|upload|all)" ;;
esac
