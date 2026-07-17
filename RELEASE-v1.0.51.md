# LORE v1.0.51 — версионирование схемы: миграции, бэкап, content_hash

Спринт SPRINT_LORE_SCHEMA_VERSIONING (ADR-LORE-023 ACCEPTED). PR #149.

## Раннер миграций (SV-02/03/05/06)
- Ledger `LoreSchemaVersion` (version·name·checksum·applied_at), версия БД = max.
- Реестр `V{n}__имя`, идемпотентные шаги; свой раннер (принципы ADR-HND-022 — OQ-023-RUNNER).
- Отказы старта как фичи: db>code; checksum-дрейф выпущенного шага; неснятый бэкап.
- fresh = bootstrap+replay+ledger; upgrade = бэкап + недостающие шаги.
- Июльский DDL оформлен V1..V3; живая БД мигрирована: бэкап снят, ledger 1..5.

## Обязательный бэкап (SV-04)
`BACKUP DATABASE` перед upgrade на БД с данными; не снялся → миграция не стартует.
Доказано на живой system_aida_lore.

## FULL_TEXT sweep (SV-09)
Все оставшиеся `*_md` объявлены и проиндексированы: outcome_md спринтов (эссе!),
description_md релизов, goal_md вех, Bragi-тела, KnowFile.summary_md, KnowDoc.

## content_hash (SV-10, решение 134)
SHA-256/16hex тел ревизии: штамп на записи (7 ресурсов), перенос при смене статуса,
backfill 6500+ существующих строк (остаток 0). Слайсы adr_history/history_sprint
отдают тела и версионируемые поля — AL-30 разблокирован.

## Три попутных бага (найдены тестами/деплоем, починены)
1. Bootstrap-гонка: свежая БД 500-ит на первых DDL-коммитах, execIgnoreError глотал →
   корпус мог встать без базовых типов. Пишущая ready-проба перед DDL.
2. CDI-ленивость: @Inject не гарантирует @PostConstruct инициализатора до раннера →
   ensureReady() на прокси.
3. Смена статуса спринта ТЕРЯЛА context_md/outcome_md (carry-forward, ADR-021) —
   тела и hash теперь переезжают на новую ревизию.

## Тест-стенд и CI (решение владельца)
Постоянная БД `lore_ci_test` на живом :2480; self-hosted CI больше НЕ скипает
live-DB тесты (LORE_TEST_DB_URL → host.docker.internal). Этот же PR стал первой
проверкой: обе CI-проверки зелёные С live-DB тестами.

## Docs
RUNBOOK-LORE-SCHEMA-UPGRADE (новый, → ADR-023); раздел версионирования в LORE_DB_SPEC.
