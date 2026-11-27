# Класс работы для актуальных задач без класса — предложение

Срез прода LORE, 15.11.2026. По [[task:SPRINT_LORE_MEASURE_TRUTH/MT-CAL-CLASS-REQUIRED]], ваше поручение: «проведи аналитику, предложи класс — на актуальных задачах».

## Картина
- Открытых задач во всей базе — **833**. Без класса — **522** (63%). С классом: enb 156, uc 83, jtd 72.
- **«Актуальные»** = те, что в ходу: в работе, частично, готовы к выкатке, UAT, заблокированы, TODO, дизайн. Таких без класса — **117**. Их я разметила вручную, по смыслу каждой задачи.
- Остальные **405** без класса — PLANNED и BACKLOG. Это следующий шаг, если скажете.
- Автоматическая разметка по ключевым словам **отброшена**: ошибается грубо («чат» находился внутри «включать», «oom» — внутри «LOOM»).

## Правило разметки (словарь work_class)
- **uc** — реализует сценарий пользователя (видно в продукте). Дефект в пользовательском сценарии — тоже uc.
- **jtd** — задача-помощник: данные, ассеты, разбор, прототип, решение.
- **enb** — расчищает дорогу: инфраструктура, CI, тесты, парсеры, безопасность, рефакторинг. Дефект в инфраструктуре — enb.

## Итог предложения по 117
| класс | задач |
|---|---|
| enb | 63 |
| uc | 35 |
| jtd | 19 |

Спорных (⚠, низкая уверенность) — **12**: их стоит глянуть вам. Остальные однозначны по формулировке задачи.

## По спринтам

### SPRINT_HOUND_S3 (21)
- **enb** — [[task:SPRINT_HOUND_S3/HS3-06]] SQL Beautifier перед записью в БД — флаг beautify_sql + интерфейс SqlBeautifier + применять к atom_text (не к geoid)
- **uc** ⚠ — [[task:SPRINT_HOUND_S3/KI-HINT-1]] KI-HINT-1: SQL hints lineage (3559 corpus hits)
- **enb** — [[task:SPRINT_HOUND_S3/T-01]] JsonManifestParser.java: разбирает .json файлы с procedure/function definitions
- **enb** — [[task:SPRINT_HOUND_S3/T-02]] HoundFileType.JSON → JsonManifestParser в ParserRegistry
- **enb** — [[task:SPRINT_HOUND_S3/T-03]] Emit AtomInfo/Structure с source_format=JSON, language=PLSQL|SQL
- **enb** — [[task:SPRINT_HOUND_S3/T-04]] @QuarkusTest: parse 3 JSON fixtures → atoms > 0, source_format = JSON
- **enb** — [[task:SPRINT_HOUND_S3/T-05]] XmlDdlParser.java: разбирает .xml файлы (SSMS Export, Liquibase)
- **enb** — [[task:SPRINT_HOUND_S3/T-06]] HoundFileType.XML → XmlDdlParser в ParserRegistry
- **enb** — [[task:SPRINT_HOUND_S3/T-07]] Emit AtomInfo/Structure с source_format=XML
- **enb** — [[task:SPRINT_HOUND_S3/T-08]] @QuarkusTest: parse 2 XML fixtures → routines detected correctly
- **enb** — [[task:SPRINT_HOUND_S3/T-15]] ParseJob.java: auto-detect file extension → ParserRegistry.forFile(path)
- **enb** — [[task:SPRINT_HOUND_S3/T-16]] .sql / .pls / .pks / .pkb → existing SQL/PL/SQL parsers
- **enb** — [[task:SPRINT_HOUND_S3/T-17]] .json → JsonManifestParser
- **enb** — [[task:SPRINT_HOUND_S3/T-18]] .xml → XmlDdlParser
- **enb** — [[task:SPRINT_HOUND_S3/T-20]] MixedFormatSessionTest: сессия с SQL + JSON + XML файлами
- **enb** — [[task:SPRINT_HOUND_S3/T-21]] atoms > 0 для каждого типа
- **enb** — [[task:SPRINT_HOUND_S3/T-22]] ./gradlew :libraries:hound:test :services:dali:test GREEN
- **enb** — [[task:SPRINT_HOUND_S3/T-23]] JSON + XML файлы принимаются Hound без ошибок
- **enb** — [[task:SPRINT_HOUND_S3/T-24]] AtomInfo/Structure.source_format заполнен для каждого формата
- **enb** — [[task:SPRINT_HOUND_S3/T-26]] ./gradlew :libraries:hound:test :services:dali:test GREEN (0 failures)
- **enb** — [[task:SPRINT_HOUND_S3/T-28]] PR влит в develop

