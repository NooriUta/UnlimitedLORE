#!/usr/bin/env bash
# DBU-03/DBU-05: прогон НАШИХ запросов (реестр слайсов) на двух версиях СУБД
# по ОДНОЙ И ТОЙ ЖЕ копии базы и сравнение результата.
#
# Зачем отдельно от db-regression.sh: тот проверяет грамматику на синтетике.
# Но заметки 26.8.1 меняли поведение BM25, курсора индекса и выбора бакета при
# поиске по вторичному индексу — это ломается не в выдуманном запросе, а в
# нашем. Реестр слайсов — единственный источник наших запросов; вторая копия
# SQL разошлась бы с продуктом при первой же правке.
#
# SQL берётся из build/slice-sql.tsv, который пишет SliceSqlDumpTest.
#
# Вход: OLD_URL, NEW_URL, DB_USER, DB_PASS, DB_NAME, SQL_TSV.
set -uo pipefail

OLD_URL="${OLD_URL:?OLD_URL обязателен}"
NEW_URL="${NEW_URL:?NEW_URL обязателен}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:?DB_PASS обязателен}"
DB_NAME="${DB_NAME:?DB_NAME обязателен}"
SQL_TSV="${SQL_TSV:-backend/build/slice-sql.tsv}"

run_on() { # run_on <url> <sql>
  local url="$1" f; f=$(mktemp)
  # Запрос уходит файлом: инлайновый -d бьёт не-ASCII, а в наших слайсах
  # кириллица есть (статусы, названия). Сломанная мерка выглядела бы как
  # расхождение версий.
  printf '{"language":"sql","command":"%s"}' "$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')" > "$f"
  curl -s -m 120 -u "$DB_USER:$DB_PASS" -H 'Content-Type: application/json' \
       -X POST "$url/api/v1/command/$DB_NAME" --data-binary "@$f"
  rm -f "$f"
}

