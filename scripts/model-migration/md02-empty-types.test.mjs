// SPRINT_LORE_MODEL_DOCS_TIDY/MD-02 · 8а — пустые типы (0 записей в источнике).
// Владелица 19.11.2026: «по коду восстанови и по данным что выбрать»; «функции оставить, алгоритмами и здравым смыслом
// подобрать типы»; «поискать в спеках». Правило:
//   • пустой тип, который трогает код сервера, — в схеме 1.18 без данных («только схема»);
//   • пустой и не используемый кодом — не создаётся, причина «пустой и не используется кодом»;
//   • свойства: старая схема → спека → вывод из кода → мягкий тип; даты не переводятся, где код пишет строку;
//   • индексы — из старой схемы (DDL шагов V в коде);
//   • сторож «тип, который трогает код, — в модели 1.18 или вне модели с причиной» один: OutsideModelTypesGuardTest (бэкенд),
//     список — ModelSchemaAdapter.OUTSIDE_MODEL; разбор кода тот же, что здесь (code-types.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { proposeMap, SCHEMA_ONLY_WHY, EMPTY_UNUSED_WHY, CODE_FIELDS } from './propose-map-all.mjs';
import { schemaOnlyType } from './propose-schema-all.mjs';
import { codeTypes, declaredDdl, codeWrittenFields, LORE_JAVA } from './code-types.mjs';
import { structurePlan } from './structure-plan.mjs';
import { MAP, SCHEMA, EDGES, NOT_MOVED } from './resources.mjs';
import census from './tools/census/fields-all.json' with { type: 'json' };
import allObjects from './map/all-objects.json' with { type: 'json' };

const JAVA = fileURLToPath(LORE_JAVA);
const NAMES = new Set(Object.keys(census));
const USED = codeTypes(JAVA, NAMES);
const DDL = declaredDdl(JAVA);
const EMPTY = Object.keys(census).filter(T => census[T].total === 0).sort();
const ELEVEN = ['KnowCanvas', 'KnowCanvasItem', 'KnowCanvasLink', 'KnowFindingHist', 'KnowSavedView', 'KnowUserFavorite',
  'KnowUserHabit', 'KnowUserMemoryPref', 'KnowUserRecent', 'LoreRefDismissal', 'QGMetric'];

test('8а: пустые по переписи — те 11, и все их трогает код сервера (положительный контроль сканера)', () => {
  assert.deepEqual(EMPTY, ELEVEN);
  for (const T of ELEVEN) assert.ok(USED.has(T), T + ': код сервера трогает тип');
  assert.ok(!USED.has('FROM') && !USED.has('SET'), 'служебные слова SQL — не типы');
});

test('8а: генератор — пустой тип, который трогает код, только схема; не используемый — не создаётся', () => {
  const c = { KnowA: { total: 0, fields: [{ name: 'a_at', declared: 'STRING', filled: 0 }] }, KnowB: { total: 0, fields: [{ name: 'x', declared: 'STRING', filled: 0 }] }, KnowC: { total: 2, fields: [{ name: 'y', declared: 'STRING', filled: 2 }] } };
  const m = proposeMap(c, { codeTypes: new Set(['KnowA', 'KnowC']) });
  assert.deepEqual(Object.keys(m.types), ['KnowA', 'KnowC']);
  assert.equal(m.schema_only.KnowA, SCHEMA_ONLY_WHY);
  assert.match(SCHEMA_ONLY_WHY, /19\.11/);
  assert.match(SCHEMA_ONLY_WHY, /код/);
  assert.equal(m.skipped.KnowB, EMPTY_UNUSED_WHY);
  assert.match(EMPTY_UNUSED_WHY, /не используется кодом/);
  // дата строкой старой схемы не переводится: у типа «только схема» поле — как есть
  assert.equal(m.types.KnowA.a_at.rule, 'keep');
  // без сведений о коде пустой тип не выбрасывается (функцию не теряем по незнанию)
  assert.ok(proposeMap(c).types.KnowB);
});

test('8а: карта переснята по переписи и коду — 11 пустых типов в карте «только схема», ни один не выброшен', () => {
  assert.equal(JSON.stringify(proposeMap(census, { codeTypes: new Set(USED.keys()) })), JSON.stringify(allObjects), 'карта = вывод генератора');
  for (const T of ELEVEN) {
    assert.ok(MAP[T], T + ': в карте');
    assert.ok(allObjects.schema_only[T], T + ': помечен «только схема»');
    assert.ok(!NOT_MOVED[T], T + ': не в «не переносится»');
  }
});

