# LORE v1.0.48 — ⚙ Admin LORE: админ-панель справочников + RBAC-фронт

Реализация ADR-LORE-025 (ACCEPTED, 9 решений). Порядок пользователя соблюдён: **UI-first, auth остаётся выключенным** — включение (AL-12) заблокировано до проверки администрирования.

## ⚙ Admin LORE (admin-gated секция)
- **Словари** (`KnowDictEntry`, 8 dict_type): таблица code/label/цвет/иконка/порядок/is_active, правка и «+ значение» → `POST /lore/dict/entry` — **тот же эндпоинт, что MCP `dict_set`** (D4: параллельного admin-API нет). Канон-типы — предупреждение + обязательный чекбокс (D5); area — post-write reconcile-строка.
- **Проекты** (`KnowGitProject`): hosts[]-редактор построчно (remote/role/base_url/шаблоны URL, ADR-018) → `POST /lore/project`.
- **Роли** и **Теги** — read (D6): RBAC-скоуп профилей, использования тегов.
- **Настройки** — read: auth-статус, роль; app_setting ждёт ОВ.

## 🔐 RBAC-фронт (D8)
- `getRole()`/`useRole()`/`useIsAdmin()` — единый проверенный источник роли: JWT-клеймы `seer_roles` (super-admin→superadmin/admin/иначе viewer — least privilege) при включённом auth; `VITE_LORE_ROLE` (default admin) в dev.
- Секция ⚙ «Админ» скрыта из навигации для не-admin (не disabled — отсутствует).
- 4 vitest-кейса на маппинг ролей.

## Слайсы
`tags_usage`, `lore_tags_usage` (новые); `git_projects` дополнен `hosts`.

## Docs
- **LORE_DB_SPEC** — новая checkpoint-версия (LH-02): раздел Admin LORE.
- **RUNBOOK-ADMIN-LORE** (новый, linked → ADR-025): администрирование + порядок включения auth (все флаги вместе, RUNBOOK-AUTH-OMILORE).

## Проверено вживую
Панель рендерится (роль admin · auth off), 0 ошибок консоли; round-trip: dict-entry create/soft-delete, project name edit/restore — через боевые эндпоинты. Найден и исправлен 404 (панель звала /lore/dict вместо /lore/dict/entry).

## Заблокировано (ждёт пользователя)
**AL-12 / PHASE_AUTH**: включение auth-стека — только после проверки администрирования (спуф-тест, 401, роли — по runbook).

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
