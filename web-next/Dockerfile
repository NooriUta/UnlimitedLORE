# LORE v2 — образ нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01,
# D-2026-UXR-V2-FOLDER-V1-FROZEN). Живёт рядом с корневым Dockerfile (v1,
# сервис lore-app) и его не трогает.
#
# Контекст сборки — КОРЕНЬ репозитория, а не web-next/:
#   docker build -f web-next/Dockerfile -t lore-app-next .
# Из корня нужны ровно два файла, общие с v1 (S3-02): nginx.conf.template —
# прокси /lore/ и /bench/ у v2 обязан быть тем же, что у v1 (через него ходят
# MCP и телефон), — и скрипт старта docker/30-lore-public-url.sh.
#
# Копирование только поимённое. Корневой .dockerignore отсекает node_modules
# лишь в корне, web-next/node_modules под него не попадает — `COPY web-next/ .`
# утащил бы в образ локальные (возможно, виндовые) бинарники. И ни одного
# файла v1 (src/, корневой package.json) в образе v2 быть не должно — это
# сторожит web-next/src/infra.test.ts.
#
# Seiðr-kit (kit/, D-2026-UXR-KIT-REACT, S4-00a) — зависимость file:../kit,
# поэтому раскладка повторяет репозиторий: /app/kit рядом с /app/web-next.
# Тоже поимённо: kit/node_modules (локальный, для тестов kit) в образ не идёт.
FROM node:26-alpine AS build
WORKDIR /app/web-next
COPY kit/package.json /app/kit/package.json
COPY web-next/package.json web-next/package-lock.json ./
# Установка — только по манифестам: kit — file:-зависимость (симлинк), его
# исходники npm ci не нужны. Правка kit/src не должна сбрасывать этот слой
# (PR #882: свежий npm ci в образе потерял @rolldown/binding-linux-x64-musl).
RUN npm ci
COPY kit/src /app/kit/src
# Демо-конфиги и фикстуры kit (K-03): страницы /kit/demo/* импортируют @seidr/kit/demo/*.
COPY kit/demo /app/kit/demo
COPY web-next/tsconfig.json web-next/vite.config.ts web-next/index.html ./
COPY web-next/src ./src

# Настроек входа (вход вкл/выкл, адрес Keycloak, клиент) в сборке НЕТ — это настройки ЗАПУСКА
# (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE): env контейнера LORE_AUTH_ENABLED,
# LORE_OIDC_ISSUER, LORE_OIDC_CLIENT_ID → /config.json скриптом старта 40-lore-runtime-config.sh.
# Раньше они были build-arg VITE_*, и образ препрода увозил на прод вход в realm препрода (15.11).
# S4-30: из какого коммита собран фронт — для метки версии в правом нижнем углу.
# Это свойство самой сборки, а не среды, поэтому build-time: Vite впекает
# import.meta.env в бандл. Пусто — метка честно скажет «сервер …».
ARG VITE_LORE_BUILD_COMMIT=""
ENV VITE_LORE_BUILD_COMMIT=$VITE_LORE_BUILD_COMMIT

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/web-next/dist /usr/share/nginx/html
# Те же правила подстановки, что у v1: фильтр сужает envsubst до наших LORE_*,
# иначе собственные переменные nginx ($host, $uri…) могли бы обнулиться.
ENV NGINX_ENVSUBST_FILTER="^LORE_" \
    LORE_PUBLIC_URL="" \
    LORE_OIDC_ORIGIN="" \
    LORE_VOLVA_ORIGIN="" \
    LORE_BACKEND_URL="" \
    LORE_BACKEND_HOST=""
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# Общий с v1 скрипт старта (S3-02): подсказывает, каких LORE_* не хватает для
# входа по OIDC. LORE_FRONT метит его строки как «[LORE v2]»; в шаблоне nginx
# ${LORE_FRONT} нет, поэтому envsubst её никуда не подставляет.
ENV LORE_FRONT=v2
COPY docker/30-lore-public-url.sh /docker-entrypoint.d/30-lore-public-url.sh
RUN chmod +x /docker-entrypoint.d/30-lore-public-url.sh
# Настройки входа фронта — из env контейнера при старте в /config.json (SELF-PROVISION-STANDALONE).
# Пустые умолчания: «не задано» — фронт спросит бэкенд своей среды, не скажет и он — «вход не настроен».
ENV LORE_AUTH_ENABLED="" \
    LORE_OIDC_ISSUER="" \
    LORE_OIDC_CLIENT_ID=""
COPY docker/40-lore-runtime-config.sh /docker-entrypoint.d/40-lore-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-lore-runtime-config.sh
EXPOSE 80
