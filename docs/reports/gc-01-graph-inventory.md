# GC-01 — инвентаризация наработок AIDA по графу и холсту

Задача: SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-01. Дата: 13.11.2026.
Основание: решение D-2026-LORE-WAVES-1113 (владелица: «Да, раздай»).

**Что читалось.**
- Код AIDA: `C:\AIDA\aida-root`, ветка `feature/tunga-dialect-detect` (cbc7d001). Каталог `frontends/verdandi/src` сверен с `origin/develop` (994d1756, 08.11.2026): расходятся 10 файлов (LoginPage, SqlView, UploadModal, i18n, sessionsApi, dialectUtils, transformHelpers и тесты), файлы холста и раскладки не затронуты. `git fetch` не делался — «origin/develop» здесь означает ссылку на 08.11.
- LORE (MCP aida-lore, прод): ADR-DA-004, ADR-SKULD-001; спеки LOOM_PERFORMANCE_ANALYSIS, LOOM_NAVIGATION, VERDANDI_ARCHITECTURE, SPEC-LORE-GRAPH-VIEWS; спринты SPRINT_ELKQW, SPRINT_ELK_M2_KNOT, SPRINT_LOOM_5K, SPRINT_LOOM_L2_REDESIGN, SPRINT_LOOM_CANVAS_GAPS_JUN26.
- Код kit: `kit/src/graph/*`, `kit/src/record/graph.ts`, `RecordGraph.tsx`, `graphState.ts`, `core/contract.ts` в этом worktree.

**Чего не нашёл.**
- spec:LOOM_CANVAS_ALGORITHMS: в LORE есть только заголовок, `content_md = null`, `file_path = engine/specs/loom/LOOM_CANVAS_ALGORITHMS.md`. Файла нет ни на диске под `C:\AIDA` (поиск до глубины 7), ни в дереве `origin/develop` aida-root, ни в истории git (`git log --all -- '*LOOM_CANVAS_ALGORITHMS*'` пусто). Поиск LORE по названию тоже пуст. По SPRINT_LOOM_L2_REDESIGN/L2R-58 документ писался, но где он сейчас — не нашёл.
- Хука `useEdgesVisible` (SPRINT_LOOM_5K/T-02, «✅ DONE») в коде нет, в истории git тоже нет (`git log -S useEdgesVisible --all` пусто). Рёбра в LOOM отсекает только штатное `onlyRenderVisibleElements` React Flow, и включается оно при числе узлов > 1500 (`LoomCanvas.tsx:287`, `constants.ts` `PERF_VIRTUALIZE_THRESHOLD`).
- **SKULD canvas нет в коде.** Маршрут `skuld` — заглушка `UnderConstructionPage` (`frontends/verdandi/src/App.tsx:164-167`). От ADR-SKULD-001 остаются только решения: конвейер хранится графом `nodes[]+edges[]`, холст делается на `@xyflow/react`.
- **В KNOT графа нет.** `frontends/verdandi/src/components/knot/*` (KnotPage, KnotStructure, KnotStatements…) — таблицы и отчёты; ни `@xyflow`, ни `elk` там не импортируются (проверено grep). Название SPRINT_ELK_M2_KNOT вводит в заблуждение: из ELK в нём только P-01 (автопереключение на stress/mrtree), остальное — секции инспектора.
- В LORE нет sprint:SPRINT_LOOM_L2_REDESIGN с ровно 107 задачами «по L-модели холста»: в спринте смешаны задачи LORE-статусов (L2R-01..05), HOUND/MIMIR/KNOT (L2R-63..74, 101, 103, 108) и холста. В таблицу ниже взяты только задачи холста.

---

## 1. Как LOOM выносит ELK из главного потока

**Ответ: в LOOM раскладка действительно идёт в настоящем Web Worker. Сделано это через `elk.bundled.js` со своим `workerFactory`, а не через `elk-api.js`.**

Файл — `C:\AIDA\aida-root\frontends\verdandi\src\utils\layoutGraph.ts`:
- `:17` — `import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'`: Vite выкладывает воркер отдельным файлом и отдаёт его адрес.
- `:353-367` `resolveWorkerBlobUrl()` — скачивает этот файл через `fetch` и превращает в same-origin `blob:`-адрес. Так обходили запрет кросс-доменного `new Worker()` в эпоху Module Federation; сейчас это лишние 1,6 МБ (размер `elk-worker.min.js` — 1 593 716 байт) в памяти.
- `:369-384` `getElk()` — динамический `import('elkjs/lib/elk.bundled.js')` и `new ELK({ workerFactory: () => new Worker(blobUrl) })` **без** `workerUrl`.
- `:394-415` `runElkLayout()` — `Promise.race` раскладки с таймаутом. Если раскладка не вернулась (`null`), включается сетка: `applyGridLayout`, `:564-568`.

