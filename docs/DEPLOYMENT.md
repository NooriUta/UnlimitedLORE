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

**Альтернатива** — доверить бутстрап Java-коду: выставить `LORE_BOOTSTRAP=true`
при первом старте backend'а (шаг 3), тогда `LoreSchemaInitializer.java` сам
прогонит тот же DDL при `@PostConstruct`. Для уже существующей общей БД (как в
проде) `LORE_BOOTSTRAP` должен оставаться `false` — иначе бэкенд заново гоняет
DDL при каждом старте (безвредно за счёт `IF NOT EXISTS`, но лишнее).

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

Зарегистрировать в `.mcp.json` (пример, уже в репозитории):

```json
{
  "mcpServers": {
    "aida-lore": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {
        "LORE_BACKEND_URL": "http://localhost:9100",
        "LORE_SEER_ROLE": "admin"
      }
    }
  }
}
```

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
  реально развёрнута (шаг 2) и БД называется именно `system_aida_lore`
  (`lore.db` в `application.properties`).
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
