#!/usr/bin/env bash
# RELEASE-<tag>.md → самодостаточная HTML-страница (светлая тема Seiðr) для
# вложения в Telegram.
#
# Владелица 05.11.2026: «в телеграм создавать вот такие HTML и писать кратко
# выложено ссылка и аттачем полноценное описание». Сообщение — коротко, полный
# текст — файлом: в Telegram длинные заметки резались на куски и читались плохо.
#
# Владелица 06.11.2026: «доправь создание HTML и release notes … чтобы заметки
# были информативные, а не так себе … HTML на несколько версий у тебя был
# классный». Образец — отчёт по v1.13–v1.15: каждая фича — КАРТОЧКА
# «Проблема → Решение → Результат» со ссылками на задачу и PR. Правила текста —
# spec:SPEC-LORE-RELEASE-NOTES.
#
#   release-html.sh <RELEASE-tag.md> <out.html> <tag> [forgejo-url] [github-url]
#   release-html.sh --selftest
#
# Поддерживаемый markdown — тот, что пишется в заметках: # ## ### заголовки,
# «- » и «  - » списки, **жирный**, `код`, [текст](url), абзацы, таблицы | a | b |.
#
# КАРТОЧКА ФИЧИ: «### Название» и под ним пункты с метками
#   - **Проблема:** …   (также: Причина, Зачем)        → строка «Проблема»
#   - **Решение:** …    (также: Что сделано)           → строка «Решение»
#   - **Результат:** …  (также: Ценность, Что даёт)    → строка «Результат»
#   - **Ссылки:** SPRINT_X/CODE · #NNN  (также: Задача) → строка ссылок
# Пункты без метки остаются списком внутри карточки.
#
# Ссылки сами: SPRINT_X/CODE → паспорт спринта в LORE, #NNN → PR в Forgejo
# (репозиторий берётся из forgejo-url, если он вида …/releases/tag/<tag>).
set -uo pipefail
export LC_ALL=C.UTF-8

