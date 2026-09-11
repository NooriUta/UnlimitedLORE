import requests, json, sys
sys.stdout.reconfigure(encoding='utf-8')

# Подключение из окружения — см. cards_lib.py. В оригинале адрес и пароль root
# были зашиты в исходник; здесь значений в коде нет.
import os
BASE = os.environ.get('ARCADE_URL', 'http://localhost:2480')
_PW = os.environ.get('ARCADE_PASSWORD')
if not _PW:
    sys.exit('BLOCKED: не задан ARCADE_PASSWORD. Пароль берётся только из окружения.')
AUTH = (os.environ.get('ARCADE_USER', 'root'), _PW)
DB = os.environ.get('ARCADE_DB', 'RAGVSDL')

def cmd(sql, params=None):
    body = {'language': 'sql', 'command': sql}
    if params:
        body['params'] = params
    r = requests.post(f'{BASE}/api/v1/command/{DB}', auth=AUTH, json=body)
    return r.json()

# --- Данные для патча ---

PATCHES = {
    'fsfm_2026': {
        'title_short': 'FSFM: Selective Forgetting for LLM Agents',
        'description_en': (
            'Neuro-inspired framework for selective memory forgetting in LLM agents. '
            'Taxonomy of forgetting mechanisms: passive decay (Ebbinghaus curve), '
            'active deletion (right-to-be-forgotten), safety-triggered, and adaptive reinforcement (synaptic plasticity). '
            'Three evaluation axes: efficiency (+30% storage), content quality (SNR +29.2%), '
            'security (100% elimination of dangerous content, 70%+ high-value retention). '
            'Validated on 3.36M China Mobile Lingxi records. '
            'Conceptual donor for decay-function V5 in topic:dkg_temporal.'
        ),
        'description_ru_sci': (
            'Нейровдохновлённый фреймворк селективного забывания памяти агентов LLM. '
            'Таксономия механизмов: пассивный распад по кривой Эббингауза; '
            'активное удаление (right-to-be-forgotten); безопасностно-тригерное; '
            'адаптивное подкрепление (синаптическая пластичность). '
            'Три оси оценки: эффективность памяти (+30% экономии ёмкости), '
            'качество контента (SNR +29.2%), безопасность (100% устранение опасного контента, '
            'сохранение >70% ценного бизнес-контента). '
            'Валидировано на 3.36M записей China Mobile Lingxi. '
            'Концептуальный донор функции decay V5 (вектор dkg_temporal).'
        ),
    },
    'stale_2026': {
        'title_short': 'STALE: Memory Validity Benchmark for LLM Agents',
        'description_en': (
            'Benchmark for evaluating implicit conflict resolution in LLM long-term memory. '
            '400 expert-validated conflict scenarios (1200 queries) across 100+ everyday topics, '
            'contexts up to 150K tokens. '
            'Conflict taxonomy: Type I (co-referential, same attribute updated) '
            'and Type II (propagated, cascade across dependent attributes). '
            'Three probing dimensions: State Resolution, Premise Resistance, Implicit Policy Adaptation. '
            'Best model (Gemini-3.1-pro) achieves only 55.2% overall. '
            'CUPMEM prototype with write-side adjudication reaches 68.0%. '
            'Directly operationalises gold-staleness failure mode for oracle systems.'
        ),
        'description_ru_sci': (
            'Бенчмарк STALE для оценки способности агентов LLM обнаруживать устаревшие воспоминания '
            'в условиях неявного конфликта состояний. '
            'Таксономия конфликтов: Type I (со-референциальный — прямое изменение атрибута) '
            'и Type II (пропагированный — каскадная инвалидация через цепочку зависимостей). '
            'Три оси зондирования: State Resolution (явная проверка), '
            'Premise Resistance (устойчивость к устаревшим предпосылкам), '
            'Implicit Policy Adaptation (применение обновлённого состояния). '
            'Лучший результат 55.2% (Gemini-3.1-pro) указывает на открытую проблему. '
            'CUPMEM с write-side adjudication достигает 68.0%. '
            'Прямое операционализирование gold-staleness как failure-mode в системах с оракулом.'
        ),
    },
    'knowledge_conflicts_2026': {
        'title_short': 'Knowledge Conflicts from Evolving APIs (Code Gen)',
        'description_en': (
            'Systematic empirical study of context-memory conflict when LLMs generate code '
            'under API evolution post-training. '
            'Benchmark: 270 real-world API updates (deprecation / modification / addition) '
            'from 8 Python libraries (NumPy, Pandas, SciPy, etc.), all post Dec-2023 cutoff. '
            'Without documentation: adoption 74.64%, executable rate 42.55%. '
            'With documentation: adoption 92.87%, executable 66.36%. '
            'Self-Reflection prompting adds +11.33% executable rate. '
            'Key finding: LLMs continue using stale API patterns even when updated specs are provided '
            'in context — empirical evidence for oracle-staleness as a systemic failure.'
        ),
        'description_ru_sci': (
            'Первое систематическое эмпирическое исследование конфликта parametric vs contextual knowledge '
            'при генерации кода в условиях эволюции API после обрезки обучающих данных. '
            'Бенчмарк: 270 обновлений API из 8 библиотек Python (после Dec-2023). '
            'Без документации: adoption rate 74.64%, executable rate 42.55%. '
            'С документацией: adoption 92.87%, executable 66.36%. '
            'Self-Reflection: +11.33% к executable rate. '
            'Ключевой результат: LLM продолжают воспроизводить устаревшие паттерны API '
            'даже при наличии актуальной спецификации в контексте — '
            'эмпирическое доказательство oracle-staleness как системной проблемы в RAG-пайплайнах.'
        ),
    },
}

