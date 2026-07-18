FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Флаги auth — build-time, и иначе никак: Vite впекает import.meta.env в бандл
# на `npm run build`, поэтому переменной окружения у запущенного контейнера их
# уже не поменять. Без этих ARG передать их было НЕЧЕМ, и включение auth
# упиралось не в конфигурацию, а в отсутствие входа для неё.
#
# Пусто по умолчанию → AUTH_ENABLED=false в src/auth/session.ts, то есть сборка
# без аргументов ведёт себя ровно как раньше.
#
# Флипать вместе с бэкендовым LORE_AUTH_ENABLED и настройками MCP: включённый
# фронт при выключенном бэкенде шлёт токен, который никто не проверяет, а
# обратное — бэкенд требует токен, которого фронт не присылает (docs/AUTH_OMILORE.md).
ARG VITE_LORE_AUTH_ENABLED=""
ARG VITE_OIDC_ISSUER=""
ARG VITE_OIDC_CLIENT_ID=""
ENV VITE_LORE_AUTH_ENABLED=$VITE_LORE_AUTH_ENABLED \
    VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
