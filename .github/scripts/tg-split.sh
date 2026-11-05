#!/usr/bin/env bash
# Разрезать текст на куски для Telegram sendMessage (лимит 4096 СИМВОЛОВ).
#
# Владелец 04.11.2026: «хочу, чтобы релиз выдавал весь release notes, без run,
# со всеми фичами». До этого lore-release.yml резал тело на 3600 байт с пометкой
# «обрезано» — список изменений терялся там, куда с телефона не заглядывают.
#
# Режем по абзацам (пустая строка), чтобы не рвать фразу и markdown-список;
# абзац длиннее лимита — по строкам; строка длиннее лимита — по символам.
# Меряем символы, а не байты: кириллица — 2 байта на символ.
#
#   tg-split.sh <file> <outdir> [limit]  — пишет outdir/part-001.txt …, печатает число кусков
#   tg-split.sh --selftest
set -uo pipefail
export LC_ALL=C.UTF-8

split_file() { # split_file <file> <outdir> <limit>
  local file="$1" out="$2" limit="$3"
  mkdir -p "$out"; rm -f "$out"/part-*.txt
  awk -v limit="$limit" -v out="$out" '
    function flush() { if (buf != "") { n++; f = sprintf("%s/part-%03d.txt", out, n); printf "%s", buf > f; close(f); buf = "" } }
    function add(piece, sep,   cand) {
      cand = (buf == "" ? piece : buf sep piece)
      if (length(cand) <= limit) { buf = cand; return }
      flush()
      while (length(piece) > limit) { buf = substr(piece, 1, limit); flush(); piece = substr(piece, limit + 1) }
      buf = piece
    }
    BEGIN { RS = ""; FS = "\n"; n = 0; buf = "" }
    {
      if (length($0) <= limit) { add($0, "\n\n"); next }
      first = 1
      for (i = 1; i <= NF; i++) { add($i, first ? "\n\n" : "\n"); first = 0 }
    }
    END { flush(); print n }
  ' "$file"
}

selftest() {
  local d; d=$(mktemp -d); local fail=0
  # 1) короткий текст — один кусок, без изменений
  printf 'Заголовок\n\nабзац' > "$d/a.md"
  [ "$(split_file "$d/a.md" "$d/a" 100)" = 1 ] || { echo "FAIL: короткий не одним куском"; fail=1; }
  [ "$(cat "$d/a/part-001.txt")" = "$(printf 'Заголовок\n\nабзац')" ] || { echo "FAIL: короткий изменён"; fail=1; }
  # 2) три абзаца по 40 символов при лимите 90 — два куска, разрез по абзацу
  local p; p=$(printf 'ж%.0s' $(seq 1 40))
  printf '%s\n\n%s\n\n%s' "$p" "$p" "$p" > "$d/b.md"
  [ "$(split_file "$d/b.md" "$d/b" 90)" = 2 ] || { echo "FAIL: три абзаца не в два куска"; fail=1; }
  [ "$(cat "$d/b/part-001.txt")" = "$(printf '%s\n\n%s' "$p" "$p")" ] || { echo "FAIL: разрез не по абзацу"; fail=1; }
  # 3) ни один кусок не длиннее лимита в СИМВОЛАХ, и ничего не потеряно
  local long; long=$(for i in $(seq 1 30); do printf -- '- пункт %02d про изменение в релизе\n' "$i"; done)
  printf '# v9\n\n%s\n\n%s' "$long" "$long" > "$d/c.md"
  split_file "$d/c.md" "$d/c" 300 >/dev/null
  for f in "$d"/c/part-*.txt; do [ "$(wc -m < "$f")" -le 300 ] || { echo "FAIL: $f длиннее 300 символов"; fail=1; }; done
  [ "$(cat "$d"/c/part-*.txt | tr -d '\n' | wc -m)" = "$(tr -d '\n' < "$d/c.md" | wc -m)" ] || { echo "FAIL: текст потерян при разрезе"; fail=1; }
  rm -rf "$d"
  [ $fail = 0 ] && echo "tg-split selftest: OK"
  return $fail
}

case "${1:-}" in
  --selftest) selftest ;;
  "") echo "usage: tg-split.sh <file> <outdir> [limit] | --selftest" >&2; exit 2 ;;
  *) split_file "$1" "$2" "${3:-3800}" ;;
esac