test('8а: схема 1.18 — каждый из 11 типов со свойствами старой схемы (типы прежние) и её индексами', () => {
  for (const T of ELEVEN) {
    const s = SCHEMA[T];
    assert.ok(s, T + ': в схеме 1.18');
    assert.equal(s.records, 0);
    assert.equal(s.schema_only, true);
    for (const f of census[T].fields) {
      assert.equal(s.fields[f.name].db_type, f.declared, `${T}.${f.name}: тип старой схемы`);
      assert.equal(s.fields[f.name].source, 'старая схема');
    }
    for (const ix of (DDL[T] || {}).indexes || []) assert.ok(s.indexes.some(x => JSON.stringify(x.fields) === JSON.stringify(ix.fields) && x.kind === ix.kind), `${T}: индекс ${ix.fields} ${ix.kind}`);
    assert.deepEqual(s, schemaOnlyType(T, MAP[T], census[T], DDL[T]), T + ': схема = вывод генератора');
  }
  // даты, которые код пишет строкой, — строкой (не DATETIME)
  assert.equal(SCHEMA.KnowCanvas.fields.created_at.db_type, 'STRING');
  assert.equal(SCHEMA.KnowSavedView.fields.updated_at.db_type, 'STRING');
  assert.equal(SCHEMA.KnowFindingHist.fields.valid_from.db_type, 'DATETIME', 'а где старая схема — DATETIME, там DATETIME');
  // UPSERT по ключу требует уникального индекса — он есть
  for (const [T, f] of [['KnowUserMemoryPref', ['owner_sub']], ['QGMetric', ['metric_id']], ['LoreRefDismissal', ['dismissal_key']]])
    assert.ok(SCHEMA[T].indexes.some(x => x.kind === 'UNIQUE' && JSON.stringify(x.fields) === JSON.stringify(f)), T);
});

test('8а: свойство, которое пишет код, но старая схема не задаёт, — с типом и источником (спека / вывод из кода / мягкий)', () => {
  const written = codeWrittenFields(JAVA, ELEVEN);
  for (const T of ELEVEN) {
    const decl = new Set(census[T].fields.map(f => f.name));
    for (const f of written[T] || []) {
      if (decl.has(f)) continue;
      const s = SCHEMA[T].fields[f];
      assert.ok(s, `${T}.${f}: код пишет — в схеме`);
      assert.ok(CODE_FIELDS[T] && CODE_FIELDS[T][f], `${T}.${f}: в CODE_FIELDS с типом и источником`);
      assert.match(s.source, /^(спека |выведено из кода: |по умолчанию \(неоднозначно\))/, `${T}.${f}: источник`);
    }
  }
  assert.deepEqual(Object.keys(CODE_FIELDS).sort(), ['KnowCanvasLink', 'QGMetric']);
  assert.equal(SCHEMA.KnowCanvasLink.fields.graph_state.db_type, 'STRING');
  assert.equal(SCHEMA.QGMetric.fields.name.db_type, 'STRING');
  assert.match(SCHEMA.QGMetric.fields.threshold.source, /LORE_SCHEMA_V12_NEW_TYPES/);
});

test('8а: пустые связи, которые пишет код (MEASURED_BY, MACHINE_ACCESS, SOURCED_FROM), — в схеме 1.18 со свойствами старой схемы', () => {
  for (const E of ['MEASURED_BY', 'MACHINE_ACCESS', 'SOURCED_FROM']) {
    assert.ok(USED.has(E), E + ': код пишет');
    assert.equal(EDGES[E].rule, 'keep');
    assert.equal(EDGES[E].schema_only, true, E + ': только схема');
  }
  assert.deepEqual(EDGES.MACHINE_ACCESS.props, { role: 'STRING', projects: 'LIST', harnesses: 'LIST', granted_by: 'STRING', granted_at: 'STRING' });
  assert.deepEqual(EDGES.SOURCED_FROM.props, { at: 'STRING', via: 'STRING' });
});

test('8а: перенос связей заводит пустую связь «только схема» со свойствами старой схемы; связь с данными — своим путём', async () => {
  const { schemaOnlyEdgeDdl } = await import('./edge-plan.mjs');
  const ddl = schemaOnlyEdgeDdl(EDGES, new Set(['SOURCED_FROM']));
  assert.ok(ddl.includes('CREATE EDGE TYPE MACHINE_ACCESS IF NOT EXISTS'));
  assert.ok(ddl.includes('CREATE PROPERTY MACHINE_ACCESS.`projects` IF NOT EXISTS LIST'));
  assert.ok(ddl.includes('CREATE EDGE TYPE MEASURED_BY IF NOT EXISTS'));
  assert.ok(!ddl.some(s => /SOURCED_FROM/.test(s)), 'вид, уже заведённый записью данных, не трогается');
});

test('правило: в SQL кода нет параметра :by — BY ключевое слово ArcadeDB, запись падает «mismatched input»', async () => {
  // Найдено 19.11.2026 пробой записи в LoreRefDismissal (EmptyTypesSchemaOnlyWriteTest): «UPDATE … created_by = :by …» —
  // 400 на разборе; та же ловушка уже чинилась точечно (LoreUserResource, LoreNewsReadMarkStore, MachineActivity, CI 11.11).
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { sqlText } = await import('./code-types.mjs');
  const bad = [];
  for (const f of fs.readdirSync(JAVA).filter(x => x.endsWith('.java')))
    for (const m of sqlText(fs.readFileSync(path.join(JAVA, f), 'utf8')).matchAll(/"((?:[^"\\\n]|\\.)*)"/g))
      if (/(=|,|\(|\bIN|\bSET)\s*:by\b/i.test(m[1])) bad.push(f + ': ' + m[1].slice(0, 120));
  assert.deepEqual(bad, []);
});

test('8а: установщик не выбрасывает тип вне карты по пустоте — тип без данных, но со структурой источника, заводится', () => {
  const plan = structurePlan([{ name: 'MetricSnapshot', type: 'document', records: 0, properties: [{ name: 'a', type: 'STRING' }], indexes: [] }], {}, {});
  assert.deepEqual(plan.types.map(t => t.name), ['MetricSnapshot']);
});
