# Handoff · аналитика вех LORE · 06.11.2026

Сессия: AIDA-UnlimitedLORE 75be95c7. Задача: SPRINT_LORE_ROADMAP_PER_PROJECT/RM-A4 (RM-A3 снята, влита в RM-A4).
Отчёт: `docs/reports/lore-milestones-analysis-2026-11-06.html`, отправлен владелице на телефон (v4).
Решение: D-2026-LORE-PRODUCT-KINDS-TECH-SERVICE (proposed) — два типа продуктов, ребро SERVES, функции на бэкофисе OMILORE.

## Состояние

- Замер ЗАВЕРШЁН до перезагрузки ci-server: выгрузка 06.11 ~08:00–09:30 UTC, данные целые (493 спринта, 5 653 задачи, 480 релизов, 100 компонентов, 64 сценария).
- SPRINT_LORE_MEASURE_TRUTH/MT-05 и MT-GOALS закрыты сессией be834c67 ссылкой на RM-A4.
- В заметке RM-A4 есть первая и вторая волна. Третья волна (диагноз MIDGARD, типы продуктов tech/service) — в отчёте и в решении выше.

## Состояние на момент перезагрузки (06.11, ~11:15)

- Отчёт v11 (`lore-milestones-analysis-2026-11-06.html`): 9 вкладок, включая «Ценность» — 5 исследований роя агентов с поправками проверяющих. Отправлен владелице.
- Отчёт о долге: `lore-debt-by-project-2026-11-06.html` (228 открытых вопросов, 50 PROPOSED ADR по продуктам). Отправлен.
- Независимая проверка обоих отчётов выполнена (7 агентов), правки внесены. Журнал: `~/.claude/projects/C--AIDA-UnlimitedLORE/75be95c7-…/subagents/workflows/wf_4c133a2d-51a/journal.jsonl`.
- Рой аналитики: результаты 5 исследований + проверок сохранены в `C:/Users/LEGION/AppData/Local/Temp/msq/swarm_results.json` (журнал `…/workflows/wf_7949e1a3-b33/journal.jsonl`).
- Калибровка оценок ДОДЕЛАНА и проверена (`…/workflows/wf_fb524c9a-231`, скрипты `Temp/calib2/calib.js`, `Temp/calib2v/v.js`): коэффициента нет — 75% закрытых задач без рабочего статуса, измеримых 14%, разброс в десятки раз; прогноз — по пропускной способности. В отчёте v11, вкладка «Ценность». Рекомендации (фиксация начала работы, флаг bookkeeping, поле actual_days, роли и work_class всегда) — завести задачами после подъёма сервера.
- Решения записаны: ADR-LORE-044 (PROPOSED) + D-2026-LORE-UNIFIED-WORKFLOW-CORE, D-2026-LORE-DONE-NEEDS-EVIDENCE, D-2026-LORE-SERVES-EDGE, D-2026-LORE-PROJECT-WITHOUT-REPO, D-2026-LORE-PRODUCT-KINDS-TECH-SERVICE; SPEC-LORE-WORK-ANY-KIND; D-2026-LORE-ROADMAP-IS-QUARTERLY-PROCESS (accepted), D-2026-LORE-HISTORY-SPLIT-AND-FREEZE (accepted); D-2026-LORE-M0M7-BELONG-TO-AIDA → superseded.
- **Не выполнено в базе** (по решению о заморозке): исторические вехи по сериям релизов и отвязка 24 открытых спринтов от M0–M7 — массовая запись, делать после перезагрузки сервера.
- Мусор в графе для будущего спринта чистки: 51 заглушка-спринт с одной задачей T-01 в семействе AIDA; фантом AIDA v1.8.0, нет v1.7.3–v1.7.5; 20 дублей IMPLEMENTED_IN_RELEASE; 17 повторяющихся release_id; две открытые hist-строки у v1.5.0; 9 сценариев «сделано, но не shipped»; ROLE_HELD_BY загружены пачкой 2026-08-31 06:06 (4041 из 8035).

## Отчёт v6 — пересобран целиком (v5 сохранён рядом: `…-v5.html`)

