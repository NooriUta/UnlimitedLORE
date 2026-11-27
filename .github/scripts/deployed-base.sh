#!/usr/bin/env bash
# Какой коммит РЕАЛЬНО работает на стенде — база сравнения для ci-scope.sh cd (DEPLOYED_BASE).
#
# Зачем: выкатка, упавшая или повисшая после сборки, но до подмены контейнера, не должна терять
# изменения. 27.11.2026: #1912 собрал бэкенд и повис на сборке v2; следующий пуш (#1915) сравнивал
# с головой #1912 и бэкенд не выкатил — стенд остался на старом бэкенде при зелёном CD.
#
# Источник — тег образа работающих контейнеров lore-backend и lore-app-next (…:<префикс>-<sha8>).
# Берётся СТАРШИЙ из двух (тот, что предок другого): дифф шире — лишняя сборка, а не потерянная правка.
# Ничего не нашлось (первая выкатка, тег без sha) — пусто: ci-scope.sh сравнит, как раньше, с прошлым пушем.
# Выход: строка DEPLOYED_BASE=<sha8|пусто> в stdout и в $GITHUB_ENV.
set -uo pipefail

sha_of() {
  local cid img
  cid=$(docker compose ps -q "$1" 2>/dev/null | head -1)
  [ -n "$cid" ] || return 0
  img=$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null) || return 0
  printf '%s' "$img" | grep -oE -- '-[0-9a-f]{7,40}$' | tr -d '-'
}

a=$(sha_of lore-backend)
b=$(sha_of lore-app-next)
base=""
if [ -n "$a" ] && [ -n "$b" ]; then
  if git merge-base --is-ancestor "$a" "$b" 2>/dev/null; then base="$a"
  elif git merge-base --is-ancestor "$b" "$a" 2>/dev/null; then base="$b"
  else base="$a"; fi
else
  base="${a:-$b}"
fi
echo "выкачено: lore-backend=${a:-?} lore-app-next=${b:-?} → база ${base:-нет (сравнение с прошлым пушем)}" >&2
echo "DEPLOYED_BASE=$base"
[ -n "${GITHUB_ENV:-}" ] && echo "DEPLOYED_BASE=$base" >> "$GITHUB_ENV"
exit 0