### SPRINT_MINILORE_POLISH (15)
- **uc** — [[task:SPRINT_MINILORE_POLISH/A11Y-SEARCH-MENU-LABEL]] Экран Search: у кнопки меню нет подписи «Menu» для доступности — меню не открыть по тексту
- **enb** — [[task:SPRINT_MINILORE_POLISH/CI-PROBE-LEAK]] Стенды «Стыка клиента и сервера» остаются на ci-server: 8 контейнеров minilore-arcade/probe живут 10–24 ч
- **uc** — [[task:SPRINT_MINILORE_POLISH/GATEWAYS-STATUS-ADMIN]] Лента без плашки «машина не на связи» — статус шлюзов в «Системе»
- **enb** — [[task:SPRINT_MINILORE_POLISH/KC-SEER-ROLES-MAPPER]] Keycloak: клиенту mobilepoc-app маппер seer_roles (User Realm Role, в access token) — статус записи LORE с телефона токе
- **enb** — [[task:SPRINT_MINILORE_POLISH/MODEL-FROM-LORE]] Модель LORE из GET /lore/model вместо своих таблиц статусов и подписей: загрузчик по образцу kit seidr, на Dart
- **uc** — [[task:SPRINT_MINILORE_POLISH/NEWS-CANON-ICONS]] Новости: значки событий и сгорания — по канону веб-LORE, а не эмодзи
- **uc** — [[task:SPRINT_MINILORE_POLISH/NEWS-SPLIT-FEED-ANALYTICS]] Новости: разделить перегруженный экран на «Новости · Лента» и «Новости · Аналитика»
- **jtd** — [[task:SPRINT_MINILORE_POLISH/PL-1]] Обход эмулятора скриптом tools/tour
- **enb** ⚠ — [[task:SPRINT_MINILORE_POLISH/PL-19]] Проверить: фоновый опрос ходит в /feed?since=, которого нет на новом сервере, — молчат ли уведомления при закрытом прило
- **uc** — [[task:SPRINT_MINILORE_POLISH/PL-8]] Паспорт записи LORE — один для всех путей: тип · статус · id, строка-вердикт, баннер целостности, Содержание · Связи · И
- **uc** — [[task:SPRINT_MINILORE_POLISH/PL-LIST-HEADER-GROUPED]] Шапка списка диалогов: действия одной капсулой справа, фильтры — мини-баром как в новостях
- **uc** — [[task:SPRINT_MINILORE_POLISH/PL-SPIN-SPEED]] Скорость ободка говорит состояние (работает 1,6 с, ждёт 8 с)
- **uc** — [[task:SPRINT_MINILORE_POLISH/SEARCH-DUPLICATE-BRAND-BAR]] Экран Search: старый бар со значком и надписью «miniLORE» под общей шапкой — второй бренд
- **uc** ⚠ — [[task:SPRINT_MINILORE_POLISH/TYPE-ICONS-FROM-LORE]] Значки видов записей — из модели LORE (types[].icon), а не свои
- **enb** — [[task:SPRINT_MINILORE_POLISH/UPLOAD-STALL-TEST-WALLCLOCK]] upload_stall_test «живая медленная отправка не обрывается» падает на CI: окно 300 мс живого времени

