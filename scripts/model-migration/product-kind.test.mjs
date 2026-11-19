// Владелица 19.11.2026: «продукт · вид — в wizard переноса». Вид продукта (tech | service, ADR-LORE-044) решает
// человек на шаге мастера; перенос только предлагает по данным и не идёт, пока у продукта нет вида.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { proposeProductKinds, productKindMap, withProductKinds, productKindState, applyProductKinds } from './product-kind.mjs';

const projects = [
  { slug: 'NooriUta/volva', hosts: JSON.stringify([{ role: 'primary', base_url: 'https://f/NooriUta/volva' }]) },
  { slug: 'NooriUta/seidr-site', hosts: [{ role: 'primary', base_url: 'https://f/NooriUta/seidr-site' }] },
  { slug: 'AIDA/empty', hosts: null },
];
const products = [
  { code: 'VOLVA', label: 'Völva', owners: ['NooriUta/volva'], components: ['VOLVA_FE', 'VOLVA'] },
  { code: 'HARPA', label: 'HARPA', owners: ['NooriUta/seidr-site'], components: ['HARPA'], serves: [{ code: 'DW', kind: 'sell' }] },
  { code: 'TYR', label: 'TYR', owners: [], components: ['TYR'] },
  { code: 'BACK', label: 'Бэк-офис студии', owners: ['AIDA/empty'] },
  { code: 'SUB', label: 'SUB', parent: 'VOLVA' },
  { code: 'SET', label: 'SET', kind: 'service', owners: ['NooriUta/volva'] },
];
const row = (r, c) => r.find(x => x.code === c);

test('предложение вида: репозиторий — tech, «служит» — service, слова услуги — service, подпродукт — как родитель, иначе «?»', () => {
  const r = proposeProductKinds({ products, projects });
  assert.equal(r.length, products.length, 'строка на каждый продукт');
  assert.deepEqual(row(r, 'VOLVA').suggested, ['tech']);
  assert.match(row(r, 'VOLVA').why, /репозиторий/);
  assert.deepEqual(row(r, 'HARPA').suggested, ['tech', 'service'], 'служит другим продуктам и свой репозиторий — оба');
  assert.match(row(r, 'HARPA').why, /DW \(sell\)/);
  assert.equal(row(r, 'TYR').suggested, '?', 'компоненты без репозитория — вывести нельзя, не выдумываем');
  assert.deepEqual(row(r, 'BACK').suggested, ['service']);
  assert.deepEqual(row(r, 'SUB').suggested, ['tech']);
  assert.match(row(r, 'SUB').why, /родител/);
  assert.deepEqual(row(r, 'SET').suggested, ['service']);
  assert.deepEqual(row(r, 'SET').current, ['service'], 'вид источника виден отдельно');
});

test('решение — раздел product_kind файла решений; прежние решения и остальные разделы не трогаются; негодный вид — отказ', () => {
  const doc = { format: 'mig-decisions/1', decisions: [{ id: 'ST-01' }], projects: { map: { a: 'G' } } };
  let next = withProductKinds(doc, { VOLVA: 'tech' }, 'omiloreadmin', '2026-11-19T12:00:00Z');
  next = withProductKinds(next, { HARPA: 'service' }, 'omiloreadmin', '2026-11-19T12:01:00Z');
  assert.deepEqual(productKindMap(next), { VOLVA: ['tech'], HARPA: ['service'] });
  assert.equal(next.product_kind.by, 'omiloreadmin');
  assert.deepEqual(next.decisions, doc.decisions);
  assert.deepEqual(next.projects, doc.projects);
  assert.throws(() => withProductKinds(doc, { VOLVA: 'mixed' }, 'x'), /недопустим/);
  assert.deepEqual(productKindMap({}), {});
});

test('пока у продукта нет вида — не готово; вид источника засчитывается; решение сильнее источника', () => {
  const s = productKindState(products, { product_kind: { map: { VOLVA: 'tech', SET: 'tech' } } });
  assert.equal(s.ready, false);
  assert.deepEqual(s.missing.sort(), ['BACK', 'HARPA', 'SUB', 'TYR']);
  assert.deepEqual(s.kinds.SET, ['tech']);
  const all = Object.fromEntries(products.map(p => [p.code, 'tech']));
  assert.equal(productKindState(products, { product_kind: { map: all } }).ready, true);
});

test('перенос кладёт вид в запись продукта приёмника; сверка — у всех продуктов вид задан', async () => {
  const rows = products.map(p => ({ code: p.code, kind: null }));
  const db = {
    dstCommand: async (sql, p) => { if (sql.startsWith('UPDATE')) rows.find(x => x.code === p.c).kind = p.k; },
    dstQuery: async () => rows.map(x => ({ ...x })),
  };
  const half = await applyProductKinds(db, products, { product_kind: { map: { VOLVA: 'tech' } } }, { log: () => {} });
  assert.equal(half.ok, false, 'продукты без вида — сверка не сходится');
  const map = Object.fromEntries(products.map(p => [p.code, p.code === 'HARPA' ? 'service' : 'tech']));
  const full = await applyProductKinds(db, products, { product_kind: { map } }, { log: () => {} });
  assert.equal(full.ok, true);
  assert.deepEqual(rows.find(x => x.code === 'HARPA').kind, ['service']);
});

