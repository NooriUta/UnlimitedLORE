# LORE v1.0.53 — Продуктовый слой: Value Proposition как граф (Остервальдер + Коберн)

Спринт SPRINT_LORE_PRODUCT_LAYER (ADR-LORE-022 + дочки 027/028/029/030/031/032).
PR #156 (фазы MODEL/QUALITY/MCP) + V10 (Jobs/Osterwalder). **UI-фаза — отдельным
релизом после заморозки прототипа** (прототип утверждён владельцем,
`docs/prototypes/forseti-storyline-vp.html`).

## Модель — Value Proposition как ГРАФ (не проза)
Профиль клиента по Остервальдеру собран из трёх столпов-вершин и связан рёбрами,
поэтому «заявлено» против «сделано» и fit считаются обходом графа, а не вычиткой:

- **Фичи / User Story (UC) / Акторы** (V6): KnowFeature (context_md) → DECOMPOSES_INTO →
  KnowUseCase → REALIZES ← KnowTask; HAS_ACTOR (мульти, D12); UC_INCLUDES/UC_EXTENDS (D13).
- **Боли и выгоды как вершины** (V8, ADR-032 §2): KnowPain / KnowGain (metric_md) + 6 рёбер
  FELT_BY / DESIRED_BY (профиль) · ADDRESSES / PROMISES (фича ЗАЯВЛЯЕТ) · RELIEVES / DELIVERS
  (UC РЕАЛЬНО снимает/создаёт — замыкание fit). Боль переиспользуется несколькими фичами.
- **Работа как третий столп** (V10, Остервальдер VPC): **KnowJob** (глобальная вершина) +
  PERFORMED_BY (job→actor) · HELPS_WITH (feature→job, заявлено) · **PERFORMS** (uc→job,
  выполнено — третья ось fit) · BLOCKS (pain→job) · SUCCESS_OF (gain→job). KnowGain.rank.
- **Видимость:** Job/Pain — глобальные (одна работа/боль у многих продуктов), контекст на
  рёбрах; Gain — проектная. Все рёбра продукто-проектно-зависимые.

## Шкала целей по Коберну (ADR-027 D1)
Единая на слой: `goal_level` ☁ cloud / 🪁 kite (фичи) · 🌊 sea-level / 🐟 subfunction (UC);
словарь `uc_rigor` (casual | fully-dressed). Вес оформления выводится из уровня, явный
сильнее; граница высот фичи — sea-level.

## Линтер качества (ADR-027 §3-4)
`UcQuality` — чистая функция, знаменатель по весу (casual ≠ fully-dressed: опциональные
секции — подсказки, не штраф). `CockburnTemplate` подставляет скелет в пустой сценарий.
`POST /lore/uc/quality` (re-lint) + `quality` в ответе `uc_new/uc_set` — один алгоритм,
расхождение невозможно по построению. primary-актор и TRACED_TO читаются из рёбер, не прозы.

## MCP — реестр 74 инструмента
`pain_new` · `gain_new` (rank) · **`job_new`** · `feature_link` (pain|gain|**job**|milestone|
component) · `uc_link` (…|relieves|delivers|**performs**) · **`vp_link`** (felt_by|desired_by|
performed_by|blocks|success_of) · `uc_quality`; шаблон Коберна в description `uc_new`.
Профили architect/pm += `job_*`/`vp_*` (RBAC D10).

## Слайсы
`features` (pain_ids/gain_ids/job_ids, uc_total/uc_shipped) · `use_cases_of_feature`
(relieves/delivers/performs, граф, акторы) · `pains` (addressed_by vs relieved_by,
blocks_job_ids) · `gains` (rank, delivered_by, success_of_job_ids) · **`jobs`** (профиль
работы: actor_ids, blocking_pain_ids, gain_ids, performed_by/performed_by_ucs) · `actors`.

## Схема (ADR-023, идемпотентно, дрейф-гард авто)
V6 feature/uc/actor · V7 generic-ассеты · **V8** pain/gain + шкала Коберна · **V9** role на
HAS_ACTOR · **V10** vpc_osterwalder_jobs_and_ranks. `codeVersion()` выводится из последнего
шага; версии уникальны/возрастают, каждый стейтмент `IF NOT EXISTS`/`UPSERT WHERE`.

### Компат-осознанное версионирование `major.minor` (новое)
Раньше ЛЮБОЙ новый шаг (даже чисто аддитивный) поднимал целочисленную версию, и старый
бинарь отказывался стартовать против «БД новее кода» — из-за чего аддитивный V10 положил
dev-стенд (v9-контейнер не встал против db=10). Теперь у шага две оси: **ordinal** (порядок/
ledger/checksum, как было) и **`compatMajor`** (ось совместимости). Аддитивные шаги ДЕЛЯТ major
(10.1 / 10.2 / 10.3 — старый бинарь major=10 их переживает, форвард-совместимо), несовместимый
шаг ПОДНИМАЕТ major (11) — и только тогда дрейф-гард отказывает старту. Историческим шагам
`compatMajor = ordinal` (3-арг конструктор), новый аддитивный передаёт меньший major явно
(`new Step(11, 10, …)` → человеку «10.1»). Решение о старте вынесено в чистую `decide(...)`
(UP_TO_DATE / RUN_PENDING / FORWARD_COMPAT / INCOMPATIBLE) и юнит-тестируется без БД. Ledger
получил колонку `compat_major` (легаси-строки читаются как major=ordinal). Это лечит КЛАСС
того простоя: впредь аддитивную миграцию можно катить, не роняя работающий бинарь.

## Тесты
`UcQualityTest` (6 юнитов) · `LoreVpLayerLiveDbTest` (10 сценариев на живой тест-БД
`lore_ci_test`, вкл. замыкание третьей оси fit и канон gain_rank) · `LoreSchemaMigrationsTest`
(инварианты реестра) — всё зелёное на обеих проверках CI. Dogfood: FEAT-GITCYCLE несёт
реальную VP-канву, UC-GIT-MERGE 10/10.

## Отложено (осознанно, не потеряно)
- **UI-фаза** (навигация по Seiðr Studio + экраны VP-канвы/профиля) — прототип утверждён,
  кодинг отдельным PR после заморозки прототипа. Правило: прототип → approve → код.
- **Аналитика продуктового слоя** — SPRINT_LORE_PRODUCT_ANALYTICS → v1.0.54 (fit-слайсам
  нужны KnowPain/KnowGain/KnowJob этого релиза).
- **UC → US переименование** (ADR-LORE-027-D6) — терминология, отдельной задачей (риск для
  живых uc_*/слайсов; машинерия Коберна остаётся).
