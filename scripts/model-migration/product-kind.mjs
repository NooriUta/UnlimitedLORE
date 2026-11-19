// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Вид продукта (product.kind) — решение человека на шаге мастера переноса.
// Владелица 19.11.2026: «продукт · вид — в wizard переноса». Вид по ADR-LORE-044 (D-2026-LORE-PRODUCT-KINDS-TECH-SERVICE):
// tech — технологический, service — сервисно-организационный (от него git не требуется). Перенос вид не выбирает:
// он только предлагает по данным, решает человек; пока у продукта нет вида, перенос не начинается.
//
// Вид — НАБОР (решение владелицы 19.11.2026, enum multi): tech, service или оба (DataWanderers — «tech и service»);
// пустой набор недопустим.
// Правило предложения (доводы показываются в мастере):
//   1) вид уже задан в источнике — он и остаётся;
//   2) признаки service: продукт служит другим продуктам (связь SERVES: продаёт, считает…) или в названии слова
//      услуги/бэк-офиса (продажи, учёт, поддержка, backoffice…); признак tech — у проекта-владельца есть адрес
//      репозитория; есть оба — предлагается набор из обоих;
//   3) подпродукт без своих признаков — как у родителя;
//   4) иначе — «?» (компоненты без репозитория — довод слабый: компоненты есть у всех продуктов).
// Решение — раздел файла решений: product_kind: { map: { КОД: ['tech'] | ['service'] | ['tech','service'] }, by, at }.
// Прежний файл со строкой ('tech') читается как набор из одного значения.

export const KINDS = ['tech', 'service'];
const SERVICE_WORDS = /back-?office|бэк-?офис|услуг|продаж|sales|учёт|учет|бухгалт|маркетинг|marketing|поддержк|support|консалт|consult|обучени/i;

/** Набор вида: строка или список → список без повторов в порядке KINDS; чужое значение — null (набор негоден). */
export function kindSet(v) {
  const list = Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);
  if (list.some(x => !KINDS.includes(x))) return null;
  return KINDS.filter(k => list.includes(k));
}
const valid = v => { const s = kindSet(v); return s && s.length ? s : null; };
const same = (a, b) => JSON.stringify(kindSet(a)) === JSON.stringify(kindSet(b));

const hasRepo = p => {
  let h = p && p.hosts;
  if (typeof h === 'string') { try { h = JSON.parse(h); } catch { h = null; } }
  return Array.isArray(h) && h.some(x => x && typeof x.base_url === 'string' && x.base_url.trim());
};

/**
 * Предложение вида по данным источника.
 * @param {{ products: {code:string,label?:string,kind?:string|null,parent?:string|null,owners?:string[],components?:string[],serves?:{code:string,kind?:string}[]}[],
 *           projects?: {slug:string,hosts?:any}[] }} input
 * @returns {{code,label,current,suggested:'tech'|'service'|'?',why:string}[]}
 */
export function proposeProductKinds({ products, projects = [] }) {
  const bySlug = new Map(projects.map(p => [p.slug, p]));
  const byCode = new Map(products.map(p => [p.code, p]));
  const own = p => {
    if (valid(p.kind)) return { suggested: valid(p.kind), why: 'вид уже задан в источнике' };
    const why = [], set = [];
    const repos = (p.owners || []).filter(s => hasRepo(bySlug.get(s)));
    if (repos.length) { set.push('tech'); why.push(`tech: репозиторий у проекта-владельца ${repos.join(', ')}` + ((p.components || []).length ? `, компонентов ${p.components.length}` : '')); }
    const serves = (p.serves || []).filter(s => s && s.code);
    const w = SERVICE_WORDS.exec(`${p.code} ${p.label || ''}`);
    if (serves.length || w) {
      set.push('service');
      why.push('service: ' + [serves.length ? `служит продуктам ${serves.map(s => s.code + (s.kind ? ' (' + s.kind + ')' : '')).join(', ')}` : null, w ? `в названии «${w[0]}» — услуга` : null].filter(Boolean).join('; '));
    }
    return set.length ? { suggested: KINDS.filter(k => set.includes(k)), why: why.join(' · ') } : null;
  };
  return products.map(p => {
    let r = own(p);
    if (!r && p.parent) {
      const seen = new Set([p.code]); let c = p.parent, pr = null;
      while (c && !seen.has(c) && byCode.has(c)) { seen.add(c); pr = own(byCode.get(c)); if (pr) break; c = byCode.get(c).parent; }
      if (pr) r = { suggested: pr.suggested, why: `подпродукт ${p.parent} — как у родителя ${c}: ${pr.why}` };
    }
    if (!r) r = { suggested: '?', why: (p.components || []).length ? `компоненты есть (${p.components.length}), репозитория и связи «служит» нет — вывести нельзя` : 'ни репозитория, ни компонентов, ни связи «служит» — вывести нельзя' };
    return { code: p.code, label: p.label || p.code, current: valid(p.kind), ...r };
  });
}

