#!/usr/bin/env bash
# Сокращённый прогон бэкенда на PR в develop — SPRINT_LORE_PIPELINE_HOST/PL-02
# (правило владелицы 11.11.2026: «маленькие CI для PR, всю трубу — при мерже»).
#
# Компиляция main+test ВСЕГДА (сломанная сборка видна сразу), затем только
# затронутые тест-классы — список считает ci-scope.sh (BACKEND_TESTS): изменённые
# тесты и тесты, где встречается имя изменённого класса. Live-DB тесты из списка
# идут на встроенной ArcadeDB (LORE_TEST_DB_EMBEDDED=true): ни общей тест-БД,
# ни образа. Полный набор на живой ArcadeDB CI — push в develop и промо.
#
# Запуск: из каталога backend/, BACKEND_TESTS="ClassATest ClassBTest".
set -uo pipefail
RETRY="$(dirname "$0")/gradle-retry.sh"

echo "::notice::сокращённый прогон бэкенда (PR в develop): компиляция + затронутые тесты; полный набор — после мержа в develop"
bash "$RETRY" compileTestJava --no-daemon || exit $?

read -r -a classes <<< "${BACKEND_TESTS:-}"
if [ "${#classes[@]}" -eq 0 ]; then
  echo "::notice::затронутых тест-классов нет — только компиляция main+test"
  exit 0
fi
args=()
for c in "${classes[@]}"; do
  case "$c" in *[!A-Za-z0-9_]*|'') echo "::error::странное имя тест-класса '$c' — список из ci-scope.sh испорчен"; exit 2 ;; esac
  args+=(--tests "*.$c")
done
echo "тест-классов: ${#classes[@]} — ${classes[*]}"
LORE_TEST_DB_EMBEDDED=true bash "$RETRY" test --no-daemon "${args[@]}"
