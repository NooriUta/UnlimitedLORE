#!/usr/bin/env bash
# Выбирает РАБОЧИЙ адрес HTTP-прокси и подставляет его на остаток job'а.
#
# Зачем это вообще. Конфигурация прокси переезжает вместе с раннером, а адрес,
# верный на одном хосте, на другом не значит ничего: на ноуте прокси виден как
# host.docker.internal (имя подставляет Docker Desktop), на Linux-хосте
# ci-server того же имени изнутри контейнера может не быть — есть шлюз
# docker-моста. Мёртвый адрес молча уводит сборку на прямой путь, а он у
# ci-server деградирован: 20 пакетов через прокси — 20 секунд, напрямую —
# ~3 минуты, `apk add curl` вовсе отваливается, а Gradle получает
# «Remote host terminated the handshake» на Maven Central.
#
# Почему отдельным файлом, а не шагом в workflow. Ровно эта логика, вписанная
# в `run:` внутри YAML, дважды подряд ломала РАЗБОР workflow парсером Forgejo:
# job падал за 1 секунду, не начавшись, притом что js-yaml файл принимал.
# Искать перебором, какая конструкция ему не нравится, — по пушу на попытку.
# В скрипте bash-код парсеру не виден вовсе: в YAML остаётся одна строка вызова.
#
# ПРОВЕРКА ИМЕННО TCP-КОННЕКТОМ, И ЭТО НАМЕРЕННО. Не заменять на HTTP-пробу
# через busybox wget: он получает через этот прокси 400 Bad Request, тогда как
# curl и npm работают, — и такая проба объявила бы живой прокси мёртвым.
set -u

P="${HTTP_PROXY:-${http_proxy:-}}"
if [ -z "$P" ]; then
  echo "прокси не задан — ничего не делаем"
  exit 0
fi

hostport="${P#*://}"
hostport="${hostport%%/*}"
h="${hostport%%:*}"
p="${hostport##*:}"
[ "$p" = "$h" ] && p=8080

# Шлюз docker-моста — то, чем host.docker.internal является на Linux.
GW="$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')"

# IP пробуем ПЕРВЫМИ. Имя из конфигурации может резолвиться в job-контейнере, но
# НЕ резолвиться внутри docker build (там host.docker.internal сам по себе не
# существует на Linux-демоне) — а выбранный адрес уезжает в build-args. IP
# одинаково понятен обоим.
PICKED=""
for cand in "$GW" 172.17.0.1 "$h" host.docker.internal; do
  [ -z "$cand" ] && continue
  if timeout 3 bash -c "exec 3<>/dev/tcp/$cand/$p" 2>/dev/null; then
    PICKED="$cand"
    break
  fi
  echo "  $cand:$p — не отвечает"
done

if [ -z "$PICKED" ]; then
  echo "::warning::прокси не найден ни по одному адресу (шлюз $GW, 172.17.0.1, $h, host.docker.internal на порту $p) — снимаю proxy-переменные. Если дальше npm/Gradle упрётся в таймаут или «Remote host terminated the handshake» — причина ЗДЕСЬ: прямой выход у этого хоста деградирован. Чинить прокси в конфигурации раннера, а не npm/Gradle."
  for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; do
    echo "$v=" >> "$GITHUB_ENV"
  done
  # Снимаем и свойства Gradle: раннер переиспользует $HOME между прогонами, и
  # оставленный от прошлого раза адрес увёл бы Gradle в заведомо мёртвый прокси —
  # отказ выглядел бы как «сборка сломалась», хотя сломан адрес.
  gprops="$HOME/.gradle/gradle.properties"
  if [ -f "$gprops" ]; then
    grep -vE '^systemProp\.(http|https)\.(proxyHost|proxyPort|nonProxyHosts)=' "$gprops" > "$gprops.tmp" 2>/dev/null || true
    mv "$gprops.tmp" "$gprops" 2>/dev/null || true
    echo "прежние proxy-свойства Gradle сняты"
  fi
  exit 0
fi

# ── Gradle ────────────────────────────────────────────────────────────────────
# GRADLE НЕ ЧИТАЕТ HTTP_PROXY/HTTPS_PROXY ИЗ ОКРУЖЕНИЯ — ему нужны системные
# свойства Java. Ровно это уже написано в backend/Dockerfile.local и решено ТАМ,
# внутри сборки образа. Но шаги «Gradle build» и «Gradle test» идут НА РАННЕРЕ,
# и до этой правки они такой трансляции не имели: скрипт честно выставлял
# HTTP_PROXY, а Gradle его игнорировал и шёл напрямую.
#
# Прямой выход у этого хоста деградирован, поэтому отказ выглядел как случайный:
# иногда проскакивало, иногда падало на
#   Could not GET 'https://repo.maven.apache.org/maven2/...'
#     > repo.maven.apache.org: Temporary failure in name resolution
# при полностью исправном DNS (проверено: и хост, и контейнер раннера резолвят
# имя в IPv4). Не флак — отсутствие прокси ровно на одном шаге из двух.
#
# Пишется в $HOME/.gradle/gradle.properties, а не в проектный: проектный лежит в
# репозитории и правка испачкала бы рабочее дерево.
write_gradle_proxy() {
  gh="$1"; gp="$2"
  mkdir -p "$HOME/.gradle"
  gprops="$HOME/.gradle/gradle.properties"
  # Прежние строки снимаем: шаг может выполниться повторно, а дублирующиеся
  # systemProp с разными значениями дают неочевидный «последний выиграл».
  if [ -f "$gprops" ]; then
    grep -vE '^systemProp\.(http|https)\.(proxyHost|proxyPort|nonProxyHosts)=' "$gprops" > "$gprops.tmp" 2>/dev/null || true
    mv "$gprops.tmp" "$gprops" 2>/dev/null || true
  fi
  NP="$(printf '%s' "${NO_PROXY:-${no_proxy:-}}" | tr ',' '|')"
  {
    echo "systemProp.http.proxyHost=$gh"
    echo "systemProp.http.proxyPort=$gp"
    echo "systemProp.https.proxyHost=$gh"
    echo "systemProp.https.proxyPort=$gp"
    [ -n "$NP" ] && echo "systemProp.http.nonProxyHosts=$NP" || true
    [ -n "$NP" ] && echo "systemProp.https.nonProxyHosts=$NP" || true
  } >> "$gprops"
  echo "прокси для Gradle на раннере: $gh:$gp ($gprops)"
}
write_gradle_proxy "$PICKED" "$p"

NEW="http://$PICKED:$p"
if [ "$NEW" = "$P" ]; then
  echo "прокси $P доступен как есть"
  exit 0
fi

echo "прокси доступен по $NEW (в конфигурации было $P) — подставляю рабочий адрес"
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; do
  echo "$v=$NEW" >> "$GITHUB_ENV"
done