Почему это работает, а замер 11.11 видел главный поток. Проверено по исходнику `node_modules/elkjs/lib/elk.bundled.js` (elkjs 0.11.1):
- `:6551-6560` — если передан `workerUrl`, но npm-пакета `web-worker` нет, bundled печатает предупреждение и **откатывается на поддельный воркер**.
- `:6562-6566` — «поддельный воркер» (`require('./elk-worker.min.js').Worker`) ставится, только если `workerFactory` не передан.
- `elk-api.js:38-50` — переданная `workerFactory` вызывается как есть.

Значит, `elk.bundled.js` игнорирует `workerUrl` и уважает `workerFactory`. Вывод spec:SPEC-LORE-GRAPH-VIEWS §10 («нужно `elk-api.js` + `workerUrl`») верен как один из рабочих путей, но не единственный: LOOM пришёл ко второму.

Тот же приём, только без blob, — в HEIMDALL: `C:\AIDA\aida-root\frontends\heimdall-frontend\src\components\ServiceTopology.tsx:7-8, 112-118`.

**Чего LOOM при этом не довёл (найдено в коде):**
1. **Отмена не убивает воркер.** `cancelPendingLayouts()` (`layoutGraph.ts:387-392`) вызывает `(_elk as any).terminate?.()`. У класса ELK такого метода нет — есть `terminateWorker()` (`node_modules/elkjs/lib/elk-api.js`, блок `_createClass` около `:111`). `terminate` есть только у внутреннего `PromisedWorker` (`:169`). Поэтому вызов ничего не делает: ссылку на ELK обнуляют, а старый воркер продолжает считать. При смене скоупа (`LoomCanvas.tsx:165`) и при каждой очистке эффекта (`useLoomLayout.ts:250`) рядом создаётся новый воркер. По таймауту воркер тоже не останавливается: `Promise.race` лишь перестаёт ждать результат.
2. **Тяжёлая работа вокруг ELK остаётся в главном потоке.** `resolveCollisions` (`layoutGraph.ts:78-123`) — до 80 проходов O(n²); `graphFingerprint` (`:301-306`) — сортировка узлов. Ещё в главном потоке libavoid (WASM): `utils/avoidRouting.ts`, `hooks/canvas/useAvoidRoutes.ts` — поэтому там жёсткий предел `AVOID_MAX_NODES = 60`, по комментарию «зависание страницы на 144 узлах».
3. **Свой воркер `src/workers/elkWorker.ts` — мёртвый код.** Его никто не импортирует (grep по `src` находит только сам файл). Гипотеза из VERDANDI_ARCHITECTURE §11.1 подтверждается.
4. **Состояние «не уложилось» показывается не всегда.** При таймауте раскладка молча становится сеткой. Предупреждение выводится только если `isGrid && nodeCount > AUTO_GRID_THRESHOLD (1800)` (`useLoomLayout.ts:191-195`). На 800 узлах, где по таймауту в 8 с уже бывает сетка, человек получает сетку без объяснения.

**Что из этого применимо к kit:**
- Берём: ленивую загрузку ELK (динамический `import` внутри функции раскладки), `workerFactory` / `workerUrl` на отдельный файл `elk-worker.min.js?url`, `Promise.race` с таймаутом и запасной раскладкой.
- Меняем: в kit используем `elk-api.js` (в нём нет 1,6 МБ движка в главном бандле — сам движок только в воркере) + `workerUrl`. Отмену делаем через `terminateWorker()` с проверкой тестом. По таймауту убиваем воркер и показываем честное состояние, а не тихую сетку. Blob-обход MF не нужен.
- Не берём: `src/workers/elkWorker.ts` (мёртв) и порог 1800 у предупреждения.

---

## 2. Таблица: наработка AIDA → решение для kit

Решения: **как есть** — переносим код почти без правки; **переписываем** — берём идею или алгоритм, код пишем под договор kit (токены, i18n, без доменных имён K-14); **не берём** — с причиной.

