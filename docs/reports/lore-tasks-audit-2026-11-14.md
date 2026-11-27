# Сверка задач и спринтов LORE — 14.11.2026

**Коротко.** Проверено 911 открытых задач в 146 спринтах. Подробно, по заметкам и PR, разобраны 133 задачи в статусах «в работе», «частично» и «проектирование». Сверка с релизами v1.17.14…v1.17.21 и с PR в Forgejo не нашла ни одной задачи, которую можно с доказательствами перевести в 🚀 ready_for_deploy. Код, ушедший в релизы, уже отражён в статусах: этим утром релизная сессия сделала свою сверку. У остальных задач в заметке прямо перечислены оставшиеся шаги.

Что изменено в LORE:
- **33 связи спринт → компонент** добавлены открытым спринтам, у которых компонента не было. Связи спринт → проект были у всех открытых спринтов.
- **3 задачи GLADSHEIM** получили запись в заметке о том, что PR слит. Статус у них остался PARTIAL, потому что остальные шаги не сделаны.
- **Статусы задач не менялись (0).**

На решение владелицы вынесено:
- 7 спринтов без однозначного компонента;
- 7 открытых спринтов, где все открытые задачи уже на приёмке;
- 12 закрытых спринтов, в которых остались открытые задачи (всего 26);
- 37 пустых спринтов-заглушек;
- 26 задач «в работе» без движения больше 7 дней;
- MC-05: вы сами перевели её из 🧪 в ⬜ TODO 14.11 в 07:18 UTC;
- дефект данных: одна и та же заметка стоит в четырёх разных задачах.

