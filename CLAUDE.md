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
- **Промоушн `develop → preprod` (выкатка на стенд) требует явного «да» каждый раз** — это деплой, а не мерж.
- **Промоушн `preprod → main` + тег (релиз) требует явного «да» каждый раз.**

## Проверка статуса CI

Брать через `forgejo-mcp get_commit_status` (owner `AIDA`, repo `UnlimitedLORE`), а НЕ через curl по `/actions/runs`: эндпоинты actions зависят от версии, пустой ответ легко принять за «ещё бежит». Проверено 2026-07-21 — поллер 9 минут показывал «pending», когда оба чека уже были зелёными.
