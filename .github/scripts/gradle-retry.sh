#!/usr/bin/env bash
# Повтор gradle-задачи при обрыве загрузки зависимостей.
#
# ЗАЧЕМ. Отказ 2026-07-19 на PR #173:
#
#   Could not resolve io.quarkus:quarkus-classloader-commons:3.36.1
#     > Could not GET 'https://repo.maven.apache.org/maven2/.../*.pom'
#        > Read timed out
#   > There are 51 more failures with identical causes.
#
# Выкачка самого репозитория тут ни при чём — она идёт с локального Forgejo и
# занимает доли секунды. Обрывается путь до Maven Central, и интернет на этом
# канале нестабилен: за сутки backend CI падал примерно в трети прогонов, на тех
# же файлах, вперемежку с зелёными.
#
# Ретрай уже был — но ТОЛЬКО на сборке docker-образа (см. backend-ci.yml).
# Шаги `gradlew build` и `gradlew test` его не имели, и отказ пришёлся ровно
# туда, где его не предусмотрели.
#
# ЭТО ЗАПЛАТКА, А НЕ РЕШЕНИЕ. Настоящее — зеркало Maven Central (Nexus), которое
# владелец поднимает параллельно: тогда зависимости берутся из локальной сети и
# внешний канал перестаёт быть на критическом пути сборки. После появления
# зеркала этот скрипт можно оставить как страховку, но повторов быть не должно —
# если они продолжатся, значит зеркало не используется.
#
# ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ, а не bash внутри `run:` — многострочный bash в
# workflow уже дважды ломал разбор у Forgejo (см. resolve-proxy.sh).
#
# НЕ ПОВТОРЯТЬ УПАВШИЕ ТЕСТЫ (20.10.2026). Повтор задуман против обрыва канала,
# а срабатывал на ЛЮБОЙ отказ — в том числе на честно упавший тест. Тест,
# падающий детерминированно, падал трижды: PR #688 держал слот выделенного
# раннера 52 минуты вместо ~16, с теми же тремя отказами в каждой попытке, а
# очередь остальных PR стояла за ним. Отказ, в котором тесты ДОБЕЖАЛИ и
# упали, — не сеть: повтор его не лечит, только прячет красный на час.
set -uo pipefail

ATTEMPTS="${GRADLE_RETRY_ATTEMPTS:-3}"
DELAY="${GRADLE_RETRY_DELAY:-20}"

# Тесты добежали и упали? Признаки — строка итога build.gradle с ненулевым
# «упало» и стандартное сообщение Gradle о падении тестов.
tests_failed() {
  grep -a -q -E '==== ИТОГ ТЕСТОВ: .*упало [1-9]|There were failing tests' "$1"
}

if [ "${1:-}" = "--selftest" ]; then
  t=$(mktemp -d); rc=0
  printf '==== ИТОГ ТЕСТОВ: всего 747, зелёных 744, упало 3, пропущено 0 ====\n' > "$t/red"
  printf "> There were failing tests. See the report at: file:///x/index.html\n" > "$t/gradle"
  printf 'Could not GET https://repo.maven.apache.org/x.pom\n> Read timed out\n' > "$t/net"
  printf '==== ИТОГ ТЕСТОВ: всего 747, зелёных 747, упало 0, пропущено 0 ====\nRead timed out\n' > "$t/green"
  tests_failed "$t/red"    || { echo "::error::selftest.red FAIL — упавшие тесты не опознаны, их снова будут повторять"; rc=1; }
  tests_failed "$t/gradle" || { echo "::error::selftest.gradle FAIL — сообщение Gradle о тестах не опознано"; rc=1; }
  tests_failed "$t/net"    && { echo "::error::selftest.net FAIL — обрыв сети принят за тесты, повтора не будет"; rc=1; }
  tests_failed "$t/green"  && { echo "::error::selftest.green FAIL — «упало 0» принято за отказ тестов"; rc=1; }
  rm -rf "$t"; [ "$rc" -eq 0 ] && echo "selftest ok"; exit "$rc"
fi

if [ "$#" -eq 0 ]; then
  echo "::error::gradle-retry.sh вызван без аргументов — нечего запускать"
  exit 2
fi

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

attempt=1
while : ; do
  echo "── попытка $attempt из $ATTEMPTS: ./gradlew $* ──"
  # Код — ИМЕННО gradle, а не tee: PIPESTATUS[0], иначе конвейер отдал бы
  # код tee (0) и скрипт «падал бы успешно».
  ./gradlew "$@" 2>&1 | tee "$LOG"
  rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ]; then
    [ "$attempt" -gt 1 ] && echo "::notice::сборка прошла с попытки $attempt — канал до Maven Central нестабилен"
    exit 0
  fi

  if tests_failed "$LOG"; then
    echo "::error::тесты добежали и упали (код $rc) — это не сеть, повтор не поможет; причина в сводке «УПАВШИЕ ТЕСТЫ» выше"
    exit "$rc"
  fi

  # ОТКАТ ОТ ЗЕРКАЛА. Первая же неудача снимает init-скрипт Nexus, и следующая
  # попытка идёт в публичные репозитории. Так отказ зеркала стоит одной лишней
  # попытки, а не красного билда.
  #
  # Именно повтором целиком, а не «запасным репозиторием в списке»: последнее не
  # работает. Gradle запоминает, откуда пришёл .pom, и за .jar идёт туда же —
  # если зеркало отдало одно и не отдало другое, поиск по остальным
  # репозиториям не повторяется (проверено отказом 2026-07-19).
  NEXUS_INIT="${GRADLE_USER_HOME:-$HOME/.gradle}/init.d/nexus.gradle"
  if [ -f "$NEXUS_INIT" ]; then
    mv "$NEXUS_INIT" "$NEXUS_INIT.disabled"
    echo "::warning::попытка с зеркалом Nexus не удалась — следующая пойдёт напрямую"
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    # Отдельным сообщением, потому что «упало три раза подряд» и «упало один
    # раз» — разные диагнозы. Первое означает, что дело не в канале, и искать
    # надо в коде; повтор при этом честно израсходован, а не пропущен.
    echo "::error::gradle падал $ATTEMPTS раз подряд, последний код $rc. Столько обрывов подряд на сеть уже не спишешь — причина в логе выше."
    exit "$rc"
  fi

  echo "::warning::попытка $attempt не удалась (код $rc), повтор через ${DELAY}с"
  sleep "$DELAY"
  attempt=$((attempt + 1))
done
