// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Шаг мастера «Вид зависимостей» (Зв): связи DEPENDS_ON планирования без вида.
// Владелица 20.11.2026: «дополнительный визард для миграции у нас прочесть и предложить». На проде 16.11 таких 30,
// все спринт → спринт и все без причины. Мастер читает тексты обоих спринтов (название, описание, итог, причину
// блокировки, заметки) и ищет фразу, где назван другой конец; по словам фразы предлагает вид с подсказкой — самой
// фразой. Решает человек: группой («принять все предложения») или по одной. Ответ — раздел dependency_kinds файла
// решений: { map: { "FROM>TO": код | null }, by, at }; null — «оставить без вида» (решено). Без ответа связь
// переносится без вида, в отчёте — «ждёт решения». Правило детерминировано: те же данные — тот же ответ.

import { depKindCodes, classifyDepKind } from './depends-on.mjs';

/** Слова → вид, по порядку: первое сработавшее (проверка конкретнее ожидания, ожидание — конкретнее «после»). */
export const KIND_WORDS = [
  ['gate', /провер|гейт|\bgate|go\/no-go|приёмк|приемк|\buat\b|ревью/i],
  ['waits', /жд[её]м|ожида|ответ[аеу]?\b|ждать|waiting|await/i],
  ['informs', /входн|данные из|исходн|основ[аеуы]|использует|опира|переиспольз|наследует|informs|input|reuse/i],
  ['blocks', /после|только когда|требует|нужн[аоы]?\b|без [а-яё]|блокир|нельзя|requires|needs|after|blocked/i],
];
export const TEXT_FIELDS = ['name', 'title', 'context_md', 'outcome_md', 'block_reason', 'note_md', 'notes_md'];

const short = id => String(id).replace(/^SPRINT_/, '');
const sentences = t => String(t || '').split(/(?<=[.!?;\n])\s+/).map(s => s.trim()).filter(Boolean);
const mentions = (s, id) => {
  const re = new RegExp(`(^|[^A-Z0-9_])(SPRINT_)?${short(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Z0-9_])`);
  return re.test(s);
};

function classify(s) {
  for (const [k, re] of KIND_WORDS) if (re.test(s)) return k;
  return 'relates';
}

/** Фраза записи `a`, где назван конец `id`; нет — null. */
function phrase(a, id) {
  for (const f of TEXT_FIELDS) for (const s of sentences(a[f])) if (mentions(s, id)) return { field: f, text: s };
  return null;
}

/**
 * Предложения. edges — [{ from: {id, name?, context_md?, …}, to: {…}, from_type?, to_type? }] — связи без вида.
 * Ответ по ключу: { key, from, to, suggest (код | null), why, hint (фраза) }.
 */
export function proposeDepKinds(edges, rules) {
  const codes = depKindCodes(rules);
  return edges.map(e => {
    const key = `${e.from.id}>${e.to.id}`;
    const base = { key, from: e.from.id, to: e.to.id, from_name: e.from.name || null, to_name: e.to.name || null };
    const own = phrase(e.from, e.to.id);
    if (own) {
      const k = classify(own.text);
      return { ...base, suggest: codes.includes(k) ? k : null, hint: own.text,
        why: `в тексте ${e.from.id} (${own.field}): «${own.text}»` + (k === 'relates' ? ' — назван без слова о характере связи' : '') };
    }
    const back = phrase(e.to, e.from.id);
    if (back) {
      const k = classify(back.text);
      return { ...base, suggest: codes.includes(k) ? k : null, hint: back.text, why: `в тексте ${e.to.id} (${back.field}): «${back.text}»` };
    }
    return { ...base, suggest: null, hint: null, why: 'связь в текстах обоих спринтов не объяснена — «какой?»: выберите вид или оставьте без вида' };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Ответы человека; нет раздела — пусто. Значение: код справочника или null («оставить без вида»). */
export function depKindAnswers(doc) {
  const m = doc && doc.dependency_kinds && typeof doc.dependency_kinds === 'object' ? doc.dependency_kinds.map || {} : {};
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v === null || (typeof v === 'string' && v)));
}

/** Записать ответы: прежние сохраняются; синоним — к коду; код не из справочника и пустое «кто» — отказ. */
export function withDepKinds(doc, map, by, rules, at = new Date().toISOString()) {
  if (!by) throw new Error('не записано: не сказано, кто принял');
  const next = { ...depKindAnswers(doc) };
  for (const [k, v] of Object.entries(map || {})) {
    if (v === null) { next[k] = null; continue; }
    const c = classifyDepKind(v, rules);
    if (!c.code) throw new Error(`вид «${v}» у ${k} не из справочника dependency_kind (${depKindCodes(rules).join(', ')})`);
    next[k] = c.code;
  }
  return { ...doc, dependency_kinds: { map: next, by, at } };
}

/** Итог: вид по ответу, оставлены без вида (решено), ждут решения. */
export function depKindState(rows, answers) {
  const kind = [], keep = [], waiting = [];
  for (const r of rows) {
    const a = answers[r.key];
    if (a === undefined) waiting.push(r.key);
    else if (a === null) keep.push(r.key);
    else kind.push({ key: r.key, kind: a });
  }
  return { kind, keep, waiting };
}

/** Чтение источника: связи планирования без вида и тексты обоих концов. q — запрос к базе источника. */
export async function readDepKindInput(q) {
  const end = e => `${e}.@type AS ${e === '@out' ? 'ot' : 'it'}, coalesce(${e}.task_uid, ${e}.phase_uid, ${e}.sprint_id, ${e}.milestone_id) AS ${e === '@out' ? 'fid' : 'tid'}`;
  const rows = await q(`SELECT ${end('@out')}, ${end('@in')} FROM DEPENDS_ON WHERE (kind IS NULL OR kind = '') AND @out.@type IN ['KnowTask','KnowPhase','KnowSprint','KnowMilestone'] AND @in.@type IN ['KnowTask','KnowPhase','KnowSprint','KnowMilestone']`);
  const ids = [...new Set(rows.flatMap(r => [r.fid, r.tid]).filter(Boolean))];
  const texts = new Map();
  for (const id of ids) {
    const t = await q(`SELECT sprint_id AS id, coalesce(title, name) AS name, context_md, outcome_md, out('HAS_STATE')[valid_to IS NULL].context_md[0] AS hc, out('HAS_STATE')[valid_to IS NULL].outcome_md[0] AS ho, out('HAS_STATE')[valid_to IS NULL].block_reason[0] AS block_reason FROM KnowSprint WHERE sprint_id = '${String(id).replace(/'/g, '')}'`);
    const x = t[0] || {};
    texts.set(id, { id, name: x.name || null, context_md: x.hc || x.context_md || null, outcome_md: x.ho || x.outcome_md || null, block_reason: x.block_reason || null });
  }
  return rows.filter(r => r.fid && r.tid).map(r => ({ from: texts.get(r.fid) || { id: r.fid }, to: texts.get(r.tid) || { id: r.tid }, from_type: r.ot, to_type: r.it }));
}