### SPRINT_DW_AI_ASSETS (7)
- **jtd** — [[task:SPRINT_DW_AI_ASSETS/AI-1]] SDXL (~7 ГБ) в ComfyUI на ryzenai и пробная генерация — скачан, генерация работает с флагом split-attention
- **jtd** — [[task:SPRINT_DW_AI_ASSETS/AI-12]] Проба UniRig (нейросетевой скелет + веса) на Буле против своего скелета
- **jtd** — [[task:SPRINT_DW_AI_ASSETS/AI-19]] Дефект: лица юнитов серо-белые («вампир»), фон отрисовок серый — причина: покраска даёт кожу почти без цвета, Filmic в о
- **jtd** — [[task:SPRINT_DW_AI_ASSETS/AI-2]] Картинка → 3D для прототипа: Hunyuan3D / TRELLIS.2 / TripoSG на наших стендах; финальные модели — на пром-стендах
- **jtd** — [[task:SPRINT_DW_AI_ASSETS/AI-21]] Массовый проход по spec:SPEC-DW-HY3D-UNITS: Кантор, Фреге, Гаусс, Шеннон
- **jtd** — [[task:SPRINT_DW_AI_ASSETS/AI-25]] Юниты серые/болезненные: запекание наследовало множитель цвета 0.8 из MTL покраски
- **jtd** — [[task:SPRINT_DW_AI_ASSETS/AI-42]] Исходник юнита в A-позе: Animagine XL 4.0 + IPAdapter Plus (linear 0,6, end 0,7), чистка фона, 6 юнитов

### SPRINT_HOUND_ARCADEDB_DIALECT (5)
- **enb** — [[task:SPRINT_HOUND_ARCADEDB_DIALECT/ARC-04]] openCypher в HOUND: грамматика + слушатель (MATCH/WHERE/RETURN/CREATE/MERGE/SET), lineage по меткам и свойствам
- **jtd** — [[task:SPRINT_HOUND_ARCADEDB_DIALECT/ARC-05]] Корпус запросов ArcadeDB из нашего кода (SHUTTLE, Heimdall, LORE-слайсы, scripts/lore-*.mjs, HOUND writer) + прогон разб
- **enb** — [[task:SPRINT_HOUND_ARCADEDB_DIALECT/ARC-07]] Регресс контракта HOUND → SHUTTLE → Verdandi для графовых источников (geoid, drill) + отображение в LOOM
- **enb** — [[task:SPRINT_HOUND_ARCADEDB_DIALECT/ARC-08]] Gremlin в HOUND: грамматика TinkerPop Gremlin.g4 + слушатель (V()/E(), hasLabel, out/in/both, addV/addE, property, drop)
- **enb** — [[task:SPRINT_HOUND_ARCADEDB_DIALECT/ARC-14]] Обобщение: гейт CI — собственные запросы AIDA к ArcadeDB проверяются грамматикой ArcadeDB; отказ команды схемы не уходит

### SPRINT_MINILORE_TG_LOOK (5)
- **uc** — [[task:SPRINT_MINILORE_TG_LOOK/TG-30]] Дефект: контраст тем Telegram — t2/t3 ниже WCAG, поле ввода и пузырь сливаются с подложкой
- **uc** — [[task:SPRINT_MINILORE_TG_LOOK/TG-36]] Дефект: скачано в диалоге, а «Файлы» зовут скачать снова; «Сборки» пусты при присланных APK
- **uc** — [[task:SPRINT_MINILORE_TG_LOOK/TG-37]] Дефект: отчёт субагента в ленте её пузырём и сырым текстом — обёртка с преамбулой мимо правила
- **uc** — [[task:SPRINT_MINILORE_TG_LOOK/TG-38]] Дефект: пачка фото рвётся — 7 уведомлений с нарастающим списком, сырые пути её пузырём, «картинку не отдал сервер»
- **uc** — [[task:SPRINT_MINILORE_TG_LOOK/TG-40]] Дефект: флот прячет живых субагентов Claude в «Завершённые» — «жив» решалось по их собственной сессии

