// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Правило переноса для каждого вида связи — по общей карте map/all.edges.json.
// keep — переносится как есть; drop — не переносится (с причиной); convert — переносится под другим именем (to),
// при reverse — с разворотом концов; дубль пары концов в цели не создаётся. Правила нет — ошибка, не тихий пропуск.
// Связь, у которой хоть один конец — непереносимый тип, не переносится при любом правиле: её некуда поставить.

//
// MD-05 · перевод по типу начала (convert + by_from): {тип начала: {to, reverse}} — одна старая связь расходится в разные
// живые по тому, откуда она идёт (HAS_PR: задача → CLOSED_BY, релиз → SHIPPED_IN разворотом). Тип начала вне by_from —
// не переносится, причина — from_note правила (в отчёте как dropped_ends).
export function edgePlan(triples, rules, transferredTypes) {
  const out = {};
  for (const t of triples) {
    const r = rules[t.edge];
    if (!r) throw new Error('связь вне карты: ' + t.edge + ' (' + t.from + ' → ' + t.to + ') — добавьте правило в map/all.edges.json');
    if (r.rule === 'convert' && !r.to && !r.by_from) throw new Error(t.edge + ': правило convert без цели to и без перевода по типу начала by_from');
    const p = out[t.edge] ||= { rule: r.rule === 'wait' ? 'keep' : r.rule, to: r.to, reverse: !!r.reverse, by_from: r.by_from, why: r.note || '', ends: [], dropped_ends: [] };
    const orphan = [t.from, t.to].filter(x => !transferredTypes.has(x));
    if (orphan.length) p.dropped_ends.push({ from: t.from, to: t.to, n: t.n, why: 'тип ' + orphan.join(', ') + ' не переносится' });
    else if (r.by_from && !r.by_from[t.from]) p.dropped_ends.push({ from: t.from, to: t.to, n: t.n, why: r.from_note || ('начало ' + t.from + ' не переводится') });
    else p.ends.push({ from: t.from, to: t.to, n: t.n });
  }
  for (const [e, p] of Object.entries(out)) {
    if (!p.ends.length && p.rule !== 'drop') { p.rule = 'drop'; p.why = p.dropped_ends.map(x => x.why).join('; '); }
    if (p.rule === 'convert' && !p.to && !p.by_from) throw new Error(e + ': правило convert без цели to');
    if (!p.by_from) delete p.by_from;
  }
  return out;
}

/**
 * Запрос страницы связей источника. У перевода по типу начала — адрес, концы и тип начала (свойства не читаются:
 * у HAS_PR роль снята решением «HAS_PR.role: снять»); у прочих — запись связи целиком.
 */
export function srcEdgeSql(edge, p, last) {
  const page = ` FROM ${edge} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`;
  return p && p.by_from ? 'SELECT @rid AS r, @out AS o, @in AS i, @out.@type AS ot' + page : 'SELECT' + page;
}

/** Строка выборки {@link srcEdgeSql} → связь источника { r, o, i, ot?, props }. */
export function srcEdgeRow(row) {
  if ('ot' in row && 'r' in row) return { r: row.r, o: row.o, i: row.i, ot: row.ot, props: {} };
  const props = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('@') && k !== 'out' && k !== 'in' && v !== null && v !== undefined && v !== '') props[k] = v;
  return { r: row['@rid'], o: row['@out'], i: row['@in'], props };
}

/** Ключ пары концов в направлении цели — по нему не создаётся дубль при переводе. */
export const convertKey = (x, reverse) => (reverse ? `${x.i}>${x.o}` : `${x.o}>${x.i}`);

/**
 * Что записать в приёмник. src: { вид: [{ r, o, i, props }] } — связи источника (адреса записей источника);
 * dstRid: адрес записи источника → адрес в приёмнике; plan — результат edgePlan.
 * Связь, у которой конец не перенесён, — в missingEnds (отчёт), в базу не идёт. convert — после keep своей цели,
 * пара концов, уже существующая в цели, — в duplicates.
 */
export function edgeWrites(src, dstRid, plan) {
  const writes = {}, missingEnds = {}, duplicates = {}, seen = {}, converted = {}, skippedFrom = {};
  // Дубль отсекается только при переводе (convert): параллельные связи keep законны — задача → человек
  // бывает и автором, и исполнителем (ROLE_HELD_BY с разной role).
  const put = (target, edge, x, reverse, converting) => {
    const o = dstRid.get(reverse ? x.i : x.o), i = dstRid.get(reverse ? x.o : x.i);
    if (!o || !i) { missingEnds[edge] = (missingEnds[edge] || 0) + 1; return; }
    const key = o + '>' + i, s = (seen[target] ||= new Set());
    if (converting && s.has(key)) { duplicates[edge] = (duplicates[edge] || 0) + 1; return; }
    s.add(key);
    (writes[target] ||= []).push({ from: o, to: i, content: { ...(x.props || {}), mig_src_rid: x.r } });
    if (converting) { const c = (converted[edge] ||= {}); c[target] = (c[target] || 0) + 1; }
  };
  const order = Object.keys(plan).sort((a, b) => (plan[a].rule === 'convert') - (plan[b].rule === 'convert'));
  for (const e of order) {
    const p = plan[e];
    if (p.rule === 'drop') continue;
    const conv = p.rule === 'convert';
    for (const x of src[e] || []) {
      if (conv && p.by_from) {
        // MD-05: цель — по типу начала; свойства старой связи не переносятся (роль HAS_PR снята)
        const r = p.by_from[x.ot];
        if (!r) { const k = (skippedFrom[e] ||= {}); k[x.ot] = (k[x.ot] || 0) + 1; continue; }
        put(r.to, e, { r: x.r, o: x.o, i: x.i, props: {} }, !!r.reverse, true);
      } else put(conv ? p.to : e, e, x, conv && p.reverse, conv);
    }
  }
  // converted — сколько связей вида легло в каждую цель (сверка «до и после»: прирост цели = keep + converted)
  return { writes, missingEnds, duplicates, converted, skippedFrom };
}

/**
 * MD-02 8а · DDL пустых связей «только схема» (карта: schema_only, props — свойства старой схемы): вид связи нужен
 * живому коду сервера, данных нет. created — виды, уже заведённые записью данных этого переноса: их не трогаем.
 */
export function schemaOnlyEdgeDdl(edges, created = new Set()) {
  const out = [];
  for (const [e, r] of Object.entries(edges).sort(([a], [b]) => a.localeCompare(b))) {
    if (!r.schema_only || created.has(e)) continue;
    out.push(`CREATE EDGE TYPE ${e} IF NOT EXISTS`);
    for (const [p, t] of Object.entries(r.props || {})) out.push(`CREATE PROPERTY ${e}.\`${p}\` IF NOT EXISTS ${t}`);
  }
  return out;
}
