# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
from cards_lib import run_batch

CARDS = [
{
 'card_id':'reasoning_sql_2025','ref_id':'reasoning_sql_2025','name':'Reasoning-SQL','group':'Talaei/Google','date':'Мар 2025',
 'bird':'72.78 (14B)','spider':'81.4','link':'https://arxiv.org/abs/2503.23157',
 'tldr':'GRPO с шестью частичными наградами; логика рассуждения возникает сама при правильной функции вознаграждения.',
 'arch':'Policy-модель сэмплирует группу из G кандидатов на вопрос. Композитная награда складывает шесть компонент (execution, LLM-judge, syntax, schema-link Jaccard, n-gram, format). Групповое преимущество Aᵢ=(rᵢ−mean)/std нормирует ВНУТРИ группы и заменяет value-сеть (отличие от PPO); policy gradient обновляет πθ в цикле.',
 'prep':'8 026 отфильтрованных примеров BIRD train; внешний schema linking (Gemini). Онлайн-сэмплинг в GRPO — без отдельного синтетического корпуса.',
 'method':'GRPO (advantage = (r − mean)/std по группе, без value-сети). Шесть наград: ①②④ — корректность к хранилищу, ③⑥ — грамматика SQL.',
 'results':'72.78% EX на BIRD test (14B), +4% к o3-mini при снижении стоимости на 93%. Spider 81.4%.',
 'findings':'Явная логика рассуждения эмерджентна — достаточно правильной функции награды, формат не навязывают.',
 'hound':'Чистейшая декомпозиция «грамматика (syntax) vs хранилище (schema-link/execution)» в одной функции потерь. Но валидация одного слоя → ядро H-single-layer-eval.',
 'mm':(
'  q["Вопрос + схема (L3)"]:::in --> pol["Policy πθ<br/>Qwen2.5-Coder 3/7/14B"]:::proc\n'
'  pol --> grp["Группа из G выборок<br/>SQL₁..SQL_G (temperature sampling)"]:::proc\n'
'  grp --> R\n'
'  subgraph R["Композитная награда r = Σ wᵢ·rᵢ"]\n'
'    direction TB\n'
'    r1["① execution accuracy"]:::eval\n'
'    r2["② LLM-judge (RLAIF)"]:::eval\n'
'    r3["③ syntax validity"]:::eval\n'
'    r4["④ schema-link (Jaccard)"]:::eval\n'
'    r5["⑤ n-gram vs gold"]:::eval\n'
'    r6["⑥ format compliance"]:::eval\n'
'  end\n'
'  R --> adv["Aᵢ = (rᵢ − mean) / std<br/>групповое преимущество, без value-сети"]:::result\n'
'  adv --> upd["Policy gradient<br/>∇θ J ← Aᵢ · log πθ"]:::rl\n'
'  upd -.-> pol\n'
'  adv --> out["BIRD 72.78% (14B) · −93% стоимости"]:::result\n'
)},
{
 'card_id':'cot_dpo_sql_2025','ref_id':'cot_dpo_sql_2025','name':'CoT-DPO','group':'RUCKBReasoning','date':'Фев 2025',
 'bird':'67.1 (14B)','spider':'','link':'https://arxiv.org/abs/2502.11656',
 'tldr':'CoT — предпосылка для DPO: без рассуждений vanilla DPO деградирует на 6/10 моделей; синтез CoT-трасс это чинит.',
 'arch':'BIRD содержит только финальный SQL без шагов. GPT-4o-mini синтезирует CoT-трассы (Q→шаги→SQL), восполняя дефицит. SFT на CoT, затем DPO на preference-парах: chosen (исполняется верно, execution oracle) против rejected (неверный результат).',
 'prep':'Синтез CoT-трасс через GPT-4o-mini поверх BIRD; execution как oracle для построения preference-пар.',
 'method':'SFT на CoT → DPO (chosen/rejected). Qwen2.5 7/14B.',
 'results':'BIRD dev 67.1% (14B); стабильный прирост +1.6–4.5% на всех 10 моделях.',
 'findings':'Любой preference-метод требует промежуточных рассуждений, если эталон — единственный финальный артефакт.',
 'hound':'Системный вывод про дефицит рассуждений в gold — резонанс с проблемой «gold содержит только ответ». Пролинкован к H-single-layer-eval.',
 'mm':(
'  bird["BIRD train<br/>(Q, gold SQL) — только финал"]:::in --> cot["① Синтез CoT-трасс<br/>GPT-4o-mini: Q → шаги → SQL"]:::synth\n'
'  cot --> sft["② SFT на CoT · Qwen2.5 7/14B"]:::synth\n'
'  sft --> DPO\n'
'  subgraph DPO["③ DPO на preference-парах"]\n'
'    direction TB\n'
'    ch["chosen: исполняется верно (oracle)"]:::eval\n'
'    rj["rejected: неверный результат"]:::warn\n'
'  end\n'
'  DPO --> out["BIRD 67.1% · +1.6–4.5% стабильно"]:::result\n'
'  out -.-> w["⚠ без CoT vanilla DPO деградирует на 6/10 моделей"]:::warn\n'
)},
{
 'card_id':'omnisql_2025','ref_id':'omnisql_2025','name':'OmniSQL','group':'RUCKBReasoning','date':'Мар 2025 · PVLDB',
 'bird':'69.7','spider':'Spider2 13.3','link':'https://arxiv.org/abs/2503.02240',
 'tldr':'SynSQL-2.5M — масштаб синтетики. Но Spider2.0 13.3% обнажает: объём не закрывает enterprise-разрыв.',
 'arch':'Автоконвейер синтеза из четырёх стадий: синтез БД (web-таблицы → реальные БД с значениями), генерация SQL с учётом сложности (simple→nested), стилизованные вопросы (9 стилей + back-translation), CoT-решение для каждой пары. Свод в SynSQL-2.5M → SFT.',
 'prep':'Автоконвейер SynSQL-2.5M: сбор БД, генерация вопросов с учётом сложности, девять стилей, back-translation SQL→NL, CoT-аннотации.',
 'method':'SFT на 2.5M пар. Qwen2.5-Coder 7/14/32B. Single greedy.',
 'results':'BIRD dev 69.7% (32B). Spider2.0-SQLite 13.3% — enterprise-разрыв.',
 'findings':'Масштаб синтетики не компенсирует семантическую дистанцию до enterprise-домена.',
 'hound':'Прямое эмпирическое доказательство enterprise-gap → мотивирует наш L6-lineage подход. Anchor для H-domain-collapse, контр-точка к EvolSQL.',
 'mm':(
'  subgraph SYN["Конвейер синтеза SynSQL-2.5M (4 стадии)"]\n'
'    direction LR\n'
'    s1["① Синтез БД<br/>web → реальные БД + значения"]:::synth --> s2["② SQL по сложности<br/>simple → nested"]:::synth --> s3["③ 9 стилей вопросов<br/>+ back-translation"]:::synth --> s4["④ CoT-решение"]:::synth\n'
'  end\n'
'  SYN --> data["SynSQL-2.5M"]:::synth\n'
'  data --> sft["SFT Qwen2.5-Coder 7/14/32B"]:::synth\n'
'  sft --> out["BIRD 69.7% (32B)"]:::result\n'
'  sft -.-> warn["⚠ Spider2.0 13.3% — масштаб не закрыл enterprise-разрыв"]:::warn\n'
)},
{
 'card_id':'sql_o1_2025','ref_id':'sql_o1_2025','name':'SQL-o1','group':'Независимые','date':'Фев 2025',
 'bird':'66.8 (7B)','spider':'','link':'https://arxiv.org/abs/2502.11741',
 'tldr':'o1-стиль поиска по дереву мыслей с самонаградой и исполнением как oracle на каждом шаге.',
 'arch':'Self-Reward Heuristic Dynamic Search строит дерево частичных SQL-состояний. На каждом узле модель сама оценивает шаг (process self-reward), а schema-aware исполнение служит oracle и обрезает тупики. Динамический best-first поиск ведёт к финалу.',
 'prep':'BIRD; CoT-трассы o1-стиля (нет отдельного релиза). SFT + RL warm-start.',
 'method':'Эвристический динамический поиск с процессной самонаградой; исполнение как oracle. Qwen2.5-7B.',
 'results':'BIRD 66.8% — превышает GPT-4 на 7B-базе.',
 'findings':'Поисковый инференс с верификацией компенсирует размер.',
 'hound':'Execution-as-oracle на каждом шаге — но шаги внутри одного запроса, не по слоям lineage. H-single-layer-eval.',
 'mm':(
'  q["Вопрос"]:::in --> tree\n'
'  subgraph tree["Дерево частичных SQL-состояний"]\n'
'    direction TB\n'
'    n1["SELECT"]:::proc --> n2["+FROM / +JOIN"]:::proc --> n3["+WHERE"]:::proc --> n4["FINAL"]:::eval\n'
'  end\n'
'  tree --> sr["Process self-reward<br/>модель оценивает шаг"]:::proc\n'
'  tree --> ex["Schema-aware execution<br/>oracle, обрезка тупиков"]:::eval\n'
'  sr --> out["BIRD 66.8% · 7B > GPT-4"]:::result\n'
'  ex --> out\n'
)},
{
 'card_id':'alpha_sql_2025','ref_id':'alpha_sql_2025','name':'Alpha-SQL','group':'HKUST-Dial','date':'Фев 2025',
 'bird':'MCTS','spider':'','link':'https://arxiv.org/abs/2502.17248',
 'tldr':'MCTS в пространстве построения SQL с исполнением как наградой; zero-shot, training-free.',
 'arch':'Монте-Карло поиск по дереву построения SQL, итерация из четырёх фаз: Selection (UCT), Expansion (LLM предлагает следующее действие), Simulation/eval (исполнение + self-consistency = reward, без обучения), Backpropagation (обновление ценностей вверх). Наиболее посещаемый путь → финальный SQL.',
 'prep':'BIRD/Spider напрямую; training-free — данные для дообучения не нужны.',
 'method':'MCTS (UCT) по дереву построения SQL; исполнение — награда. Плагин к открытым моделям.',
 'results':'Конкурентно без дообучения за счёт поиска.',
 'findings':'Поиск с execution-наградой заменяет RL-дообучение.',
 'hound':'MCTS-машинерия концептуально близка обходу графа — но дерево SQL, не lineage. Контраст с нашим multihop по lineage-DAG.',
 'mm':(
'  q["Вопрос"]:::in --> MCTS\n'
'  subgraph MCTS["Итерация MCTS (× N) · training-free"]\n'
'    direction LR\n'
'    p1["① Selection (UCT)"]:::proc --> p2["② Expansion<br/>LLM: следующее действие"]:::proc --> p3["③ Simulation<br/>исполнение + self-consistency = reward"]:::eval --> p4["④ Backpropagation"]:::proc\n'
'    p4 -.-> p1\n'
'  end\n'
'  MCTS --> best["Best path → SQL"]:::result\n'
)},
{
 'card_id':'kasla_2025','ref_id':'kasla_2025','name':'KaSLA','group':'Независимые','date':'Фев 2025',
 'bird':'Recall+/Precision+','spider':'','link':'https://arxiv.org/abs/2502.12911',
 'tldr':'Schema linking как 0-1 knapsack: максимизировать релевантность при бюджете токенов.',
 'arch':'Каждый элемент схемы имеет value (релевантность) и weight (стоимость токенов). Иерархический 0-1 knapsack: сначала DP по таблицам (max Σvalue при Σweight ≤ B), затем по колонкам в пределах выбранных таблиц; дедупликация и штраф за пропуск. Метрики Recall+/Precision+.',
 'prep':'BIRD/Spider; элементы схемы с весами релевантности и стоимостью токенов.',
 'method':'Иерархический 0-1 knapsack DP под бюджетом контекста. GPT-4o.',
 'results':'Улучшает покрытие схемы при фиксированном бюджете токенов.',
 'findings':'Первая формализация schema linking как оптимизации с явным бюджетом контекста.',
 'hound':'Бюджет токенов → можно ограничить чувствительные элементы схемы. Прямой резонанс с нашей schema-privacy линией; anchor для H-gold-asymmetry.',
 'mm':(
'  elems["Элементы схемы<br/>value=релевантность · weight=токены"]:::in --> KS\n'
'  subgraph KS["Иерархический 0-1 knapsack"]\n'
'    direction TB\n'
'    k1["уровень 1: knapsack ТАБЛИЦ<br/>max Σvalue, Σweight ≤ B"]:::proc --> k2["уровень 2: knapsack КОЛОНОК<br/>в выбранных таблицах"]:::proc\n'
'  end\n'
'  KS --> sch["Бюджетная схема<br/>Recall+ / Precision+ · дедуп + штраф пропуска"]:::eval\n'
'  sch --> out["→ генерация SQL (GPT-4o)"]:::result\n'
)},
{
 'card_id':'think2sql_2025','ref_id':'think2sql_2025','name':'Think2SQL','group':'Polito/EURECOM','date':'Апр 2025',
 'bird':'60.2 (14B)','spider':'82.6','link':'https://arxiv.org/abs/2504.15077',
 'tldr':'SFT→RLVR с плотными наградами QATCH (Cell P/R, Tuple Cardinality); плотный сигнал компенсирует размер.',
 'arch':'Три слоя: SFT на трассах DeepSeek-R1 (привить рассуждение), RLVR через GRPO с верифицируемыми наградами, затем плотные cell-level награды QATCH (Cell Precision, Cell Recall, Tuple Cardinality, Tuple Constraint) — градиент даже при частично верном SQL, в отличие от бинарного EX.',
 'prep':'SFT на трассах DeepSeek-R1 (BIRD+Spider); QATCH требует реальной БД с данными для cell-level наград.',
 'method':'SFT → RLVR (GRPO) → плотные QATCH-награды. Qwen2.5-Coder 3/7/14B.',
 'results':'14B: 60.2% weighted на BIRD, Spider 82.6%; превышает GPT-4o (54.1%) и модели в 5–45× крупнее.',
 'findings':'Плотные функционально-специфичные награды компенсируют порядки величины в параметрах.',
 'hound':'QATCH cell-level метрика интереснее голого EX — ближе к нашим partial-credit метрикам пути. H-path-metric.',
 'mm':(
'  l1["① SFT<br/>трассы DeepSeek-R1 (BIRD+Spider)"]:::synth --> l2["② RLVR (GRPO)<br/>verifiable rewards"]:::rl\n'
'  l2 --> L3\n'
'  subgraph L3["③ Плотные награды QATCH (cell-level)"]\n'
'    direction TB\n'
'    qa["Cell Precision"]:::eval\n'
'    qb["Cell Recall"]:::eval\n'
'    qc["Tuple Cardinality"]:::eval\n'
'    qd["Tuple Constraint"]:::eval\n'
'  end\n'
'  L3 --> out["BIRD 60.2% (14B) > GPT-4o (54.1)"]:::result\n'
)},
{
 'card_id':'ellie_sql_2025','ref_id':'ellie_sql_2025','name':'EllieSQL','group':'HKUST-Dial','date':'Мар 2025 · COLM',
 'bird':'cost-routing','spider':'','link':'https://arxiv.org/abs/2503.22402',
 'tldr':'Экономичная маршрутизация по сложности: лёгкие вопросы — дешёвым конвейером, сложные — большой моделью.',
 'arch':'Лёгкий классификатор оценивает сложность вопроса и направляет его в один из трёх уровней (Basic — малая модель/$, Intermediate — $$, Advanced — большая/полный конвейер/$$$). Метрика Token Elasticity of Performance оценивает прирост качества на потраченный токен. Публичная HuggingFace checkpoint.',
 'prep':'BIRD/Spider; метки сложности вопроса для обучения роутера.',
 'method':'Лёгкий классификатор → basic/intermediate/advanced конвейер. Метрика TEP.',
 'results':'Снижает стоимость при сохранении точности; единственная работа обзора с публичным чекпойнтом.',
 'findings':'Не каждый вопрос требует дорогой модели — маршрутизация амортизирует стоимость.',
 'hound':'Прямой источник H-router и H-amortize (амортизированная стоимость на запрос).',
 'mm':(
'  q["Вопрос"]:::in --> r["Router сложности<br/>лёгкий классификатор"]:::proc\n'
'  r --> b1["Basic · малая модель · $"]:::eval\n'
'  r --> b2["Intermediate · $$"]:::eval\n'
'  r --> b3["Advanced · большая · $$$"]:::eval\n'
'  b1 --> out["SQL"]:::result\n'
'  b2 --> out\n'
'  b3 --> out\n'
'  r -.-> tep["Token Elasticity of Performance<br/>★ публичный HF-checkpoint"]:::synth\n'
)},
{
 'card_id':'e_sql_2024','ref_id':'e_sql_2024','name':'E-SQL','group':'Независимые','date':'2024',
 'bird':'question enrichment','spider':'','link':'https://arxiv.org/abs/2409.16751',
 'tldr':'Обогащение вопроса вместо отсечения схемы: вопрос дополняется ссылками на схему, значения, кандидатные предикаты.',
 'arch':'Вместо pruning вопрос обогащается кандидатными таблицами/колонками, значениями (привязка термина к ячейке БД) и кандидатными предикатами (вероятные WHERE-условия). Обогащённый вопрос подаётся с ПОЛНОЙ схемой на прямую генерацию — схему не режут, recall не теряется.',
 'prep':'BIRD; обогащение вопроса схемными и значенческими ссылками вместо pruning.',
 'method':'Прямое связывание схемы через enrichment; кандидатные предикаты. GPT-4o.',
 'results':'Конкурентно на BIRD.',
 'findings':'Обогащение контекста (а не урезание) — альтернативная стратегия SL, противоположная CHESS/KaSLA.',
 'hound':'Enrichment-подход родственен добавлению lineage-контекста (L6). Пролинкован к H-det-retrieval.',
 'mm':(
'  q["Исходный вопрос"]:::in --> ENR\n'
'  subgraph ENR["Обогащение вопроса (enrichment)"]\n'
'    direction TB\n'
'    x1["+ кандидатные таблицы / колонки"]:::proc\n'
'    x2["+ кандидатные значения (из БД)"]:::proc\n'
'    x3["+ кандидатные предикаты (WHERE)"]:::proc\n'
'  end\n'
'  ENR --> gen["Прямой SL + генерация<br/>обогащённый вопрос + ПОЛНАЯ схема<br/>recall не теряется"]:::proc\n'
'  gen --> out["SQL · BIRD · enrichment > pruning"]:::result\n'
)},
{
 'card_id':'death_schema_linking_2024','ref_id':'death_schema_linking_2024','name':'The Death of Schema Linking?','group':'Maamari и др.','date':'2024',
 'bird':'long-context','spider':'','link':'https://arxiv.org/abs/2408.07702',
 'tldr':'С сильными long-context моделями явный schema linking может быть избыточен и вреден (теряет recall).',
 'arch':'Сравнение двух путей. Путь A (традиционный SL): отсечь схему → потеря нужной колонки → необратимая ошибка. Путь B (предлагаемый): полная схема в long-context → SL не нужен, recall сохранён. Тезис: при достаточном контексте явный SL вреден.',
 'prep':'BIRD/Spider; подача полной схемы как альтернатива отобранной.',
 'method':'Промптинг long-context модели полной схемой; сравнение с явным SL.',
 'results':'Показывает, что SL может вредить при достаточном контексте.',
 'findings':'Ключевая работа дебата parse/retrieve vs long-context.',
 'hound':'Прямо мотивирует H-rag-ceiling (потолок retrieval) и H-det-retrieval (parse обходит retrieval).',
 'mm':(
'  q["Вопрос + БД"]:::in --> A["Путь A: SL → prune"]:::warn\n'
'  q --> B["Путь B: полная схема в long-context"]:::eval\n'
'  A --> af["потеря нужной колонки → необратимо ✗"]:::warn\n'
'  B --> bf["SL не нужен → recall сохранён"]:::eval\n'
'  af --> out["SQL"]:::result\n'
'  bf --> out\n'
'  out -.-> th["Тезис: с сильным long-context SL избыточен и вреден"]:::synth\n'
)},
]

run_batch(CARDS)