### SPRINT_ALERTS (4)
- **uc** — [[task:SPRINT_ALERTS/P-01]] State machine (Active → Acknowledged → Silenced → Resolved)
- **uc** — [[task:SPRINT_ALERTS/P-02]] Channels (Email/Slack/Telegram/PagerDuty)
- **uc** — [[task:SPRINT_ALERTS/P-03]] Silence/ACK/escalation/on-call
- **uc** — [[task:SPRINT_ALERTS/P-04]] Runbook integration

### SPRINT_SITE_SEO_PRERENDER (4)
- **enb** — [[task:SPRINT_SITE_SEO_PRERENDER/PRE-03]] scripts/prerender.mjs — puppeteer-core: форс seer-lang=ru, ожидание рендера/MD, хард-фейл на ошибке, запись dist/<route>
- **enb** — [[task:SPRINT_SITE_SEO_PRERENDER/WWW-01]] .github/workflows/cd.yml — -d www.${DOMAIN} в certbot SAN + NEED_EXPAND-проверку
- **enb** — [[task:SPRINT_SITE_SEO_PRERENDER/WWW-02]] infra/nginx/nginx.conf — отдельный server { server_name www; return 301 → apex }; убрать www из apex server_name
- **enb** — [[task:SPRINT_SITE_SEO_PRERENDER/WWW-03]] DNS-запись www на VM (ops, вне репо)

### SPRINT_VOLVA_BRANDING_W2 (4)
- **enb** — [[task:SPRINT_VOLVA_BRANDING_W2/B-STATICVIZ-PARITY]] Расхождение движков письмо↔браузер: расходятся три типа, и «перенести на ECharts» — неверная починка
- **uc** — [[task:SPRINT_VOLVA_BRANDING_W2/B04-PAGES]] Десять страниц, состоящих только из рекламы платного Metabase: решить и сделать, что там вместо неё
- **uc** — [[task:SPRINT_VOLVA_BRANDING_W2/B04-VOICE]] Голос продукта: ~40 строк, где приложение называет себя Metabase — подставить имя из whitelabel
- **uc** — [[task:SPRINT_VOLVA_BRANDING_W2/VB-ICONS]] Бренд-иконки: все глиф/виз/действия/статус-слоты закрыты дефолтами (вето снято 06.11), остались SVG-иллюстрации

### SPRINT_DW_VISUAL (3)
- **jtd** — [[task:SPRINT_DW_VISUAL/VI-1]] Подобрать шрифты OFL с засечками для HUD v4
- **jtd** — [[task:SPRINT_DW_VISUAL/VI-2]] Дома из Quaternius Medieval Village на станциях
- **jtd** ⚠ — [[task:SPRINT_DW_VISUAL/VI-3]] Вечер и свет в окнах

### SPRINT_GLADSHEIM_SERVER_CORE (3)
- **enb** — [[task:SPRINT_GLADSHEIM_SERVER_CORE/SR-31]] Логика из Node — в Java: проверка людей и узлов, плейлист и разбор телеметрии для показа; Node только отдаёт витрину
- **enb** — [[task:SPRINT_GLADSHEIM_SERVER_CORE/SR-33]] Выкладка через CI Forgejo: тесты и выкладка на стенд по пушу в main, а не скриптами из сессии
- **uc** — [[task:SPRINT_GLADSHEIM_SERVER_CORE/SR-34]] Проверка людей — включить: вход Rauthy или Keycloak; 06.11 AIDA/GLADSHEIM#49 слит и выложен (e134cd5): Keycloak основным

### SPRINT_MIDGARD_ZIGBEE_STACK (3)
- **enb** — [[task:SPRINT_MIDGARD_ZIGBEE_STACK/ZS-04]] Прототип: плата C6 — радио 802.15.4 на Rust по USB, стек на центре поднимает сеть и принимает одно устройство
- **enb** — [[task:SPRINT_MIDGARD_ZIGBEE_STACK/ZS-05]] Координатор на центре службой: сеть создана и переживает перезапуск без пересопряжения
- **jtd** — [[task:SPRINT_MIDGARD_ZIGBEE_STACK/ZS-08]] Завести реестр проверенной совместимости и внести первые результаты

