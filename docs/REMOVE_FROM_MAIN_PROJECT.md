# Что удалить из основного проекта (aida-root) после переезда LORE + Исследования

**Статус:** черновик · **Дата:** 2026-06-21
**Контекст:** LORE и BENCHMARK переехали в автономное приложение `C:\AIDA\UnlimitedLORE`
(свой фронт + свой Quarkus-backend `UnlimitedLORE/backend` на :9100, который ходит в **ту
же** ArcadeDB :2480). Основной проект (`heimdall-frontend` + `heimdall-backend`) больше
не обязан обслуживать LORE/BENCH.

> ⚠️ **Удалять только ПОСЛЕ верификации переезда** (см. чек-лист внизу). Сначала
> убедиться, что автономное приложение полностью покрывает функциональность и пишет/читает
> ArcadeDB корректно. Все удаления — через PR с ревью, не напрямую в master.

---

## 1. heimdall-frontend — удалить

Путь: `C:/AIDA/aida-root/frontends/heimdall-frontend/`

| Что | Путь |
|-----|------|
| LORE-компоненты | `src/components/lore/**` (≈20 файлов: GameIcon, lore-status, LoreAdrList, LorePlanBoard, LoreSprintTree, LoreTimeline, …) |
| BENCH-компоненты | `src/components/bench/**` (≈21 файл: StoryScreen, CampaignsScreen, MatrixScreen, MartProse, shared, …) |
| Страницы LORE | `src/pages/LorePage.tsx` |
| Страницы BENCH | `src/pages/BenchmarkPage.tsx`, `SubstratePage.tsx`, `HypothesisPage.tsx`, `FindingPage.tsx`, `ReferencesPage.tsx` |
| API-слой | `src/api/lore.ts`, `src/api/bench.ts` |
| Хуки | `src/hooks/useBench.ts` (+ `usePageTitle`/`useIsMobile` — только если больше нигде не используются) |
| Утилиты | `src/utils/benchData.ts` |
| Роуты | записи `/lore/*`, `/benchmark/*` в роутере |
| Навигация | пункты LORE / BENCHMARK в `src/components/layout/heimdallNavData.ts` |
| i18n | ключи `lore.*` и `bench.*` в `src/i18n/locales/{en,ru}/common.json` |
| Тесты | соответствующие `*.test.tsx` для перечисленного |

**Проверить перед удалением:** `usePageTitle`, `useIsMobile`, `MartProse` могут
использоваться другими (не-LORE/BENCH) частями heimdall — grep по импортам.

---

## 2. heimdall-backend — удалить

Путь: `C:/AIDA/aida-root/services/heimdall-backend/`

| Что | Путь |
|-----|------|
| LORE-пакет (13) | `src/main/java/studio/seer/heimdall/lore/**` |
| BENCH-пакет (5) | `src/main/java/studio/seer/heimdall/bench/**` |
| Файловый сервер | `src/main/java/studio/seer/heimdall/resource/BenchResource.java` |
| Конфиг | ключи `lore.*`, `bench.*`, `bench.mart.*`, `bench.root`, `%dev.team-docs.root` в `src/main/resources/application.properties` |
| Docker | volume-маунты `bench.root` (`/bench-data`) и связанные в `docker-compose.yml` основного проекта |
| Тесты | `*Test.java` для lore/bench |

**REST-клиент `mart-api`:** проверить, используется ли он чем-то кроме lore/bench.
Если нет — удалить и его конфиг (`quarkus.rest-client.mart-api.url`).

---

## 3. ОСТАВИТЬ (не трогать)

- **ArcadeDB** на :2480 и базы **`system_aida_lore`** + **`RAGVSDL`** — их использует
  наш новый backend. Удаление сломает автономное приложение.
- Инстанцию `frigg`/`mart-api` инфраструктуры ArcadeDB, креды `ARCADEDB_ROOT_PASSWORD`.
- Репозиторий бенчмарка `C:/AIDA/rag-vs-parse` (STATUS.json + отчёт) — наш BE его монтирует.
- Репозиторий доков `C:/AIDA/docs` — источник ингестии LORE.

---

## 4. Развилка: владение ингестией LORE (ВАЖНО)

Ингестия (парсеры MD → ArcadeDB) **скопирована** в наш backend. Теперь потенциально
**два писателя** в общий `system_aida_lore`. Чтобы избежать гонок и расхождений:

- Выбрать **один** источник ингестии. Рекомендация: ингестит **наш** backend
  (`UnlimitedLORE/backend`, `LORE_BOOTSTRAP`/admin-эндпоинт), а в основном проекте
  LORE-ингестию **выключить** (`lore.enabled=false`) ещё до удаления кода.
- Наш standalone-BE по умолчанию **не** трогает общую БД на старте
  (`lore.bootstrap=false`); схему/сидинг включать только для свежей ArcadeDB.

---

## 5. Чек-лист перед удалением

- [ ] Автономное приложение открывает «Проекты» (LORE-план) на живых данных через :9100.
- [ ] «Исследования» (реестры/разрезы/Отчёт) работают через :9100.
- [ ] Запись работает: `POST /lore/status`, `/lore/task` идут в `system_aida_lore`.
- [ ] heimdall-backend :9093 остановлен — автономное приложение продолжает работать.
- [ ] Согласовано владение ингестией (раздел 4); дубль-писатель в основном проекте выключен.
- [ ] Удаления оформлены отдельными PR с ревью (FE и BE раздельно), CI зелёный.
