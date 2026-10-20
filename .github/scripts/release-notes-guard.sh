#!/usr/bin/env bash
# SE-12: сторож «тег без заметок». Отказывает ДО необратимого шага.
#
# ЗАЧЕМ. Публикация релиза (`lore-release.yml`) берёт тело из RELEASE-<tag>.md
# и срабатывает на PUSH ТЕГА. Нет файла — шаг падает, но тег УЖЕ стоит и назад
# не снимается, а выпускающий в этот момент считает дело сделанным и в лог не
# смотрит. Так ушёл v1.10.0: прогон 14749 от 31.08.2026 красный, релиза в
# Forgejo не было двенадцать дней, заметки жили только в записи LORE.
#
# Отказ после необратимого шага — не «неудобство», а дефект порядка: проверка
# стоит копейки и возможна РАНЬШЕ, пока всё ещё обратимо. Этот скрипт её и
# делает — и сам умеет краснеть (--selftest), потому что сторож, не умеющий
# покраснеть, неотличим от декорации.
#
# ПРИМЕНЕНИЕ
#   release-notes-guard.sh <tag> [git-ref]   проверить, что файл есть в ref
#   release-notes-guard.sh --selftest        проверить сам сторож
#
# <tag> — например v1.11.3. [git-ref] по умолчанию HEAD; для релиза это ровно
# тот коммит, на который ляжет тег (обычно origin/main после слияния preprod).
set -uo pipefail

usage() {
  cat >&2 <<'USAGE'
release-notes-guard.sh <tag> [git-ref]   — отказ, если в ref нет RELEASE-<tag>.md
release-notes-guard.sh --selftest        — самопроверка сторожа
USAGE
}

# Единственная проверка, ради которой всё: есть ли файл заметок В ТОМ КОММИТЕ,
# на который ляжет тег. Не «в рабочем дереве» и не «в develop» — публикация
# читает чекаут тега, и только он имеет значение.
notes_present() { # notes_present <tag> <ref>
  git ls-tree --name-only "$2" -- "RELEASE-$1.md" 2>/dev/null | grep -q .
}

guard() { # guard <tag> <ref>
  local tag="$1" ref="$2"
  case "$tag" in
    v*) : ;;
    *)  echo "::error::тег '$tag' не похож на версию (ожидается vX.Y.Z) — проверять нечего, и это само по себе повод остановиться"; return 2 ;;
  esac

  if notes_present "$tag" "$ref"; then
    echo "RELEASE-$tag.md есть в $ref — тег ставить можно"
    return 0
  fi

  cat >&2 <<EOF
::error::в $ref НЕТ RELEASE-$tag.md — тег $tag ставить нельзя.
::error::Публикация падает уже ПОСЛЕ простановки тега, а тег назад не снимается:
::error::так релиз v1.10.0 двенадцать дней не существовал в Forgejo при живом теге.
::error::Порядок: дописать RELEASE-$tag.md в develop → промо в preprod → слияние в main → и только потом тег.
EOF
  return 1
}

# --- самопроверка ------------------------------------------------------------
#
# Положительный и отрицательный контроль рядом, на одноразовом репозитории:
# без отрицательного «сторож зелёный» означало бы лишь, что он ничего не смотрит.
selftest() {
  local tmp rc=0
  tmp="$(mktemp -d)"
  (
    cd "$tmp" || exit 1
    git init -q .
    git config user.email guard@local; git config user.name guard
    echo "# v9.9.9" > RELEASE-v9.9.9.md
    git add -A; git commit -qm "notes only"
  ) || { echo "::error::самопроверке не удалось собрать временный репозиторий"; rm -rf "$tmp"; return 1; }

  if ( cd "$tmp" && guard "v9.9.9" HEAD >/dev/null 2>&1 ); then
    echo "selftest.present PASS — при наличии файла сторож пропускает"
  else
    echo "::error::selftest.present FAIL — сторож не пропускает при НАЛИЧИИ файла, он сломан"; rc=1
  fi

  if ( cd "$tmp" && guard "v8.8.8" HEAD >/dev/null 2>&1 ); then
    echo "::error::selftest.missing FAIL — сторож пропустил тег БЕЗ файла заметок, то есть не сторожит"; rc=1
  else
    echo "selftest.missing PASS — при отсутствии файла сторож отказывает"
  fi

  if ( cd "$tmp" && guard "release-candidate" HEAD >/dev/null 2>&1 ); then
    echo "::error::selftest.badtag FAIL — сторож принял имя, не похожее на версию"; rc=1
  else
    echo "selftest.badtag PASS — имя не похожее на версию отбито"
  fi

  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "самопроверка сторожа: в порядке"
  return "$rc"
}

case "${1:-}" in
  --selftest) selftest ;;
  -h|--help|"") usage; exit 2 ;;
  *) guard "$1" "${2:-HEAD}" ;;
esac
