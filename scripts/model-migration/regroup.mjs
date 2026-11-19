// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Перегруппировка проектов при установке.
// Владелица 19.11.2026: «проекты нужно схлопнуть», «сделай отдельное меню с предложением перегруппировки в
// инсталляции». Предложение строится из данных установки, а не из списка, придуманного вручную:
//   1) проект = продукт верхнего уровня, чей он (связь продукт → проект с ролью owner); подпродукт — в родителе;
//   2) проект без продукта, но с тем же основным репозиторием, что у проекта с продуктом, — в ту же группу (дубль);
//   3) правка человека (overrides: проект → группа) сильнее предложения;
//   4) остальное — «куда?» (to = null): группа не выдумывается.
// Чистая функция: базу читает вызывающий (ui.mjs, transfer.mjs).

/** Адрес основного репозитория проекта без хвостового «/» и регистра; нет — null. */
function primaryRepo(p) {
  const hosts = Array.isArray(p.hosts) ? p.hosts : [];
  const h = hosts.find(x => x && x.role === 'primary') || hosts[0];
  return h && h.base_url ? String(h.base_url).replace(/\/+$/, '').toLowerCase() : null;
}

/**
 * @param {{ projects: {slug:string,name?:string,hosts?:any}[], products: {code:string,parent:string|null,owners:string[]}[],
 *           counts?: Record<string,number>, overrides?: Record<string,string|null> }} input
 * @returns {{ rows: {from:string,name:string,records:number,to:string|null,why:string}[],
 *             groups: Record<string,{from:string[],records:number}>, unassigned: string[] }}
 */
export function proposeRegroup({ projects, products, counts = {}, overrides = {} }) {
  const byCode = new Map(products.map(p => [p.code, p]));
  const top = code => { // корень цепочки родителей; цикл не роняет — останавливаемся на повторе
    const seen = new Set(); let c = code;
    while (byCode.get(c)?.parent && !seen.has(c)) { seen.add(c); c = byCode.get(c).parent; }
    return c;
  };
  const ownerOf = new Map(); // проект → [{ code, topCode }]
  for (const p of products) for (const slug of p.owners || []) {
    if (!ownerOf.has(slug)) ownerOf.set(slug, []);
    ownerOf.get(slug).push({ code: p.code, topCode: top(p.code) });
  }
  const rows = projects.map(p => {
    const own = ownerOf.get(p.slug) || [];
    const tops = [...new Set(own.map(o => o.topCode))];
    let to = null, why = 'нет продукта — куда?';
    if (tops.length) {
      to = tops[0];
      const sub = own.find(o => o.code !== o.topCode);
      why = tops.length > 1 ? `несколько продуктов (${tops.join(', ')}) — взят первый`
        : sub ? `подпродукт ${sub.code} → в родителе ${to}` : `продукт ${to}`;
    }
    return { from: p.slug, name: p.name || p.slug, records: counts[p.slug] || 0, to, why, repo: primaryRepo(p) };
  });
  // дубли: тот же основной репозиторий — туда же, куда проект с продуктом
  for (const r of rows) {
    if (r.to || !r.repo) continue;
    const twin = rows.find(x => x !== r && x.to && x.repo === r.repo);
    if (twin) { r.to = twin.to; r.why = `тот же репозиторий, что у ${twin.from}`; }
  }
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(overrides, r.from)) { r.to = overrides[r.from] || null; r.why = 'решение человека'; }
    delete r.repo;
  }
  const groups = {};
  for (const r of rows) {
    if (!r.to) continue;
    (groups[r.to] ||= { from: [], records: 0 }).from.push(r.from);
    groups[r.to].records += r.records;
  }
  return { rows, groups, unassigned: rows.filter(r => !r.to).map(r => r.from) };
}

/** Данные для предложения из источника (только чтение): проекты, продукты с владельцами, число записей проекта. */
export async function readRegroupInput(db) {
  const projects = await db.src('SELECT slug, name, hosts, in(\'BELONGS_TO_PROJECT\').size() AS n FROM KnowGitProject ORDER BY slug');
  const prods = await db.src("SELECT code, out('PARENT_PRODUCT').code[0] AS parent, outE('BELONGS_TO_PROJECT')[role = 'owner'].inV().slug AS owners FROM KnowDictEntry WHERE dict_type = 'product'");
  const parseHosts = h => { if (Array.isArray(h)) return h; try { return JSON.parse(h); } catch { return null; } };
  return {
    projects: projects.map(p => ({ slug: p.slug, name: p.name, hosts: parseHosts(p.hosts) })),
    products: prods.map(p => ({ code: p.code, parent: p.parent || null, owners: Array.isArray(p.owners) ? p.owners : [] })),
    counts: Object.fromEntries(projects.map(p => [p.slug, Number(p.n) || 0])),
  };
}

/** Правки человека из файла решений: { "проект": "группа" | null }; нет раздела — пусто. */
export function regroupOverrides(doc) {
  const o = doc && doc.projects && typeof doc.projects === 'object' ? doc.projects.map || {} : {};
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof k === 'string' && (v === null || typeof v === 'string')));
}

/** Записать правки в документ решений: кто и когда — рядом; пустая строка — «оставить без группы». */
export function withRegroupOverrides(doc, overrides, by, at = new Date().toISOString()) {
  const map = { ...regroupOverrides(doc) };
  for (const [k, v] of Object.entries(overrides || {})) map[k] = v ? String(v).trim() : null;
  return { ...doc, projects: { map, by: by || null, at } };
}
