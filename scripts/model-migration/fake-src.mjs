// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Источник в памяти для тестов и пробы страницы мастера без базы.
// Понимает ровно те формы запроса, которыми мастер читает источник: проекция (поле, «поле AS имя»,
// count(*), @rid, in('E').поле, out('E').поле), FROM тип или [список @rid], WHERE «поле = :v»,
// «(поле IS NULL OR поле = '')», «поле IN :ids», GROUP BY поле, ORDER BY @rid, LIMIT n. Остальное — ошибка:
// незнакомый запрос не должен молча отвечать «пусто».



/** store: { records: [{ '@rid', '@type', ...поля }], edges: [{ type, out, in }] } */
export function fakeSrc(store, env = { MIG_SRC_DB: 'fixture' }) {
  const byRid = new Map(store.records.map(r => [r['@rid'], r]));
  const hop = (rid, dir, E) => store.edges.filter(e => e.type === E && e[dir === 'out' ? 'out' : 'in'] === rid).map(e => byRid.get(dir === 'out' ? e.in : e.out)).filter(Boolean);
  const value = (rec, expr) => {
    expr = expr.trim();
    if (expr === '@rid') return rec['@rid'];
    const m = /^(in|out)\('(\w+)'\)\.(@?\w+)$/.exec(expr);
    if (m) return hop(rec['@rid'], m[1], m[2]).map(x => x[m[3]] ?? null);
    if (!/^\w+$/.test(expr)) throw new Error('fake-src: проекция «' + expr + '» не поддержана');
    return rec[expr] ?? null;
  };
  const cond = (where, params) => {
    if (!where) return () => true;
    let m = /^\((\w+) IS NULL OR (\w+) = ''\)$/.exec(where);
    if (m) return r => r[m[1]] === null || r[m[1]] === undefined || r[m[1]] === '';
    m = /^(\w+) = :(\w+)$/.exec(where);
    if (m) return r => r[m[1]] === params[m[2]];
    m = /^(\w+) IN :(\w+)$/.exec(where);
    if (m) return r => (params[m[2]] || []).includes(r[m[1]]);
    throw new Error('fake-src: условие «' + where + '» не поддержано');
  };
  const split = s => { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map(x => x.trim()); };
  return {
    env,
    async src(command, params = {}) {
      const m = /^SELECT (.+?) FROM (\w+|\[[^\]]*\])(?: WHERE (.+?))?(?: GROUP BY (\w+))?(?: ORDER BY @rid)?(?: LIMIT (\d+))?$/s.exec(command.trim());
      if (!m) throw new Error('fake-src: запрос не поддержан: ' + command.slice(0, 80));
      const [, proj, from, where, group, limit] = m;
      let rows = from.startsWith('[') ? split(from.slice(1, -1)).map(r => byRid.get(r)).filter(Boolean) : store.records.filter(r => r['@type'] === from);
      rows = rows.filter(cond(where, params));
      rows.sort((a, b) => a['@rid'].localeCompare(b['@rid'], 'en', { numeric: true }));
      const items = split(proj).map(p => { const a = /^(.+?)\s+AS\s+(\w+)$/i.exec(p); return a ? { expr: a[1], as: a[2] } : { expr: p, as: p }; });
      if (group) {
        const g = new Map();
        for (const r of rows) { const k = r[group] ?? null; g.set(k, (g.get(k) || 0) + 1); }
        return [...g.entries()].map(([k, n]) => Object.fromEntries(items.map(i => [i.as, /^count\(\*\)$/i.test(i.expr) ? n : k])));
      }
      if (items.length === 1 && /^count\(\*\)$/i.test(items[0].expr)) return [{ [items[0].as]: rows.length }];
      if (limit) rows = rows.slice(0, +limit);
      return rows.map(r => Object.fromEntries(items.map(i => [i.as, value(r, i.expr)])));
    },
  };
}