### SPRINT_MINILORE_PIPELINE_HOST (3)
- **enb** — [[task:SPRINT_MINILORE_PIPELINE_HOST/MPH-01]] Тег v* выкатывает сервер на lore-host по SSH; шаг «поднять на ci-server» убран
- **enb** — [[task:SPRINT_MINILORE_PIPELINE_HOST/MPH-02]] Откат (rollback.yml) — на lore-host, по прошлому образу и бэкапу compose
- **enb** — [[task:SPRINT_MINILORE_PIPELINE_HOST/MPH-09]] Дефект: проверка выкатки падала с кодом curl на первой попытке, пока сервер стартует (прогон 590)

### SPRINT_DW_CHARACTERS (2)
- **jtd** ⚠ — [[task:SPRINT_DW_CHARACTERS/CH-2]] Облик странников из деталей KayKit: правила и запекание
- **jtd** ⚠ — [[task:SPRINT_DW_CHARACTERS/CH-5]] 3D-юниты из конвейера 3D-сессии в Unity (прототип): импорт, риг, драйвер подола под чужие Humanoid-клипы

### SPRINT_HOUND_MPP_DIALECTS (2)
- **uc** ⚠ — [[task:SPRINT_HOUND_MPP_DIALECTS/DO-04]] Doris: MTMV как источник lineage — СВОЯ модель, не копия StarRocks
- **uc** ⚠ — [[task:SPRINT_HOUND_MPP_DIALECTS/SR-04]] StarRocks: MV + external catalog как источники lineage

