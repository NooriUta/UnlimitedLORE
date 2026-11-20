// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Одна связь «зависит от» (DEPENDS_ON) при переносе.
// Связь переносится шагом связей как есть (карта map/all.edges.json: keep, свойства kind и reason); по модели она
// историчная (edge_history) — шаг связей даёт ей valid_from / valid_to. Затем связи ПЛАНИРОВАНИЯ (задача, фаза,
// спринт, веха) приводятся к правилам 1.18 (владелица 20.11.2026):
//   - вид — код объединённого справочника dependency_kind (rules/status-unification.json); прежний код — синоним
//     (hard → blocks);
//   - вид пустой — по ответу человека в мастере (шаг «Вид зависимостей», раздел dependency_kinds файла решений);
//     без ответа — без вида, в отчёте «ждёт решения»; вид перенос не выдумывает;
//   - причина обязательна у новых связей; старая связь без причины получает MIGRATED_NO_REASON, а не отказ.
// ADR → ADR — та же связь, но не планирование: вид и причина ей не нужны, она не трогается.
// Сверка «было → стало» по паре концов и виду: потерь 0, вид вне справочника и синоним в приёмнике — не «сошлось».

export const DEP_EDGE = 'DEPENDS_ON';
export const NO_KIND = '(без вида)';
export const MIGRATED_NO_REASON = 'перенесено без причины (до 1.18)';
export const PLANNING = ['KnowTask', 'KnowPhase', 'KnowSprint', 'KnowMilestone'];

/** Коды справочника видов зависимости — по порядку правил. */
export function depKindCodes(rules) {
  const d = rules.dictionaries && rules.dictionaries.dependency_kind;
  if (!d) throw new Error('в правилах нет справочника dependency_kind');
  return d.codes.map(c => c.code);
}

/** Вид: known — код; synonym — прежний код → код; normalized — регистр/пробелы; empty — без вида; unknown. */
export function classifyDepKind(v, rules) {
  if (v === undefined || v === null || String(v).trim() === '') return { kind: 'empty', code: null };
  const codes = depKindCodes(rules), syn = rules.dictionaries.dependency_kind.synonyms || {};
  const raw = String(v);
  if (codes.includes(raw)) return { kind: 'known', code: raw };
  if (syn[raw]) return { kind: 'synonym', code: syn[raw] };
  const n = raw.trim().toLowerCase();
  if (codes.includes(n)) return { kind: 'normalized', code: n };
  if (syn[n]) return { kind: 'synonym', code: syn[n] };
  return { kind: 'unknown', code: null };
}

const keyOf = r => `${r.from}>${r.to}`;
const isPlanning = r => PLANNING.includes(r.o) && PLANNING.includes(r.i);

/** Вид после правил переноса: код справочника; пустой у планирования — ответ мастера (код | null), иначе пусто. */
function expected(r, rules, answers) {
  const c = classifyDepKind(r.kind, rules);
  if (c.kind !== 'empty' || !isPlanning(r)) return c;
  const a = answers ? answers[keyOf(r)] : undefined;
  return a ? { kind: 'answer', code: a } : c;
}

/**
 * Счёт рёбер: rows [{o, i, from, to, kind}] (o, i — типы вершин концов). answers — ответы мастера (ключ from>to);
 * считается вид ПОСЛЕ правил переноса. Ответ: total, by_pair { 'O>I': { total, kinds } }, synonym и normalized
 * (сколько значений не в форме кода), unknown [{pair, kind}].
 */
export function countDeps(rows, rules, answers = {}) {
  const by_pair = {}, unknown = [];
  let normalized = 0, synonym = 0;
  for (const r of rows) {
    const pair = `${r.o}>${r.i}`;
    const c = expected(r, rules, answers);
    const key = c.kind === 'empty' ? NO_KIND : c.kind === 'unknown' ? String(r.kind) : c.code;
    if (c.kind === 'unknown') unknown.push({ pair, kind: r.kind });
    if (c.kind === 'normalized') normalized++;
    if (c.kind === 'synonym') synonym++;
    const p = (by_pair[pair] ||= { total: 0, kinds: {} });
    p.total++;
    p.kinds[key] = (p.kinds[key] || 0) + 1;
  }
  return { total: rows.length, by_pair, normalized, synonym, unknown };
}

/**
 * Что поправить в приёмнике после копирования: rows — рёбра приёмника (r — адрес). Ответ: updates [{r, set}] и
 * счёт по правилам (synonym, normalized, kind_by_answer, no_kind_decided, no_kind_waiting, reason_default).
 */
