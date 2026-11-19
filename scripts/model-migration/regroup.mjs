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
export function proposeRegroup({ projects, products, counts = {}, overrides = {}, members = {} }) {
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
  // сходство по данным (владелица 19.11.2026: «надо сделать алгоритм или предложить сгруппировать проекты»):
  // проект без группы — к группе, с которой у него общие записи и/или похожее имя или описание; признак слабый — «куда?»
  const desc = new Map(projects.map(p => [p.slug, `${p.slug} ${p.name || ''} ${p.description || ''}`.toLowerCase()]));
  const words = s => new Set(s.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(w => w.length >= 4));
  const assigned = rows.filter(r => r.to);
  for (const r of rows) {
    if (r.to) continue;
    const mine = new Set(members[r.from] || []);
    let best = null;
    for (const g of [...new Set(assigned.map(x => x.to))]) {
      const peers = assigned.filter(x => x.to === g);
      const theirs = new Set(peers.flatMap(x => members[x.from] || []));
      const shared = [...mine].filter(x => theirs.has(x)).length;
      const text = desc.get(r.from) || '';
      const hit = peers.map(x => x.from.split('/').pop().toLowerCase()).concat([g.toLowerCase()])
        .find(n => n.length >= 5 && (text.includes(n) || [...words(text)].some(w => w.startsWith(n) || n.startsWith(w) && w.length >= 6)));
      const score = shared * 2 + (hit ? 3 : 0);
      if (score >= 3 && (!best || score > best.score)) best = { g, shared, hit, score };
    }
    if (best) {
      r.to = best.g; r.suggested = true;
      r.why = `похоже на группу ${best.g}: ` + [best.shared ? `общих записей ${best.shared}` : null, best.hit ? `имя/описание — «${best.hit}»` : null].filter(Boolean).join('; ');
    }
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
  const projects = await db.src("SELECT slug, name, description, hosts, in('BELONGS_TO_PROJECT').size() AS n, in('BELONGS_TO_PROJECT').@rid AS m FROM KnowGitProject ORDER BY slug");
  const prods = await db.src("SELECT code, out('PARENT_PRODUCT').code[0] AS parent, outE('BELONGS_TO_PROJECT')[role = 'owner'].inV().slug AS owners FROM KnowDictEntry WHERE dict_type = 'product'");
  const parseHosts = h => { if (Array.isArray(h)) return h; try { return JSON.parse(h); } catch { return null; } };
  return {
    projects: projects.map(p => ({ slug: p.slug, name: p.name, description: p.description || '', hosts: parseHosts(p.hosts) })),
    products: prods.map(p => ({ code: p.code, parent: p.parent || null, owners: Array.isArray(p.owners) ? p.owners : [] })),
    counts: Object.fromEntries(projects.map(p => [p.slug, Number(p.n) || 0])),
    // записи проекта (адреса источника): по общим записям проект без продукта получает предложение группы
    members: Object.fromEntries(projects.map(p => [p.slug, Array.isArray(p.m) ? p.m.map(String) : []])),
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

/**
 * План слияния по принятой таблице: группа → опора (проект с наибольшим числом записей; равенство — по имени),
 * проекты, которые вливаются в опору, и синонимы (все старые slug группы). Строки без группы не трогаются.
 */
export function regroupPlan(rows) {
  const plan = {};
  for (const r of rows) {
    if (!r.to) continue;
    (plan[r.to] ||= []).push(r);
  }
  return Object.fromEntries(Object.entries(plan).map(([g, list]) => {
    const sorted = [...list].sort((a, b) => (b.records - a.records) || a.from.localeCompare(b.from));
    const anchor = sorted[0].from;
    return [g, { anchor, merge: sorted.slice(1).map(x => x.from), aliases: sorted.map(x => x.from), records: list.reduce((a, x) => a + x.records, 0) }];
  }));
}

/**
 * Применить план в приёмнике: связи проектов, которые вливаются, переводятся на опору (повтор той же связи —
 * сливается, считается), хосты объединяются, опора получает синонимы (aliases) и группу (regroup), влитые
 * проекты удаляются. Сверка по каждой группе: множество записей, связанных с проектами группы до, равно
 * множеству записей у опоры после. Источник не трогается.
 */
export async function applyRegroup(db, plan, { log = console.log } = {}) {
  const q = (sql, p) => db.dstQuery(sql, p);
  const c = (sql, p) => db.dstCommand(sql, p);
  await c('CREATE PROPERTY KnowGitProject.aliases IF NOT EXISTS LIST');
  await c('CREATE PROPERTY KnowGitProject.regroup IF NOT EXISTS STRING');
  const ridOf = async slug => (await q('SELECT @rid AS r FROM KnowGitProject WHERE slug = :s', { s: slug }))[0]?.r || null;
  const members = async rid => new Set((await q(`SELECT @rid AS r FROM (SELECT expand(in('BELONGS_TO_PROJECT')) FROM ${rid})`)).map(x => x.r));
  const report = { groups: {}, ok: true };
  for (const [g, p] of Object.entries(plan)) {
    const anchor = await ridOf(p.anchor);
    if (!anchor) { report.groups[g] = { error: `нет опоры ${p.anchor}` }; report.ok = false; continue; }
    const before = new Set(await members(anchor));
    const hosts = [];
    const pushHosts = h => { for (const x of Array.isArray(h) ? h : []) if (x && x.base_url && !hosts.some(y => y.base_url === x.base_url)) hosts.push(x); };
    pushHosts((await q(`SELECT hosts FROM ${anchor}`))[0]?.hosts);
    let moved = 0, merged = 0, missing = [];
    for (const slug of p.merge) {
      const m = await ridOf(slug);
      if (!m) { missing.push(slug); continue; }
      for (const r of await members(m)) before.add(r);
      pushHosts((await q(`SELECT hosts FROM ${m}`))[0]?.hosts);
      const edges = await q(`SELECT FROM (SELECT expand(bothE()) FROM ${m})`);
      for (const e of edges) {
        const t = e['@type'], o = e['@out'] === m ? anchor : e['@out'], i = e['@in'] === m ? anchor : e['@in'];
        const props = Object.fromEntries(Object.entries(e).filter(([k, v]) => !k.startsWith('@') && k !== 'out' && k !== 'in' && v !== null && v !== undefined));
        const same = await q(`SELECT count(*) AS n FROM ${t} WHERE @out = ${o} AND @in = ${i}` + (props.role !== undefined ? ' AND role = :role' : ''), props.role !== undefined ? { role: props.role } : {});
        if (Number(same[0]?.n) > 0) merged++;
        else { await c(`CREATE EDGE ${t} FROM ${o} TO ${i} CONTENT :c`, { c: props }); moved++; }
        await c(`DELETE FROM ${e['@rid']}`);
      }
      await c(`DELETE FROM ${m}`);
    }
    await c(`UPDATE ${anchor} SET aliases = :a, regroup = :g, hosts = :h`, { a: p.aliases, g, h: hosts.length ? hosts : null });
    const after = await members(anchor);
    const lost = [...before].filter(r => !after.has(r)).length;
    const extra = [...after].filter(r => !before.has(r)).length;
    report.groups[g] = { anchor: p.anchor, merged_projects: p.merge.length - missing.length, missing, edges_moved: moved, edges_merged: merged, records_before: before.size, records_after: after.size, lost, extra };
    if (lost || extra || missing.length) report.ok = false;
    log(`группа ${g}: опора ${p.anchor}, влито ${p.merge.length - missing.length}, записей ${before.size} → ${after.size}, связей перенесено ${moved}, слито повторов ${merged}` + (missing.length ? `, нет в приёмнике: ${missing.join(', ')}` : ''));
  }
  log('сверка перегруппировки:', report.ok ? 'сошлась' : 'НЕ сошлась');
  return report;
}