test('мастер: шаг «Вид продукта» — таблица с выбором tech/service, «принять все предложения», запрет переноса без вида', () => {
  const ui = fs.readFileSync(new URL('./ui.mjs', import.meta.url), 'utf8');
  assert.match(ui, /data-step="k"/, 'пункт шага в навигации');
  assert.match(ui, /section data-page="k"/, 'страница шага');
  assert.match(ui, /\/api\/product-kind/, 'данные шага и запись решения');
  assert.match(ui, /Принять все предложения/);
  assert.match(ui, /нет вида у продуктов/, 'перенос не начинается, пока у продукта нет вида');
  const te = fs.readFileSync(new URL('./transfer-edges.mjs', import.meta.url), 'utf8');
  assert.match(te, /applyProductKinds/, 'перенос кладёт вид в приёмник и сверяет');
});

// Решение владелицы 19.11.2026: вид продукта — НАБОР (enum multi): tech, service или оба (DataWanderers — «tech и service»).
// Пусто — нельзя. Старый файл решений со строкой читается как набор из одного значения.
const OWNER = { BRAGI: ['service'], ODIN: ['tech'], MIDGARD: ['tech'], MIGGEN: ['tech'], TYR: ['service'], DW: ['tech', 'service'] };

test('вид — набор: одно или оба значения; строка прежнего файла — набор из одного; пустой набор и чужое значение — отказ', () => {
  const doc = withProductKinds({ format: 'mig-decisions/1', decisions: [] }, OWNER, 'omiloreadmin', '2026-11-19T18:00:00Z');
  assert.deepEqual(productKindMap(doc), OWNER);
  assert.deepEqual(productKindMap({ product_kind: { map: { VOLVA: 'tech', DW: ['service', 'tech', 'tech'] } } }), { VOLVA: ['tech'], DW: ['tech', 'service'] }, 'строка → [строка]; повтор — один раз, порядок tech, service');
  assert.throws(() => withProductKinds(doc, { BRAGI: [] }, 'x'), /пуст/);
  assert.throws(() => withProductKinds(doc, { BRAGI: ['tech', 'mixed'] }, 'x'), /недопустим/);
  const s = productKindState([{ code: 'DW' }, { code: 'BOKVIT' }], doc);
  assert.deepEqual(s.kinds.DW, ['tech', 'service']);
  assert.deepEqual(s.missing, ['BOKVIT'], 'BOKVIT ещё ждёт решения');
});

test('перенос пишет kind списком; сверка — у всех непустой набор, равный решению', async () => {
  const codes = [...Object.keys(OWNER), 'BOKVIT'];
  const rows = codes.map(code => ({ code, kind: null }));
  const ddl = [];
  const db = {
    dstCommand: async (sql, p) => { if (sql.startsWith('UPDATE')) rows.find(x => x.code === p.c).kind = p.k; else ddl.push(sql); },
    dstQuery: async () => rows.map(x => ({ ...x })),
  };
  const prods = codes.map(code => ({ code }));
  const r1 = await applyProductKinds(db, prods, { product_kind: { map: OWNER } }, { log: () => {} });
  assert.equal(r1.ok, false, 'BOKVIT без вида — сверка не сходится');
  assert.ok(ddl.some(s => /KnowDictEntry\.kind .*LIST/.test(s)), 'поле kind — список');
  assert.deepEqual(rows.find(x => x.code === 'DW').kind, ['tech', 'service']);
  const r2 = await applyProductKinds(db, prods, { product_kind: { map: { ...OWNER, BOKVIT: ['tech'] } } }, { log: () => {} });
  assert.equal(r2.ok, true);
  rows.find(x => x.code === 'DW').kind = ['tech'];
  db.dstCommand = async () => {};
  assert.equal((await applyProductKinds(db, prods, { product_kind: { map: { ...OWNER, BOKVIT: ['tech'] } } }, { log: () => {} })).ok, false, 'набор в базе не равен решению');
});

test('предложение — набор: служит другим продуктам и есть свой репозиторий — оба вида', () => {
  const r = proposeProductKinds({ products: [{ code: 'H', owners: ['NooriUta/seidr-site'], serves: [{ code: 'DW', kind: 'sell' }] }], projects });
  assert.deepEqual(r[0].suggested, ['tech', 'service']);
  assert.deepEqual(proposeProductKinds({ products: [{ code: 'T', components: ['T'] }] })[0].suggested, '?');
});

test('пример файла решений: ответы владелицы по виду продукта, BOKVIT — ещё нет; файл годен', async () => {
  const { checkDecisions } = await import('./decisions.mjs');
  const doc = JSON.parse(fs.readFileSync(new URL('./rules/decisions.lore.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkDecisions(doc), []);
  const m = productKindMap(doc);
  for (const [k, v] of Object.entries(OWNER)) assert.deepEqual(m[k], v, k);
  assert.equal(m.BOKVIT, undefined);
});

test('мастер: две галочки tech и service вместо одного выбора', () => {
  const ui = fs.readFileSync(new URL('./ui.mjs', import.meta.url), 'utf8');
  assert.match(ui, /type="checkbox"[^>]*data-pk=/);
  assert.doesNotMatch(ui, /type="radio" name="pk-/);
});
