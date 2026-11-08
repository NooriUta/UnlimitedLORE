#!/bin/sh
# Подсказка при старте контейнера фронтенда: какие настройки нужны ЧУЖОЙ
# установке. Раньше их не требовалось задавать вовсе — канонический адрес
# стенда и origin Keycloak были вшиты в nginx.conf литералами, и посторонняя
# установка, открытая по IP, уезжала редиректом на чужой хост.
#
# Почему предупреждение, а не отказ старта. Обе настройки нужны ТОЛЬКО для
# входа по OIDC. Установка без них полностью работоспособна с выключенным
# auth, и ронять её было бы враньём про серьёзность проблемы. Но и молчать
# нельзя: без HTTPS-адреса вход не заработает физически (PKCE требует
# защищённого контекста), а без origin в CSP логин пройдёт и начнёт молча
# отваливаться через минуты — отладить такое по симптомам крайне трудно.
#
# Порядок в /docker-entrypoint.d значим: 20-envsubst-on-templates.sh штатного
# образа уже отработал, конфиг собран, мы лишь комментируем результат.
#
# Скрипт ОБЩИЙ для обоих фронтов (SPRINT_UXR_S3_V2_INFRA/S3-02): его кладут и
# корневой Dockerfile (v1, lore-app), и web-next/Dockerfile (v2, lore-app-next).
# LORE_FRONT метит строки лога, чтобы по `docker logs` было видно, чей это
# контейнер. Образ v1 её не задаёт, и его вывод остаётся прежним «[LORE] …»
# (v1 заморожен, D-2026-UXR-V2-FOLDER-V1-FROZEN); у v2 — «[LORE v2] …».
set -e

P="[LORE${LORE_FRONT:+ $LORE_FRONT}]"

if [ -z "$LORE_PUBLIC_URL" ]; then
    echo "$P LORE_PUBLIC_URL не задана — редирект на канонический HTTPS-адрес ВЫКЛЮЧЕН."
    echo "$P   Приложение работает; вход по OIDC при заходе на голый IP работать не будет"
    echo "$P   (PKCE считает code_challenge через crypto.subtle, а он доступен только"
    echo "$P   в защищённом контексте: HTTPS либо localhost)."
    echo "$P   Задайте адрес своей установки, например: LORE_PUBLIC_URL=https://lore.example.org"
else
    echo "$P канонический адрес: $LORE_PUBLIC_URL (заход по голому IP уводится сюда)"
fi

if [ -z "$LORE_OIDC_ORIGIN" ]; then
    echo "$P LORE_OIDC_ORIGIN не задана — постороннего origin в CSP нет."
    echo "$P   Это верно при выключенном auth. При включённом укажите origin своего"
    echo "$P   Keycloak, например: LORE_OIDC_ORIGIN=https://auth.example.org —"
    echo "$P   иначе логин пройдёт, а тихое обновление сессии в iframe упрётся в CSP."
else
    echo "$P origin Keycloak в CSP: $LORE_OIDC_ORIGIN"
fi

if [ -z "$LORE_VOLVA_ORIGIN" ]; then
    echo "$P LORE_VOLVA_ORIGIN не задана — встраивание графиков Völva выключено (frame-src без Völva)."
    echo "$P   Чтобы включить: LORE_VOLVA_ORIGIN=https://volva.example.org — ровно один origin."
else
    echo "$P origin Völva в frame-src CSP: $LORE_VOLVA_ORIGIN"
fi
