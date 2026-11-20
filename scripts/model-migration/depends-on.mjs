// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Одна связь «зависит от» (DEPENDS_ON) при переносе.
// Связь переносится шагом связей как есть (карта map/all.edges.json: keep, свойства kind и reason); по модели она
// историчная (edge_history) — шаг связей даёт ей valid_from / valid_to. Этот модуль — сверка вида со
// справочником dependency_kind (rules/status-unification.json) и счёт «было → стало» по каждой паре концов и
// каждому виду: потерь 0, вид не из справочника — не «сошлось». Связь без вида (на проде 30 спринтовых и все ADR)
// переносится без вида — какой вид ей дать, решает человек, перенос его не выдумывает.

export const DEP_EDGE = 'DEPENDS_ON';
export const NO_KIND = '(без вида)';

/** Коды справочника видов зависимости — по порядку правил. */
export function depKindCodes(rules) {
  const d = rules.dictionaries && rules.dictionaries.dependency_kind;
  if (!d) throw new Error('в правилах нет справочника dependency_kind');
  return d.codes.map(c => c.code);
}

/** Вид ребра источника: known — код справочника; normalized — код после обрезки и регистра; empty — без вида; unknown. */
export function classifyDepKind(v, rules) {
  if (v === undefined || v === null || String(v).trim() === '') return { kind: 'empty', code: null };
  const codes = depKindCodes(rules);
  const raw = String(v);
  if (codes.includes(raw)) return { kind: 'known', code: raw };
  const n = raw.trim().toLowerCase();
  if (codes.includes(n)) return { kind: 'normalized', code: n };
  return { kind: 'unknown', code: null };
}

/**
 * Счёт рёбер: rows [{o, i, kind}] (o, i — типы вершин концов). Ответ: total, by_pair { 'O>I': { total, kinds } },
 * normalized (сколько приведено к коду), unknown [{pair, kind}] — виды вне справочника.
 */
export function countDeps(rows, rules) {
  const by_pair = {}, unknown = [];
  let normalized = 0;
  for (const r of rows) {
    const pair = `${r.o}>${r.i}`;
    const c = classifyDepKind(r.kind, rules);
    const key = c.kind === 'empty' ? NO_KIND : c.kind === 'unknown' ? String(r.kind) : c.code;
    if (c.kind === 'unknown') unknown.push({ pair, kind: r.kind });
    if (c.kind === 'normalized') normalized++;
    const p = (by_pair[pair] ||= { total: 0, kinds: {} });
    p.total++;
    p.kinds[key] = (p.kinds[key] || 0) + 1;
  }
  return { total: rows.length, by_pair, normalized, unknown };
}

/** Было (источник) → стало (приёмник) по каждой паре концов и виду. ok — всё совпало и видов вне справочника нет. */
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
  // вид в приёмнике — только код справочника: значение не в той форме (регистр, пробелы) — тоже не «сошлось»
  const ok = lost === 0 && src.total === dst.total && !src.unknown.length && !dst.unknown.length && !dst.normalized;
  return { ok, lost, was: src.total, now: dst.total, unknown: [...src.unknown, ...dst.unknown], rows };
}

const read = async (q, base) => {
  const out = [];
  let last = '#-1:-1';
  for (;;) {
    const page = await q(`SELECT @rid AS r, @out.@type AS o, @in.@type AS i, kind FROM ${DEP_EDGE} WHERE @rid > ${last}${base} ORDER BY @rid LIMIT 5000`);
    if (!page.length) break;
    out.push(...page);
    last = page[page.length - 1].r;
    if (page.length < 5000) break;
  }
  return out;
};

/**
 * Сверка после шага связей: рёбра DEPENDS_ON источника (все — до переноса истории в ребре не было) против
 * текущих рёбер приёмника (valid_to пусто). Источник только читается.
 */
export async function checkDependsOn(db, rules, { log = console.log } = {}) {
  const srcTypes = new Set((await db.src('SELECT name FROM schema:types')).map(x => x.name));
  const dstTypes = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  const src = countDeps(srcTypes.has(DEP_EDGE) ? await read(q => db.src(q), '') : [], rules);
  const dst = countDeps(dstTypes.has(DEP_EDGE) ? await read(q => db.dstQuery(q), ' AND valid_to IS NULL') : [], rules);
  const cmp = compareDeps(src, dst);
  for (const r of cmp.rows) log(`зависимость ${r.pair} · ${r.kind}: было ${r.was} → стало ${r.now}`);
  log(`зависимости DEPENDS_ON: было ${cmp.was} → стало ${cmp.now}, потерь ${cmp.lost}, видов вне справочника ${cmp.unknown.length} — ${cmp.ok ? 'сошлось' : 'НЕ сошлось'}`);
  return { ...cmp, normalized: src.normalized };
}