/** Решения человека из файла решений: { КОД: ['tech'|'service', …] }; строка — набор из одного; негодный набор отбрасывается. */
export function productKindMap(doc) {
  const m = doc && doc.product_kind && typeof doc.product_kind === 'object' ? doc.product_kind.map || {} : {};
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, valid(v)]).filter(([, v]) => v));
}

/** Записать решения в документ: прежние сохраняются, кто и когда — рядом. Негодный вид — отказ. */
export function withProductKinds(doc, map, by, at = new Date().toISOString()) {
  const next = { ...productKindMap(doc) };
  for (const [k, v] of Object.entries(map || {})) {
    const set = kindSet(v);
    if (!set) throw new Error(`вид продукта ${k} «${v}» недопустим, есть: ${KINDS.join(', ')}`);
    if (!set.length) throw new Error(`вид продукта ${k}: набор пуст — нужен tech, service или оба`);
    next[k] = set;
  }
  return { ...doc, product_kind: { map: next, by: by || null, at } };
}

/** Итог вида: решение человека, иначе вид источника. Продукты без вида — `missing`; пока он не пуст, перенос не идёт. */
export function productKindState(products, doc) {
  const m = productKindMap(doc);
  const kinds = {}, missing = [];
  for (const p of products) {
    const k = m[p.code] || valid(p.kind);
    if (k) kinds[p.code] = k; else missing.push(p.code);
  }
  return { kinds, missing, ready: missing.length === 0 };
}

/** Данные из источника (только чтение): продукты словаря product и адреса проектов. */
export async function readProductKindInput(db) {
  const prods = await db.src("SELECT code, label_ru, label_en, kind, out('PARENT_PRODUCT').code[0] AS parent, outE('BELONGS_TO_PROJECT')[role = 'owner'].inV().slug AS owners, in('IN_PRODUCT').component_id AS components, out('SERVES').code AS serves_codes, outE('SERVES').kind AS serves_kinds FROM KnowDictEntry WHERE dict_type = 'product' ORDER BY code");
  const projects = await db.src('SELECT slug, hosts FROM KnowGitProject');
  const list = v => (Array.isArray(v) ? v : []);
  return {
    products: prods.map(p => ({
      code: p.code, label: p.label_ru || p.label_en || p.code, kind: p.kind || null, parent: p.parent || null,
      owners: list(p.owners), components: list(p.components).filter(Boolean),
      serves: list(p.serves_codes).map((c, i) => ({ code: c, kind: list(p.serves_kinds)[i] || null })),
    })),
    projects: projects.map(p => ({ slug: p.slug, hosts: p.hosts })),
  };
}

/**
 * Положить вид в записи продуктов приёмника (KnowDictEntry, dict_type = 'product'). Сверка: у каждого продукта
 * приёмника вид задан и равен решению. Продукт без вида — сверка не сходится (молча не пропускается).
 */
export async function applyProductKinds(db, products, doc, { log = console.log } = {}) {
  const { kinds, missing } = productKindState(products, doc);
  // product.kind — enum multi (решение владелицы 19.11.2026): в записи список кодов
  await db.dstCommand('CREATE PROPERTY KnowDictEntry.kind IF NOT EXISTS LIST');
  for (const [code, kind] of Object.entries(kinds)) await db.dstCommand("UPDATE KnowDictEntry SET kind = :k WHERE dict_type = 'product' AND code = :c", { k: kind, c: code });
  const got = await db.dstQuery("SELECT code, kind FROM KnowDictEntry WHERE dict_type = 'product'");
  const empty = got.filter(x => !valid(x.kind)).map(x => x.code);
  const wrong = got.filter(x => kinds[x.code] && valid(x.kind) && !same(x.kind, kinds[x.code])).map(x => x.code);
  const ok = !missing.length && !empty.length && !wrong.length;
  const n = k => got.filter(x => same(x.kind, k)).length;
  log(`вид продукта: tech ${n(['tech'])}, service ${n(['service'])}, tech + service ${n(KINDS)}, без вида ${empty.length}${empty.length ? ' (' + empty.join(', ') + ')' : ''}` + (wrong.length ? `, не совпал с решением: ${wrong.join(', ')}` : ''));
  log('сверка вида продуктов:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, products: got.length, kinds, missing, empty, wrong };
}
