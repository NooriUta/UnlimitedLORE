#!/usr/bin/env bash
# Что гонять в CI и что выкатывать в CD — по изменённым путям.
# SPRINT_UXR_S3_V2_INFRA/S3-10, решение D-2026-UXR-V2-FOLDER-V1-FROZEN:
#
#   web-next/**                         → только v2
#   src/**, корневые файлы сборки v1    → только v1 (он заморожен, см. guard-v1)
#   nginx.conf.template, docker/**      → оба веба (общий шаблон и скрипт старта)
#   backend/**, mcp-server/**, shared/**,
#   docker-compose*.yml                 → бэкенд, MCP с контрактом S0 и ОБА веба
#   .github/**                          → всё: правка CI должна проверить себя сама
#   docs/**, *.md и прочая документация → ничего тяжёлого
#   всё незнакомое                      → всё
#
# Принцип: ошибиться можно только в сторону «прогнали лишнее». Не вычислился
# дифф, пустой список, незнакомый путь — гоняем всё и говорим об этом вслух.
# Пропущенный тест выглядит зелёным, поэтому молчаливое «нечего проверять»
# здесь хуже лишних десяти минут прогона.
#
# Логика в скрипте, а не в `run:` workflow: bash внутри `run:` уже дважды
# ломал разбор workflow парсером Forgejo (см. resolve-proxy.sh).
#
# Режимы:
#   ci        → v1, v2, backend, mcp (true/false) + reason
#   cd        → backend, frontend (v1), frontend_next (v2) + reason
#   guard-v1  → код 1, если PR трогает src/** без метки v1-hotfix
#
# Вход (env):
#   CI_SCOPE_FILES  — список путей через перевод строки; если задана (даже
#                     пустой), git не спрашивается (тесты, ручной прогон)
#   EVENT_NAME      — github.event_name
#   BASE_REF        — github.base_ref (pull_request)
#   BEFORE          — github.event.before (push)
#   SERVICE         — ввод ручного запуска CD (cd)
#   PR_LABELS       — toJSON(github.event.pull_request.labels.*.name) (guard-v1)
# Выход: строки key=value в stdout и в $GITHUB_OUTPUT (если задан).
set -uo pipefail

MODE="${1:-}"
case "$MODE" in
  ci|cd|guard-v1) ;;
  *) echo "::error::ci-scope.sh: неизвестный режим '$MODE' (ci | cd | guard-v1)"; exit 2 ;;
esac

emit() {
  echo "$1=$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1=$2" >> "$GITHUB_OUTPUT"; fi
}

# ── список изменённых путей ──────────────────────────────────────────────────
# FILES_OK=0 — список получить не удалось (причина в FILES_WHY).
FILES=""
FILES_OK=1
FILES_WHY=""

changed_files() {
  if [ "${CI_SCOPE_FILES+set}" = set ]; then
    FILES="$CI_SCOPE_FILES"
    return
  fi
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    FILES_OK=0; FILES_WHY="не git-каталог"; return
  fi
  local range=""
  case "${EVENT_NAME:-}" in
    pull_request|pull_request_target)
      if [ -z "${BASE_REF:-}" ]; then FILES_OK=0; FILES_WHY="у PR нет base_ref"; return; fi
      git rev-parse -q --verify "origin/$BASE_REF" >/dev/null 2>&1 \
        || git fetch --no-tags -q origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF" >/dev/null 2>&1
      range="origin/$BASE_REF...HEAD"
      ;;
    push)
      if [ -z "${BEFORE:-}" ] || [ "${BEFORE//0/}" = "" ]; then
        FILES_OK=0; FILES_WHY="у пуша нет предыдущего коммита (новая ветка?)"; return
      fi
      git cat-file -e "$BEFORE^{commit}" 2>/dev/null \
        || git fetch --no-tags -q origin "$BEFORE" >/dev/null 2>&1
      range="$BEFORE...HEAD"
      ;;
    *)
      FILES_OK=0; FILES_WHY="событие '${EVENT_NAME:-}' не сравнивается по путям"; return
      ;;
  esac
  if ! FILES="$(git diff --name-only "$range" 2>&1)"; then
    FILES_OK=0; FILES_WHY="git diff $range не выполнился: $(printf '%s' "$FILES" | head -c 300)"; FILES=""
  fi
}

