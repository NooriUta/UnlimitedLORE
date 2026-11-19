// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Правило переноса для каждого вида связи — по общей карте map/all.edges.json.
// keep — переносится как есть; drop — не переносится (с причиной); convert — переносится под другим именем (to),
// при reverse — с разворотом концов; дубль пары концов в цели не создаётся. Правила нет — ошибка, не тихий пропуск.
// Связь, у которой хоть один конец — непереносимый тип, не переносится при любом правиле: её некуда поставить.

export function edgePlan(triples, rules, transferredTypes) {
  const out = {};
  for (const t of triples) {
    const r = rules[t.edge];
    if (!r) throw new Error('связь вне карты: ' + t.edge + ' (' + t.from + ' → ' + t.to + ') — добавьте правило в map/all.edges.json');
    const p = out[t.edge] ||= { rule: r.rule === 'wait' ? 'keep' : r.rule, to: r.to, reverse: !!r.reverse, why: r.note || '', ends: [], dropped_ends: [] };
    const orphan = [t.from, t.to].filter(x => !transferredTypes.has(x));
    if (orphan.length) p.dropped_ends.push({ from: t.from, to: t.to, n: t.n, why: 'тип ' + orphan.join(', ') + ' не переносится' });
    else p.ends.push({ from: t.from, to: t.to, n: t.n });
  }
  for (const [e, p] of Object.entries(out)) {
    if (!p.ends.length && p.rule !== 'drop') { p.rule = 'drop'; p.why = p.dropped_ends.map(x => x.why).join('; '); }
    if (p.rule === 'convert' && !p.to) throw new Error(e + ': правило convert без цели to');
  }
  return out;
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
  const writes = {}, missingEnds = {}, duplicates = {}, seen = {};
  // Дубль отсекается только при переводе (convert): параллельные связи keep законны — задача → человек
  // бывает и автором, и исполнителем (ROLE_HELD_BY с разной role).
  const put = (target, edge, x, reverse, converting) => {
    const o = dstRid.get(reverse ? x.i : x.o), i = dstRid.get(reverse ? x.o : x.i);
    if (!o || !i) { missingEnds[edge] = (missingEnds[edge] || 0) + 1; return; }
    const key = o + '>' + i, s = (seen[target] ||= new Set());
    if (converting && s.has(key)) { duplicates[edge] = (duplicates[edge] || 0) + 1; return; }
    s.add(key);
    (writes[target] ||= []).push({ from: o, to: i, content: { ...(x.props || {}), mig_src_rid: x.r } });
  };
  const order = Object.keys(plan).sort((a, b) => (plan[a].rule === 'convert') - (plan[b].rule === 'convert'));
  for (const e of order) {
    const p = plan[e];
    if (p.rule === 'drop') continue;
    const conv = p.rule === 'convert';
    for (const x of src[e] || []) put(conv ? p.to : e, e, x, conv && p.reverse, conv);
  }
  return { writes, missingEnds, duplicates };
}