render() { # render <md> <out> <tag> <fg> <gh>
  # PRODUCT_NAME — имя продукта в <title> (по умолчанию LORE; у LORE поведение не
  # меняется). Ручка заведена в источнике по находке Völva при порте 06.11: иначе
  # копии скрипта расходятся с источником навсегда.
  MD="$1" TAG="$3" FG="${4:-}" GH="${5:-}" LORE_URL="${LORE_URL:-https://lore.odal.seidrstudio.pro}" \
  PRODUCT_NAME="${PRODUCT_NAME:-LORE}" perl -CSD -Mutf8 -e '
    use strict; use warnings;
    # %ENV приходит БАЙТАМИ: -CSD декодирует потоки, а не окружение. Без этого
    # не-ASCII значение (имя продукта, заголовок) печаталось бы как «VÃ¶lva» —
    # найдено сессией Völva при порте 06.11.
    utf8::decode($ENV{$_}) for grep { defined $ENV{$_} } qw(MD TAG FG GH LORE_URL PRODUCT_NAME);
    open(my $fh, "<:encoding(UTF-8)", $ENV{MD}) or die "нет файла $ENV{MD}\n";
    my @lines = <$fh>; close $fh; chomp @lines;
    # Репозиторий — из адреса релиза …/<owner>/<repo>/releases/tag/<tag>; иначе ссылок на PR не строим.
    my $repo = ($ENV{FG} // "") =~ m{^(.*)/releases(?:/.*)?$} ? $1 : "";
    my $lore = $ENV{LORE_URL};
    sub esc { my $s = shift; $s =~ s/&/&amp;/g; $s =~ s/</&lt;/g; $s =~ s/>/&gt;/g; $s =~ s/"/&quot;/g; $s }
    # Ссылки на задачу и PR — только в тексте ВНЕ уже готовых тегов <a>/<code>.
    sub autolink {
      my $s = shift; my $out = "";
      for my $part (split /(<a\b[^>]*>.*?<\/a>|<code>.*?<\/code>)/, $s) {
        if ($part =~ /^<(a|code)\b/) { $out .= $part; next }
        $part =~ s{\b(SPRINT_[A-Z0-9_]+)(/[A-Za-z0-9][A-Za-z0-9-]*)?}{"<a href=\"$lore/lore?section=sprints&amp;passport=$1\">$1" . ($2 // "") . "</a>"}ge;
        $part =~ s{(^|[\s(·,;])#(\d{2,5})\b}{"$1<a href=\"$repo/pulls/$2\">#$2</a>"}ge if $repo ne "";
        $out .= $part;
      }
      $out
    }
    sub inl {
      my $s = esc(shift);
      $s =~ s/`([^`]+)`/<code>$1<\/code>/g;
      $s =~ s/\*\*([^*]+)\*\*/<b>$1<\/b>/g;
      $s =~ s/\[([^\]]+)\]\(([^)\s]+)\)/<a href="$2">$1<\/a>/g;
      autolink($s)
    }
    my %ROW = (
      "проблема" => ["was", "Проблема"], "причина" => ["was", "Проблема"], "зачем" => ["was", "Проблема"],
      "решение" => ["now", "Решение"], "что сделано" => ["now", "Решение"],
      "результат" => ["why", "Результат"], "ценность" => ["why", "Результат"], "что даёт" => ["why", "Результат"],
      "ссылки" => ["refs", ""], "задача" => ["refs", ""],
    );
    my ($title, @body, @para, $list, $sub, @tbl, $card) = ("");
    my ($features, $sections) = (0, 0);
    my $flush_para = sub { if (@para) { push @body, "<p>" . inl(join(" ", @para)) . "</p>"; @para = () } };
    my $close_list = sub {
      if ($sub)  { push @body, "</ul></li>"; $sub = 0 }
      if ($list) { push @body, "</ul>"; $list = 0 }
    };
    my $close_card = sub { if ($card) { push @body, "</div>"; $card = 0 } };
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
        $flush_para->(); $close_list->(); $close_card->();
        my ($n, $t) = (length $1, $2);
        if ($n == 1 && $title eq "") { $title = $t; next }
        if ($n == 3) { push @body, "<div class=\"card\"><h4>" . inl($t) . "</h4>"; $card = 1; $features++; next }
        $sections++;
        push @body, "<h2>" . inl($t) . "</h2>"; next;   # «#»/«##» — раздел
      }
      if ($card && $l =~ /^[-*]\s+\*\*([^*:]+):\*\*\s*(.*)$/ && exists $ROW{lc $1}) {
        $close_list->();
        my ($cls, $label) = @{ $ROW{lc $1} };
        push @body, $cls eq "refs"
          ? "<div class=\"refs\">" . inl($2) . "</div>"
          : "<div class=\"row $cls\"><b>$label</b><div>" . inl($2) . "</div></div>";
        next;
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
      if ($card && @body && $body[-1] =~ /<\/div><\/div>$/ && $l =~ /^\s+(\S.*)$/) {   # перенос строки карточки
        my $x = inl($1); $body[-1] =~ s/<\/div><\/div>$/ $x<\/div><\/div>/; next;
      }
      $close_list->(); push @para, $l;
    }
    $flush_para->(); $close_list->(); $flush_tbl->(); $close_card->();
    my ($tag, $fg, $gh) = ($ENV{TAG}, $ENV{FG}, $ENV{GH});
    my $product = esc($ENV{PRODUCT_NAME} // "LORE");
    my $links = join(" · ", grep { $_ } ($fg ? "<a href=\"" . esc($fg) . "\">Forgejo</a>" : ""), ($gh ? "<a href=\"" . esc($gh) . "\">GitHub</a>" : ""));
    my $t = esc($title ne "" ? $title : $tag);
    # Склонение: «1 раздел», «2 раздела», «5 разделов» (находка seidr-site 06.11 —
    # «1 разделов» на собранной странице бросалось в глаза первым).
    my $plural = sub { my ($n, $one, $few, $many) = @_;
      my ($m10, $m100) = ($n % 10, $n % 100);
      return $many if $m100 >= 11 && $m100 <= 14;
      return $one  if $m10 == 1;
      return $few  if $m10 >= 2 && $m10 <= 4;
      $many };
    my $kpis = $features ? "<div class=\"kpis\"><div class=\"kpi\"><b>$features</b><span>" . $plural->($features, "изменение", "изменения", "изменений") . "</span></div>"
      . "<div class=\"kpi\"><b>$sections</b><span>" . $plural->($sections, "раздел", "раздела", "разделов") . "</span></div></div>" : "";
    print <<"HTML";
<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$product $tag</title>
<style>
:root{--bg:#faf6ee;--bg2:#fff;--bg3:#f3ecdf;--bd:#e4d9c6;--t1:#241c12;--t2:#5a4c39;--t3:#8a7a62;--acc:#b4690e;--acc-soft:#f6e3c4;
--was:#a3402d;--now:#2f6f9a;--why:#3d7a3a;--r:10px;
--fs-2xs:10.5px;--fs-xs:11px;--fs-sm:12.5px;--fs-md:14.5px;--fs-lg:17px;--fs-xl:24px;--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;--sans:Manrope,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t1);font:var(--fs-md)/1.65 var(--sans)}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 48px}
.tag{font:800 var(--fs-xl)/1 var(--sans);color:var(--acc)}h1{font-size:var(--fs-lg);margin:8px 0 6px}
.links{font:var(--fs-sm) var(--mono);color:var(--t3);margin-bottom:18px}
h2{font-size:var(--fs-md);text-transform:uppercase;letter-spacing:.06em;color:var(--acc);margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--acc-soft)}
h3{font-size:var(--fs-md);margin:16px 0 6px}h4{font-size:var(--fs-md);margin:0 0 8px}
ul{margin:4px 0 10px;padding-left:20px}li{margin:4px 0}li::marker{color:var(--acc)}
code{font-family:var(--mono);font-size:.9em;background:var(--bg3);padding:1px 5px;border-radius:4px;word-break:break-word}
a{color:var(--acc);text-decoration:none;border-bottom:1px solid var(--acc-soft)}
table{border-collapse:collapse;width:100%;font-size:var(--fs-sm);margin:8px 0 12px;background:var(--bg2)}
th{text-align:left;font:600 var(--fs-xs) var(--mono);text-transform:uppercase;color:var(--t3);border-bottom:1px solid var(--bd);padding:6px 8px}
td{border-bottom:1px solid var(--bg3);padding:6px 8px;vertical-align:top}
p{margin:6px 0 10px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0 0 18px}
.kpi{background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);padding:12px 14px}
.kpi b{display:block;font:800 var(--fs-xl)/1.1 var(--sans);color:var(--acc)}
.kpi span{font-size:var(--fs-xs);color:var(--t3);text-transform:uppercase;letter-spacing:.08em}
.card{background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);padding:14px 16px;margin:0 0 10px}
.row{display:grid;grid-template-columns:96px 1fr;gap:8px;margin:5px 0;font-size:var(--fs-sm)}
.row>b{font:600 var(--fs-2xs)/1.9 var(--mono);text-transform:uppercase;letter-spacing:.08em}
.row.was>b{color:var(--was)}.row.now>b{color:var(--now)}.row.why>b{color:var(--why)}
.card ul{margin:2px 0 0;padding-left:18px}
.refs{font:var(--fs-xs) var(--mono);color:var(--t3);margin-top:8px}.refs a{font-weight:600}
\@media (max-width:560px){.row{grid-template-columns:1fr;gap:0}}
</style></head><body><div class="wrap">
<div class="tag">$tag</div><h1>$t</h1><div class="links">$links</div>
$kpis
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

## Возможности

### Причина блокировки спринта

- **Проблема:** из шести блокировок настоящая одна
- **Решение:** `status_set` знает причину
- **Результат:** «заблокирован» отличим от «забыли статус»
- **Ссылки:** SPRINT_QG_REBUILD/QG-16 · #796
- обычный пункт без метки
MD
  render "$d/n.md" "$d/n.html" v9.9.9 "https://f/o/r/releases/tag/v9.9.9" "" || { echo "FAIL: render упал"; fail=1; }
  local h; h=$(tr -d '\n' < "$d/n.html")   # элементы разделены переводами строк — сверяем без них
  chk() { grep -qF -- "$1" <<<"$h" || { echo "FAIL: нет «$1»"; fail=1; }; }
  chk '<h1>v9.9.9 — заголовок</h1>'
  chk '<p>Первый абзац с <b>жирным</b> и <code>кодом</code> &amp; &lt;тегом&gt;.</p>'
  chk '<h2>Раздел</h2>'
  chk '<li>пункт <b>один</b> (#1)<ul>'        # однозначный номер — не ссылка на PR
  chk '<li>вложенный</li>'
  chk '<a href="https://x.y/z?a=1&amp;b=2">два</a>'
  chk '<th>а</th>'
  chk '<td><code>x</code></td>'
  chk '<a href="https://f/o/r/releases/tag/v9.9.9">Forgejo</a>'
  # карточка фичи
  chk '<div class="card"><h4>Причина блокировки спринта</h4>'
  chk '<div class="row was"><b>Проблема</b><div>из шести блокировок настоящая одна</div></div>'
  chk '<div class="row now"><b>Решение</b><div><code>status_set</code> знает причину</div></div>'
  chk '<div class="row why"><b>Результат</b>'
  chk '<a href="https://lore.odal.seidrstudio.pro/lore?section=sprints&amp;passport=SPRINT_QG_REBUILD">SPRINT_QG_REBUILD/QG-16</a>'
  chk '<a href="https://f/o/r/pulls/796">#796</a>'
  chk '<li>обычный пункт без метки</li>'
  chk '<div class="kpi"><b>1</b><span>изменение</span>'   # склонение: 1 изменение
  chk '<div class="kpi"><b>2</b><span>раздела</span>'     # 2 раздела («Раздел», «Возможности»)
  chk '<title>LORE v9.9.9</title>'                 # по умолчанию — как было
  # PRODUCT_NAME и не-ASCII из окружения: «Völva», а не «VÃ¶lva»
  PRODUCT_NAME='Völva' render "$d/n.md" "$d/v.html" v9.9.9 "" "" || { echo "FAIL: render с PRODUCT_NAME упал"; fail=1; }
  grep -qF '<title>Völva v9.9.9</title>' "$d/v.html" || { echo "FAIL: PRODUCT_NAME не дошёл или испорчен кодировкой: $(grep -o '<title>[^<]*' "$d/v.html")"; fail=1; }
  grep -q '\*\*\|^#' <<<"$h" && { echo "FAIL: осталась сырая разметка"; fail=1; }
  # теги ul и div сбалансированы
  [ "$(grep -o '<ul>' <<<"$h" | wc -l)" = "$(grep -o '</ul>' <<<"$h" | wc -l)" ] || { echo "FAIL: <ul> не сбалансирован"; fail=1; }
  [ "$(grep -o '<div' <<<"$h" | wc -l)" = "$(grep -o '</div>' <<<"$h" | wc -l)" ] || { echo "FAIL: <div> не сбалансирован"; fail=1; }
  rm -rf "$d"
  [ $fail = 0 ] && echo "release-html selftest: OK"
  return $fail
}

case "${1:-}" in
  --selftest) selftest ;;
  "") echo "usage: release-html.sh <md> <out.html> <tag> [forgejo-url] [github-url] | --selftest" >&2; exit 2 ;;
  *) render "$1" "$2" "$3" "${4:-}" "${5:-}" ;;
esac