Источники: срезы open_tasks, tasks_by_uids, history_task, agent_actions, release_tasks_by_tag (v1.17.14–v1.17.21), sprints, sprint_totals, components; Forgejo — AIDA/UnlimitedLORE (последние 50 PR), AIDA/GLADSHEIM (#51–#53). Прод — v1.17.21, это PR #1361 в main от 06:29 UTC. Всё, что влито в develop после промо #1360, сейчас только на preprod.

---

## Статусы исправлены

Статусы не менялись. Причины по группам:

| Группа | Что видно | Почему не меняла |
|---|---|---|
| Задачи с PR из v1.17.18–v1.17.21: [[task:SPRINT_LORE_WORK_ANY_KIND/WK-01]], [[task:SPRINT_LORE_MODEL_AS_CONFIG/MC-06]], [[task:SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH]], [[task:SPRINT_LORE_OWN_HOST/OH-17]], [[task:SPRINT_UXR_POLISH_UAT_1113/PU-07]], [[task:SPRINT_UXR_POLISH_UAT_1113/PU-17]] | PR на проде | В заметке прямо перечислено, что осталось. Например, у PU-07 не исправлены данные «задача ↔ 7–17 релизов», у WK-01 не сделаны фильтр и разметка |
| [[task:SPRINT_UXR_MOBILE_POLISH/MP2-15-BOTTOM-BAR]] | Сторож из #1351 на проде. В заметке написано «Статус — planned до снимка», а статус 🔄 | Расхождение есть, но в 00:15 статус 🔄 поставили после того, как была написана заметка. Неясно, что из двух верно, нужно ваше слово |
| GLADSHEIM: [[task:SPRINT_GLADSHEIM_SERVER_CORE/SR-06]], [[task:SPRINT_GLADSHEIM_VOICE_TOOLS/VT-04]], [[task:SPRINT_GLADSHEIM_OUTSIDE_DOOR/OD-05]] | PR AIDA/GLADSHEIM#51, #52, #53 слиты, CI зелёный | Слияние было только одним из пунктов «Осталось», остальное за владелицей. Дописана заметка от 14.11 (см. ниже) |
| Остальные 120 задач в работе и частично сделанных (DW, Gjallarhorn, Gladsheim, Midgard, Hound, Völva, QG, miniLORE) | У большинства нет PR | В заметке есть «Осталось» или «ждёт владелицу» |

**Заметки дописаны** (note_append, 14.11.2026 — сверка): SR-06 (#51 слит), VT-04 (#52 слит), OD-05 (#53 слит). Статус у всех трёх остаётся 🟡 PARTIAL.

## Связи спринтов добавлены

Добавлено 33 ребра BELONGS_TO (спринт → компонент) через entity_link. Проверка: срез component_sprints DW_SRV показывает все новые спринты DWL_*.

| Компонент | Спринты |
|---|---|
| DW_SRV | [[sprint:SPRINT_DWL_DECISIONS]], [[sprint:SPRINT_DWL_PILOT_PROTO]], [[sprint:SPRINT_DWL_QUALITY]], [[sprint:SPRINT_DWL_SETTINGS]], [[sprint:SPRINT_DWL_SRV_AUTH]], [[sprint:SPRINT_DWL_SRV_COMBAT]], [[sprint:SPRINT_DWL_SRV_GAME]], [[sprint:SPRINT_DWL_UNITY_STAND]] — репозиторий Datawanderers-ServerandLore, в названии «сервер» или «лор/сервер»; соседние спринты DWL_* уже на DW_SRV |
| DW_AI | [[sprint:SPRINT_DW_AI_ASSETS]] — название совпадает с описанием компонента |
| DW_UNITY | [[sprint:SPRINT_DW_CHARACTERS]], [[sprint:SPRINT_DW_PORTRAIT]], [[sprint:SPRINT_DW_TRAVEL]], [[sprint:SPRINT_DW_VISUAL]] — репозиторий Datawanderers-Unity, клиент (HUD, станции, персонажи) |
| GJALLARHORN | [[sprint:SPRINT_GJALLARHORN_NEW_WAKEWORD]], [[sprint:SPRINT_GJALLARHORN_VOICE_PROFILE]] |
| GLADSHEIM | [[sprint:SPRINT_GLADSHEIM_INTENT_TOOLS]], [[sprint:SPRINT_GLADSHEIM_MULTIROOM_SYNC]] |
| MIDGARD | [[sprint:SPRINT_MIDGARD_CURTAINS]] — отдельного компонента для штор нет |
| MINILORE_SRV | [[sprint:SPRINT_MINILORE_PIPELINE_HOST]] (репозиторий miniLore_serverside), [[sprint:SPRINT_MINILORE_SRV_TELEMETRY]] |
| MINILORE | [[sprint:SPRINT_MINILORE_APK_MINIO]], [[sprint:SPRINT_MINILORE_DEEP_ARCHIVE]], [[sprint:SPRINT_MINILORE_GOALS_MULTIHARNESS]], [[sprint:SPRINT_MINILORE_POLISH]], [[sprint:SPRINT_MINILORE_TG_LOOK]] — в них работа и приложения, и сервера, поэтому взят корень |
| OMILORE | [[sprint:SPRINT_LORE_ADMIN_POLISH]], [[sprint:SPRINT_LORE_BOARD_PASSPORTS]], [[sprint:SPRINT_LORE_PIPELINE_HOST]], [[sprint:SPRINT_UXR_POLISH_UAT_1113]], [[sprint:SPRINT_UXR_S11_TEST_OPT]] — корень продукта LORE, как у соседей LORE_OWN_HOST и LORE_PRODUCT_BACKLOG |
| SEIDRKIT | [[sprint:SPRINT_UXR_S13_KIT4]] |
| VOLVA_THEME | [[sprint:SPRINT_VOLVA_BRANDING_W2]] — как у предшественника VOLVA_062_BRANDING |
| VOLVA_CI | [[sprint:SPRINT_VOLVA_CI_W2]] — как у VOLVA_CI |
| VOLVA | [[sprint:SPRINT_VOLVA_HELP]] |

Связи спринт → проект (BELONGS_TO_PROJECT) есть у всех 171 открытого спринта, добавлять было нечего.

## Нужно решение владелицы

### Компонент неоднозначен — связь не ставила
- [[sprint:SPRINT_MIDGARD_KORVO]] — колонка с экраном: GJALLARHORN (голос и колонка) или SJON (экран)?
- [[sprint:SPRINT_DW_RUNE_ART]] — рисунки рун: DW_UNITY (клиент) или DW_AI (генерация)?
- [[sprint:SPRINT_DW_MIGRATION]] — перенос папки и репозитория: корень DW?
- [[sprint:SPRINT_DEMO_SCRIPT]], [[sprint:SPRINT_PMODE]], [[sprint:SPRINT_RBMT]] — NooriUta/AIDA, задач нет (см. «заглушки» ниже).
- Спринты в двух проектах сразу (продолжение RM-P4): GLADSHEIM_MULTIROOM_SYNC, GLADSHEIM_SERVER_CORE, MIDGARD_CLIMATE, MIDGARD_LIGHT (GLADSHEIM+MIDGARD); MIDGARD_PLANPARSE_PROD, MIDGARD_PLAN_IMPORT (TEIKN+MIDGARD); KC_THEMES_VOLVA_LORE, VOLVA_HOUND_BRIDGE (AIDA+volva); SEIDRKIT_GRAPH_CANVAS (AIDA+UnlimitedLORE); VIZ_EMBED (volva+UnlimitedLORE).

### Спринты, которые можно закрывать после приёмки
Все открытые задачи этих спринтов уже 🧪 или 🚀:
- [[sprint:SPRINT_LORE_PIPELINE_HOST]] (6 в 🧪)
- [[sprint:SPRINT_UXR_S7B_ADMIN]] (7)
- [[sprint:SPRINT_UXR_S7A_NEWS]] (3)
- [[sprint:SPRINT_UXR_S10_SEIDR_KIT_2]] (3)
- [[sprint:SPRINT_UXR_S12_KIT3_VOLVA_GRAPH]] (2)
- [[sprint:SPRINT_UXR_S5_RECORD_TASKS]] (1)
- [[sprint:SPRINT_MINILORE_GOALS_MULTIHARNESS]] (3 в 🚀)
- [[sprint:SPRINT_VOLVA_CI_W2]] (1 в 🚀)

Обратный случай: [[sprint:SPRINT_MINILORE_TG_LOOK]] стоит в 🚀 READY FOR DEPLOY, хотя [[task:SPRINT_MINILORE_TG_LOOK/TG-38]] ещё 🔄 в работе.

### Закрытые спринты с открытыми задачами (26 задач)
BRAGI_ABOUT_PUB 3, CI_SELECTIVE_FAST 1, DALI_DIALECTS_LORE_VIZ 1, GEOID_STRUCTURAL_ID 1, HOUND_DIALECT_MODEL_DEPTH 2, INFRA_BACKLOG 3, LORE_PRODUCT_FIT 1, OBS_INTEGRATION 2, SEO_MARKETING_W2 4, SITE_SEO_PRERENDER 5, SITE_SEO_V3 1, VERDANDI_MOBILE 1. Нужно решить: задачи перенести, отменить или открыть спринт заново.

### Пустые спринты-заглушки (0 задач, открыты с июня–июля)
37 спринтов: AI_CPG_AUTODOCS_BACKLOG, ALT_AIJ, ALT_AIJ_WORK, ALT_MLSD, ALT_MLSD_WORK, ALT_SMART_WORK, BENCH_RUN, BLOG3, BLOG4, CFP_SUB, COMPETITOR_UX_GAPS, DATASET_TRUST_LABELS, DEMO_SCRIPT, HELM_CHART, HIRE_MID_DE, INCORPORATION_IP, K8S, LEADS, MIMIR_GATEWAY, MIMIR_HYBRID, MIMIR_ONPREM, MIMIR_TOKEN_USAGE_ACCOUNTING, MIMREH, NAMED_AGENTS, OEM_PARTNER_PROGRAM, OUTREACH, PENTEST_EXTERNAL, PMODE, Q6_SCHEMA, RAG_BLOG, RAG_REPORT, RBMT, SEO_SITE_WAVE3, SKADI_PG, SKULD_OPERATIONAL_METRICS, SLIDES, SOVEREIGN_AI_MESSAGING. Это план-заглушки: решите, оставить их в плане или отменить.

### [[task:SPRINT_LORE_MODEL_AS_CONFIG/MC-05]] — ваш перевод 🧪 → ⬜ TODO
В истории: 14.11 в 07:17:56 🧪 → 🚀, в 07:17:58 → 🧪, в 07:18:24 → ⬜ TODO. Все три смены сделала учётка omiloreadmin (человек, срез agent_actions), заметки о причине нет. Последняя запись в заметке: «UAT: проверено агентом на проде… → uat». Код (#1323) на проде с v1.17.19. Похоже на пробу нового меню статусов WK-05; это гипотеза. Вернуть в 🧪 или так и задумано?

### Задачи «в работе» без движения 7+ дней (статус не меняла)
Последняя дата в заметке или в истории — до 07.11:
- **LORE / AIDA:** [[task:SPRINT_KC_THEMES_VOLVA_LORE/KCT-04]] (02.08, PR #323 тогда же), [[task:SPRINT_VAULT_HARDENING/VH-03]] (02.08), [[task:SPRINT_QG_REBUILD/QG-08]] (25.08), [[task:SPRINT_HOUND_ARCADEDB_DIALECT/ARC-14]] (20.10, решение о гейте за вами).
- **Gladsheim / Gjallarhorn / Midgard:** [[task:SPRINT_GLADSHEIM_SERVER_CORE/SR-31]] (10.09), [[task:SPRINT_GLADSHEIM_INTENT_TOOLS/IT-01]] (15.09), [[task:SPRINT_GJALLARHORN_NEW_WAKEWORD/NW-13]] (16.09), [[task:SPRINT_GJALLARHORN_VOICE_PROFILE/VP-11]] (16.09), [[task:SPRINT_GJALLARHORN_VOICE_PROFILE/VP-10]] (22.09), [[task:SPRINT_GJALLARHORN_WAKEWORD/WW-34]] (23.09), [[task:SPRINT_MIDGARD_ZIGBEE_STACK/ZS-04]] (16.09), [[task:SPRINT_MIDGARD_ZIGBEE_STACK/ZS-05]] (19.09), [[task:SPRINT_MIDGARD_PLANPARSE_PROD/H-03]] (29.08), [[task:SPRINT_MIDGARD_PLANPARSE_PROD/ZW-01]] (01.09), [[task:SPRINT_GLADSHEIM_SERVER_CORE/SR-82]] (05.11), [[task:SPRINT_GLADSHEIM_SERVER_CORE/SR-34]] (06.11), [[task:SPRINT_MIDGARD_KORVO/KV-15]] (05.11).
- **Дата-странники:** [[task:SPRINT_DW_AI_ASSETS/AI-4]] (28.10), [[task:SPRINT_DW_AI_ASSETS/AI-12]] (28.10), [[task:SPRINT_DW_AI_ASSETS/AI-21]] (28.10), [[task:SPRINT_DW_AI_ASSETS/AI-25]] (28.10), [[task:SPRINT_DW_AI_ASSETS/AI-43]] (04.11), [[task:SPRINT_DW_AI_ASSETS/AI-42]] (05.11), [[task:SPRINT_DWL_SETTINGS/ST-1]] (05.11), [[task:SPRINT_DWL_UNITY_STAND/US-1]] (07.11).
- **Völva:** [[task:SPRINT_VOLVA_BRANDING_W2/VB-ICONS]] (06.11, ждёт файлов от дизайна).

Важно: changed_at почти у всех задач — 13.11, 23:21–23:24. Это массовая правка ссылок (/lore/admin/tidy/apply), а не работа, поэтому давность считалась по заметке и по history_task.

### Дефект данных: одна заметка в четырёх задачах
У [[task:SPRINT_HOUND_DIALECT_MODEL_DEPTH/HD-1]], [[task:SPRINT_HOUND_DIALECT_MODEL_DEPTH/HD-3]] и [[task:SPRINT_SITE_SEO_PRERENDER/PRE-03]] заметка целиком состоит из строки «MySQL+MariaDB e2e verified; Trino follow-up». Эта строка относится к [[task:SPRINT_DALI_DIALECTS_LORE_VIZ/DLG-08]]. У всех четырёх статус записан как «PARTIAL» без значка, то есть не по словарю, и все они лежат в закрытых спринтах. Похоже на ошибочную пачечную запись в июне — это гипотеза. Исходные заметки можно поднять из history_task; без вашего слова не трогала.

## Не трогала (свежая чужая работа, меньше 2 часов)
- [[task:SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-02]] — изменена в 11:43. В заметке написано «сверка статуса: IN PROGRESS → PARTIAL», а статус всё ещё 🔄. Похоже, смена статуса не записалась. Пусть её сессия (kit-polish) доведёт или подтвердит.
- [[task:SPRINT_UXR_S9_SCALE_OPT/S9-04]] (11:44) и [[task:SPRINT_VIZ_EMBED/EMB-L2]] (11:44) — их правки #1379 сейчас выкатываются на preprod (#1380, 12:12).
- [[task:SPRINT_UXR_POLISH_UAT_1113/PU-29]] (11:39, открыт PR #1381), [[task:SPRINT_UXR_POLISH_UAT_1113/PU-23]] (11:39).
- [[task:SPRINT_MINILORE_POLISH/PL-1]], [[task:SPRINT_MINILORE_POLISH/PL-19]], [[task:SPRINT_MINILORE_POLISH/PL-23]], [[task:SPRINT_MINILORE_POLISH/MODEL-FROM-LORE]], [[task:SPRINT_MINILORE_POLISH/GOAL-TICKS]] (11:45–11:50), [[task:SPRINT_VIZ_EMBED/VOLVA-EMBED-1]] (11:43), [[task:SPRINT_LORE_OWN_HOST/OH-13]] (10:10).
- В [[sprint:SPRINT_MINILORE_POLISH]] есть [[task:SPRINT_MINILORE_POLISH/UAT-PROBE-STATUS]]. Её статус в 10:22–11:47 четыре раза менялся с учётки omiloreadmin: это пробная задача приёмки. Если проба закончена, задачу стоит отменить.
