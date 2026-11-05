#!/usr/bin/env bash
# RELEASE-<tag>.md → самодостаточная HTML-страница (светлая тема Seiðr) для
# вложения в Telegram.
#
# Владелица 05.11.2026: «в телеграм создавать вот такие HTML и писать кратко
# выложено ссылка и аттачем полноценное описание». Сообщение — коротко, полный
# текст — файлом: в Telegram длинные заметки резались на куски и читались плохо.
#
#   release-html.sh <RELEASE-tag.md> <out.html> <tag> [forgejo-url] [github-url]
#   release-html.sh --selftest
#
# Поддерживаемый markdown — тот, что пишется в заметках: # ## ### заголовки,
# «- » и «  - » списки, **жирный**, `код`, [текст](url), абзацы, таблицы | a | b |.
set -uo pipefail
export LC_ALL=C.UTF-8

render() { # render <md> <out> <tag> <fg> <gh>
  MD="$1" TAG="$3" FG="${4:-}" GH="${5:-}" perl -CSD -Mutf8 -e '
    use strict; use warnings;
    open(my $fh, "<:encoding(UTF-8)", $ENV{MD}) or die "нет файла $ENV{MD}\n";
    my @lines = <$fh>; close $fh; chomp @lines;
    sub esc { my $s = shift; $s =~ s/&/&amp;/g; $s =~ s/</&lt;/g; $s =~ s/>/&gt;/g; $s =~ s/"/&quot;/g; $s }
    sub inl {
      my $s = esc(shift);
      $s =~ s/`([^`]+)`/<code>$1<\/code>/g;
      $s =~ s/\*\*([^*]+)\*\*/<b>$1<\/b>/g;
      $s =~ s/\[([^\]]+)\]\(([^)\s]+)\)/<a href="$2">$1<\/a>/g;
      $s
    }
    my ($title, @body, @para, $list, $sub, @tbl) = ("");
    my $flush_para = sub { if (@para) { push @body, "<p>" . inl(join(" ", @para)) . "</p>"; @para = () } };
    my $close_list = sub {
      if ($sub)  { push @body, "</ul></li>"; $sub = 0 }
      if ($list) { push @body, "</ul>"; $list = 0 }
    };
    my $flush_tbl = sub {
      return unless @tbl;
      my @rows = grep { $_ !~ /^\s*\|?\s*:?-{2,}/ } @tbl;
      my $h = shift @rows;
      my $cells = sub { my $r = shift; $r =~ s/^\s*\|//; $r =~ s/\|\s*$//; map { inl(s/^\s+|\s+$//gr) } split /\|/, $r };
      push @body, "<table><tr>" . join("", map { "<th>$_</th>" } $cells->($h)) . "</tr>"
        . join("", map { my $r = $_; "<tr>" . join("", map { "<td>$_</td>" } $cells->($r)) . "</tr>" } @rows) . "</table>";
      @tbl = ();
    };
    for my $l (@lines) {
      if ($l =~ /^\s*\|.*\|\s*$/) { $flush_para->(); $close_list->(); push @tbl, $l; next }
      $flush_tbl->();
      if ($l =~ /^(#{1,3})\s+(.*)$/) {
        $flush_para->(); $close_list->();
        my ($n, $t) = (length $1, $2);
        if ($n == 1 && $title eq "") { $title = $t; next }
        my $h = $n == 1 ? 2 : $n;   # первый «#» — заголовок страницы, «##» — раздел
        push @body, "<h$h>" . inl($t) . "</h$h>"; next;
      }
      if ($l =~ /^(\s{2,})[-*]\s+(.*)$/ && $list) {
        if (!$sub) { $body[-1] =~ s/<\/li>$//; push @body, "<ul>"; $sub = 1 }
        push @body, "<li>" . inl($2) . "</li>"; next;
      }
      if ($l =~ /^[-*]\s+(.*)$/) {
        $flush_para->();
        if ($sub) { push @body, "</ul></li>"; $sub = 0 }
        if (!$list) { push @body, "<ul>"; $list = 1 }
        push @body, "<li>" . inl($1) . "</li>"; next;
      }
      if ($l =~ /^\s*$/) { $flush_para->(); $close_list->(); next }
      if ($list && $l =~ /^\s+(\S.*)$/) { my $x = inl($1); $body[-1] =~ s/<\/li>$/ $x<\/li>/; next }  # перенос пункта
      $close_list->(); push @para, $l;
    }
    $flush_para->(); $close_list->(); $flush_tbl->();
    my ($tag, $fg, $gh) = ($ENV{TAG}, $ENV{FG}, $ENV{GH});
    my $links = join(" · ", grep { $_ } ($fg ? "<a href=\"" . esc($fg) . "\">Forgejo</a>" : ""), ($gh ? "<a href=\"" . esc($gh) . "\">GitHub</a>" : ""));
    my $t = esc($title ne "" ? $title : $tag);
    print <<"HTML";
<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LORE $tag</title>
<style>
:root{--bg:#faf6ee;--bg2:#fff;--bg3:#f3ecdf;--bd:#e4d9c6;--t1:#241c12;--t2:#5a4c39;--t3:#8a7a62;--acc:#b4690e;--acc-soft:#f6e3c4;
--fs-xs:11px;--fs-sm:12.5px;--fs-md:14.5px;--fs-lg:17px;--fs-xl:24px;--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;--sans:Manrope,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t1);font:var(--fs-md)/1.65 var(--sans)}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 48px}
.tag{font:800 var(--fs-xl)/1 var(--sans);color:var(--acc)}h1{font-size:var(--fs-lg);margin:8px 0 6px}
.links{font:var(--fs-sm) var(--mono);color:var(--t3);margin-bottom:18px}
h2{font-size:var(--fs-md);text-transform:uppercase;letter-spacing:.06em;color:var(--acc);margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--acc-soft)}
h3{font-size:var(--fs-md);margin:16px 0 6px}h4{font-size:var(--fs-sm);margin:12px 0 4px}
ul{margin:4px 0 10px;padding-left:20px}li{margin:4px 0}li::marker{color:var(--acc)}
code{font-family:var(--mono);font-size:.9em;background:var(--bg3);padding:1px 5px;border-radius:4px;word-break:break-word}
a{color:var(--acc);text-decoration:none;border-bottom:1px solid var(--acc-soft)}
table{border-collapse:collapse;width:100%;font-size:var(--fs-sm);margin:8px 0 12px;background:var(--bg2)}
th{text-align:left;font:600 var(--fs-xs) var(--mono);text-transform:uppercase;color:var(--t3);border-bottom:1px solid var(--bd);padding:6px 8px}
td{border-bottom:1px solid var(--bg3);padding:6px 8px;vertical-align:top}
p{margin:6px 0 10px}
</style></head><body><div class="wrap">
<div class="tag">$tag</div><h1>$t</h1><div class="links">$links</div>
HTML
    print join("\n", @body), "\n</div></body></html>\n";
  ' > "$2"
}

selftest() {
  local d; d=$(mktemp -d); local fail=0
  cat > "$d/n.md" <<'MD'
# v9.9.9 — заголовок

Первый абзац с **жирным** и `кодом` & <тегом>.

## Раздел

- пункт **один** (#1)
  - вложенный
- пункт [два](https://x.y/z?a=1&b=2)

| а | б |
|---|---|
| `x` | y |
MD
  render "$d/n.md" "$d/n.html" v9.9.9 "https://f/r" "" || { echo "FAIL: render упал"; fail=1; }
  local h; h=$(tr -d '\n' < "$d/n.html")   # элементы разделены переводами строк — сверяем без них
  chk() { grep -qF -- "$1" <<<"$h" || { echo "FAIL: нет «$1»"; fail=1; }; }
  chk '<h1>v9.9.9 — заголовок</h1>'
  chk '<p>Первый абзац с <b>жирным</b> и <code>кодом</code> &amp; &lt;тегом&gt;.</p>'
  chk '<h2>Раздел</h2>'
  chk '<li>пункт <b>один</b> (#1)<ul>'
  chk '<li>вложенный</li>'
  chk '<a href="https://x.y/z?a=1&amp;b=2">два</a>'
  chk '<th>а</th>'
  chk '<td><code>x</code></td>'
  chk '<a href="https://f/r">Forgejo</a>'
  grep -q '\*\*\|^#' <<<"$h" && { echo "FAIL: осталась сырая разметка"; fail=1; }
  # теги ul сбалансированы
  [ "$(grep -o '<ul>' <<<"$h" | wc -l)" = "$(grep -o '</ul>' <<<"$h" | wc -l)" ] || { echo "FAIL: <ul> не сбалансирован"; fail=1; }
  rm -rf "$d"
  [ $fail = 0 ] && echo "release-html selftest: OK"
  return $fail
}

case "${1:-}" in
  --selftest) selftest ;;
  "") echo "usage: release-html.sh <md> <out.html> <tag> [forgejo-url] [github-url] | --selftest" >&2; exit 2 ;;
  *) render "$1" "$2" "$3" "${4:-}" "${5:-}" ;;
esac
