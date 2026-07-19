#!/usr/bin/env bash
# Направляет сборку на кеширующее зеркало Nexus в локальной сети.
#
# ЗАЧЕМ. Канал до внешних реестров нестабилен: backend CI падал примерно в трети
# прогонов с `Read timed out` на Maven Central (52 артефакта подряд, PR #173).
# Ретрай это лечил повтором, зеркало убирает причину — зависимости берутся из
# LAN. Замер на том же артефакте, из-за которого падало:
#
#   зеркало (прогрето) — 0.025 с
#   зеркало (холодное) — 6.6 с
#   Maven Central       — 10.6 с
#
# ОТКАЗОУСТОЙЧИВОСТЬ — два уровня, оба намеренные.
#
# 1. Если Nexus недоступен, скрипт НИЧЕГО не делает и выходит с нулём. Сборка
#    пойдёт по прежнему пути. Зеркало не должно становиться единой точкой отказа:
#    иначе выключенный ci-server останавливал бы CI целиком.
#
# 2. Публичные репозитории остаются в списке ВТОРЫМИ, а не удаляются. Это важнее,
#    чем кажется: Nexus отвечает `404`, когда не смог сходить наверх и кэш пуст.
#    Такой ответ читается как «артефакта не существует», а не «не достучался», и
#    диагностика уходит в сторону. Хуже того, у Nexus есть отрицательный кэш —
#    по умолчанию он держит этот 404 сутки. Один обрыв в неудачную минуту прибил
#    бы артефакт на день, и сборка падала бы с «not found» при живом интернете.
#    С запасным репозиторием такой 404 просто приводит к обращению напрямую.
set -uo pipefail

NEXUS="${NEXUS_URL:-http://192.168.3.131:8081}"
MAVEN_MIRROR="$NEXUS/repository/maven-central-proxy/"
PLUGIN_MIRROR="$NEXUS/repository/gradle-plugins-proxy/"
NPM_MIRROR="$NEXUS/repository/npm-proxy/"

# Проверка здесь НАМЕРЕННО поверхностная — только «отвечает ли». Угадывать,
# отдаст ли зеркало каждый нужный артефакт, бессмысленно: оно может ответить на
# пробу и споткнуться на десятом jar-е. Настоящий запас устроен иначе — сборка
# ПОВТОРЯЕТСЯ БЕЗ ЗЕРКАЛА, если попытка с ним не удалась (см. gradle-retry.sh,
# compose-build-retry.sh, npm-retry.sh). Отказ зеркала стоит одной лишней
# попытки, а не красного билда.
#
# Так получается и честнее: «публичные репозитории вторыми в списке» запасом НЕ
# являются. Gradle запоминает, откуда пришёл .pom, и за .jar идёт туда же — если
# зеркало отдало одно и не отдало другое, сборка падает, сколько запасных ни
# пропиши. У npm запаса нет вовсе: реестр один. Единственный работающий откат —
# повторить целиком, без зеркала.
if ! curl -sf --noproxy '*' -m 8 -o /dev/null "$NEXUS/service/rest/v1/repositories"; then
  echo "::notice::Nexus ($NEXUS) не отвечает — сборка идёт напрямую, как раньше"
  exit 0
fi
echo "Nexus отвечает: $NEXUS"

# ── Gradle ───────────────────────────────────────────────────────────────────
# Init-скриптом, а не правкой settings.gradle/build.gradle: файлы сборки должны
# оставаться пригодными вне этой сети — на github-hosted раннере и на машине
# разработчика, где 192.168.3.131 не существует.
GRADLE_HOME="${GRADLE_USER_HOME:-$HOME/.gradle}"
mkdir -p "$GRADLE_HOME/init.d"
cat > "$GRADLE_HOME/init.d/nexus.gradle" <<GRADLE
// Сгенерирован .github/scripts/use-nexus.sh — правки здесь будут затёрты.
def mavenMirror  = '$MAVEN_MIRROR'
def pluginMirror = '$PLUGIN_MIRROR'

// allowInsecureProtocol: зеркало отдаётся по http внутри LAN. Gradle с 7.0
// блокирует такие репозитории молча-непонятным сообщением, если не разрешить.
settingsEvaluated { settings ->
    settings.pluginManagement.repositories {
        maven { url = pluginMirror; allowInsecureProtocol = true }
        maven { url = mavenMirror;  allowInsecureProtocol = true }
    }
}

allprojects {
    buildscript.repositories {
        maven { url = mavenMirror; allowInsecureProtocol = true }
    }
    repositories {
        maven { url = mavenMirror; allowInsecureProtocol = true }
    }
}
GRADLE
echo "  gradle → $GRADLE_HOME/init.d/nexus.gradle"

# ── npm ──────────────────────────────────────────────────────────────────────
# Через окружение job'а, а не `npm config set`: глобальный конфиг раннера общий
# для всех репозиториев на этом хосте, и правка утекла бы в чужие сборки.
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "npm_config_registry=$NPM_MIRROR" >> "$GITHUB_ENV"
  echo "  npm → $NPM_MIRROR"
else
  echo "  npm: GITHUB_ENV не задан (запуск вне CI) — реестр не переключаю"
fi
