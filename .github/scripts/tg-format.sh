#!/usr/bin/env bash
# Привести markdown заметок релиза к виду, который Telegram показывает как текст.
#
# Владелица 05.11.2026: «не проходит твое форматирование в telegram читать
# больно». sendMessage уходил без parse_mode, и Telegram печатал разметку как
# есть: «## Время в базе», «**Миграция V56**», `limit`/`offset` в обратных
# кавычках, «- » вместо пунктов.
#
#   tg-format.sh html  < in > out  — Telegram HTML (parse_mode=HTML): <b>, <code>, <a>, «•»
#   tg-format.sh plain < in > out  — та же структура без разметки (запасной путь,
#                                    если Telegram отверг HTML)
#   tg-format.sh --selftest
#
# Режется ДО форматирования (tg-split.sh по абзацам), поэтому теги каждого
# куска закрыты внутри строки и куски форматируются независимо.
set -uo pipefail
export LC_ALL=C.UTF-8

fmt() { # fmt html|plain
  MODE="$1" perl -CSD -pe '
    BEGIN { $m = $ENV{MODE} }
    s/&/&amp;/g; s/</&lt;/g; s/>/&gt;/g;
    if (/^#{1,6}\s+(.*)$/) {                     # заголовок — жирная строка
      my $h = $1; $h =~ s/\*\*//g;
      $_ = ($m eq "html" ? "<b>$h</b>" : $h) . "\n";
    }
    s/^(\s*)[-*]\s+/$1\x{2022} /;                # пункт списка «•» (кодом: литерал без use utf8 бьётся)
    if ($m eq "html") {
      s/`([^`]+)`/<code>$1<\/code>/g;
      s/\*\*([^*]+)\*\*/<b>$1<\/b>/g;
      s/\[([^\]]+)\]\(([^)\s]+)\)/<a href="$2">$1<\/a>/g;
    } else {
      s/`([^`]+)`/$1/g;
      s/\*\*([^*]+)\*\*/$1/g;
      s/\[([^\]]+)\]\(([^)\s]+)\)/$1 ($2)/g;
      s/&lt;/</g; s/&gt;/>/g; s/&amp;/&/g;     # plain не экранируется
    }
  '
}

selftest() {
  local fail=0
  t() { # t <mode> <in> <expected>
    local got; got=$(printf '%s' "$2" | fmt "$1")
    [ "$got" = "$3" ] || { echo "FAIL [$1] «$2» → «$got», ждали «$3»"; fail=1; }
  }
  t html '## Время в базе' '<b>Время в базе</b>'
  t html '# v1.15.0 — **жирно**' '<b>v1.15.0 — жирно</b>'
  t html 'a **b** c' 'a <b>b</b> c'
  t html 'слайсы `limit`/`offset`' 'слайсы <code>limit</code>/<code>offset</code>'
  t html '`x<y` & z' '<code>x&lt;y</code> &amp; z'
  t html '- **Миграция V56** (#769): да' '• <b>Миграция V56</b> (#769): да'
  t html '  - вложенный' '  • вложенный'
  t html 'см. [релиз](https://x.y/r?a=1)' 'см. <a href="https://x.y/r?a=1">релиз</a>'
  t html 'обычная строка' 'обычная строка'
  t plain '## Время в базе' 'Время в базе'
  t plain '- **V56** `x<y` & z' '• V56 x<y & z'
  t plain 'см. [релиз](https://x.y/r)' 'см. релиз (https://x.y/r)'
  [ $fail = 0 ] && echo "tg-format selftest: OK"
  return $fail
}

case "${1:-}" in
  --selftest) selftest ;;
  html|plain) fmt "$1" ;;
  *) echo "usage: tg-format.sh html|plain < in > out | --selftest" >&2; exit 2 ;;
esac
