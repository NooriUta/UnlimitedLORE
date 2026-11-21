# MCP-сервер LORE по адресу хоста (SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED).
#
# Владелица 19.11.2026: «мне надоело локально mcp пересобирать». Образ собирается
# и выкатывается LORE CD вместе со стендом (сервис lore-mcp в docker-compose.yml),
# наружу отдаётся через nginx фронта как https://<хост LORE>/mcp — своего порта
# наружу нет.
#
# Режим — Streamable HTTP (LORE_MCP_TRANSPORT=http): токен и профиль присылает
# клиент в каждом запросе, своего OIDC client_credentials у сервера нет, поэтому
# секретов в образе и окружении нет вовсе. Клиент без headersHelper может прислать
# пару X-Lore-Client-Id/Secret — тогда токен по ней берёт сервер (нужен только
# LORE_OIDC_ISSUER из compose, это адрес realm, а не секрет).
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# SE-10: отметка сборки (dist/build-info.json) — коммит из аргумента, git в
# контексте сборки нет. Пусто → «unknown», и это видно в /mcp/health.
ARG LORE_BUILD_COMMIT=""
ENV LORE_BUILD_COMMIT=$LORE_BUILD_COMMIT
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production \
    LORE_MCP_TRANSPORT=http \
    LORE_MCP_PORT=9200
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Профили поверхности читаются рядом с dist (profile.ts: ../agent-profiles).
COPY --from=build /app/agent-profiles ./agent-profiles
# OH-MCP-HOSTED-SWITCH: порядок ролей из модели — список ролей подагентов в instructions (subagents.ts).
COPY --from=build /app/model ./model
USER node
EXPOSE 9200
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9200/mcp/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
