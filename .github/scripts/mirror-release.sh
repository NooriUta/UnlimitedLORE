#!/usr/bin/env bash
# Перенос выпуска (объект Release: описание + вложения) из основного репозитория в зеркало.
# SPRINT_CICD_OPS_2611/CO-MIRRORS-AUTOSYNC, 23.11.2026.
#
# Повод: шаг «Mirror main + tag to SeidrStudio» пушит только main и тег. Выпуска с описанием и
# вложениями в зеркале не было ни разу — замечание владельца на v1.19.0: «не вижу зеркала выпуска,
# только зеркало репозитория». Друг с доступом к зеркалу видел исходники, но установщик скачать не мог.
#
# Зовут его двое: мини-труба lore-mirror-release.yml (ручной запуск по тегу — догнать прошлый выпуск)
# и основная lore-release.yml (сразу после пуша тега в зеркало).
#
# Идемпотентен: выпуск в зеркале не дублируется (описание приводится к источнику), вложение с тем же
# именем и размером не перекачивается, с другим размером — заменяется.
#
# Вход (env):
#   TAG        — тег, напр. v1.19.0; переносятся только мажорные vX.Y.0 (как и сам пуш в зеркало)
#   HOST       — адрес Forgejo, напр. http://forgejo:3000
#   SRC_REPO   — источник, напр. AIDA/UnlimitedLORE;  SRC_TOKEN — чтение источника
#   DST_REPO   — зеркало, напр. SeidrStudio/UnlimitedLORE; DST_TOKEN — запись в зеркало
#   WORK_DIR   — рабочая папка (по умолчанию временная); CURL_BIN — curl (тесты подменяют)
set -u

CURL="${CURL_BIN:-curl}"
TAG="${TAG:?TAG не задан}"
HOST="${HOST:-http://forgejo:3000}"; HOST="${HOST%/}"
SRC_REPO="${SRC_REPO:-AIDA/UnlimitedLORE}"
DST_REPO="${DST_REPO:-SeidrStudio/UnlimitedLORE}"
SRC_API="$HOST/api/v1/repos/$SRC_REPO"
DST_API="$HOST/api/v1/repos/$DST_REPO"

if ! printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.0$'; then
  echo "::notice::выпуск в зеркале $DST_REPO не трогаем: $TAG — не vX.Y.0 (зеркала выносятся при смене x.y)"
  exit 0
fi

if [ -z "${DST_TOKEN:-}" ]; then
  echo "::error::BLOCKED: выпуск $TAG в зеркало $DST_REPO НЕ перенесён — нет секрета MIRROR_PUSH_TOKEN (организация AIDA, Settings -> Actions -> Secrets). Разблокировать: токен с правом записи в $DST_REPO выпускает владелица, кладёт CICDGitHub."
  exit 1
fi

W="${WORK_DIR:-$(mktemp -d)}"
mkdir -p "$W"

# json <файл> <выражение над j> — node, а не jq: jq на раннере не гарантирован.
json() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const r=('"$2"');if(r!==undefined&&r!==null)process.stdout.write(String(r))' "$1"; }

# call <метод> <url> <токен> <файл-ответа> [доп. аргументы curl] → печатает HTTP-код
call() {
  local m="$1" url="$2" tok="$3" out="$4"; shift 4
  "$CURL" -sS -X "$m" -H "Authorization: token $tok" -o "$out" -w '%{http_code}' "$@" "$url" 2>"$W/curl.err" || echo 000
}

# 1. Выпуск в источнике
code=$(call GET "$SRC_API/releases/tags/$TAG" "${SRC_TOKEN:-}" "$W/src.json")
if [ "$code" != 200 ]; then
  echo "::error::в $SRC_REPO нет выпуска $TAG (HTTP $code) — переносить нечего. Сначала опубликуйте выпуск."
  exit 1
fi

# 2. Тег в зеркале: без него выпуск не завести (Forgejo создал бы тег сам — от чужого коммита)
code=$(call GET "$DST_API/tags/$TAG" "$DST_TOKEN" "$W/dtag.json")
if [ "$code" != 200 ]; then
  echo "::error::тега $TAG в зеркале нет (HTTP $code, $DST_REPO) — сначала пуш main + тег (шаг Mirror main + tag to SeidrStudio), потом перенос выпуска."
  exit 1
fi

# 3. Выпуск в зеркале: завести или привести описание к источнику
node -e '
  const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  process.stdout.write(JSON.stringify({tag_name:s.tag_name,name:s.name,body:s.body||"",draft:false,prerelease:!!s.prerelease}));
' "$W/src.json" > "$W/payload.json"

code=$(call GET "$DST_API/releases/tags/$TAG" "$DST_TOKEN" "$W/dst.json")
if [ "$code" = 200 ]; then
  RID=$(json "$W/dst.json" 'j.id')
  code=$(call PATCH "$DST_API/releases/$RID" "$DST_TOKEN" "$W/patch.json" -H 'Content-Type: application/json' --data-binary "@$W/payload.json")
  case "$code" in 2*) echo "выпуск $TAG в зеркале уже есть (id $RID) — описание приведено к источнику" ;;
    *) echo "::error::не удалось обновить описание выпуска $TAG в зеркале (HTTP $code)"; exit 1 ;; esac