### SPRINT_KIMI_DSH_INTEGRATION (2)
- **uc** — [[task:SPRINT_KIMI_DSH_INTEGRATION/KDP-66]] Регрессия KDP-37: у сессии в Claude desktop нет пути к «Поднять силой» — кнопка неактивна
- **uc** ⚠ — [[task:SPRINT_KIMI_DSH_INTEGRATION/KI-11]] Файлы: link-фикс влит (#259), серверный сигнал о прибытии влит (#142) — ждёт выкатки

### SPRINT_LORE_OWN_HOST (2)
- **enb** — [[task:SPRINT_LORE_OWN_HOST/OH-15]] ArcadeDB: слабый пароль root, 2480/2424/5432 открыты всей LAN, препроду — своя учётка вместо root
- **enb** — [[task:SPRINT_LORE_OWN_HOST/OH-16]] Nexus (aida-nexus, 131): потерян пароль admin — сброс в окно

### SPRINT_LORE_PRODUCT_BACKLOG (2)
- **enb** — [[task:SPRINT_LORE_PRODUCT_BACKLOG/DBR-01]] Свой API-токен ArcadeDB вместо общего root-пароля
- **enb** — [[task:SPRINT_LORE_PRODUCT_BACKLOG/VD-01]] TypeScript 6 vs 7: блокировка внешняя, снятие — не раньше TS 7.1

### SPRINT_MINILORE_DEEP_ARCHIVE (2)
- **enb** — [[task:SPRINT_MINILORE_DEEP_ARCHIVE/DA-7]] Дефект: первый ночной перенос в архив не прошёл — боевой пользователь ArcadeDB не может завести базу minilore_archive
- **enb** — [[task:SPRINT_MINILORE_DEEP_ARCHIVE/DA-8]] Дефект: чтение архива считает базу готовой по одному факту её существования — пустая база без схемы роняет ленту

### SPRINT_OBS_INTEGRATION (2)
- **enb** — [[task:SPRINT_OBS_INTEGRATION/OBS-CMC-ANV]] feat(obs): ContainerMetricCollector для anvil-analytics
- **enb** — [[task:SPRINT_OBS_INTEGRATION/OBS-CMC-VER]] feat(obs): cgroup-metrics.sh для verdandi/heimdall-frontend (nginx container) — некуда отправлять: HTTP-приёмника метрик

### SPRINT_VAULT_HARDENING (2)
- **enb** — [[task:SPRINT_VAULT_HARDENING/VH-01]] Хвосты после перевода на vault (зонтичная): KC-секреты в /chur, least-privilege, .env.prod, chur без токена
- **enb** — [[task:SPRINT_VAULT_HARDENING/VH-03]] chur на персервисный токен FRIGG — последний вызывающий на общем root-креде

### SPRINT_AIDA_PREPROD_MIGRATION (1)
- **enb** — [[task:SPRINT_AIDA_PREPROD_MIGRATION/AID-28]] Hound service-режим на odal: НЕ включать до AID-51 — в текущем коде даёт тихий COMPLETED с пустым графом

### SPRINT_DWL_METHOD (1)
- **jtd** — [[task:SPRINT_DWL_METHOD/ME-1]] Прототипы Аналитики и Методологии (эталон вида для утверждения): сводка «требует внимания», списки, доска, статус в 2 ка

### SPRINT_DWL_SETTINGS (1)
- **enb** — [[task:SPRINT_DWL_SETTINGS/ST-1]] Архитектура настроек: env / Keycloak / Infisical — что где живёт, откуда читается, как сервис падает без настройки

### SPRINT_DWL_SRV_AUTH (1)
- **jtd** — [[task:SPRINT_DWL_SRV_AUTH/AU-1]] Решить: Keycloak (как AIDA) или свои токены для игроков-детей — варианты с доказательствами владелице

### SPRINT_DWL_SRV_GAME (1)
- **uc** — [[task:SPRINT_DWL_SRV_GAME/GM-2]] Тепло рун и остывание; перегоны: открытие квестами, удержание теплом стрелки, пеший путь (SPEC-DWL-RUNE-DREAMS)

### SPRINT_DW_MIGRATION (1)
- **jtd** — [[task:SPRINT_DW_MIGRATION/MG-3]] Решить судьбу старой папки C:\Users\LEGION\Documents\EduGame (не удалять без слова владелицы)

### SPRINT_DW_TRAVEL (1)
- **uc** — [[task:SPRINT_DW_TRAVEL/TR-4]] Пешие тропы между островами — проектирование (D-2026-DW-TRAILS-DESIGN); вариант трассы — за владелицей (Q-DW-TRAILS-VOID

### SPRINT_GJALLARHORN_NET_AUDIO (1)
- **enb** — [[task:SPRINT_GJALLARHORN_NET_AUDIO/NA-06]] Круг по сети замкнут до постановки команды, задержка по участкам измерена (~1 с от конца команды); участок «ответ голосо

### SPRINT_HOUND_EXTERNAL_SOURCES (1)
- **enb** — [[task:SPRINT_HOUND_EXTERNAL_SOURCES/ES-13]] Регресс контракта HOUND → SHUTTLE → Verdandi на тенанте с внешними источниками (drill L1–L3, поиск, KNOT)

### SPRINT_HOUND_NAMESPACE (1)
- **enb** — [[task:SPRINT_HOUND_NAMESPACE/NS-02-DBCASE]] HOUND пуловый путь (RemoteWriter, так парсит Dali) пишет db_name/db_geoid в исходном регистре — нарушение ADR-HND-020 (к

### SPRINT_HOUND_TSQL_SQLITE_DUCKDB (1)
- **enb** — [[task:SPRINT_HOUND_TSQL_SQLITE_DUCKDB/TSD-06]] Распознаватель диалекта: T-SQL, SQLite, DuckDB как семейства (ADR-HND-032 «новый диалект») + замер по SPEC-DIALECT-IDENT

### SPRINT_KC_THEMES_VOLVA_LORE (1)
- **enb** — [[task:SPRINT_KC_THEMES_VOLVA_LORE/KCT-04]] Деплой тем на KC (131) + realm-настройки + живой smoke (логин, смена пароля в ЛС)

### SPRINT_LORE_AGENT_OBSERVABILITY (1)
- **enb** — [[task:SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-ADD-INFISICAL]] Секрет новой и ротированной учётки агента — сразу в Infisical, человек его не видит (хвост AO-AGENT-ADD шаг 2)

### SPRINT_LORE_PROJECT_SCOPE (1)
- **enb** — [[task:SPRINT_LORE_PROJECT_SCOPE/AL-91]] Read-скоуп по проекту: project=omitted → «все РАЗРЕШЁННЫЕ» для не-superadmin, а не буквально все

### SPRINT_MIDGARD_PLANPARSE_PROD (1)
- **uc** ⚠ — [[task:SPRINT_MIDGARD_PLANPARSE_PROD/H-03]] Г-03: пара граней ADLA со скелетом между ними = тело стены

### SPRINT_MINILORE_APK_MINIO (1)
- **uc** — [[task:SPRINT_MINILORE_APK_MINIO/SR-5]] Дефект: «Сборки» в приложении пусты — демон без секции [s3] молча не льёт сборки в MinIO

### SPRINT_MINILORE_GOALS_MULTIHARNESS (1)
- **enb** — [[task:SPRINT_MINILORE_GOALS_MULTIHARNESS/G4]] Реконсиляция целей при reconnect (goal-snapshot) + явный goals.enabled

### SPRINT_UXR_POLISH_UAT_1113 (1)
- **enb** ⚠ — [[task:SPRINT_UXR_POLISH_UAT_1113/PU-17]] Роли задачи — только рёбрами: убрать строковые author/executor/reviewer_agent из модели и отображения, правка только выб

### SPRINT_UXR_S4_UI_SHELL_LISTS (1)
- **uc** — [[task:SPRINT_UXR_S4_UI_SHELL_LISTS/S4-32]] Иконки, не выбранные в S4-25: подобрать вне наборов game-icons и lucide (Настройки, черновик, устарел, вне словаря, кома

### SPRINT_VERDANDI_MOBILE (1)
- **uc** — [[task:SPRINT_VERDANDI_MOBILE/MOB-8]] Регресс mobile: граф DataFlow с данными + header-дропдауны + e2e/visual

### SPRINT_VIZ_EMBED (1)
- **jtd** ⚠ — [[task:SPRINT_VIZ_EMBED/VOLVA-EMBED-1]] Эксперимент: дашборд LORE в Völva + iframe-встройка обратно в LORE

### SPRINT_VOLVA_CI_W2 (1)
- **enb** — [[task:SPRINT_VOLVA_CI_W2/CI-PATH-FILTERS]] CI Völva гоняет только то, что задето: детектор изменённых путей + сводная обязательная джоба (как в aida-root)

### SPRINT_VOLVA_DATASTORY (1)
- **uc** — [[task:SPRINT_VOLVA_DATASTORY/DS-SNAPSHOT]] Режим элемента документа «живой / на дату»: снимок на апстримовом stored_result (ADR-VOLVA-014)

### SPRINT_VOLVA_HELP (1)
- **uc** — [[task:SPRINT_VOLVA_HELP/H10]] Хвосты H03: подпись «Search Metabase's docs», разнобой target у ссылок справки, ссылки на ещё не написанные страницы вст

## Спорные — почему
- **Ассеты и облик (DW CH-2, CH-5, VI-3)** — jtd как работа на контент. Если считать облик частью игрового сценария — uc.
- **Источники lineage в диалектах (Doris DO-04, StarRocks SR-04, KI-HINT-1)** — uc: пользователь видит lineage нового источника. Грамматики и парсеры рядом — enb.
- **KI-11, PL-19, TYPE-ICONS-FROM-LORE, PU-17** — на границе: правка видна пользователю, но суть техническая.
- **MIDGARD H-03** — правило распознавания стены: uc, если распознавание считать функцией продукта.
- **VOLVA-EMBED-1** — эксперимент → jtd.

## Что дальше
1. Ваше «да» или поправки по спорным → я записываю класс в 117 задач, с title дословно и проверкой expected.
2. По желанию — тот же разбор для 405 запланированных.
3. Приток новых задач без класса закрывает решение D5 «подсказка» (в работе по MT-CAL-CLASS-REQUIRED). Замер повторю через неделю.
