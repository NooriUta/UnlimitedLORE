#!/usr/bin/env bash
# Печатает, что РЕАЛЬНО уйдёт в --build-arg сборки бэкенда (AL-53).
#
# Зачем. Деплой падал так: LORE_AUTH_ENABLED=true стоит в env job'а, образ
# пересобирается СВЕЖИМ (2 м 6 с, не из кэша), контейнер пересоздаётся — а в
# готовом бэкенде auth выключен. Значения ARG внутрь BuildKit не печатает,
# поэтому причина неотличима: compose не подставил · job-env не виден команде ·
# кэш слоя · Quarkus не поднял свойство. Симптом у всех четырёх один.
#
# `docker compose config` печатает конфигурацию ПОСЛЕ интерполяции — видно
# значение, пустую строку или отсутствие ключа. Три исхода = три разные починки.
#
# Вторая половина диагностики — `RUN echo` перед gradlew в backend/Dockerfile.local:
# она показывает, что видит сам билд. Нужны обе: первая проверяет доставку до
# сборки, вторая — внутрь неё.
#
# ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ ШАГОМ В YAML. Bash-логика, вписанная в `run:`,
# дважды подряд ломала РАЗБОР workflow парсером Forgejo: job падал за 1 секунду,
# не начавшись, притом что js-yaml файл принимал. В скрипте bash парсеру не
# виден вовсе — в YAML остаётся одна строка вызова. Тот же приём, что в
# resolve-proxy.sh.
set -u

echo "job env: LORE_AUTH_ENABLED=[${LORE_AUTH_ENABLED:-<не задан>}]"
echo "job env: LORE_OIDC_ISSUER=[${LORE_OIDC_ISSUER:-<не задан>}]"
echo "job env: VITE_LORE_AUTH_ENABLED=[${VITE_LORE_AUTH_ENABLED:-<не задан>}]"

echo "--- docker compose config, секция build.args обоих сервисов:"
if ! docker compose config > /tmp/compose-resolved.yml 2>/tmp/compose-err.txt; then
  echo "::warning::docker compose config не отработал — причина ниже"
  head -c 500 /tmp/compose-err.txt
  exit 0   # диагностика не должна ронять деплой
fi

# Сервисы в выводе идут по алфавиту (lore-app раньше lore-backend), поэтому
# режем по имени сервиса, а не по порядку следования.
awk '/^  [a-z-]+:$/ {svc=$1} /args:/ {print "  [" svc "] args:"; inargs=1; next}
     inargs && /^        [A-Z_]+:/ {print "     " $0; next}
     inargs {inargs=0}' /tmp/compose-resolved.yml

echo "--- ожидание: у lore-backend LORE_AUTH_ENABLED=\"true\", у lore-app VITE_LORE_AUTH_ENABLED=\"true\""