export function planDependsOnFix(rows, rules, answers = {}) {
  const updates = [];
  const counts = { planning: 0, synonym: 0, normalized: 0, kind_by_answer: 0, no_kind_decided: 0, no_kind_waiting: 0, reason_default: 0, unknown: 0 };
  const waiting = [];
  for (const r of rows) {
    if (!isPlanning(r)) continue;
    counts.planning++;
    const set = {};
    const c = classifyDepKind(r.kind, rules);
    if (c.kind === 'synonym' || c.kind === 'normalized') { set.kind = c.code; counts[c.kind]++; }
    else if (c.kind === 'unknown') counts.unknown++;
    else if (c.kind === 'empty') {
      const a = answers[keyOf(r)];
      if (a) { set.kind = a; counts.kind_by_answer++; }
      else if (a === null) counts.no_kind_decided++;
      else { counts.no_kind_waiting++; waiting.push(keyOf(r)); }
    }
    if (r.reason === undefined || r.reason === null || String(r.reason).trim() === '') { set.reason = MIGRATED_NO_REASON; counts.reason_default++; }
    if (Object.keys(set).length) updates.push({ r: r.r, set });
  }
  return { updates, counts, waiting };
}

/** Было (источник, вид после правил) → стало (приёмник) по паре концов и виду. */
export function compareDeps(src, dst) {
  const rows = [];
  let lost = 0;
  const pairs = [...new Set([...Object.keys(src.by_pair), ...Object.keys(dst.by_pair)])].sort();
  for (const pair of pairs) {
    const a = (src.by_pair[pair] || { kinds: {} }).kinds, b = (dst.by_pair[pair] || { kinds: {} }).kinds;
    for (const kind of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const was = a[kind] || 0, now = b[kind] || 0;
      rows.push({ pair, kind, was, now });
      if (now < was) lost += was - now;
    }
  }
  // в приёмнике вид — только код справочника: синоним или значение не в той форме — тоже не «сошлось»
  const ok = lost === 0 && src.total === dst.total && !src.unknown.length && !dst.unknown.length && !dst.normalized && !dst.synonym;
  return { ok, lost, was: src.total, now: dst.total, unknown: [...src.unknown, ...dst.unknown], rows };
}

const COLS = '@rid AS r, @out.@type AS o, @in.@type AS i, coalesce(@out.task_uid, @out.phase_uid, @out.sprint_id, @out.milestone_id, @out.adr_id) AS from, coalesce(@in.task_uid, @in.phase_uid, @in.sprint_id, @in.milestone_id, @in.adr_id) AS to, kind, reason';
const read = async (q, where) => {
  const out = [];
  let last = '#-1:-1';
  for (;;) {
    const page = await q(`SELECT ${COLS} FROM ${DEP_EDGE} WHERE @rid > ${last}${where} ORDER BY @rid LIMIT 5000`);
    if (!page.length) break;
    out.push(...page);
    last = page[page.length - 1].r;
    if (page.length < 5000) break;
  }
  return out;
};

/** Ответы мастера «Вид зависимостей» из файла решений. */
export function depKindAnswersOf(doc) {
  const m = doc && doc.dependency_kinds && typeof doc.dependency_kinds === 'object' ? doc.dependency_kinds.map || {} : {};
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v === null || (typeof v === 'string' && v)));
}

/**
 * После шага связей: правила 1.18 к текущим рёбрам приёмника, затем сверка с источником (источник только
 * читается; рёбра, поставленные другими шагами — mig_rule, например «ожидание → связи», — в сверку не входят).
 */
export async function applyDependsOn(db, rules, doc, { log = console.log } = {}) {
  const answers = depKindAnswersOf(doc);
  const srcTypes = new Set((await db.src('SELECT name FROM schema:types')).map(x => x.name));
  const dstTypes = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  const dstRows = dstTypes.has(DEP_EDGE) ? await read(q => db.dstQuery(q), ' AND valid_to IS NULL AND mig_rule IS NULL') : [];
  const plan = planDependsOnFix(dstRows, rules, answers);
  for (const u of plan.updates) {
    const parts = Object.keys(u.set).map(k => `${k} = :${k}`).join(', ');
    await db.dstCommand(`UPDATE ${u.r} SET ${parts}`, u.set);
  }
  const src = countDeps(srcTypes.has(DEP_EDGE) ? await read(q => db.src(q), '') : [], rules, answers);
  const after = dstTypes.has(DEP_EDGE) ? await read(q => db.dstQuery(q), ' AND valid_to IS NULL AND mig_rule IS NULL') : [];
  const dst = countDeps(after, rules, {});
  const cmp = compareDeps(src, dst);
  const noReason = after.filter(r => isPlanning(r) && (r.reason === null || r.reason === undefined || String(r.reason).trim() === '')).length;
  const ok = cmp.ok && noReason === 0;
  for (const r of cmp.rows) log(`зависимость ${r.pair} · ${r.kind}: было ${r.was} → стало ${r.now}`);
  log(`зависимости DEPENDS_ON: было ${cmp.was} → стало ${cmp.now}, потерь ${cmp.lost}; hard → blocks ${plan.counts.synonym}; вид по ответу мастера ${plan.counts.kind_by_answer}; без вида — решено ${plan.counts.no_kind_decided}, ждёт решения ${plan.counts.no_kind_waiting}; причина «${MIGRATED_NO_REASON}» — ${plan.counts.reason_default}; без причины осталось ${noReason} — ${ok ? 'сошлось' : 'НЕ сошлось'}`);
  return { ...cmp, ok, fix: plan.counts, waiting: plan.waiting, without_reason: noReason };
}
