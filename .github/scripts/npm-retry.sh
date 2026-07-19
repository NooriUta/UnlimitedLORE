#!/usr/bin/env bash
# npm-команда с повтором и откатом от зеркала.
#
# ЗАЧЕМ. У npm нет списка репозиториев — реестр ровно один. Значит «запасной
# источник» задать нечем, и единственный работающий откат — повторить команду
# без зеркала. Оба отказа этого вечера были ровно такими:
#
#   npm error code EIDLETIMEOUT
#   npm error Idle timeout reached for host `registry.npmjs.org:443`
#
#   npm error 404 '@iconify-json/game-icons@http://…/npm-proxy/…tgz'
#
# Первый — прямой реестр не дожил до конца установки. Второй — зеркало не отдало
# scoped-пакет в момент донастройки. Симметрично: подводить может любая сторона,
# поэтому повтор снимает зеркало, а не наоборот.
set -uo pipefail

ATTEMPTS="${NPM_RETRY_ATTEMPTS:-3}"
DELAY="${NPM_RETRY_DELAY:-15}"

if [ "$#" -eq 0 ]; then
  echo "::error::npm-retry.sh вызван без аргументов"
  exit 2
fi

attempt=1
while : ; do
  echo "── попытка $attempt из $ATTEMPTS: npm $* (реестр: ${npm_config_registry:-по умолчанию}) ──"
  # Код возврата снимается в ветке else: после `fi` он был бы нулевым, потому
  # что `if` без else возвращает 0 при провалившемся условии.
  if npm "$@"; then
    [ "$attempt" -gt 1 ] && echo "::notice::npm прошёл с попытки $attempt"
    exit 0
  else
    rc=$?
  fi

  if [ -n "${npm_config_registry:-}" ]; then
    unset npm_config_registry
    echo "::warning::попытка с зеркалом не удалась — следующая пойдёт в обычный реестр"
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "::error::npm падал $ATTEMPTS раза подряд, последний код $rc — причина в логе выше"
    exit "$rc"
  fi

  echo "::warning::попытка $attempt не удалась (код $rc), повтор через ${DELAY}с"
  sleep "$DELAY"
  attempt=$((attempt + 1))
done
