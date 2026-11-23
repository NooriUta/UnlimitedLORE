#!/usr/bin/env bash
# Шлагбаум «препрод → прод»: смоук стенда (Playwright, тестовые учётки) на голове PR в main обязан быть зелёным.
# SPRINT_UXR_S11_TEST_OPT/E2E-STAND · владелица 19.11.2026: «пиши все тесты на него и включай в проверку
# между преподом и продом». Раньше зелёный смоук проверял агент руками перед слиянием — теперь CI.
#
#   stand-gate.sh <sha>       ждать статус смоука на коммите (до STAND_GATE_WAIT_MIN минут, по умолчанию 120)
#   stand-gate.sh --selftest  сторож обязан уметь краснеть: решение на заготовленных ответах API
#
# Решение по статусам коммита (контекст содержит «stand-e2e»):
#   success → пропустить; failure/error → стоп; нет или pending → ждать; время вышло → стоп.
set -uo pipefail

decide() { # stdin: JSON ответа /commits/<sha>/status → печатает pass | fail | wait
  node -e '
    let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
      let j; try { j = JSON.parse(d); } catch { console.log("wait"); return; }
      const st = (j.statuses || []).filter(s => /stand-e2e/.test(s.context || ""));
      if (!st.length) return console.log("wait");
      if (st.some(s => s.status === "failure" || s.status === "error")) return console.log("fail");
      if (st.every(s => s.status === "success")) return console.log("pass");
      console.log("wait");
    });'
}

if [ "${1:-}" = "--selftest" ]; then
  rc=0
  check() { got=$(printf '%s' "$2" | decide); [ "$got" = "$1" ] || { echo "::error::самопроверка: ждали $1, получили $got на $2"; rc=1; }; }
  check pass '{"statuses":[{"context":"LORE stand e2e / stand-e2e (push)","status":"success"},{"context":"Backend CI","status":"failure"}]}'
  check fail '{"statuses":[{"context":"LORE stand e2e / stand-e2e (push)","status":"failure"}]}'
  check wait '{"statuses":[{"context":"LORE stand e2e / stand-e2e (push)","status":"pending"}]}'
  check wait '{"statuses":[{"context":"Backend CI","status":"success"}]}'
  check wait 'не json'
  [ "$rc" = 0 ] && echo "самопроверка шлагбаума: ок (pass/fail/wait различаются)"
  exit "$rc"
fi

SHA="${1:?нужен коммит}"
API="${GITHUB_API_URL:-${GITHUB_SERVER_URL:-}/api/v1}"
WAIT_MIN="${STAND_GATE_WAIT_MIN:-120}"
deadline=$(( $(date +%s) + WAIT_MIN * 60 ))
while :; do
  body=$(curl -fsS -H "Authorization: token ${GITHUB_TOKEN:-}" "$API/repos/$GITHUB_REPOSITORY/commits/$SHA/status" 2>/dev/null || echo '')
  verdict=$(printf '%s' "$body" | decide)
  case "$verdict" in
    pass) echo "смоук стенда на $SHA зелёный — выпуск в прод разрешён"; exit 0 ;;
    fail) echo "::error::смоук стенда на $SHA красный — в прод нельзя. Отчёт — в прогоне «LORE stand e2e»."; exit 1 ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::за $WAIT_MIN мин смоук стенда на $SHA так и не стал зелёным (нет статуса или pending) — в прод нельзя, перезапустите проверку после смоука"
    exit 1
  fi
  sleep 60
done
