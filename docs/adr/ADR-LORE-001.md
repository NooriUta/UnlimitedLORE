# ADR-LORE-001 — KnowADR не наследуется от KnowDoc на уровне БД

**Статус:** ACCEPTED
**Дата:** 2026-07-06
**Компоненты:** LORE, OMILORE
**Связано:** SPRINT_LORE_PROD_HARDENING / задача B7

## Контекст

Задача B7 предлагала «отнаследовать KnowADR от KnowDoc», чтобы ADR переиспользовал
doc-редактор (EN/RU табы), parent/child дерево и хранение тела — «чтобы не мучаться».
ArcadeDB поддерживает множественное наследование типов (`ALTER TYPE KnowADR SUPERTYPE +KnowDoc`).

При детальном разборе схемы (live `system_aida_lore`: 135 KnowDoc / 70 KnowADR) модели
оказались разными:

- **KnowDoc** — контент на самой вершине: `content_md_en`, `content_md_ru`, `doc_id`, `sort_order`.
- **KnowADR** — минимальная вершина (`adr_id`); контент в `KnowADRHist`
  (`context_md`, `decision_md`, `consequences_md`) + статус-lifecycle + supersedes-цепочка.

Оба типа имеют Hist-двойник; `superTypes` у всех = null.

## Решение

**DB-наследование KnowADR ← KnowDoc НЕ вводим.** Цель B7 (меньше дублирования
doc/ADR-редактора) достигается на уровне фронтенда/API — рендерить ADR через общий
doc-редактор, адаптируя поля ADR к пропсам редактора, без изменения схемы БД.

Проверено на scratch-клоне (создан → удалён, боевая БД не тронута):
`ALTER TYPE KnowADR SUPERTYPE +KnowDoc` работает, но SELECT в ArcadeDB **полиморфен** —
после наследования `SELECT FROM KnowDoc` возвращает и доки, и все ADR (`@type=KnowADR`).
70 ADR протекли бы во все doc-слайсы (`docs`, `doc_by_id`, `search $d`,
`LoreSlices.java:278/449/468`) и в UI доков.

## Последствия

**Плюсы:**
- Не трогаем схему общей боевой `system_aida_lore` (операция необратима).
- Doc-слайсы остаются чистыми — не нужно добавлять `WHERE @type='KnowDoc'` в каждый
  doc-запрос (хрупко: пропуск одного = утечка ADR в UI).
- Реальная выгода достижима на фронте без риска для данных.

**Минусы:**
- Нет «бесплатного» переиспользования doc-плумбинга через наследование — переиспользование
  редактора делаем явно на фронте/API.

**Если всё же вводить DB inheritance в будущем** — обязательно: (1) бэкап/клон БД;
(2) заменить `SELECT FROM KnowDoc` → `... WHERE @type='KnowDoc'` во ВСЕХ слайсах и коде
(backend + frontend); (3) выверить конфликты ADR-специфичных полей/рёбер с doc-полиморфизмом.
