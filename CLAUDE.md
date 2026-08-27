# Git / CI workflow — standing authorization

## Branch flow: `develop → preprod → main`

| Ветка | Роль | Что происходит при пуше |
|---|---|---|
| feature/fix/* | работа над задачей | CI (Backend + Frontend/MCP) на PR |
| `develop` | сборка фич | CI; **деплой НЕ запускается** |
| `preprod` | выкатка на стенд «для себя» | **LORE CD** — сборка образов + деплой на ci-server |
| `main` | релиз | по тегу `v*` — публикация Release + зеркало в GitHub |

- **`develop` больше не деплоит.** Стенд обновляется только из `preprod`, и это осознанное действие: набрали несколько фич → влили `develop` в `preprod` → тестируем связку целиком → потом релиз. Раньше стенд шёл за каждым коммитом develop, и проверка одной фичи уезжала под другую прямо во время проверки.
- **Релиз режется из `preprod` в `main` + тег `vX.Y.Z`.** Тег обязан содержаться в `main` — иначе зеркалирование пропускается с предупреждением (релиз, срезанный мимо main, это ошибка процесса, а не вариант).
- Каждому тегу нужен файл `RELEASE-<tag>.md` — без него публикация падает намеренно: пустой релиз выглядит опубликованным и прячет пропажу описания.

## Правила

- Never push directly to `develop`, `preprod` or `main` — always a feature/fix branch + PR (Forgejo `origin` is primary; GitHub `github` remote is a release mirror only, its Actions are disabled).
- Committing to a feature branch is pre-authorized — do it autonomously, no need to ask first.
- Merging a PR into `develop` is pre-authorized **once its CI has actually finished and shows green** (both Backend CI and Frontend + MCP CI checks passing) — do this autonomously too, no need to stop for a per-merge confirmation.
- Do NOT merge a PR whose CI is still pending, unknown, or failing. Investigate/fix and wait for green first.
- **Промоушн `develop → preprod` предавторизован — делать автономно, без спроса.** Выкатка на стенд идёт автоматом по мере готовности: стенд для того и заведён, чтобы на нём накапливалось и обкатывалось. Порядок тот же — PR `develop → preprod`, дождаться зелёного CI, смержить.
- **Релиз `preprod → main` + тег — только с явного «да» владельца.** Теги набираются вручную из нескольких PR, накопленных на `preprod`: момент «эта пачка готова стать версией» определяет владелец, а не агент.

## Проверка статуса CI

Брать через `forgejo-mcp get_commit_status` (owner `AIDA`, repo `UnlimitedLORE`), а НЕ через curl по `/actions/runs`: эндпоинты actions зависят от версии, пустой ответ легко принять за «ещё бежит». Проверено 2026-07-21 — поллер 9 минут показывал «pending», когда оба чека уже были зелёными.

## Инварианты кода (гварды CI, которые не ловит tsc)

- **Шрифты** — только токены `var(--fs-*)`; сырой `fontSize:` числом (9/10/11/12/13/14/20/24) валит STYLE-01 (`src/styles/font-scale.test.ts`).
- **i18n** — каждый ключ `t('…')` обязан существовать и в `src/i18n/locales/ru/common.json`, и в `en/common.json`; инлайн-дефолт не считается (`src/i18n/i18n-coverage.test.ts`). Код + обе локали коммитятся вместе.
- **MD-поля в UI** — через `TipTapField`, не голую textarea; тела доков рендерить `MartProse`, HTML — только через `SandboxedHtmlFrame`.

## Две базы и запись только через MCP

- Локальный ArcadeDB `localhost:2480` — тест/отладка; прод — на ci-server, туда же пишет MCP. Запись «руками» в локальную базу выглядит успешной, но прод не меняет.
- **Любой** `./gradlew test` мигрирует прод-схему (LiveDbTest не единственный путь) — после падения проверять факт миграции, а не ledger.
- Спринты/релизы/спеки/статусы — только MCP-инструментами: прямой INSERT обходит SCD2 и ломает слайсы.

## Docker

- Сервис фронтенда называется `lore-app`, не `frontend` — неверное имя в compose-командах даёт молчаливый no-op.

## Синхронизация с панелью «Правила CLAUDE»

Этот файл отображается в админке LORE (Справочники → Правила CLAUDE) как док `claude_rules_unlimitedlore`. После правки файла — обновить док через MCP `doc_new` тем же заходом.
