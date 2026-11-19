// Владелица 19.11.2026: «проекты нужно схлопнуть», «сделай отдельное меню с предложением перегруппировки в
// инсталляции». Предложение строится из данных установки: проект = продукт верхнего уровня (подпродукт — в родителе),
// дубли одного репозитория — в один; правка человека сильнее предложения; без продукта — честное «куда?».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRegroup } from './regroup.mjs';

const P = (slug, base) => ({ slug, name: slug, hosts: base ? [{ role: 'primary', base_url: base }] : null });
const projects = [
  P('AIDA/MIDGARD', 'https://f/AIDA/MIDGARD'), P('AIDA/GLADSHEIM', 'https://f/AIDA/GLADSHEIM'), P('AIDA/BOKVIT', 'https://f/AIDA/BOKVIT'),
  P('AIDA/udwe-mig-gen', 'https://f/AIDA/udwe-mig-gen'), P('ciadmin/udwe-mig-gen', 'https://f/AIDA/udwe-mig-gen'),
  P('AIDA/studio', null), P('NooriUta/BRAGI', null),
];
const products = [
  { code: 'MIDGARD', parent: null, owners: ['AIDA/MIDGARD', 'AIDA/GLADSHEIM'] },
  { code: 'BOKVIT', parent: 'MIDGARD', owners: ['AIDA/BOKVIT'] },
  { code: 'MIGGEN', parent: null, owners: ['AIDA/udwe-mig-gen'] },
  { code: 'BRAGI', parent: null, owners: ['NooriUta/BRAGI'] },
];
const counts = { 'AIDA/MIDGARD': 380, 'AIDA/GLADSHEIM': 87, 'AIDA/BOKVIT': 5, 'AIDA/udwe-mig-gen': 31, 'ciadmin/udwe-mig-gen': 14, 'AIDA/studio': 10, 'NooriUta/BRAGI': 21 };
const row = (r, slug) => r.rows.find(x => x.from === slug);

test('проект = продукт верхнего уровня; подпродукт — в родителе', () => {
  const r = proposeRegroup({ projects, products, counts });
  assert.equal(row(r, 'AIDA/MIDGARD').to, 'MIDGARD');
  assert.equal(row(r, 'AIDA/GLADSHEIM').to, 'MIDGARD');
  assert.equal(row(r, 'AIDA/BOKVIT').to, 'MIDGARD');
  assert.match(row(r, 'AIDA/BOKVIT').why, /подпродукт/);
});

test('дубль того же основного репозитория — в ту же группу', () => {
  const r = proposeRegroup({ projects, products, counts });
  assert.equal(row(r, 'ciadmin/udwe-mig-gen').to, 'MIGGEN');
  assert.match(row(r, 'ciadmin/udwe-mig-gen').why, /тот же репозиторий/);
});

test('без продукта — честное «куда?», не выдуманная группа', () => {
  const r = proposeRegroup({ projects, products, counts });
  assert.equal(row(r, 'AIDA/studio').to, null);
  assert.ok(r.unassigned.includes('AIDA/studio'));
});

test('правка человека сильнее предложения', () => {
  const r = proposeRegroup({ projects, products, counts, overrides: { 'NooriUta/BRAGI': 'SEIDR_BACKOFFICE', 'AIDA/studio': 'SEIDR_BACKOFFICE' } });
  assert.equal(row(r, 'NooriUta/BRAGI').to, 'SEIDR_BACKOFFICE');
  assert.equal(row(r, 'NooriUta/BRAGI').why, 'решение человека');
  assert.equal(r.unassigned.length, 0);
});

test('сводка по группам: записей до = записей после', () => {
  const r = proposeRegroup({ projects, products, counts });
  assert.equal(r.groups.MIDGARD.records, 380 + 87 + 5);
  assert.deepEqual(r.groups.MIDGARD.from.sort(), ['AIDA/BOKVIT', 'AIDA/GLADSHEIM', 'AIDA/MIDGARD']);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const placed = Object.values(r.groups).reduce((a, g) => a + g.records, 0) + r.unassigned.reduce((a, s) => a + counts[s], 0);
  assert.equal(placed, total);
});

import { regroupOverrides, withRegroupOverrides } from './regroup.mjs';
test('правки перегруппировки живут в файле решений и не трогают остальные решения', () => {
  const doc = { format: 'mig-decisions/1', decisions: [{ id: 'x' }] };
  const next = withRegroupOverrides(doc, { 'NooriUta/BRAGI': 'SEIDR_BACKOFFICE', 'AIDA/studio': '' }, 'omiloreadmin', '2026-11-19T12:00:00Z');
  assert.deepEqual(next.decisions, doc.decisions);
  assert.deepEqual(regroupOverrides(next), { 'NooriUta/BRAGI': 'SEIDR_BACKOFFICE', 'AIDA/studio': null });
  assert.equal(next.projects.by, 'omiloreadmin');
  assert.deepEqual(regroupOverrides({}), {});
});

import { regroupPlan } from './regroup.mjs';
test('план слияния: опора — проект с наибольшим числом записей, остальные — в неё; без группы и одиночки — не трогаем', () => {
  const rows = [
    { from: 'AIDA/MIDGARD', records: 380, to: 'MIDGARD' }, { from: 'AIDA/GLADSHEIM', records: 87, to: 'MIDGARD' },
    { from: 'AIDA/BOKVIT', records: 5, to: 'MIDGARD' }, { from: 'NooriUta/volva', records: 138, to: 'VOLVA' },
    { from: 'AIDA/studio', records: 10, to: null },
  ];
  const p = regroupPlan(rows);
  assert.deepEqual(p.MIDGARD, { anchor: 'AIDA/MIDGARD', merge: ['AIDA/GLADSHEIM', 'AIDA/BOKVIT'], aliases: ['AIDA/MIDGARD', 'AIDA/GLADSHEIM', 'AIDA/BOKVIT'], records: 472 });
  assert.deepEqual(p.VOLVA, { anchor: 'NooriUta/volva', merge: [], aliases: ['NooriUta/volva'], records: 138 });
  assert.equal(p[null], undefined);
});
