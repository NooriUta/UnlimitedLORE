# LORE — разворот с нуля

**Перенесено в LORE (2026-07-14):** полный чек-лист теперь живёт как runbook
`RUNBOOK-DEPLOY-LOCAL-DEV` — `:4400/lore?section=knowledge&passport=RUNBOOK-DEPLOY-LOCAL-DEV`
(или `query_slice({slice:"runbook_by_id", params:{id:"RUNBOOK-DEPLOY-LOCAL-DEV"}})` из MCP).
Этот файл больше не обновляется — правьте runbook в LORE, не этот .md.

См. также: [`LORE_OVERVIEW.md`](./LORE_OVERVIEW.md) — что это вообще такое,
[`backend/db-schema/README.md`](../backend/db-schema/README.md) — детали шага 2.

## Предпосылки

- Docker + Docker Compose
- Java 21 (для локальной сборки backend, `./gradlew`)
- Node.js 20+ (для frontend и MCP-сервера)
- Доступ к `C:/AIDA/aida-root` (там определён контейнер ArcadeDB — LORE в него
  не входит, это сателлит)

## Шаг 1 — поднять ArcadeDB (если ещё не поднята)

ArcadeDB **не** часть `docker-compose.yml` этого репозитория — она общая с
основным проектом (Hound/lineage-графом). Контейнер `Ygg-1` (образ
`arcadedata/arcadedb:26.6.1`) определён в
`C:/AIDA/aida-root/docker-compose.stable.yml` (или `.prod.yml`).

```bash
cd C:/AIDA/aida-root
docker compose -f docker-compose.stable.yml up -d ygg
```

Порт `:2480` публикуется на `127.0.0.1` (только localhost). Root-пароль — env
`ARCADEDB_ROOT_PASSWORD` (fallback `playwithdata` в dev-окружении, в проде задать
явно). Проверка живости:

```bash
curl http://localhost:2480/api/v1/ready
```

## Шаг 2 — создать БД `system_aida_lore` и развернуть схему

БД сама по себе не создаётся автоматически — либо через ArcadeDB Studio
(`http://localhost:2480` → Databases → Create), либо командой:

```bash
curl -s -X POST http://localhost:2480/api/v1/server -u root:<password> \
  -H "Content-Type: application/json" \
  -d '{"command":"create database system_aida_lore"}'
```

Затем развернуть схему (типы/индексы) — см.
[`backend/db-schema/README.md`](../backend/db-schema/README.md):

```bash
cd backend/db-schema
ARCADEDB_PASS=<password> ./bootstrap.sh
```

Проверка: `SELECT FROM schema:types` должно вернуть 87 типов (51 vertex + 36
edge) — сверить со `schema-metadata.json` в той же папке.

**Проще — ничего не делать:** на пустой базе (нет ядровых типов KnowTask/KnowSprint/KnowADR)
`LoreSchemaInitializer.java` поднимает ядро сам, без флага (D-2026-LORE-AUTO-BOOTSTRAP-CORE;
свежей базе даётся до 10 попыток пробы). На базе с ядром (общий стенд, прод) — ни одного DDL.
`LORE_BOOTSTRAP=true` остаётся принуждением. Для внешней/чистой установки есть готовый
профиль и инсталлятор для Linux — `deploy/install/` (README там же).

## Шаг 3 — собрать и поднять backend

Backend собирается как prebuilt jar — `Dockerfile.local` копирует
`build/quarkus-app`, поэтому **обязательно** пересобрать jar перед `docker
build`, иначе Java-правки не попадут в образ:

```bash
cd backend
./gradlew build -x test
cd ..
docker compose build lore-backend
docker compose up -d lore-backend
```

Ключевые env (заданы в `docker-compose.yml`, переопределяются через `.env` в
корне репо):

| Переменная | Назначение | Дефолт |
|---|---|---|
| `ARCADEDB_USER` | пользователь ArcadeDB | `root` |
| `ARCADEDB_ROOT_PASSWORD` | пароль ArcadeDB | `unset` — **обязательно задать** |
| `LORE_BOOTSTRAP` | прогонять ли DDL при старте | `false` |
| `LORE_DB` | имя базы LORE в ArcadeDB (свойство `lore.db`) — любое; на пустой базе ядро и схема поднимаются сами | `system_aida_lore` |

Backend слушает `:9100` (публикуется наружу — так и MCP-сервер на хосте, и dev
frontend через vite-proxy до него достучатся).

Проверка:

```bash
curl http://localhost:9100/lore/slices   # список слайсов, не пусто
```

## Шаг 4 — собрать и поднять frontend

```bash
docker compose build lore-app
docker compose up -d lore-app
```

Слушает `:4400`. Открыть `http://localhost:4400/lore?section=plan`.

`LORE_PUBLIC_URL` — канонический https-адрес установки. Пустой (по умолчанию) — редирект выключен:
LORE открывается по тому адресу, по которому пришли; вход по OIDC на голом IP тогда не работает (PKCE
требует HTTPS или localhost).

Для локальной разработки (hot reload) вместо докер-образа:

