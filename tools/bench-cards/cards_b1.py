# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
from cards_lib import run_batch

CARDS = [
{
 'card_id':'codes_2024','ref_id':'codes_2024','name':'CodeS','group':'RUCKBReasoning','date':'Фев 2024 · SIGMOD',
 'bird':'57.3','spider':'85.1','link':'https://arxiv.org/abs/2402.16347',
 'tldr':'Открытые LM 1B–15B впервые конкурентны с GPT-4 за счёт инкрементального пред-обучения на SQL-корпусе и аккуратного построения database-prompt.',
 'arch':'Инкрементальный пред-трейн на 11 ГБ SQL-центричного корпуса (поверх StarCoder) даёт семейство CodeS 1B/3B/7B/15B. Затем строится database-prompt: фильтрация схемы классификатором релевантности, привязка значений (BM25+LSH по ячейкам), метаданные (типы, PK/FK, репрезентативные строки) и двунаправленное расширение схемы.',
 'prep':'SQL-центричный корпус для инкрементального пред-обучения. Двунаправленное расширение схемы (вопрос→схема и схема→вопрос) и сопоставление значений колонок для schema linking. Построение компактного database-prompt из релевантных таблиц, колонок и примеров значений.',
 'method':'SFT семейства открытых моделей 1B–15B. Полный инженерный конвейер: данные → дообучение → инференс single-greedy. Без RL и без CoT.',
 'results':'BIRD 57.3% EX, Spider 85.1%. Первый паритет открытых моделей с GPT-4 эпохи.',
 'findings':'Открытые модели жизнеспособны при правильной подготовке данных и schema linking; двунаправленное расширение схемы — ранний намёк на структурный контекст (но без lineage). Задал инженерный шаблон линии RUC.',
 'hound':'Базовый SFT-предок. Пролинкован к H-domain-collapse, H-det-retrieval. Двунаправленное расширение схемы — далёкий предшественник нашего lineage-обогащения, но остаётся на уровне одного запроса.',
 'mm':(
'  corpus["SQL-центричный корпус 11ГБ"]:::in --> pre["Инкрементальный пред-трейн<br/>StarCoder → CodeS 1-15B"]:::synth\n'
'  pre --> DBP\n'
'  subgraph DBP["Построение database-prompt (schema linking)"]\n'
'    direction TB\n'
'    f1["Schema filtering<br/>классификатор релевантности"]:::proc\n'
'    f2["Value matching<br/>BM25 + LSH по ячейкам"]:::proc\n'
'    f3["Метаданные: типы, PK/FK, строки"]:::proc\n'
'    f4["Двунаправленное расширение схемы"]:::proc\n'
'  end\n'
'  DBP --> sft["SFT на target · single-greedy"]:::synth\n'
'  sft --> out["BIRD 57.3% · Spider 85.1%"]:::result\n'
)},
{
 'card_id':'chess_2024','ref_id':'chess_2024','name':'CHESS','group':'Talaei/Google','date':'Май 2024',
 'bird':'~65','spider':'','link':'https://arxiv.org/abs/2405.16755',
 'tldr':'Контекстуальное сжатие схемы четырьмя агентами: лишние таблицы/колонки зашумляют генерацию — их отсекают до LLM.',
 'arch':'Четыре агента в конвейере: Information Retriever извлекает значения и контекст, Schema Selector сжимает схему до релевантного подмножества, Candidate Generator порождает SQL с CoT и циклом коррекции, Unit Tester отбраковывает кандидатов сгенерированными тестами на исполнение.',
 'prep':'Работает с BIRD/Spider напрямую (промптинг, собственного корпуса нет). Иерархическое извлечение значений БД и контекста под конкретный вопрос.',
 'method':'Мультиагентный промптинг проприетарной модели (GPT-4o), CoT. Ключ — Schema Selector: bottleneck не генерация, а размер схемы.',
 'results':'~65% EX на BIRD — сильный результат промптинговой эры без дообучения.',
 'findings':'Сжатие контекста схемы — отдельный важный компонент конвейера. Unit Tester показывает ценность исполнения как фильтра кандидатов.',
 'hound':'Schema Selector = ручка управления контекстом, релевантная нашей проблеме чувствительного/ограниченного контекста (резонанс с H-data-profiling и KaSLA-линией).',
 'mm':(
'  q["Вопрос"]:::in --> IR\n'
'  subgraph IR["① Information Retriever"]\n'
'    direction TB\n'
'    i1["ключевые слова / сущности"]:::proc --> i2["retrieve значений (LSH)"]:::proc --> i3["retrieve контекста / описаний"]:::proc\n'
'  end\n'
'  IR --> SS\n'
'  subgraph SS["② Schema Selector"]\n'
'    direction TB\n'
'    s1["фильтр колонок"]:::proc --> s2["выбор таблиц"]:::proc --> s3["минимальная схема"]:::eval\n'
'  end\n'
'  SS --> CG\n'
'  subgraph CG["③ Candidate Generator"]\n'
'    direction TB\n'
'    g1["CoT-генерация SQL"]:::proc --> g2["revise / fix loop"]:::proc\n'
'  end\n'
'  CG --> ut["④ Unit Tester<br/>тесты → исполнить → отбор"]:::eval\n'
'  ut --> out["SQL · BIRD ~65%"]:::result\n'
)},
{
 'card_id':'chase_sql_2024','ref_id':'chase_sql_2024','name':'CHASE-SQL','group':'Talaei/Google','date':'Окт 2024',
 'bird':'73.0 (SOTA)','spider':'','link':'https://arxiv.org/abs/2410.01943',
 'tldr':'Многопутевая генерация тремя независимыми стратегиями + обучаемый попарный селектор выбирает лучший кандидат.',
 'arch':'Три генератора порождают кандидатов разными путями: divide-and-conquer CoT (декомпозиция вопроса), query-plan CoT (рассуждение как план исполнения), онлайн-синтез few-shot примеров под схему. После fix-loop обученный selection-агент сравнивает кандидатов попарным бинарным предпочтением и выбирает финал.',
 'prep':'BIRD напрямую (промптинг). Онлайн-синтез примеров — один из генераторов производит few-shot на лету под конкретную схему.',
 'method':'Промптинг Gemini 1.5 Pro по трём стратегиям; обученный selection-агент ранжирует кандидатов попарным предпочтением (исполнение на тестовых входах).',
 'results':'73.0% EX на BIRD test — состояние искусства промптинговой эры.',
 'findings':'Первый системный механизм отбора кандидатов: разнообразие путей + обучаемый селектор. Прямой образец для JudgeSQL.',
 'hound':'Preference-отбор — предшественник execution-grouping JudgeSQL. Остаётся на одном слое (result-set), AST не разбирает → иллюстрация H-single-layer-eval.',
 'mm':(
'  q["Вопрос"]:::in --> g1["① Divide-and-Conquer CoT<br/>декомпозиция → под-запросы → сборка"]:::proc\n'
'  q --> g2["② Query-Plan CoT<br/>scan → join → filter → aggregate"]:::proc\n'
'  q --> g3["③ Online synthetic examples<br/>few-shot на лету"]:::proc\n'
'  g1 --> pool["Пул кандидатов + fix loop"]:::proc\n'
'  g2 --> pool\n'
'  g3 --> pool\n'
'  pool --> sel["Selection Agent<br/>попарное бинарное предпочтение"]:::eval\n'
'  sel --> out["BIRD 73.0% · SOTA промптинг-эры"]:::result\n'
)},
{
 'card_id':'route_2024','ref_id':'route_2024','name':'ROUTE','group':'Alibaba','date':'Дек 2024',
 'bird':'60.9','spider':'86.0','link':'https://arxiv.org/abs/2412.10138',
 'tldr':'Промышленный мультизадачный SFT на 4 взаимосвязанных задачах + совместный инференс MCP-цепочкой.',
 'arch':'Общий backbone дообучается на четырёх задачах: text-to-SQL, schema linking, noise correction, continuation writing — с фильтрацией семантически несогласованных примеров. На инференсе Multitask Collaboration Prompting связывает задачи в цепочку: сначала SL сужает схему, затем генерация, затем noise-correction самопроверка.',
 'prep':'Spider+BIRD mix; четыре взаимосвязанных задачи с фильтрацией несогласованных примеров.',
 'method':'Мультизадачный SFT (Qwen2.5 7/14/70B, Llama3-8B) + MCP на инференсе объединяет сигналы задач.',
 'results':'Spider 86.0% (Llama3-8B), BIRD 60.9% (Qwen2.5-14B).',
 'findings':'Робастность через мультизадачность; schema linking как одна из совместно обучаемых задач, усиливающих друг друга.',
 'hound':'Промышленный фокус близок нашему; SL встроен в мультитаск, но без lineage-слоя. Резонанс с H-parse-vs-llm (parse как альтернатива retrieval).',
 'mm':(
'  subgraph T["① Мультизадачный SFT (4 задачи)"]\n'
'    direction TB\n'
'    t1["Text-to-SQL"]:::proc\n'
'    t2["Schema linking"]:::proc\n'
'    t3["Noise correction"]:::proc\n'
'    t4["Continuation writing"]:::proc\n'
'  end\n'
'  T --> trn["Совместное дообучение<br/>фильтрация несогласованных<br/>Qwen2.5 7/14/70B"]:::synth\n'
'  trn --> MCP\n'
'  subgraph MCP["② MCP — Multitask Collaboration Prompting"]\n'
'    direction TB\n'
'    m1["SL: сузить схему"]:::proc --> m2["генерация SQL"]:::proc --> m3["noise-correction самопроверка"]:::proc\n'
'  end\n'
'  MCP --> out["Spider 86.0% · BIRD 60.9%"]:::result\n'
)},
{
 'card_id':'rsl_sql_2024','ref_id':'rsl_sql_2024','name':'RSL-SQL','group':'Независимые','date':'Ноя 2024',
 'bird':'67.2','spider':'','link':'https://arxiv.org/abs/2411.00073',
 'tldr':'Робастный schema linking: бинарный выбор между полной и отобранной схемой как страховка от потери нужных колонок.',
 'arch':'Двунаправленное связывание (forward: вопрос→черновой SQL→использованная схема; backward: схема→релевантные элементы) объединяется. Затем бинарный выбор между полной схемой (страховка) и отобранной (по информационному выигрышу). После генерации — многоходовая самокоррекция с исполнением.',
 'prep':'BIRD/Spider напрямую; контекстуальное обогащение информации перед генерацией.',
 'method':'Двунаправленный SL, бинарный выбор схемы, многоходовая самокоррекция. GPT-4o / Qwen.',
 'results':'BIRD 67.2% EX.',
 'findings':'Главный риск schema linking — пропуск элемента, необратимо рушащий генерацию; бинарная страховка снижает потерю recall.',
 'hound':'Подтверждает хрупкость retrieval-SL → мотивирует H-det-retrieval (детерминированный parse) и H-rag-ceiling (потолок retrieval).',
 'mm':(
'  subgraph SL["① Двунаправленный SL"]\n'
'    direction TB\n'
'    a1["forward: вопрос → черновой SQL → схема"]:::proc\n'
'    a2["backward: схема → релевантные элементы"]:::proc\n'
'    a1 --> a3["объединение ∪"]:::eval\n'
'    a2 --> a3\n'
'  end\n'
'  SL --> BIN\n'
'  subgraph BIN["② Бинарный выбор схемы"]\n'
'    direction TB\n'
'    b1["полная схема (страховка)"]:::proc\n'
'    b2["отобранная (info-gain)"]:::proc\n'
'  end\n'
'  BIN --> gen["③ Генерация SQL<br/>контекст. обогащение"]:::proc\n'
'  gen --> corr["④ Многоходовая коррекция<br/>исполнить → исправить"]:::eval\n'
'  corr --> out["BIRD 67.2%"]:::result\n'
)},
{
 'card_id':'resdsql_2023','ref_id':'resdsql_2023','name':'RESDSQL','group':'RUCKBReasoning','date':'2023 · AAAI',
 'bird':'—','spider':'ranking SL','link':'https://arxiv.org/abs/2302.05965',
 'tldr':'Разведение schema linking и парсинга скелета: ranking-энкодер ранжирует схему, skeleton-декодер строит каркас, затем наполняет.',
 'arch':'Cross-encoder ранжирует таблицы и колонки по релевантности и подаёт декодеру только верхушку. Skeleton-aware декодер сначала строит скелет SQL (SELECT _ FROM _ WHERE _), затем наполняет его ранжированными элементами схемы.',
 'prep':'Spider (собственный корпус не синтезируется). Ранжирование элементов схемы для подачи только top-K.',
 'method':'Ranking-enhanced encoder + skeleton-aware decoder. Декомпозиция снижает сложность каждого компонента.',
 'results':'Сильные показатели на Spider; прямой предшественник CodeS.',
 'findings':'Разделение SL и парсинга скелета — устойчивый приём, унаследованный поздними работами линии RUC.',
 'hound':'Фон линии RUC (2023). Декомпозиция SL родственна нашему parse-подходу; пролинкован к H-det-retrieval.',
 'mm':(
'  q["Вопрос + схема"]:::in --> ENC\n'
'  subgraph ENC["① Ranking-enhanced энкодер"]\n'
'    direction TB\n'
'    e1["cross-encoder: релевантность<br/>таблиц / колонок"]:::proc --> e2["ранжированный список → top-K"]:::eval\n'
'  end\n'
'  ENC --> DEC\n'
'  subgraph DEC["② Skeleton-aware декодер"]\n'
'    direction TB\n'
'    d1["декодировать СКЕЛЕТ<br/>SELECT _ FROM _ WHERE _"]:::proc --> d2["наполнить каркас<br/>ранжир. элементами"]:::proc\n'
'  end\n'
'  DEC --> out["SQL · Spider · предок CodeS"]:::result\n'
)},
{
 'card_id':'dts_sql_2024','ref_id':'dts_sql_2024','name':'DTS-SQL','group':'Pourreza','date':'2024',
 'bird':'closes GPT-4 gap','spider':'','link':'https://arxiv.org/abs/2402.01117',
 'tldr':'Двухэтапная декомпозиция: отдельная модель schema-linking + отдельная модель генерации, обе дообучены на малых открытых LLM.',
 'arch':'Модель schema-linking предсказывает релевантные таблицы/колонки из полной схемы → обрезанная схема. Модель генерации работает ТОЛЬКО на обрезанной схеме, не видя лишних таблиц, что снижает ошибки выбора колонок. Обе модели дообучаются независимо.',
 'prep':'BIRD/Spider; раздельные обучающие сигналы для SL и генерации.',
 'method':'Две независимо дообученные малые LLM в каскаде. Без RL.',
 'results':'Малые открытые модели приближаются к GPT-4.',
 'findings':'Аккуратная декомпозиция важнее размера модели.',
 'hound':'Подтверждает ценность разделения SL — один из аргументов за parse-стадию (H-parse-vs-llm).',
 'mm':(
'  q["Вопрос + вся схема"]:::in --> slm["① Модель schema-linking<br/>дообученная малая LLM<br/>→ обрезанная схема"]:::proc\n'
'  slm --> gm["② Модель генерации SQL<br/>на ОБРЕЗАННОЙ схеме<br/>дообученная малая LLM"]:::proc\n'
'  gm --> out["SQL · малые ≈ GPT-4"]:::result\n'
)},
]

run_batch(CARDS)
