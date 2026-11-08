#!/usr/bin/env bash
# Образы, РАБОТАЮЩИЕ на препроде: коммит сборки и пометка тегом :sha8 —
# SPRINT_LORE_PIPELINE_HOST/PL-04 → PL-05.
#
#   preprod-pin-sha.sh revision — только чтение: коммит СБОРКИ бэкенда из метки
#                                 org.opencontainers.image.revision (оверлей
#                                 docker-compose.preprod.yml) → backend_revision.
#                                 Его ждёт проба /lore/version и здесь, и на
#                                 проде: у перетегированного образа commit ≠ sha
#                                 пуша (ловушка из PL-08).
#   preprod-pin-sha.sh tag      — ПОСЛЕ всех проб: тег unlimitedlore-<сервис>:<sha8>
#                                 на образ каждого работающего контейнера.
#
# Зачем тег ставится на РАБОТАЮЩЕЕ, а не на собранное. Релиз (lore-release.yml)
# везёт на прод ровно то, что прошло препрод, и ищет это по :sha8. Но CD
# пересобирает только затронутые сервисы (ci-scope.sh cd), а v1 заморожен — после
# пуша на препроде работают образы РАЗНЫХ сборок. Поэтому тег получает то, что
# фактически работает в проекте после выкатки: собранное и не тронутое вместе.
# Ставится последним, после проб: образ, не прошедший пробы, тега :sha8 не
# получает и релизом найден не будет.
#
# Выход ($GITHUB_OUTPUT): backend_revision (revision), tag (tag).
set -uo pipefail

MODE="${1:-}"
case "$MODE" in revision|tag) ;; *) echo "::error::preprod-pin-sha.sh: режим revision | tag, а не '$MODE'"; exit 2 ;; esac
TAG="${LORE_SHA8:-}"
[ -n "$TAG" ] || { echo "::error::LORE_SHA8 не задан — тег релиза (первые 8 знаков коммита)"; exit 2; }

out() { echo "$1=$2"; [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT"; return 0; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }
revision_of() {
  local r
  r="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null)"
  [ "$r" = "<no value>" ] && r=""
  printf '%s' "$r"
}

if [ "$MODE" = revision ]; then
  cid="$(docker compose ps -q lore-backend 2>/dev/null | head -1)"
  [ -n "$cid" ] || { echo "::error::бэкенд препрода не запущен — коммит сборки не прочитать"; exit 1; }
  rev="$(revision_of "$(docker inspect -f '{{.Image}}' "$cid")")"
  if [ -z "$rev" ]; then
    echo "::warning::у образа бэкенда препрода нет метки revision (собран до PL-04): проба /lore/version проверит только живость, а релиз этого коммита упадёт на resolve. Пересоберите бэкенд: LORE CD, service=backend."
  else
    echo "бэкенд препрода собран из $rev"
  fi
  out backend_revision "$rev"
  exit 0
fi

rc=0
for svc in lore-backend lore-app lore-app-next; do
  cid="$(docker compose ps -q "$svc" 2>/dev/null | head -1)"
  if [ -z "$cid" ]; then
    echo "::error::на препроде не работает $svc — пометить нечем, релиз этого коммита не найдёт образ"
    rc=1; continue
  fi
  img="$(docker inspect -f '{{.Image}}' "$cid")"
  name="unlimitedlore-$svc:$TAG"
  if ! docker tag "$img" "$name"; then
    echo "::error::не удалось поставить $name на $img"; rc=1; continue
  fi
  rev="$(revision_of "$img")"
  echo "$name → $img (сборка ${rev:-<без метки revision>})"
  summary "- \`$name\` → \`$img\` (сборка ${rev:-без метки})"
done
out tag "$TAG"
exit "$rc"
