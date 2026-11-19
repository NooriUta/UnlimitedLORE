# SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 · Сторож входов в ArcadeDB. Без зависимостей: только node:http.
# База образа — та же, что у сборки web-next (node:26-alpine).
FROM node:26-alpine
WORKDIR /app
COPY lib.mjs guard.mjs ./
USER node
EXPOSE 2480
CMD ["node", "guard.mjs"]
