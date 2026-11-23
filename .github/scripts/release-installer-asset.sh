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
# Исходники LORE (нужны для --build-from-source) и образ сервера miniLORE (нужен для --minilore install)
# едут ОТДЕЛЬНЫМИ вложениями: класть их в архив значит превратить лёгкий пакет в 300 МБ, а не класть вовсе —
# обещать в README то, чего в релизе нет (разбор документации 22.11.2026).
WITH_SOURCES="${WITH_SOURCES:-true}"
WITH_MINILORE_IMAGE="${WITH_MINILORE_IMAGE:-false}"
# Мастер переноса lore-migrate.mjs ОТДЕЛЬНЫМ вложением (слово владельца 23.11.2026: «и дистрибутив миграции нужно
# положить тоже»): внутри архива он был, а со страницы выпуска его отдельно не скачать.
WITH_MIGRATE="${WITH_MIGRATE:-false}"
TOOLS="${INSTALLER_TOOLS_DIR:-$ROOT/.installer-tools}"
SRC_DIR="$ROOT/deploy/install"
CREATED_JSON="${CREATED_JSON:-/tmp/created.json}"
EXISTING_JSON="${EXISTING_JSON:-/tmp/existing.json}"
# curl — переменной, а не просто из PATH: тесты подменяют его заглушкой, а на
# Windows подмена через PATH невозможна в принципе — Git Bash ставит свои
# /mingw64/bin:/usr/bin ПЕРЕД унаследованным PATH, и настоящий curl всегда
# находится первым. Тот же приём, что у PROBE_CURL в lore-host-deploy.sh.
CURL="${CURL_BIN:-curl}"
# zip — тоже переменной, и по той же причине: тесты подменяют его заглушкой, а на Windows подмена через PATH
# невозможна. На машине разработчика zip может отсутствовать вовсе — тогда шаг честно предупреждает.
ZIP="${ZIP_BIN:-zip}"