```bash
npm install
npm run dev -- --port 5190 --strictPort   # порт 4400 занят докер-образом, взять другой
```

Vite dev-прокси (`vite.config.ts`) перенаправляет `/lore/*` и `/bench/*` на
`http://localhost:9100` — backend должен быть уже поднят (шаг 3).

## Шаг 5 — собрать MCP-сервер (для LLM-агентов, опционально)

```bash
cd mcp-server
npm install
npm run build       # tsc → dist/index.js
```

MCP-сервер работает в одном из двух транспортов, выбор — `LORE_MCP_TRANSPORT`: по умолчанию
`stdio` (процесс на машине агента, как ниже), `http` — Streamable HTTP (`LORE_MCP_PORT`, в пакете
установки это сервис `lore-mcp` за nginx веба: агент ходит на `https://<хост>/mcp`, проверка —
`/mcp/health`; подробно — `deploy/install/README.md`, раздел «Подключить агента к MCP»).

Переменные HTTP-режима: `LORE_MCP_HOST` (по умолчанию `127.0.0.1`; в образе `lore-mcp` — `0.0.0.0`),
`LORE_MCP_PORT` (по умолчанию `9200`), `LORE_MCP_TOKEN` — токен шлюза для клиентов без Keycloak (Llama Chat
и др.): задан — обязателен на каждом запросе (`Authorization: Bearer` или `X-Lore-Mcp-Token`), без него 401;
`LORE_MCP_CORS_ORIGINS` — origin браузерных клиентов через запятую, чужой origin — 403. `GET /health` и
`GET /mcp/health` — 200 без входа. Токена нет, а адрес не loopback — громкое предупреждение при старте.
Запись без Keycloak по HTTP пока не поддержана: роль (`X-Seer-Role`) в этом режиме не передаётся.

Зарегистрировать **в user-скоупе** Claude Code (`~/.claude.json`), а не
проектным `.mcp.json`. С #1298 `.mcp.json` не отслеживается git, а забытая
локальная копия в чекауте **перекрывает** user-скоуп: 13.11.2026 в ней лежал
старый секрет, и каждый вызов получал 401, хотя запись в user-скоупе была
исправна. Для локальной разработки:

```bash
claude mcp add --scope user aida-lore \
  -e LORE_BACKEND_URL=http://localhost:9100 -e LORE_SEER_ROLE=admin \
  -- node /абсолютный/путь/mcp-server/dist/index.js
```

Роль: обычной записи хватает `LORE_SEER_ROLE=admin`; создание проекта (`project_new`) требует
`LORE_SEER_ROLE=superadmin` — одним словом (так роль называется во всех проверках бэкенда; роль realm
Keycloak — `super-admin`, и это написание в заголовке принимается синонимом). Отказ 403 называет роль,
которой не хватило.

Против стенда — то же плюс `LORE_OIDC_ISSUER`, `LORE_MCP_CLIENT_ID`,
`LORE_MCP_CLIENT_SECRET`, `LORE_MACHINE_ID` (полная команда —
`mcp-server/README.md`). KC-клиент у каждого harness свой: `lore-mcp-full` —
Claude Code, `lore-mcp-full_<harness>` — остальные (например, `_kimi`).
`.mcp.json.example` — только для осознанного проектного скоупа.

**Важно:** MCP-сервер кэширует схему тулов на момент подключения — после
`npm run build` с изменённой схемой тула (новые параметры и т.д.) уже
запущенная MCP-сессия их не увидит, нужен рестарт/переподключение сессии.

## Проверка полного стека

1. `curl http://localhost:2480/api/v1/ready` — ArcadeDB жива
2. `curl http://localhost:9100/lore/slices` — backend отвечает, знает слайсы
3. Открыть `http://localhost:4400/lore?section=plan` — фронт грузит план
4. (если настроен MCP) `query_slice({slice: "sprints"})` из LLM-агента —
   возвращает реальные данные

## Частые проблемы

- **Backend поднялся, но слайсы пустые/ошибка 500** — проверить, что схема
  реально развёрнута (шаг 2) и имя БД совпадает с `LORE_DB` бэкенда
  (по умолчанию `system_aida_lore`, свойство `lore.db`).
- **Правки в Java не попадают в контейнер** — забыли `./gradlew build` перед
  `docker compose build lore-backend` (см. память `feedback_backend_build_prebuilt_jar.md`).
- **Frontend service не поднимается / контейнер называется не так** — сервис
  во `docker-compose.yml` называется `lore-app`, не `frontend` — опечатка в
  имени сервиса молча ничего не делает (`docker compose up -d frontend` без
  ошибки, но ничего не поднимет).
- **MCP-тул не видит новый параметр после правки схемы** — нужен рестарт MCP-сессии
  (см. шаг 5, «Важно»).
- **`CREATE INDEX ... NOTUNIQUE` падает на чистой БД** — см.
  [`backend/db-schema/README.md`](../backend/db-schema/README.md) раздел
  «Найденные при тестировании баги» — в `bootstrap.sh`/`create-schema.sql`
  уже исправлено, актуально только если запускаете DDL вручную построчно.
