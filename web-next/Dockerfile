# LORE v2 — образ нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01,
# D-2026-UXR-V2-FOLDER-V1-FROZEN). Живёт рядом с корневым Dockerfile (v1,
# сервис lore-app) и его не трогает.
#
# Контекст сборки — КОРЕНЬ репозитория, а не web-next/:
#   docker build -f web-next/Dockerfile -t lore-app-next .
# Из корня нужен ровно один файл — nginx.conf.template: прокси /lore/ и /bench/
# у v2 обязан быть тем же, что у v1 (через него ходят MCP и телефон), а
# вынос шаблона в общий для обоих фронтов — задача S3-02.
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
COPY kit/src /app/kit/src
COPY web-next/package.json web-next/package-lock.json ./
RUN npm ci
COPY web-next/tsconfig.json web-next/vite.config.ts web-next/index.html ./
COPY web-next/src ./src

# Флаги auth — build-time (Vite впекает import.meta.env в бандл), как у v1.
ARG VITE_LORE_AUTH_ENABLED=""
ARG VITE_OIDC_ISSUER=""
ARG VITE_OIDC_CLIENT_ID=""
ENV VITE_LORE_AUTH_ENABLED=$VITE_LORE_AUTH_ENABLED \
    VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/web-next/dist /usr/share/nginx/html
# Те же правила подстановки, что у v1: фильтр сужает envsubst до наших LORE_*,
# иначе собственные переменные nginx ($host, $uri…) могли бы обнулиться.
ENV NGINX_ENVSUBST_FILTER="^LORE_" \
    LORE_PUBLIC_URL="" \
    LORE_OIDC_ORIGIN="" \
    LORE_VOLVA_ORIGIN=""
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
