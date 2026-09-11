# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
from cards_lib import run_batch

CARDS = [
{
 'card_id':'reex_sql_2025','ref_id':'reex_sql_2025','name':'ReEx-SQL','group':'Независимые','date':'Май 2025',
 'bird':'64.9','spider':'88.8','link':'https://arxiv.org/abs/2505.12768',
 'tldr':'Исполнение внутри декодинга: модель пишет промежуточный SQL, исполняет, видит результат, корректирует.',
 'arch':'Теговая структура think/intermediate_sql/result/final_sql: модель рассуждает, генерирует пробный SQL, СУБД исполняет его, модель видит реальный результат и корректирует план. GRPO обучается на пошаговых роллаутах с обратной связью БД; древовидное декодирование исследует ветки параллельно, обрезая нежизнеспособные (−51.9% времени).',
 'prep':'BIRD/Spider; GRPO на пошаговых роллаутах с обратной связью СУБД (нет отдельного корпуса).',
 'method':'Теговая структура think/intermediate_sql/result/final_sql; GRPO; древовидное декодирование. Qwen2.5-Coder-7B.',
 'results':'BIRD 64.9%, Spider 88.8%; −51.9% времени инференса.',
 'findings':'SQL-система должна «видеть» БД во время рассуждения, а не только при оценке.',
 'hound':'Execution-in-loop — но в пределах одного запроса; не прослеживает источник через слои. H-single-layer-eval.',
 'mm':(
'  q["Вопрос + схема"]:::in --> think["&lt;think&gt; разбор вопроса"]:::proc\n'
'  think --> isql["&lt;intermediate_sql&gt; пробный запрос"]:::proc\n'
'  isql --> db["СУБД исполняет"]:::eval\n'
'  db --> res["&lt;result&gt; модель видит данные"]:::eval\n'
'  res -.-> think\n'
'  res --> fsql["&lt;final_sql&gt; с учётом feedback"]:::result\n'
'  fsql --> tree["Древовидный декодинг<br/>ветки параллельно, обрезка · −51.9%"]:::proc\n'
'  tree --> out["BIRD 64.9% · Spider 88.8%"]:::result\n'
'  grpo["GRPO на пошаговых роллаутах с feedback СУБД"]:::rl -.-> isql\n'
)},
{
 'card_id':'unjoin_2025','ref_id':'unjoin_2025','name':'UNJOIN','group':'Dan Roth / UPenn','date':'Май 2025',
 'bird':'50.4 EM','spider':'76.1 EM','link':'https://arxiv.org/abs/2505.18122',
 'tldr':'Упрощение вместо обогащения: уплощить схему в одну таблицу, сгенерировать, перевести обратно в JOIN/UNION.',
 'arch':'Колонки мультитабличной схемы сливаются в единую виртуальную таблицу с префиксами имён (orders_id, customers_name). SQL генерируется на плоской схеме без JOIN-рассуждения. Затем детерминированный обратный перевод восстанавливает JOIN/UNION по карте префиксов.',
 'prep':'Spider/BIRD; уплощение колонок мультитаблицы в единую абстракцию с префиксами.',
 'method':'Двухэтапно: генерация на плоской схеме → реконструкция JOIN/UNION. Частичный AST-разбор для сборки. GPT-4o.',
 'results':'Spider 76.13% EM, BIRD 50.36% EM; +14.9–19.6% с ретривером в open-book.',
 'findings':'Упрощение схемы — ортогональный ответ на её сложность (vs отбор/сжатие).',
 'hound':'Единственный пример частичного AST-разбора; уплощение убирает структуру слоёв — противоположно нашему lineage-обогащению.',
 'mm':(
'  mt["Мультитабличная схема<br/>orders, customers, FK"]:::in --> flat["① Уплощение<br/>единая таблица, префиксы<br/>orders_id, customers_name"]:::proc\n'
'  flat --> gen["② Генерация на flat<br/>SQL без JOIN-рассуждения"]:::proc\n'
'  gen --> rec["③ Обратный перевод<br/>префиксы → таблицы, восстановить JOIN/UNION"]:::eval\n'
'  rec --> out["Spider 76.1 EM · BIRD 50.4 EM"]:::result\n'
)},
{
 'card_id':'text2sql_flow_2025','ref_id':'text2sql_flow_2025','name':'Text2SQL-Flow','group':'Независимые','date':'Ноя 2025',
 'bird':'56.8','spider':'83.4','link':'https://arxiv.org/abs/2511.10192',
 'tldr':'Управляемая аугментация SQLFlow 75K: 6 измерений трансформации + перцентильный отбор БД. Качество > объём.',
 'arch':'Шесть измерений аугментации запросов (SQL-эквивалент, сложность, стиль NL, evidence, пертурбация схемы, вариация значений) + распределение БД по перцентилям сложности для сбалансированного покрытия. Верификация исполнением → SQLFlow 75K → SFT.',
 'prep':'Шесть измерений трансформации + перцентильный отбор БД; верификация исполнением. SQLFlow 75K.',
 'method':'SFT на аугментированных данных. Qwen2.5-Coder-7B + GPT-4o.',
 'results':'BIRD 56.8%, Spider 83.4% (7B); превосходит SynSQL того же масштаба.',
 'findings':'Управляемое разнообразие важнее сырого объёма синтетики.',
 'hound':'Подтверждает «качество > масштаб» — параллель EvolSQL. Anchor для H-domain-collapse.',
 'mm':(
'  seed["seed (Q, SQL)"]:::in --> AUG\n'
'  subgraph AUG["6 измерений аугментации"]\n'
'    direction TB\n'
'    d1["SQL-эквивалент"]:::proc\n'
'    d2["сложность запроса"]:::proc\n'
'    d3["стиль NL (11)"]:::proc\n'
'    d4["evidence-аугментация"]:::proc\n'
'    d5["пертурбация схемы"]:::proc\n'
'    d6["вариация значений"]:::proc\n'
'  end\n'
'  AUG --> pct["перцентильный отбор БД по сложности схемы"]:::proc\n'
'  pct --> ver["Execution verify → SQLFlow 75K"]:::eval\n'
'  ver --> sft["SFT Qwen2.5-Coder-7B"]:::synth\n'
'  sft --> out["BIRD 56.8 · Spider 83.4"]:::result\n'
)},
{
 'card_id':'judgesql_2025','ref_id':'judgesql_2025','name':'JudgeSQL','group':'Bai/Pan/Tao','date':'Окт 2025',
 'bird':'71.9 (32B gen)','spider':'','link':'https://arxiv.org/abs/2510.15560',
 'tldr':'Модель-судья + Weighted Consensus Tournament: группировка по результату исполнения → 18× меньше суждений.',
 'arch':'Кандидаты исполняются, группируются по result-set (Rᵢ как «хэш» эквивалентности). Представители групп играют двойной круговой турнир; judge-модель (GPT-4o distill + GRPO) оценивает, голоса взвешиваются размером группы (Sᵂₖ=|Cₖ|·Sₖ). Round-robin только между G группами → O(G²) вместо O(N²).',
 'prep':'BIRD; judge-трассы GPT-4o → дистилляция + GRPO (нет отдельного корпуса кандидатов).',
 'method':'Группировка по исполнению + WCT-турнир представителей, взвешивание по размеру группы.',
 'results':'XiYanSQL-32B: BIRD 71.90% (+7.95% над greedy); при N=64 — 48.6 vs 876.4 суждений.',
 'findings':'Результат исполнения как хэш группировки → O(G²) вместо O(N²).',
 'hound':'Execution-grouping — элегантный отбор, но всё ещё result-set одного слоя. Развитие CHASE-SQL-селектора. H-single-layer-eval.',
 'mm':(
'  cand["N кандидатов SQL₁..ₙ (N=8..64)"]:::in --> exe["Исполнение SQLᵢ → result-set Rᵢ"]:::eval\n'
'  exe --> grp\n'
'  subgraph grp["Группировка по Rᵢ (≪ N групп)"]\n'
'    direction TB\n'
'    c1["C₁ |12| proxy₁"]:::result\n'
'    c2["C₂ |4| proxy₂"]:::eval\n'
'    c3["… G групп"]:::proc\n'
'  end\n'
'  grp --> wct["RJudge (GPT-4o distill + GRPO)<br/>двойной round-robin представителей<br/>Sᵂₖ = |Cₖ| · Sₖ"]:::rl\n'
'  wct --> out["Победитель · BIRD 71.90% (32B)<br/>48.6 vs 876.4 суждений · O(G²)"]:::result\n'
)},
{
 'card_id':'evolsql_2025','ref_id':'evolsql_2025','name':'EvolSQL','group':'Bai/Pan/Tao','date':'Янв 2026',
 'bird':'65.1 (7B)','spider':'86.1','link':'https://arxiv.org/abs/2601.04875',
 'tldr':'6 AST-операторов эволюции SQL: 140K структурно-управляемых примеров бьют OmniSQL 2.5M. Структура > масштаб.',
 'arch':'Трёхэтапно: EQE расширяет семантическое разнообразие seed-SQL с execution-grounded refinement; OGE эволюционирует по AST шестью атомарными операторами (functional wrapping, operator mutation, logical clause/relational expansion, nesting, set composition) с адаптивной стратегией валидность↔разнообразие; CoT-синтез teacher-моделью Qwen3-Coder-30B + execution-verify + dedup → 140K.',
 'prep':'EQE-расширение разнообразия → OGE (6 атомарных AST-операторов) → CoT-синтез с teacher Qwen3-Coder-30B + execution-верификация. 140K пар.',
 'method':'SFT на 140K. Шесть операторов — трансформации по структурным границам синтаксического дерева, не текстовые перефразы.',
 'results':'BIRD 65.1% (7B) > OmniSQL 63.9% при 1/18 объёма данных. Spider 86.1%.',
 'findings':'Структурный контроль над синтезом важнее объёма; AST-граница — правильная единица декомпозиции SQL.',
 'hound':'Прямое подтверждение H-ast-chunk. Но AST разбирается для синтеза, не для lineage — иллюстрация H-single-layer-eval (разбор не идёт к истоку).',
 'mm':(
'  seed["Seed SQL (Spider+BIRD)"]:::in --> EQE\n'
'  subgraph EQE["① EQE — Exploratory Query Expansion"]\n'
'    direction TB\n'
'    e1["LLM расширяет семантич.<br/>разнообразие + покрытие"]:::proc --> e2["execution-grounded refinement"]:::eval\n'
'  end\n'
'  EQE --> OGE\n'
'  subgraph OGE["② OGE — эволюция по AST, 6 операторов"]\n'
'    direction TB\n'
'    o1["1· Functional Wrapping"]:::synth\n'
'    o2["2· Operator Mutation"]:::synth\n'
'    o3["3· Logical Clause Expansion"]:::synth\n'
'    o4["4· Relational Expansion"]:::synth\n'
'    o5["5· Nesting Evolution"]:::synth\n'
'    o6["6· Set Composition"]:::synth\n'
'  end\n'
'  OGE --> COT\n'
'  subgraph COT["③ CoT-синтез"]\n'
'    direction TB\n'
'    c1["teacher Qwen3-Coder-30B"]:::proc --> c2["execution-verify + dedup"]:::eval\n'
'  end\n'
'  COT --> out["140K → SFT 7B<br/>BIRD 65.1% &gt; OmniSQL 63.9% при 1/18 данных"]:::result\n'
)},
{
 'card_id':'diver_2026','ref_id':'diver_2026','name':'DIVER','group':'BUPT + Цинхуа','date':'Фев 2026 · SIGMOD',
 'bird':'+10.82 EX','spider':'+16.09 VES','link':'https://arxiv.org/abs/2602.12064',
 'tldr':'Автоматизация expert-evidence: без подсказок BIRD EX падает >10%; DIVER строит evidence сам через зондирование БД.',
 'arch':'Итеративный цикл CoTF (Chain of Thoughts and Facts): набор инструментов зондирует базу (sample значений, value matcher, explore схемы, проверка формул), структурированное рабочее пространство рефлексирует на результат, накапливает факты и выбирает следующий инструмент. Восстанавливает schema/value linking и выводит функции/формулы — то, что обычно пишет эксперт.',
 'prep':'BIRD; динамическое интерактивное связывание значений зондированием базы — восстанавливает evidence.',
 'method':'Toolbox зондирования + структурированное пространство CoTF; итеративный выбор инструмента.',
 'results':'+10.82% EX, +16.09% VES на BIRD; снимает >10% провал без экспертных подсказок.',
 'findings':'Зависимость от expert-evidence — скрытый костыль SOTA; её можно автоматизировать.',
 'hound':'Прямо бьёт в наш L4 hint-слой. Anchor для H-data-profiling, H-gold-asymmetry, H-domain-collapse.',
 'mm':(
'  q["Вопрос (без evidence)"]:::in --> CoTF\n'
'  subgraph CoTF["Итеративный цикл CoTF"]\n'
'    direction LR\n'
'    tb["Toolbox зондирования БД<br/>sample значений · value matcher<br/>explore схемы · проверка формул"]:::proc --> ws["CoTF workspace<br/>рефлексия → факты → выбор инструмента"]:::proc\n'
'    ws -.-> tb\n'
'  end\n'
'  CoTF --> ev["Восстановленный evidence<br/>+ schema/value linking → функции/формулы"]:::eval\n'
'  ev --> out["+10.82 EX · +16.09 VES<br/>снимает &gt;10% провал без подсказок"]:::result\n'
)},
{
 'card_id':'slice_lineage','ref_id':'slice_lineage','name':'SLiCE','group':'Microsoft · lineage','date':'2024 · корпуса нет',
 'bird':'partial-credit {C,T,F,A}','spider':'','link':'https://arxiv.org/abs/2508.07179',
 'tldr':'Не text-to-SQL генератор, а аннотатор линии происхождения; опорный пример AST→target tables. Публичного корпуса нет.',
 'arch':'Из артефактов transformation-pipeline AST-разбор извлекает на каждый целевой столбец четырёхкортеж {Column, Table, Function, Aggregation} — какие источники и преобразования его порождают. Оценка partial-credit метрикой (Multi-AST). Single-hop: доходит до непосредственно названных таблиц; истинный исток через N ETL-слоёв (staging→raw) вне охвата.',
 'prep':'Ручная аннотация линии из артефактов transformation-pipeline. Данные внутренние Microsoft — публично не выкладывались (корпуса нет).',
 'method':'Извлечение 4-кортежа {C,T,F,A}; partial-credit метрика (Multi-AST).',
 'results':'Формат и метрика scoring линии, не EX-число.',
 'findings':'AST→target tables — но single-hop; read-side (откуда взялись источники) вне охвата.',
 'hound':'Идейный источник наших metric:path_match и metric:lineage_path. Его single-hop ограничение — прямое обоснование H-single-layer-eval и нашего multihop-обхода.',
 'mm':(
'  art["Артефакты pipeline<br/>SQL-скрипты, ETL"]:::in --> ast["AST-разбор<br/>синтаксическое дерево"]:::proc\n'
'  ast --> TUP\n'
'  subgraph TUP["4-кортеж на целевой столбец"]\n'
'    direction TB\n'
'    cc["C — Column (исходная колонка)"]:::result\n'
'    tt["T — Table (исходная таблица)"]:::result\n'
'    ff["F — Function (преобразование)"]:::result\n'
'    aa["A — Aggregation (агрегат)"]:::result\n'
'  end\n'
'  TUP --> tgt["target tables/cols<br/>+ partial-credit (Multi-AST)"]:::eval\n'
'  tgt --> lim["single-hop: mart → src1 ✓<br/>истинный исток (N хопов: stg → raw) — вне охвата"]:::warn\n'
)},
{
 'card_id':'cracksql_2025','ref_id':'cracksql_2025','name':'CrackSQL','group':'диалект · фон','date':'2025 · SIGMOD',
 'bird':'грамматический разрез','spider':'','link':'https://dl.acm.org/doi/10.1145/3725278',
 'tldr':'Перевод SQL между диалектами через AST: чистая грамматическая корректность под целевой движок, независимо от семантики схемы.',
 'arch':'SQL диалекта A разбирается в AST/processing-tree; диалект-специфичные узлы (функции, операторы, типы) помечаются. Local-to-global перевод: сначала локально переводятся несовместимые под-деревья (гибрид LLM + правила), затем дерево собирается и проверяется на функциональную эквивалентность → SQL диалекта B.',
 'prep':'Пары запросов в разных диалектах; разбор в AST для функциональной эквивалентности (собственный обучающий корпус не синтезируется).',
 'method':'AST → processing-tree → local-to-global перевод гибридом LLM и правил. MySQL/Oracle/PostgreSQL.',
 'results':'Функциональный перевод между диалектами.',
 'findings':'Грамматика/диалект — отдельная ось, ортогональная семантике схемы.',
 'hound':'Чистый «грамматический разрез» обучения; методика-донор для нашего Пути B (MySQL→Oracle). Пролинкован к H-single-layer-eval (грамматическая ось).',
 'mm':(
'  a["SQL диалект A (MySQL)"]:::in --> ast["AST / processing-tree<br/>диалект-специфичные узлы: FUNC, TYPE"]:::proc\n'
'  ast --> L2G\n'
'  subgraph L2G["Local-to-global перевод"]\n'
'    direction TB\n'
'    l1["local: перевести несовместимые<br/>под-деревья · LLM + правила"]:::proc --> l2["global: собрать дерево,<br/>проверить эквивалентность"]:::eval\n'
'  end\n'
'  L2G --> b["SQL диалект B (Oracle/PostgreSQL)"]:::result\n'
'  b -.-> ax["ось «грамматика»: корректность под движок<br/>независимо от семантики · донор Пути B"]:::synth\n'
)},
]

run_batch(CARDS)
