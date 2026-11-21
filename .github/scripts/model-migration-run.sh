#!/usr/bin/env bash
# Перенос базы LORE на новую модель на ci-server — job «migrate» workflow lore-migration-snapshot.yml.
# SPRINT_LORE_OWN_HOST/OH-MIG-SNAPSHOT-WF, SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 (выкатка 1.18 на препрод).
#
# Входы (env):
#   MIG_SRC_DB      источник — снимок прода migration_src_* (только читается)
#   MIG_DST_DB      приёмник migration_dst* (для препрода — migration_dst_preprod: проходит и ворота
#                   препрода *_preprod, и сторож переноса migration_dst*)
#   STAGE           dry-run | transfer | transfer-edges | orphan-census | full
#                   full — как tools/run/ryzen-full-all.sh: connect --create-dst, затем ДВА прогона
#                   transfer --reset → edges → dst-fingerprint и сверка отпечатков (воспроизводимость:
#                   один источник и одни решения обязаны дать одну и ту же базу)
#   RESET           true — transfer по одному этапу чистит непустой приёмник
#   MIG_DECISIONS   файл решений (по умолчанию scripts/model-migration/rules/decisions.lore.json)
#   MIG_DB_USER / MIG_DB_PASSWORD — учётка ArcadeDB препрода (секреты репозитория). Нет — BLOCKED.
#   MIG_DB_URL      сервер ArcadeDB (по умолчанию шлюз docker http://172.17.0.1:2480)
#   MIG_REPORT_DIR  каталог отчётов (по умолчанию migration-report)
#   GUARD_ONLY=true — только сторож баз (для тестов)
# Для тестов: MIG_NODE (интерпретатор), MIG_CLI (точка входа конвейера).
set -uo pipefail

lc() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
die() { echo "::error::$1"; exit "${2:-1}"; }

# ── сторож баз (дублирует env.mjs и transfer.mjs) ────────────────────────────
src="$(lc "${MIG_SRC_DB:-}")"; dst="$(lc "${MIG_DST_DB:-}")"
[ -n "$src" ] || die "источник (name) не задан"
case "$src" in migration_src_*) ;; *) die "источник должен называться migration_src_*: $src" ;; esac
case "$dst" in system_aida_lore*) die "приёмник — рабочая база: $dst" ;; esac
case "$dst" in migration_dst*) ;; *) die "приёмник должен называться migration_dst*: $dst" ;; esac
[ "$src" != "$dst" ] || die "приёмник совпадает с источником"
STAGE="${STAGE:-dry-run}"
echo "источник $src → приёмник $dst, этап $STAGE"
[ "${GUARD_ONLY:-false}" = "true" ] && exit 0

# ── секреты: нет — BLOCKED, конвейер не запускается ──────────────────────────
missing=""
[ -n "${MIG_DB_USER:-}" ] || missing="$missing MIG_DB_USER"
[ -n "${MIG_DB_PASSWORD:-}" ] || missing="$missing MIG_DB_PASSWORD"
if [ -n "$missing" ]; then
  echo "::error::BLOCKED: в репозитории AIDA/UnlimitedLORE не заведены секреты Actions:$missing."
  echo "  Что завести: секрет ARCADEDB_ROOT_PASSWORD — root препродного ArcadeDB на ci-server (сценарий передаёт его как MIG_DB_PASSWORD, MIG_DB_USER=root; читать $src, создавать и писать $dst)."
  echo "  Где: Forgejo → AIDA/UnlimitedLORE → Settings → Actions → Secrets. Заводит CICDGitHub или владелица."
  echo "  Перенос не запускался."
  exit 2
fi

DECISIONS="${MIG_DECISIONS:-scripts/model-migration/rules/decisions.lore.json}"
[ -f "$DECISIONS" ] || die "файла решений нет: $DECISIONS — без решений перенос не применяет статусы, вид продукта и перегруппировку"
NODE="${MIG_NODE:-node}"
CLI="${MIG_CLI:-scripts/model-migration/cli.mjs}"
OUT="${MIG_REPORT_DIR:-migration-report}"
mkdir -p "$OUT"

# Файл доступа — во временном каталоге, только владельцу, удаляется в любом исходе.
d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
( umask 077
  {
    echo "MIG_DB_URL=${MIG_DB_URL:-http://172.17.0.1:2480}"
    echo "MIG_SRC_DB=$MIG_SRC_DB"; echo "MIG_SRC_USER=$MIG_DB_USER"; echo "MIG_SRC_PASSWORD=$MIG_DB_PASSWORD"
    echo "MIG_DST_DB=$MIG_DST_DB"; echo "MIG_DST_USER=$MIG_DB_USER"; echo "MIG_DST_PASSWORD=$MIG_DB_PASSWORD"
  } > "$d/migration.env" )

# mig <команда> [ключи] — конвейер через единую точку входа (тот же путь, что установщик и ryzen-full-all.sh).
mig() { local c="$1"; shift; "$NODE" "$CLI" "$c" "$@" --env "$d/migration.env" --decisions "$DECISIONS"; }
step() { local name="$1"; shift; echo "── $name"; "$@" || die "этап «$name» упал (код $?) — отчёт в артефакте"; }

case "$STAGE" in
  dry-run)        step dry-run mig dry-run --out "$OUT/dry-run.json" ;;
  transfer)       if [ "${RESET:-false}" = "true" ]; then step transfer mig transfer --reset --out "$OUT/transfer.json"
                  else step transfer mig transfer --out "$OUT/transfer.json"; fi ;;
  transfer-edges) step edges mig edges --out "$OUT/edges.json" ;;
  orphan-census)  step orphans mig orphans --out "$OUT/orphan-census.json" ;;
  full)
    step "connect (--create-dst)" mig connect --create-dst
    fps=()
    for n in 1 2; do
      step "прогон $n: transfer" mig transfer --reset --out "$OUT/run$n-transfer.json"
      step "прогон $n: edges" mig edges --out "$OUT/run$n-edges.json"
      echo "── прогон $n: dst-fingerprint"
      fpout="$(mig dst-fingerprint --out "$OUT/run$n-fp.json")" || die "этап «прогон $n: dst-fingerprint» упал"
      tail -3 <<< "$fpout"
      fp="$(sed -n 's/^отпечаток содержимого: //p' <<< "$fpout" | tail -1)"
      [ -n "$fp" ] || die "прогон $n: отпечаток содержимого не прочитан"
      fps+=("$fp")
    done
    if [ "${fps[0]}" != "${fps[1]}" ]; then
      die "отпечатки двух прогонов разошлись: ${fps[0]} ≠ ${fps[1]} — перенос невоспроизводим, базу $dst на препрод не брать (сравните $OUT/run1-fp.json и run2-fp.json)"
    fi
    echo "отпечатки двух прогонов совпали: ${fps[0]} — база $dst готова"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- перенос $src → $dst: два прогона, отпечаток ${fps[0]}" >> "$GITHUB_STEP_SUMMARY"; fi
    ;;
  *) die "этап «$STAGE» неизвестен: dry-run | transfer | transfer-edges | orphan-census | full" ;;
esac
exit 0