# Лёгкая часть пакета установки. Тот же перечень, что вшивает в установщик
# install-bundle-sync.mjs, плюс сам собранный lore-migrate.mjs.
BUNDLE_FILES=(install.sh install.ps1 docker-compose.install.yml .env.example README.md)
STAGE_NAME="lore-installer-$TAG"
ARCHIVE="$STAGE_NAME.tar.gz"
# Слово владелицы 22.11.2026: «собирай установщик под windows и linux». Содержимое у архивов ОДНО — пакет
# один и тот же (compose без привязок к путям хоста), разный только вход: install.sh под Linux, install.ps1
# под Windows (он запускает тот же install.sh через WSL или bash из Git). Форма разная потому, что tar.gz на
# Windows без лишних программ не распаковать, а права на install.sh в zip не выживают.
WIN_ARCHIVE="$STAGE_NAME-windows.zip"
EXE_ASSET="lore-migrate-linux-x64"
SRC_ASSET="lore-src-$TAG.tar.gz"
MIGRATE_ASSET="lore-migrate-$TAG.mjs"
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

  # Второй архив — тот же каталог в zip, для Windows. Инструмент берём какой есть: zip на раннере обычно
  # стоит, python как запасной. Нет ни одного — говорим вслух и не приложим ZIP, но tar.gz уже собран,
  # поэтому выпуск не рушим: под Linux пакет полон.
  if command -v "$ZIP" >/dev/null 2>&1; then
    ( cd "$ASSET_DIR" && "$ZIP" -qr "$WIN_ARCHIVE" "$STAGE_NAME" ) || warn "ZIP $WIN_ARCHIVE не собрался (zip)"
  elif command -v python3 >/dev/null 2>&1; then
    ( cd "$ASSET_DIR" && python3 -m zipfile -c "$WIN_ARCHIVE" "$STAGE_NAME" ) \
      || warn "ZIP $WIN_ARCHIVE не собрался (python3)"
  else
    warn "ни zip, ни python3 — вложение для Windows ($WIN_ARCHIVE) не собрано; tar.gz на месте"
  fi

  rm -rf "${ASSET_DIR:?}/$STAGE_NAME"

  # Исполняемый файл — ОТДЕЛЬНЫМ вложением, не внутри архива: иначе лёгкий
  # пакет превращается в 125 МБ, которые почти никому не нужны.
  if [ "$WITH_EXE" = true ]; then
    [ -f "$OUT/lore-migrate" ] || die "нет $OUT/lore-migrate — исполняемый файл не собрался"
    cp "$OUT/lore-migrate" "$ASSET_DIR/$EXE_ASSET" || die "не скопирован исполняемый файл"
  fi

  # Мастер переноса (любая ОС, Node 20+) — отдельным вложением с подписью в SHA256SUMS.
  if [ "$WITH_MIGRATE" = true ]; then
    cp "$OUT/lore-migrate.mjs" "$ASSET_DIR/$MIGRATE_ASSET" || die "не скопирован мастер переноса $MIGRATE_ASSET"
  fi

  # Исходники LORE — для install.sh --build-from-source. Без них у получателя остаётся только путь
  # «готовые образы из реестра», а README обещает оба (разбор документации 22.11.2026: обещал и не прикладывал).
  if [ "$WITH_SOURCES" = true ]; then
    if node "$ROOT/scripts/model-migration/source-archive.mjs" --out "$OUT" --version "$TAG"; then
      local src
      src="$(ls "$OUT"/src/lore-*.tar.gz 2>/dev/null | head -1)"
      if [ -n "$src" ] && [ -f "$src" ]; then
        cp "$src" "$ASSET_DIR/$SRC_ASSET" || warn "исходники не скопированы в каталог вложений"
      else
        warn "исходники LORE не собрались — вложение $SRC_ASSET не поедет; установка из готовых образов остаётся"
      fi
    else
      warn "source-archive.mjs не отработал — исходники к релизу $TAG не приложены"
    fi
  fi

  # Образ сервера miniLORE — только по просьбе: ~150 МБ, и нужен лишь тем, кто ставит --minilore install.
  # Из сети он не тянется: адресов наших реестров в пакете нет (сторож noBakedHosts), поэтому либо вложение,
  # либо свой MINILORE_IMAGE у получателя.
  if [ "$WITH_MINILORE_IMAGE" = true ]; then
    if node "$ROOT/scripts/model-migration/minilore-image.mjs" --out "$OUT"; then
      local img
      img="$(ls "$OUT"/images/minilore-srv-*.tar 2>/dev/null | head -1)"
      if [ -n "$img" ] && [ -f "$img" ]; then
        cp "$img" "$ASSET_DIR/$(basename "$img")" || warn "образ miniLORE не скопирован в каталог вложений"
      else
        warn "образ miniLORE не собрался — вложение не поедет; установка с --minilore install у получателя не пройдёт"
      fi
    else
      warn "minilore-image.mjs не отработал (нет MINILORE_SOURCE_IMAGE?) — образ к релизу $TAG не приложен"
    fi
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
  # Архив для Windows — если собрался. Его отсутствие уже сказано вслух на упаковке; тут не повторяем
  # и не рушим выпуск: под Linux пакет полон, а под Windows человек возьмёт tar.gz и распакует сам.
  [ -f "$ASSET_DIR/$WIN_ARCHIVE" ] && names+=("$WIN_ARCHIVE")
  [ "$WITH_EXE" = true ] && names+=("$EXE_ASSET")
  [ "$WITH_MIGRATE" = true ] && names+=("$MIGRATE_ASSET")
  # Исходники и образ — вложениями, если их положил шаг сборки. Нет файла — не беда: загрузка пропускает
  # отсутствующее молча здесь и громко в upload_one, а релиз из-за необязательного файла не краснеет.
  [ -f "$ASSET_DIR/$SRC_ASSET" ] && names+=("$SRC_ASSET")
  local mimg
  mimg="$(ls "$ASSET_DIR"/minilore-srv-*.tar 2>/dev/null | head -1)"
  [ -n "$mimg" ] && names+=("$(basename "$mimg")")
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