# ── классификация одного пути → набор меток ─────────────────────────────────
# Метки: v1 v2 backend mcp deploy_backend.
classify() {
  case "$1" in
    web-next/*)                         echo "v2" ;;
    src/*|public/*|index.html|vite.config.ts|tsconfig*.json|eslint.config.js|postcss.config.cjs|package.json|package-lock.json|Dockerfile|.dockerignore)
                                        echo "v1" ;;
    nginx.conf.template|docker/*)       echo "v1 v2" ;;
    backend/*)                          echo "v1 v2 backend mcp deploy_backend" ;;
    mcp-server/*)                       echo "v1 v2 backend mcp" ;;
    shared/*|docker-compose*.yml)       echo "v1 v2 backend mcp deploy_backend" ;;
    .github/*)                          echo "v1 v2 backend mcp deploy_backend" ;;
    docs/*|*.md|renovate.json|.claude/*|.gitignore|.gitattributes|.editorconfig|LICENSE)
                                        echo "" ;;
    *)                                  echo "v1 v2 backend mcp deploy_backend" ;;
  esac
}

V1=false V2=false BACKEND=false MCP=false DEPLOY_BACKEND=false
SRC_TOUCHED=""
REASON=""

scope_all() {
  V1=true V2=true BACKEND=true MCP=true DEPLOY_BACKEND=true
  REASON="$1"
  echo "::warning::ci-scope: $1 — гоняем всё"
}

compute_scope() {
  changed_files
  if [ "$FILES_OK" != 1 ]; then scope_all "список изменений не получен ($FILES_WHY)"; return; fi
  local list n=0 f t
  list="$(printf '%s\n' "$FILES" | sed '/^[[:space:]]*$/d')"
  if [ -z "$list" ]; then scope_all "пустой список изменений"; return; fi
  while IFS= read -r f; do
    n=$((n + 1))
    case "$f" in src/*) SRC_TOUCHED="$SRC_TOUCHED $f" ;; esac
    t=" $(classify "$f") "
    case "$t" in *" v1 "*) V1=true ;; esac
    case "$t" in *" v2 "*) V2=true ;; esac
    case "$t" in *" backend "*) BACKEND=true ;; esac
    case "$t" in *" mcp "*) MCP=true ;; esac
    case "$t" in *" deploy_backend "*) DEPLOY_BACKEND=true ;; esac
  done <<< "$list"
  REASON="по путям: $n файл(ов)"
}

case "$MODE" in
  ci)
    compute_scope
    echo "ci-scope: v1=$V1 v2=$V2 backend=$BACKEND mcp=$MCP ($REASON)"
    [ "$FILES_OK" = 1 ] && printf '%s\n' "$FILES" | sed '/^[[:space:]]*$/d' | head -50 | sed 's/^/  · /'
    emit v1 "$V1"; emit v2 "$V2"; emit backend "$BACKEND"; emit mcp "$MCP"
    emit reason "$REASON"
    ;;

  guard-v1)
    changed_files
    if [ "$FILES_OK" != 1 ]; then
      echo "::error::заморозка v1 НЕ ПРОВЕРЕНА: список изменений PR не получен ($FILES_WHY). Не проверено ≠ чисто."
      exit 2
    fi
    hits="$(printf '%s\n' "$FILES" | grep -E '^src/' || true)"
    if [ -z "$hits" ]; then
      echo "ok: src/ (LORE v1) в PR не тронут"
      exit 0
    fi
    # Метка ищется как отдельная строка JSON-массива: "v1-hotfix", а не подстрока
    # (v1-hotfix-later хотфиксом не считается).
    if printf '%s' "${PR_LABELS:-}" | grep -q '"v1-hotfix"'; then
      echo "::notice::src/ тронут, метка v1-hotfix стоит — хотфикс v1 разрешён. После мержа v1 выкатывается вручную: LORE CD, service=frontend."
      printf '%s\n' "$hits" | sed 's/^/  · /'
      exit 0
    fi
    echo "::error::LORE v1 (src/) заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN): правки идут в web-next/. Если это осознанный хотфикс v1 — повесьте на PR метку v1-hotfix (проверка перезапустится сама). Тронуто:"
    printf '%s\n' "$hits" | sed 's/^/  · /'
    exit 1
    ;;

  cd)
    case "${EVENT_NAME:-}" in
      workflow_dispatch)
        svc="${SERVICE:-both}"
        case "$svc" in
          # both — бэкенд и v2. v1 сюда НЕ входит: он заморожен и пересобирается
          # только явным хотфиксом (service=frontend).
          both)          BE=true  FE=false NEXT=true ;;
          backend)       BE=true  FE=false NEXT=false ;;
          frontend)      BE=false FE=true  NEXT=false ;;
          frontend-next) BE=false FE=false NEXT=true ;;
          *) echo "::error::неизвестный сервис '$svc' (both | backend | frontend | frontend-next)"; exit 2 ;;
        esac
        REASON="ручной запуск: $svc"
        ;;
      *)
        compute_scope
        BE="$DEPLOY_BACKEND"
        # v2 выкатывается вместе с бэкендом: его тесты гоняются на каждую
        # правку бэкенда, и стенд v2 должен стоять на том же бэкенде.
        NEXT="$V2"
        FE=false
        if [ -n "$SRC_TOUCHED" ]; then
          echo "::warning::в пуше есть правки src/ (LORE v1), но v1 заморожен и по пушу не выкатывается. Хотфикс выкатить вручную: LORE CD, service=frontend.${SRC_TOUCHED}"
        fi
        ;;
    esac
    echo "cd-scope: backend=$BE frontend(v1)=$FE frontend_next(v2)=$NEXT ($REASON)"
    emit backend "$BE"; emit frontend "$FE"; emit frontend_next "$NEXT"
    emit reason "$REASON"
    ;;
esac