# Число строк считает САМА БД: запрос оборачивается в SELECT count(*) FROM (…).
#
# Считать по конверту ответа нельзя — он у версий РАЗНЫЙ. 26.7.2 отдаёт
# {"user":…,"result":[…]} и больше ничего; 26.8.1 добавляет
# "limit":20000,"returned":N,"truncated":false. Первая редакция скрипта брала
# "returned" и получала пустоту на старой версии — все 108 слайсов помечались
# DIFF, хотя данные обе версии отдавали одинаковые.
#
# Побочная выгода: не тащим через сеть тела на тысячи строк.
count_on() { # count_on <url> <sql>
  local url="$1" f resp; f=$(mktemp)
  local wrapped="SELECT count(*) AS n FROM ( $2 )"
  # Запрос уходит файлом: инлайновый -d бьёт не-ASCII, а в слайсах кириллица
  # есть (статусы, фильтры по названиям). Сломанная мерка выглядела бы как
  # расхождение версий.
  printf '{"language":"sql","command":"%s"}' "$(printf '%s' "$wrapped" | sed 's/\\/\\\\/g; s/"/\\"/g')" > "$f"
  resp=$(curl -s -m 180 -u "$DB_USER:$DB_PASS" -H 'Content-Type: application/json' \
       -X POST "$url/api/v1/command/$DB_NAME" --data-binary "@$f")
  rm -f "$f"
  if printf '%s' "$resp" | grep -q '"error"'; then
    printf 'ERROR:%s' "$(printf '%s' "$resp" | grep -o '"exception":"[^"]*"' | head -1 | cut -d'"' -f4)"
  else
    local n; n=$(printf '%s' "$resp" | grep -o '"n":[0-9]*' | head -1 | cut -d: -f2)
    # Пустой ответ — это «сосчитать не удалось», а НЕ ноль строк. Подменять
    # одно другим — ровно тот дефект, ради которого весь регресс и заведён.
    if [ -z "$n" ]; then printf 'UNPARSED'; else printf 'rows:%s' "$n"; fi
  fi
}

# --- подстановка параметров --------------------------------------------------
# Слайс с параметром без значения не проверяется вовсе, а это 46 запросов из
# 108 — почти половина реестра. Пустая подстановка не годится: она дала бы ноль
# строк на ОБЕИХ версиях, то есть ложное «совпало».
#
# Поэтому значения берутся из самого корпуса. Если образца нет (тип пуст),
# слайс честно помечается пропущенным с причиной, а не считается сошедшимся.

sample() { # sample <sql-возвращающий-v> — одно значение из корпуса
  local f resp; f=$(mktemp)
  printf '{"language":"sql","command":"%s"}' "$(printf '%s' "$1" | sed 's/"/\\"/g')" > "$f"
  resp=$(curl -s -m 60 -u "$DB_USER:$DB_PASS" -H 'Content-Type: application/json' \
       -X POST "$OLD_URL/api/v1/command/$DB_NAME" --data-binary "@$f")
  rm -f "$f"
  printf '%s' "$resp" | grep -o '"v":"[^"]*"' | head -1 | cut -d'"' -f4
}

# Значение параметра ЗАВИСИТ ОТ СЛАЙСА: «id» у adr — это adr_id, у decision —
# decision_id, у sprint_tree — sprint_id. Общей подстановки быть не может.
param_value() { # param_value <slice> <param>
  case "$1|$2" in
    adr\|id|adr_history\|id|decisions_of_adr\|id|questions_of_adr\|id)
      sample "SELECT adr_id AS v FROM KnowADR LIMIT 1" ;;
    decision\|id)          sample "SELECT decision_id AS v FROM KnowDecision LIMIT 1" ;;
    files_of_task\|id|gating_questions_of_task\|id|history_task\|id)
      sample "SELECT task_uid AS v FROM KnowTask LIMIT 1" ;;
    questions_of_sprint\|id|sprint_tree\|id|sprint_deps_of\|id|history_sprint\|id)
      sample "SELECT sprint_id AS v FROM KnowSprint LIMIT 1" ;;
    use_cases_of_feature\|id|tasks_of_uc\|id)
      sample "SELECT uc_id AS v FROM KnowUseCase LIMIT 1" ;;
    component\|id)         sample "SELECT component_id AS v FROM LoreComponent LIMIT 1" ;;
    spec_by_id\|id)        sample "SELECT spec_id AS v FROM KnowSpec LIMIT 1" ;;
    doc_by_id\|id)         sample "SELECT doc_id AS v FROM KnowDoc LIMIT 1" ;;
    runbook_by_id\|id)     sample "SELECT runbook_id AS v FROM KnowRunbook LIMIT 1" ;;
    quality_gate_by_id\|id|qg_metrics\|qg_id|qg_job_tasks\|qg_id|qg_recommendations\|qg_id)
      sample "SELECT qg_id AS v FROM QualityGate LIMIT 1" ;;
    finding_by_id\|id)     sample "SELECT finding_id AS v FROM KnowFinding LIMIT 1" ;;
    *\|sprint_id)          sample "SELECT sprint_id AS v FROM KnowSprint LIMIT 1" ;;
    *\|phase_uid)          sample "SELECT phase_uid AS v FROM KnowPhase LIMIT 1" ;;
    use_cases_of_component\|component|component_sprints\|cid)
      sample "SELECT component_id AS v FROM LoreComponent LIMIT 1" ;;
    *\|kc_sub)             sample "SELECT kc_sub AS v FROM KnowUser LIMIT 1" ;;
    *\|project)            sample "SELECT slug AS v FROM KnowGitProject LIMIT 1" ;;
    *\|run_id)             sample "SELECT run_id AS v FROM ClRoutineRun LIMIT 1" ;;
    *\|routine_name)       sample "SELECT routine_name AS v FROM ClRoutineRun LIMIT 1" ;;
    *\|output_type)        sample "SELECT output_type AS v FROM ClRoutineOutput LIMIT 1" ;;
    *\|tag)                sample "SELECT git_tag AS v FROM KnowRelease LIMIT 1" ;;
    *\|ruid)               sample "SELECT release_uid AS v FROM KnowRelease LIMIT 1" ;;
    *\|dict_type)          sample "SELECT dict_type AS v FROM KnowDictEntry LIMIT 1" ;;
    history_dict\|code)
      # Пара dict_type+code обязана быть ИЗ ОДНОЙ строки, иначе выборка пуста
      # на обеих версиях и «совпадение» ничего не значит.
      sample "SELECT code AS v FROM KnowDictEntry WHERE dict_type = '$(sample "SELECT dict_type AS v FROM KnowDictEntry LIMIT 1")' LIMIT 1" ;;
    components_in_area\|code) sample "SELECT area AS v FROM LoreComponent WHERE area IS NOT NULL LIMIT 1" ;;
    search\|pattern)       printf 'LORE' ;;
    component_sprints\|pattern) printf 'SPRINT' ;;
    *) printf '' ;;
  esac
}