| # | Наработка AIDA | Решение | Причина | Где в AIDA |
|---|---|---|---|---|
| 1 | Выбор React Flow (`@xyflow/react` 12) как отрисовщика холста | **как есть** (зависимость) | В силе ADR-DA-004 и решение D-2026-SEIDRKIT-GRAPH-ENGINES: React Flow — только локальный граф, mind map и холст | ADR-DA-004; `frontends/verdandi/package.json` (`^12.11.2`) |
| 2 | Запуск ELK в воркере через `workerFactory` и ленивую загрузку | **переписываем** | Приём рабочий, но в kit — `elk-api.js` + `workerUrl`, настоящая отмена (`terminateWorker`), без blob-обхода MF | `src/utils/layoutGraph.ts:17, 353-415` |
| 3 | Адаптивные опции ELK по числу узлов: ≤500 BRANDES_KOEPF + NETWORK_SIMPLEX + thoroughness 25/10; >500 LINEAR_SEGMENTS; >700 LONGEST_PATH, thoroughness 3, без post-compaction | **как есть** (как таблица опций) | Числа сняты на живых графах (HOTFIX 28.05.2026: 18,6 с на 724 узлах до правки). Это знание, его не надо добывать заново | `layoutGraph.ts:190-236`; `constants.ts` `LARGE/HUGE_GRAPH_THRESHOLD` |
| 4 | Режим плотного графа: E/V > 3 → `stress`, но только для ненаправленного обзора; для направленного lineage — всегда `layered` | **переписываем** (правило в договор) | Правило верное и для LORE: зависимости спринтов направлены, на них stress недопустим. Порог надо перемерить на графах LORE | `layoutGraph.ts:238-249, 500-514`; SPRINT_ELK_M2_KNOT/P-01 |
| 5 | Дедупликация рёбер перед ELK с переносом их числа в `elk.layered.priority.straightness` (EK-PRIO) | **как есть** (функция) | Чистая функция без зависимостей; у LORE между двумя записями бывает несколько рёбер разных типов | `layoutGraph.ts:308-316, 537-559` |
| 6 | В ELK подаются только «потоковые» рёбра, рёбра вложенности (`CONTAINS_*`) идут мимо раскладки | **переписываем** (как параметр) | У kit нет предметных имён рёбер; в договор нужен признак «ребро участвует в раскладке». Для этого подходит существующий `config.edges[type].layer === 'structural'` (`kit/src/core/contract.ts:11`) | `layoutGraph.ts:138-150` |
| 7 | Кэш раскладки по отпечатку (FNV-1a, XOR-свёртка рёбер); ключ включает `elkRouting` | **переписываем** | Идея годная. Кэш с одной записью LOOM_PERFORMANCE_ANALYSIS сама называет слабым местом (M-9, LRU(5) не сделан). В kit — LRU и ключ без высот DOM | `layoutGraph.ts:251-306` |
| 8 | Ортогональные рёбра по точкам изгиба ELK (`sections → bendPoints`) с закруглёнными углами; запасной вариант — smoothstep | **как есть** (компонент ребра + `extractEdgeRoutes`) | 77 строк, зависят только от `@xyflow/react`. Цвета из `style`, сырых hex нет. Константу `EDGE_ORTHO_RADIUS` перенести в настройки kit | `components/canvas/OrthogonalEdge.tsx`; `layoutGraph.ts:263-278`; SPRINT_LOOM_L2_REDESIGN/L2R-41, L2R-52 |
| 9 | Раскладка POLYLINE — повторный запуск ELK с `edgeRouting=POLYLINE` | **как есть** (опция) | Одна опция ELK, уже покрыта кэшем | `layoutGraph.ts:192, 200`; L2R-51 |
| 10 | Обход узлов рёбрами через libavoid-js (WASM) | **не берём** | Считается в главном потоке, вешает страницу уже на 144 узлах, отсюда предел 60. WASM в `public/`. Для доски и mind map не нужен | `utils/avoidRouting.ts`, `hooks/canvas/useAvoidRoutes.ts` (`AVOID_MAX_NODES = 60`); L2R-42, L2R-62 |
| 11 | Разведение наложений после ELK (`resolveCollisions`, 80 проходов O(n²)) | **переписываем** | Нужен на циклических графах, но в главном потоке и O(n²). В kit — внутри того же воркера после ELK или через сетку-индекс | `layoutGraph.ts:70-123` |
| 12 | Запасная сетка с учётом высоты столбцов | **как есть** (функция) | Чистая, детерминированная — годится как раскладка при отказе ELK | `layoutGraph.ts:125-136` |
| 13 | Таймаут ELK: 15 с, при > 700 узлов — 8 с | **переписываем** | Таймаут нужен. Но в LOOM по таймауту воркер не убивается, и сетка молча показывается до 1800 узлов (см. §1, п. 4). В kit — убить воркер и назвать состояние | `constants.ts` `TIMEOUT_MS`, `ELK_TIMEOUT_LARGE`; `useLoomLayout.ts:191-195` |
| 14 | Hub-stop: узел с более чем 13 новыми соседями по направлению сворачивается в счётчик на кнопке раскрытия; бюджет обхода 2000 узлов | **переписываем** (правило) | Сам алгоритм живёт на сервере SHUTTLE (Java), в kit его не перенести. Но правило совпадает с кластером хаба kit (`GRAPH_CLUSTER_MAX = 12`). Нужно одно правило для всех отрисовщиков | `services/shuttle/.../ExploreTableService.java:198, 203, 258-327`; `nodes/NodeExpandButtons.tsx`; L2R-59..61, L2R-90 |
| 15 | Раскрытие узла ‹ › с удержанием фокуса (без fitView при раскрытии) | **переписываем** | Поведение нужно mind map и локальному графу. Код привязан к `loomStore` (в `NodeExpandButtons.tsx` 6 обращений к стору/i18n) | `nodes/NodeExpandButtons.tsx`; `useLoomLayout.ts:226-243`; L2R-46 |
| 16 | LOD по масштабу: при zoom < 0.35 узел свёрнут (`ZoomLevelContext`) | **как есть** (идея и контекст) | Контекст — 20 строк без зависимостей; правило «высота ручки не зависит от LOD» (`TableNode.tsx:121`) переносим вместе с ним | `components/canvas/ZoomLevelContext.tsx`; `nodes/TableNode.tsx:110-125` |
| 17 | Высота узла для ELK — по реальному рендеру (обёртка 70/94 + 25 px на строку), иначе узлы перекрываются | **переписываем** (правило) | Числа принадлежат LOOM-узлам. Переносится правило: «резерв ELK = размер отрисовки», лучше брать измерение React Flow (`measured`), а не константы | `layoutGraph.ts:38-68`; `constants.ts:COL_ROW_HEIGHT`; L2R-53 |
| 18 | Узлы LOOM (TableNode, StatementNode, RoutineNode, группы пакетов/схем…) | **не берём** | Доменные (lineage БД), привязаны к `loomStore`; в StatementNode 20 сырых hex, в RecordNode 10, `fontSize: '12px'` числом (`TableNode.tsx:41`) — нарушают токены kit. Для kit — свои обобщённые узлы | `components/canvas/nodes/*.tsx`, `nodeTypes.ts` |
| 19 | Группы-подложки (пакет вокруг своих рутин) по bounding box после ELK | **переписываем** | Пригодится для «рамок» на доске; код в LOOM знает `packageId` | `layoutGraph.ts:417-458` |
| 20 | Составная раскладка (compound): ELK раскладывает только верхний уровень, дети на заранее заданных относительных местах | **переписываем** | Для mind map и структуры с вложенностью полезно, но в LOOM дети позиционируются в transform-ах предметной области | `layoutGraph.ts:584-656` |
| 21 | Конвейер показа из чистых функций (`displayPipeline.ts`: скрытие узлов, направление вверх/вниз, табличный вид, переключатель колоночных рёбер) | **переписываем** (направленный фильтр) | Фильтр «вверх / вниз от узла» (`applyDirectionFilter`) нужен kit. Подсветку надо строить по правилу из L2R-99/105: вниз — только вперёд, вверх — только назад, раздельно от исходного узла. Остальные фазы — предметные (L1, колонки) | `utils/displayPipeline.ts:113-174`; L2R-99, L2R-105 |
| 22 | Отсечение невидимого: `onlyRenderVisibleElements` при > 1500 узлах | **как есть** (настройка) | Штатная опция React Flow. Заявленный `useEdgesVisible` (SPRINT_LOOM_5K/T-02) в коде не найден — на него не рассчитывать | `LoomCanvas.tsx:287`; `constants.ts` `PERF_VIRTUALIZE_THRESHOLD` |
| 23 | Экспорт холста в PNG/SVG через `html-to-image` | **переписываем** | Полезно для доски и mind map. В LOOM экспорт завязан на стор и `lucide-react` (в kit иконки — game-icons) | `components/canvas/ExportPanel.tsx:65-100` |
| 24 | Свой ELK-воркер `src/workers/elkWorker.ts` | **не берём** | Мёртвый код: не импортируется | `src/workers/elkWorker.ts` |
| 25 | Blob-обход кросс-доменного воркера (Module Federation) | **не берём** | MF удалён в v1.3.22 (VERDANDI_ARCHITECTURE §7.3); в kit MF нет | `layoutGraph.ts:343-367` |
| 26 | Навигация L1–L5 → Welcome / DataFlow / Explanation | **не берём** | Модель конкретного продукта (lineage). Из неё в kit идёт только приём «оверлей-разбор узла снизу ~38%» как возможный вид | spec:LOOM_NAVIGATION; `components/canvas/ExplanationPanel.tsx` |
| 27 | Zustand-стор холста из 11 слайсов (`loomStore`) | **не берём** | Состояние вида в kit живёт в URL (правило kit, `record/graphState.ts`). LOOM_PERFORMANCE_ANALYSIS §4.1 сама называет стор без селекторов узким местом | `stores/loomStore.ts`, `stores/slices/*` |
| 28 | Слоёная раскладка HEIMDALL с жёсткими слоями (`layerChoiceConstraint`) | **как есть** (приём) | Нужно для «структуры» kit, где слой задаёт приложение (например, компонент → проект → продукт) | `frontends/heimdall-frontend/src/components/ServiceTopology.tsx:172-190` |
| 29 | SKULD canvas: конвейер `nodes[]+edges[]`, флаги на рёбрах, перетаскивание узлов | **не берём код** — его нет | В коде только заглушка; от ADR-SKULD-001 остаётся требование «холст-редактор на React Flow». Это задача GC-02 (режим правки), а не перенос | ADR-SKULD-001; `App.tsx:164-167` |
| 30 | Числа замеров LOOM: ELK 524–1800 мс на 430 узлах / 709 рёбрах; рендер «2–4 с» на 17K рёбер | **как есть** (как ориентир) | Совпадают с замером LORE 11.11 (React Flow + ELK: 12,6 с на 883 узлах, 52 с на 1535). Это подтверждает предел React Flow «до сотен узлов» | spec:LOOM_PERFORMANCE_ANALYSIS (таблицы 1–3); spec:SPEC-LORE-GRAPH-VIEWS §10 |

