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
# 06.11.2026: разрез переписан с awk на perl -CSD. В образе раннера awk — это
# mawk, его length() считает БАЙТЫ, а gawk есть только на машине разработчика:
# самопроверка проходила локально и падала в CI. Найдено сессией Völva при
# порте скрипта; воспроизведено на ci-server (mawk 1.3.4: «три абзаца не в два
# куска», «разрез не по абзацу», выход 1).
#
#   tg-split.sh <file> <outdir> [limit]  — пишет outdir/part-001.txt …, печатает число кусков
#   tg-split.sh --selftest
set -uo pipefail
export LC_ALL=C.UTF-8

split_file() { # split_file <file> <outdir> <limit>
  local file="$1" out="$2" limit="$3"
  mkdir -p "$out"; rm -f "$out"/part-*.txt
  LIMIT="$limit" OUT="$out" perl -CSD -e '
    use strict; use warnings;
    my ($limit, $out) = ($ENV{LIMIT}, $ENV{OUT});
    utf8::decode($out);                       # %ENV приходит байтами, -CSD декодирует только потоки
    local $/; my $text = <STDIN>; $text = "" unless defined $text;
    $text =~ s/\A\n+//; $text =~ s/\n+\z//;   # как RS="" у awk: пустые строки по краям не абзац
    my ($n, $buf) = (0, "");
    my $flush = sub {
      return if $buf eq "";
      $n++;
      my $f = sprintf("%s/part-%03d.txt", $out, $n);
      open(my $fh, ">:encoding(UTF-8)", $f) or die "не открыть $f\n";
      print $fh $buf; close $fh; $buf = "";
    };
    my $add = sub {
      my ($piece, $sep) = @_;
      my $cand = $buf eq "" ? $piece : $buf . $sep . $piece;
      if (length($cand) <= $limit) { $buf = $cand; return }
      $flush->();
      while (length($piece) > $limit) { $buf = substr($piece, 0, $limit); $flush->(); $piece = substr($piece, $limit) }
      $buf = $piece;
    };
    for my $para (split /\n{2,}/, $text) {
      if (length($para) <= $limit) { $add->($para, "\n\n"); next }
      my $first = 1;
      for my $line (split /\n/, $para) { $add->($line, $first ? "\n\n" : "\n"); $first = 0 }
    }
    $flush->();
    print "$n\n";
  ' < "$file"
}

selftest() {
  local d; d=$(mktemp -d); local fail=0
  # 1) короткий текст — один кусок, без изменений
  printf 'Заголовок\n\nабзац' > "$d/a.md"
  [ "$(split_file "$d/a.md" "$d/a" 100)" = 1 ] || { echo "FAIL: короткий не одним куском"; fail=1; }
  [ "$(cat "$d/a/part-001.txt")" = "$(printf 'Заголовок\n\nабзац')" ] || { echo "FAIL: короткий изменён"; fail=1; }
  # 2) три абзаца по 40 символов при лимите 90 — два куска, разрез по абзацу
  #    (кириллица: в байтах абзац 80, и счёт байтами дал бы три куска — так ловится mawk)
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