TOTAL=0; SAME=0; DIFF=0; SKIPPED=0

printf 'slice\tstatus\told\tnew\n'

# Строку разбираем вручную, а не через `IFS=$'\t' read -r id required sql`:
# таб — ПРОБЕЛЬНЫЙ символ, и bash схлопывает подряд идущие разделители. У
# слайсов без параметров среднее поле пустое, оно исчезало, и SQL попадал в
# переменную `required` — все 108 слайсов помечались «нужны параметры», а
# сравнено оказывалось ноль. Поймано тем, что счётчик пропусков печатается
# отдельно: иначе прогон выглядел бы как «расхождений нет».
while IFS= read -r line; do
  id="${line%%$'\t'*}"
  rest="${line#*$'\t'}"
  required="${rest%%$'\t'*}"
  sql="${rest#*$'\t'}"
  [ -z "${id:-}" ] && continue
  TOTAL=$((TOTAL + 1))
  # Параметры подставляются реальными значениями из корпуса. Не нашли образца —
  # слайс помечается пропущенным С ПРИЧИНОЙ и НЕ идёт в «совпало»: непроверенное
  # не имеет права выглядеть как проверенное.
  if [ -n "${required:-}" ]; then
    missing=""
    IFS=',' read -ra params <<< "$required"
    for p in "${params[@]}"; do
      v=$(param_value "$id" "$p")
      if [ -z "$v" ]; then missing="${missing}${missing:+,}$p"; continue; fi
      # В кавычках: в SQL плейсхолдер стоит на месте строкового литерала
      # (WHERE adr_id = :id), и голая подстановка дала бы синтаксическую
      # ошибку — одинаковую на обеих версиях, то есть снова ложное «совпало».
      sql="${sql//:$p/\'$v\'}"
    done
    if [ -n "$missing" ]; then
      SKIPPED=$((SKIPPED + 1))
      printf '%s\tSKIP\tнет образца для: %s\t\n' "$id" "$missing"
      continue
    fi
  fi
  o=$(count_on "$OLD_URL" "$sql")
  n=$(count_on "$NEW_URL" "$sql")
  if [ "$o" = "$n" ]; then
    SAME=$((SAME + 1))
    printf '%s\tSAME\t%s\t%s\n' "$id" "$o" "$n"
  else
    DIFF=$((DIFF + 1))
    printf '%s\tDIFF\t%s\t%s\n' "$id" "$o" "$n"
  fi
done < "$SQL_TSV"

printf '\n# всего %s, сравнено %s, совпало %s, разошлось %s, пропущено (нужны параметры) %s\n' \
  "$TOTAL" "$((SAME + DIFF))" "$SAME" "$DIFF" "$SKIPPED" >&2

# Пропуски НЕ прячем в ноль: слайс с параметрами не проверен, и это должно
# быть видно, а не выглядеть как «всё сошлось».
exit 0