Вкладки: Кратко · Анализ · Продукты · Дорожные карты · Процесс и правила · GOAL/KAOS · Вопросы. Дорожные карты — Gantt по продуктам: история по сериям релизов + квартальный прогноз, ревизии, отметка «сегодня», оценка effort_days и её покрытие в подписи. Графы — раскладка ELK (`@mermaid-js/layout-elk`). Правила R1–R13; R3 — дата как прогноз с историей сдвигов (decision:D-2026-LORE-ROADMAP-IS-QUARTERLY-PROCESS, accepted). R12 — веха без задач не стоит в текущем квартале: у A1 AIDA 7 спринтов и 0 задач. Оценки по вехам-кандидатам: A2 27 ч/д (25/47 задач), A3 11 (12/20), H1 10.5 (7/165), S1 34.5 (28/28), V1 14.5 (21/33), D1 35.8 (24/49), D2 9.2 (12/64), D3 16 (16/45), D4 49 (16/20), W1 1 (1/7), W2/W3 не оценены, O1 4 (5/15), O2 3.6 (4/5), O3 21.7 (29/36).

## Отчёт v5 — вкладки (адрес хранит вкладку: `#tab=short|analysis|roadmap|plan|kaos|decide`)

- **Дорожные карты:** по продуктам, зависимости от вех соседей (синие) и нехватка фич, функций, решений (красные). OMILORE — поставщик для MIDGARD и DW (realm в KC), miniLORE (скоуп) и service-продуктов (проект-не-репозиторий). A1 AIDA держится на HARPA и поддержке, функции поддержки нет. D0 MIDGARD — решение «на продажу».
- **GOAL/KAOS:** дерево G0…G6, препятствия O1–O12 по данным, препятствия к собственному предложению P1–P10. Вердикт: держится с поправками. Must — переподтвердить North Star AIDA (срок истёк), решить «MIDGARD на продажу», R1/R3/R8 требованием (дата только со словом владелицы), ADR на kind/SERVES/проект-не-репозиторий. Should — R2/R4/R7 подсказками на цикл, разметка задач, гигиена статусов MIDGARD. Could — исторические вехи с исключением M0–M7 из счёта, типы задач sales/support, предел вех на дорожку.
- В заметке RM-A4 есть три волны и текст запросов; вкладки «Дорожные карты» и «GOAL/KAOS» — только в HTML и здесь.

## Ждёт владелицу (раздел 14 отчёта)

1. Три горизонта / два типа продуктов (tech · service) и ребро SERVES (count · sell · support) — да? Нужен ADR до кода.
2. Правила R1–R11 — что требование, что подсказка → в SPEC-LORE-PLAN-MODEL.
3. MIDGARD — на продажу или нет (Q-MIDGARD-OWN-MODEL-LICENCE-FOR-SALE, открыт с 10.09).
4. BOKVIT — MIDGARD (её слово) или нет (сессия MIDGARD против).
5. GLADSHEIM, TEIKN — суб-продукты MIDGARD; VOLVA — суб-продукт или вариант AIDA; miniLORE, BRAGI — дети OMILORE.
6. 10 спринтов без проекта → проект «Студия» без репозитория.
7. M-PRODUCT-UI закрыть; M5–M7 разобрать; HighLoad++ состоялся?; HARPA project → seidr-site, area → marketing.
8. Многоагентная проверка чисел отчёта (её «ultracode») — запускать?

## Как повторить замер

Подключение — как у backend LORE: `.env` проекта (`ARCADE_HOST`, `ARCADEDB_ROOT_PASSWORD`), только чтение, POST `http://$ARCADE_HOST:2480/api/v1/query/system_aida_lore`, тело `{"language":"sql","command":"..."}`. Запрос класть в JSON-файл и слать `--data-binary @file` (кириллица через консоль бьётся). Большие ответы парсить PowerShell `ConvertFrom-Json`, не python (в Git Bash — заглушка Store).

### Запросы