---

## 3. Чего в kit не хватает для GC-02

Что есть сейчас (проверено в коде worktree):
- `kit/src/graph/` — GraphExplorer с двумя движками: `ForceEngine.tsx` (force-graph, d3-force в главном потоке) и `ObsidianEngine.tsx` + `obsidian.worker.ts` (d3-force в воркере, sigma на WebGL). Есть договор движков `engineTypes.ts` (`GxEngineProps`), вход `GxNode {id, type, title?, depth?}` / `GxEdge {from, rel, to, kind?}` (`settings.ts:10-12`).
- `kit/src/record/graph.ts` — чистая раскладка «секторы» с кластером хаба (`GRAPH_CLUSTER_MAX = 12`), отрисовка на SVG в `RecordGraph.tsx`.
- Зависимости kit: `force-graph`, `sigma`, `graphology`, `d3-force` (`kit/package.json:51-54`). **`@xyflow/react` и `elkjs` в kit нет**: ни в зависимостях, ни в импортах (grep по `kit/src` пуст).

Пробелы:

1. **Третьего отрисовщика нет.** Нет React Flow, нет ELK, нет воркера ELK. Нужно: движок `flow` (React Flow) с раскладкой ELK в воркере — для доски, mind map и структуры. Сам `GxEngine = 'force' | 'obsidian'` (`settings.ts:17`) нужно расширять.
2. **Вход разошёлся в двух местах.** GraphExplorer принимает `GxEdge.rel` (`settings.ts:12`), а основной договор kit — `KitEdge.type` (`core/contract.ts:55`). Вкладка «Граф» перекладывает одно в другое вручную (`RecordGraph.tsx:186-196`, там ещё и `kind: CLUSTER_KIND` у узла). Для GC-02 нужна **одна** форма: `{id, type, title}` + `(from, rel, to, kind?)`, и адаптер из `KitEdge`.
3. **Выбора отрисовщика по виду и объёму нет.** Сейчас вид выбирает человек (`GX_ENGINES`, личная настройка `graph_view`). Правила «React Flow — до ~300 узлов и для правки, sigma — больше» нет нигде. Нужна чистая функция `pickEngine(kind, nodeCount, editable)` с порогами из замера §10 и проверкой тестом.
4. **Нет договора раскладки вне главного потока.** У Обсидиана физика в воркере. Но у Force — в главном потоке (`ForceEngine.tsx`, шапка-комментарий: «18 кадров/с на 7 354 узлах»), а для ELK воркера нет вовсе. В договоре нужно правило «раскладка и симуляция — только в воркере» и общий модуль воркера ELK. Требования к нему: `elk-api.js` + `workerUrl` на `elk-worker.min.js?url`, ленивая загрузка (1,6 МБ), отмена через `terminateWorker()`, таймаут с завершением воркера.
5. **Нет честного состояния «раскладка не уложилась в N с».** В `GraphExplorer.tsx` есть только `LoadError` (ошибка движка), `EmptyState` (пусто или всё отфильтровано) и `loading` (пока грузится библиотека). Состояния «считается раскладка… N с» с отменой и «не уложилась в N с — показана упрощённая раскладка / [посчитать дольше]» нет. Ошибку воркера Обсидиана ловит `w.onerror` (`ObsidianEngine.tsx:48`), но таймаута у него нет. Это обязательный пункт GC-02 п. 4: здесь LOOM как раз ошибся (§1, п. 4).
6. **Одного правила хаба на все отрисовщики нет.** Кластер есть в секторах и в Force/Обсидиане вкладки «Граф» (PU-11, `RecordGraph.tsx:180-200`), но живёт в `record/`, а не в договоре `graph/`. Нужно вынести в общий слой, чтобы React Flow-вид сворачивал хаб так же: счётчик на кнопке раскрытия, как L2R-90 в LOOM.
7. **Нет слоя «координаты» в договоре.** SPEC-LORE-GRAPH-VIEWS §7 требует обязательный слой «координаты по сети» (ELK считает → отрисовщики, включая телефон, рисуют). Сейчас движки kit считают и рисуют сами. Нужен тип `GxLayout { positions: Map<id,{x,y}>, edgeRoutes?, status: 'ok'|'fallback'|'timeout' }`, отделённый от отрисовки.
8. **Нет признака «ребро участвует в раскладке».** В LOOM его роль играет `DATA_FLOW_FOR_LAYOUT`. В kit есть `config.edges[type].layer === 'structural'`, но GraphExplorer его не получает. Для ELK нужно передавать, какие связи задают слои, а какие только рисуются.
9. **Нет режима правки.** Для доски и холста (ADR-SKULD-001 — конвейер `nodes[]+edges[]`) нужны перетаскивание с сохранением положения, создание ребра и отмена. В движках kit сейчас только выбор и открытие (`GxEngineProps.onSelect`, `onOpen`), а перетаскивание в Обсидиане — физическое, без сохранения.
10. **Замер §10 сделан с неверным воркером.** GC-02 требует перемерить React Flow + ELK с настоящим воркером. В прототипе elkjs 0.9.3, в AIDA — 0.11.1, в последнем npm (по §2 спеки) — 0.12.1. Версию для kit надо выбрать и проверить, что `terminateWorker` в ней есть.

---

## 4. Расхождения в LORE, найденные по ходу

- SPRINT_LOOM_5K/T-02 «useEdgesVisible ✅ DONE» — кода нет и не было (см. выше).
- spec:LOOM_CANVAS_ALGORITHMS — пустая запись: тела нет, файл не найден.
- VERDANDI_ARCHITECTURE §11.1 пишет, что `elk.bundled.js` использует `elk-worker.min.js` как настоящий воркер. Это верно, но только благодаря явному `workerFactory`. А «отмена in-flight запросов» (`clearLayoutCache`) на деле не завершает воркер (§1, п. 1).
- spec:SPEC-LORE-GRAPH-VIEWS §10 говорит «нужно `elk-api.js` + `workerUrl`». Это верно, но LOOM показывает второй рабочий путь: `elk.bundled.js` + `workerFactory`.

В LORE ничего не записано (по условию задачи).