elif [ "$code" = 404 ]; then
  code=$(call POST "$DST_API/releases" "$DST_TOKEN" "$W/dst.json" -H 'Content-Type: application/json' --data-binary "@$W/payload.json")
  case "$code" in 2*) ;; *) echo "::error::не удалось завести выпуск $TAG в зеркале (HTTP $code): $(head -c 300 "$W/dst.json")"; exit 1 ;; esac
  RID=$(json "$W/dst.json" 'j.id')
  echo "выпуск $TAG заведён в зеркале (id $RID)"
else
  echo "::error::не удалось прочитать выпуск $TAG в зеркале (HTTP $code)"
  exit 1
fi

# 4. Вложения: имя<TAB>размер<TAB>id
json "$W/src.json" '(j.assets||[]).map(a=>a.name+"\t"+a.size).join("\n")' > "$W/src.assets"
json "$W/dst.json" '(j.assets||[]).map(a=>a.name+"\t"+a.size+"\t"+a.id).join("\n")' > "$W/dst.assets"

# fetch <способ> <имя> <uuid> <файл> → HTTP-код. att-* — /attachments/<uuid>, dl-* — /releases/download/<тег>/<имя>.
fetch() {
  local v="$1" n="$2" u="$3" out="$4" url auth
  case "$v" in
    att-*) [ -n "$u" ] || { echo 000; return; }; url="$HOST/attachments/$u" ;;
    *)     url="$HOST/$SRC_REPO/releases/download/$TAG/$n" ;;
  esac
  case "$v" in
    *-src-basic)  auth=(-u "x-access-token:${SRC_TOKEN:-}") ;;
    att-src)      auth=(-H "Authorization: token ${SRC_TOKEN:-}") ;;
    dl-dst-hdr)   auth=(-H "Authorization: token $DST_TOKEN") ;;
    *)            auth=(-u "mirror:$DST_TOKEN") ;;
  esac
  "$CURL" -sS -L "${auth[@]}" -o "$out" -w '%{http_code}' "$url" 2>"$W/curl.err" || echo 000
}

how=""; fail=0; moved=0; kept=0
# `|| [ -n "$name" ]` — последняя строка без перевода строки (json() его не ставит) иначе терялась бы.
while IFS="$(printf '\t')" read -r name size || [ -n "$name" ]; do
  [ -n "$name" ] || continue
  hsize=$(awk -F'\t' -v n="$name" '$1==n {print $2; exit}' "$W/dst.assets")
  hid=$(awk -F'\t' -v n="$name" '$1==n {print $3; exit}' "$W/dst.assets")
  if [ -n "$hid" ] && [ "$hsize" = "$size" ]; then kept=$((kept+1)); continue; fi
  if [ -n "$hid" ]; then
    call DELETE "$DST_API/releases/$RID/assets/$hid" "$DST_TOKEN" "$W/del.json" >/dev/null
  fi
  f="$W/asset.bin"
  uuid=$(json "$W/src.json" "(j.assets||[]).find(a=>a.name===$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$name"))?.uuid")
  if [ -z "$how" ]; then
    # Способ скачивания выбирается пробой на первом вложении, и выбор пишется в журнал — не молча.
    # Прогоны 10893 и 10894 (23.11) получили 404 на /releases/download/ и с токеном прогона в заголовке,
    # и с учёткой зеркала по basic. API отдаёт только описание вложения, не сам файл — остаётся веб.
    # Прогон 10895: att-src, att-dst, dl-dst-hdr, dl-dst-basic — все 404. Первыми идут basic-входы токеном
    # прогона (x-access-token:<токен>) — ровно так checkout того же прогона читает этот репозиторий.
    for v in dl-src-basic att-src-basic att-src att-dst dl-dst-hdr dl-dst-basic; do
      code=$(fetch "$v" "$name" "$uuid" "$f")
      echo "проба скачивания $v: HTTP $code"
      [ "$code" = 200 ] && { how="$v"; break; }
    done
    [ -n "$how" ] && echo "скачиваем способом $how" || how=none
  else
    code=$(fetch "$how" "$name" "$uuid" "$f")
  fi
  if [ "$code" != 200 ]; then echo "::error::вложение $name не скачано из $SRC_REPO (HTTP $code, способ $how)"; fail=1; continue; fi
  code=$(call POST "$DST_API/releases/$RID/assets?name=$name" "$DST_TOKEN" "$W/up.json" -F "attachment=@$f")
  case "$code" in 2*) moved=$((moved+1)); echo "вложение $name перенесено" ;;
    *) echo "::error::вложение $name не загружено в зеркало (HTTP $code): $(head -c 200 "$W/up.json")"; fail=1 ;; esac
  rm -f "$f"
done < "$W/src.assets"

echo "выпуск $TAG -> $DST_REPO: вложений перенесено $moved, уже были $kept"
[ "$fail" = 0 ] || { echo "::error::перенос выпуска $TAG в зеркало неполный — повторите прогон, он идемпотентен"; exit 1; }
exit 0
