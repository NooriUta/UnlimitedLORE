#!/bin/sh
# Настройки входа веба v2 — из env контейнера при СТАРТЕ, а не из сборки образа
# (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE; владелица: «гвозди убери из инсталлятора»).
#
# Раньше адрес Keycloak впекался в бандл при сборке (VITE_OIDC_ISSUER): прод вёз образ препрода и
# уходил на вход в realm препрода (15.11), а чужая установка с нашим образом пошла бы в наш Keycloak.
# Теперь образ не знает ни одного адреса: этот скрипт собирает /config.json из env контейнера, фронт
# читает его до инициализации входа (web-next/src/auth/runtimeAuthConfig.ts). Смена настройки —
# `docker compose up -d`, без пересборки образа.
#
#   LORE_AUTH_ENABLED    — true | false; пусто — решает бэкенд своей среды (/lore/auth/config);
#   LORE_OIDC_ISSUER     — https://<keycloak>/realms/<realm>; пусто — решает бэкенд, не сказал и он —
#                          экран «вход не настроен»;
#   LORE_OIDC_CLIENT_ID  — публичный клиент веба; пусто — lore-app.
# Только публичное: адрес, на который браузер всё равно уходит, и имя клиента. Секретов здесь нет.
#
# Путь файла переопределяется LORE_CONFIG_JSON (тест web-next/src/runtimeConfigScript.test.ts).
set -e

OUT="${LORE_CONFIG_JSON:-/usr/share/nginx/html/config.json}"
P="[LORE${LORE_FRONT:+ $LORE_FRONT}]"

# JSON-строка: экранируем обратный слэш и кавычку; переводы строк в адресах не бывают — срезаем.
json_str() {
    printf '"%s"' "$(printf '%s' "$1" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

TMP="$OUT.tmp"
{
    printf '{'
    printf '"auth_enabled":%s,' "$(json_str "${LORE_AUTH_ENABLED:-}")"
    printf '"oidc_issuer":%s,' "$(json_str "${LORE_OIDC_ISSUER:-}")"
    printf '"oidc_client_id":%s' "$(json_str "${LORE_OIDC_CLIENT_ID:-}")"
    printf '}\n'
} > "$TMP"
mv "$TMP" "$OUT"

if [ "${LORE_AUTH_ENABLED:-}" = "true" ] && [ -z "${LORE_OIDC_ISSUER:-}" ]; then
    echo "$P LORE_AUTH_ENABLED=true, но LORE_OIDC_ISSUER не задан — адрес входа фронт спросит у бэкенда;"
    echo "$P   не скажет и он — экран «вход не настроен». Пример: LORE_OIDC_ISSUER=https://auth.example.org/realms/lore"
else
    echo "$P настройки входа для фронта: $OUT (вход: ${LORE_AUTH_ENABLED:-от бэкенда}, issuer: ${LORE_OIDC_ISSUER:-от бэкенда})"
fi
