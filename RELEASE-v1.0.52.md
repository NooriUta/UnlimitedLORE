# LORE v1.0.52 — Forgejo-мост: git-цикл сессии без токена у агента

Спринт SPRINT_LORE_FORGEJO_INTEGRATION (ADR-LORE-024 ACCEPTED). PR #154.

## ForgejoBridge (FJ-02)
- Паттерн KcBridge: токен `FORGEJO_API_TOKEN` только через SecretProvider (env|Infisical,
  решение 138), не логируется, наружу не отдаётся; пусто → мост «не сконфигурирован».
- owner/repo НЕ конфигурируются — резолв из `KnowGitProject.hosts[]` primary base_url
  (дефолт OQ-024-OWNER-REPO); проект без hosts → честный 404, не тихий дефолт.
- required-чеки: поле `required_checks` проекта; пусто → все обнаруженные контексты required.
- Docker: `lore.forgejo.base-override` подменяет ТОЛЬКО localhost-адреса (github-primary
  проекты не трогаются); extra_host forgejo→host-gateway.

## REST /lore/forgejo/* (FJ-03) — статусы строго §10
- `POST pr` — тело PR из KnowRelease.description_md (release_id), base=develop.
- `GET pr/{n}` — статус из {NO_RUN, PENDING, GREEN, RED, UNKNOWN, STALLED} + чеки + merge_allowed.
- `POST pr/{n}/merge` — 409 MERGE_GATE из ЛЮБОГО не-GREEN с фактическим статусом и §9-маршрутом
  (RED → чинить; UNKNOWN/STALLED → forgejo-mcp, не ретраи).
- `GET ci?ref=` — гейт-статус ветки до PR; `GET branch-protection` — только чтение (решение 136).
- Без токена всё отвечает 503 с подсказкой fallback tea (§9). Grace-окно NO_RUN→STALLED: 300с.

## Авто-линк на merge (FJ-05)
KnowPR UPSERT + SHIPPED_IN к release_id (или is_current релизу проекта) + спринт→релиз
отдельным ребром. Целей нет → `linked:false` + hint в ответе — тихий no-op изгнан
(урок prs_linked:0 из контекста ADR-024).

## MCP (FJ-04/06) — условная регистрация
5 инструментов `forgejo_pr_new/pr_status/pr_merge/ci_status/branch_protection`
регистрируются ТОЛЬКО при заявленном мосте (LORE_FORGEJO=true или FORGEJO_*-env);
у заказчика без Forgejo их просто нет. Токен MCP-слой не видит вообще.
RBAC: merge=full-only (дефолт OQ-024-MERGE-RBAC) — forgejo_* нет ни в одном
ограниченном профиле. OpenCode-паритет автоматический (один MCP-бинарь).

## Тесты (FJ-07)
12 юнитов чистого гейта §10 (каждый не-GREEN статус именованным кейсом; red>pending,
warning≠green, missing-required=PENDING, grace→STALLED, upstream-fail→UNKNOWN) +
9 эндпоинт-тестов (503-контракт, RBAC, токен не появляется в ответах) +
registration-тест обеих мод MCP.

## Dogfood-статус
PR #154 открыт через tea (fallback-ниша §9 работает как задумано): мост ждёт
`FORGEJO_API_TOKEN` от владельца в .env — после этого цикл PR→CI→merge→линковка
проходит через собственные инструменты. Найден и обойдён стейл: tea виснет в Git Bash
(TTY), из PowerShell работает.

## Docs (FJ-08)
RUNBOOK-FORGEJO-BRIDGE (§9 «какой инструмент для чего», статусы §10, сессионный флоу,
конфигурация) → ADR-LORE-024.