# --- Получить RID topic:dkg_temporal ---
r = cmd("SELECT @rid FROM ExpTopic WHERE topic_id = 'topic:dkg_temporal'")
dkg_temporal_rid = r['result'][0]['@rid']
print(f"topic:dkg_temporal RID: {dkg_temporal_rid}")

# --- Патч карточек и создание рёбер ---
for ref_id, patch in PATCHES.items():
    # Обновить поля
    r_upd = cmd(
        "UPDATE ExpReference MERGE :doc WHERE ref_id = :id",
        {"doc": patch, "id": ref_id}
    )
    print(f"UPDATE {ref_id}: {r_upd.get('result', r_upd)}")

    # Получить RID ссылки
    r_ref = cmd("SELECT @rid FROM ExpReference WHERE ref_id = :id", {"id": ref_id})
    if not r_ref.get('result'):
        print(f"  ERROR: {ref_id} not found!")
        continue
    ref_rid = r_ref['result'][0]['@rid']
    print(f"  {ref_id} RID: {ref_rid}")

    # Создать ребро REF_TOPIC -> dkg_temporal
    # Проверим нет ли уже такого ребра
    check = cmd(
        "SELECT count(*) as cnt FROM REF_TOPIC WHERE @out = :r AND @in = :t",
        {"r": ref_rid, "t": dkg_temporal_rid}
    )
    cnt = check['result'][0].get('cnt', 0)
    if cnt > 0:
        print(f"  SKIP edge {ref_id} -> dkg_temporal (already exists)")
    else:
        r_edge = cmd(f"CREATE EDGE REF_TOPIC FROM {ref_rid} TO {dkg_temporal_rid}")
        print(f"  EDGE {ref_id} -> dkg_temporal: {r_edge.get('result', r_edge)}")

# --- Верификация ---
print("\n=== Verification ===")
for ref_id in PATCHES:
    r_ver = cmd(
        "SELECT ref_id, title_short, description_en, description_ru_sci FROM ExpReference WHERE ref_id = :id",
        {"id": ref_id}
    )
    rec = r_ver['result'][0] if r_ver.get('result') else {}
    ts = rec.get('title_short', 'MISSING')
    en = rec.get('description_en', 'MISSING')[:60] if rec.get('description_en') else 'MISSING'
    ru = rec.get('description_ru_sci', 'MISSING')[:60] if rec.get('description_ru_sci') else 'MISSING'
    print(f"{ref_id}:")
    print(f"  title_short:       {ts}")
    print(f"  description_en:    {en}...")
    print(f"  description_ru_sci:{ru}...")

# Рёбра к dkg_temporal
print("\n=== REF_TOPIC -> dkg_temporal ===")
r_edges = cmd("SELECT @out.ref_id as ref, @in.topic_id as topic FROM REF_TOPIC WHERE @in.topic_id = 'topic:dkg_temporal'")
for row in r_edges.get('result', []):
    print(f"  {row.get('ref')} -> {row.get('topic')}")