```sql
-- 1. спринты: вехи, компоненты, проекты, открытый статус, задачи, релизы
SELECT sprint_id,
       out('TARGETS_MILESTONE').milestone_id      AS ms,
       out('BELONGS_TO').component_id             AS comp,
       out('BELONGS_TO_PROJECT').slug             AS gp,
       out('HAS_STATE')[valid_to IS NULL].status_raw AS st,
       out('HAS_STATE')[valid_to IS NULL].valid_from AS vf,
       out('HAS_STATE').size()                    AS nh,
       in('PART_OF').size()                       AS nt,
       out('IMPLEMENTED_IN_RELEASE').size()       AS nrel
FROM KnowSprint

-- 2. рёбра вех по типу источника (спринты + сценарии)
SELECT @in.milestone_id AS m, @out.@type AS t, count(*) AS n FROM TARGETS_MILESTONE GROUP BY @in.milestone_id, @out.@type

-- 3. вехи: история цели, машинная дата
SELECT milestone_id, out('HAS_STATE').size() AS nh,
       out('HAS_STATE')[valid_to IS NULL].valid_from AS vf,
       out('HAS_STATE')[valid_to IS NULL].planned_date AS pd FROM KnowMilestone

-- 4. веха → продукт (ожидаемо 0 на 06.11)
SELECT count(*) AS n FROM TARGETS_PRODUCT

-- 5. компоненты и продукты (IN_PRODUCT; ребро PARENT_OF идёт ребёнок → родитель)
SELECT component_id, full_name, area, out('PARENT_OF').component_id AS parent,
       out('IN_PRODUCT').code AS prod, in('BELONGS_TO')[@type='KnowSprint'].size() AS nsp
FROM LoreComponent

-- 6. задачи: тип, класс работы, спринт, сценарий, открытый статус
SELECT task_uid, task_type, work_class, out('PART_OF').sprint_id AS sp,
       out('REALIZES').uc_id AS uc, out('HAS_STATE')[valid_to IS NULL].status_raw AS st
FROM KnowTask

-- 7. сценарии → фичи (фича — тоже KnowUseCase с id FEAT-*, ребро DECOMPOSES_INTO)
SELECT uc_id, in('DECOMPOSES_INTO').uc_id AS feat, in('REALIZES').size() AS ntask FROM KnowUseCase

-- 8. релизы → спринты (для исторических вех по сериям)
SELECT release_id, out('BELONGS_TO_PROJECT').slug AS gp, in('IMPLEMENTED_IN_RELEASE').sprint_id AS sp, release_date, date FROM KnowRelease

-- 9. зависимости спринтов
SELECT @out.sprint_id AS a, @in.sprint_id AS b FROM DEPENDS_ON WHERE @out.@type = 'KnowSprint'

-- 10. контрольные точки плана на вехах (доказательство «M0–M7 = забег к HighLoad++»)
-- слайс MCP plan_checkpoints + plan_tracks
```

### Положительные контроли

- `SELECT count(*) FROM KnowSprint` = 493, а слайс `sprints` отдаёт 483: пропавшие 10 — ровно спринты без `BELONGS_TO_PROJECT` (скоуп AL-91). В выдаче слайса спринтов без проекта 0, в базе 10. Если число разошлось иначе — сначала искать причину.
- Сумма рёбер TARGETS_MILESTONE = 304 (302 спринта + 2 сценария). Дублей нет: `GROUP BY s, m` даёт n = 1.
- Статус спринта брать из открытой строки истории (`valid_to IS NULL`), не с вершины. У задачи `status_raw` на вершине пуст у 581 задачи открытых спринтов — процент закрытых задач по вершине НЕ считать.
- `done_date` = дата простановки статуса, а не дата работы (4–5.11 закрыто 45). Скорость по нему не считать.
- Даты из CSV экспорта PowerShell — в русской локали (`14.06.2026 0:00:00`): парсить `[datetime]::Parse(s, 'ru-RU')`.
- Числа по вехам и продуктам не складывать: спринт входит в несколько множеств.

## Ключевые числа 06.11 (для сверки при повторе)

Вехи (спринтов / закрыто / открыто): M0 7/7/0 · M1 76/75/1 · M2 43/39/3 · M3 128/126/1 · M4 23/23/0 · M5 18/5/13 · M6 3/0/3 · M7 3/0/3 · M-MIDGARD-PLAN-TO-DRAFT 1/0/1 · M-PRODUCT-UI 0 спринтов + FEAT-VP-FIT · M-LORE-CLIENT-SAFE 0 спринтов + FEAT-GITCYCLE.
goal_md: у M0–M7 по одной строке истории от 11.06.2026; decisions_md пуст у 11; planned_date null у 11; TARGETS_PRODUCT = 0; products.git_projects пуст у 13.
Открытых спринтов 139 (129 видимых + 10 скрытых): срок впереди 10, прошёл 41, нет 78. Вне вех открыто 114. Без движения 120+ дней — 46.
Стадии: создание 437 · маркетинг 48 · продажи 4 · обслуживание 1 · студия 3. Классы работы: не размечено 55%, uc 613 (с REALIZES 216), jtd 717 (вне вех 668), enb 1 221.
Релизы: у 312 из 342 закрытых спринтов есть релиз.
