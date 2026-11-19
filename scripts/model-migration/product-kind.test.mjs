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
  assert.equal(row(r, 'VOLVA').suggested, 'tech');
  assert.match(row(r, 'VOLVA').why, /репозиторий/);
  assert.equal(row(r, 'HARPA').suggested, 'service', 'служит другим продуктам — сильнее своего репозитория');
  assert.match(row(r, 'HARPA').why, /DW \(sell\)/);
  assert.equal(row(r, 'TYR').suggested, '?', 'компоненты без репозитория — вывести нельзя, не выдумываем');
  assert.equal(row(r, 'BACK').suggested, 'service');
  assert.equal(row(r, 'SUB').suggested, 'tech');
  assert.match(row(r, 'SUB').why, /родител/);
  assert.equal(row(r, 'SET').suggested, 'service');
  assert.equal(row(r, 'SET').current, 'service', 'вид источника виден отдельно');
});

test('решение — раздел product_kind файла решений; прежние решения и остальные разделы не трогаются; негодный вид — отказ', () => {
  const doc = { format: 'mig-decisions/1', decisions: [{ id: 'ST-01' }], projects: { map: { a: 'G' } } };
  let next = withProductKinds(doc, { VOLVA: 'tech' }, 'omiloreadmin', '2026-11-19T12:00:00Z');
  next = withProductKinds(next, { HARPA: 'service' }, 'omiloreadmin', '2026-11-19T12:01:00Z');
  assert.deepEqual(productKindMap(next), { VOLVA: 'tech', HARPA: 'service' });
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
  assert.equal(s.kinds.SET, 'tech');
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
  assert.equal(rows.find(x => x.code === 'HARPA').kind, 'service');
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
