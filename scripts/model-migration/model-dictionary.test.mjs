// SPRINT_LORE_MODEL_DOCS_TIDY/MD-01 · словарь типов, полей и рёбер — генерируется из модели 1.18 и кода, не пишется руками.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDictionary, scanCode, classifyLine, transferOfType } from './model-dictionary.mjs';
import loreModel from '../../shared/model/lore-model.json' with { type: 'json' };
import edgesMap from './map/all.edges.json' with { type: 'json' };
import objectsMap from './map/all-objects.json' with { type: 'json' };

const triples = [['BELONGS_TO', 'KnowADR', 'LoreComponent', '435'], ['PART_OF', 'KnowTask', 'KnowSprint', '10']];
const code = scanCode([
  { path: 'backend/A.java', text: 'db.command("sql", "CREATE EDGE PART_OF FROM :t TO :s");\nString q = "SELECT FROM KnowSprint";' },
  { path: 'backend/LoreSlices.java', text: 'String s = "SELECT expand(in(\'PART_OF\')) FROM KnowSprint";' },
  { path: 'mcp-server/src/tools/w.ts', text: "await sql(`INSERT INTO KnowSprint CONTENT :c`)" },
]);
const dict = () => buildDictionary({ model: loreModel, edgesMap, objectsMap, triples, code, source: 'тест' });

test('классификация строки кода: запись — CREATE EDGE / INSERT / UPDATE / CREATE VERTEX, иначе чтение', () => {
  assert.equal(classifyLine('CREATE EDGE PART_OF FROM', 'PART_OF'), 'write');
  assert.equal(classifyLine('INSERT INTO KnowSprint CONTENT', 'KnowSprint'), 'write');
  assert.equal(classifyLine('UPDATE KnowSprint SET x = 1', 'KnowSprint'), 'write');
  assert.equal(classifyLine("SELECT expand(in('PART_OF'))", 'PART_OF'), 'read');
  assert.equal(classifyLine('CREATE EDGE TYPE PART_OF IF NOT EXISTS', 'PART_OF'), 'schema');
  assert.equal(classifyLine('KnowSprintHist', 'KnowSprint'), null, 'имя внутри другого имени — не упоминание');
});

test('каждый тип паспорта и каждое его поле есть в словаре; у поля — назначение, кто пишет, кто читает, паспорт', () => {
  const d = dict();
  for (const t of [...loreModel.types, ...loreModel.child_only]) {
    const entry = d.types.find(x => x.type === t.type && x.childOnly === !!loreModel.child_only.includes(t));
    assert.ok(entry, 'тип ' + t.type);
    for (const f of entry.fields) {
      for (const col of ['purpose', 'writer', 'reader', 'passport']) assert.ok(f[col], `${t.type}.${f.key}: ${col}`);
    }
    assert.ok(entry.fields.length > 0, 'поля у ' + t.type);
  }
});

test('назначение без определения в модели — честно «не записано», а не выдумано', () => {
  const d = dict();
  const noDef = d.types.flatMap(t => t.fields).filter(f => f.purpose.startsWith('—'));
  assert.ok(noDef.length > 0);
  for (const f of noDef) assert.match(f.purpose, /не записано/);
});

test('каждый вид связи карты переноса и модели — в словаре, с парами концов из переписи и правилом переноса', () => {
  const d = dict();
  const names = new Set(d.edges.map(e => e.name));
  for (const e of Object.keys(edgesMap.edges)) assert.ok(names.has(e), 'связь ' + e);
  const po = d.edges.find(e => e.name === 'PART_OF');
  assert.deepEqual(po.ends, ['KnowTask → KnowSprint (10)']);
  assert.deepEqual(po.writers, ['A.java']);
  assert.deepEqual(po.readers, ['LoreSlices.java']);
  assert.match(po.transfer, /keep/);
  assert.equal(d.edges.find(e => e.name === 'HAS_PR').transfer.startsWith('drop'), true);
});

test('типы вне паспорта (служебные, QG, BRAGI) — тоже в словаре, с судьбой при переносе', () => {
  const d = dict();
  const others = new Set(d.others.map(o => o.vertex));
  for (const T of Object.keys(objectsMap.types)) if (!d.types.some(t => t.vertex === T || t.hist === T)) assert.ok(others.has(T), T);
  for (const T of Object.keys(objectsMap.skipped)) assert.ok(others.has(T), 'не переносится: ' + T);
  const ks = d.types.find(t => t.vertex === 'KnowSprint');
  assert.deepEqual(ks.writers, ['w.ts']);
});

test('выход детерминирован и делится на страницы: обзор, поля, связи, типы вне паспорта', () => {
  const a = dict(), b = dict();
  assert.equal(JSON.stringify(a.pages), JSON.stringify(b.pages));
  const ids = a.pages.map(p => p.doc_id);
  assert.equal(ids[0], 'lore_model_dictionary');
  assert.ok(ids.includes('lore_model_dictionary_edges'));
  assert.ok(ids.includes('lore_model_dictionary_other_types'));
  for (const p of a.pages) {
    assert.ok(p.title && p.md.length > 100, p.doc_id);
    assert.ok(Buffer.byteLength(p.md) < 95000, p.doc_id + ' меньше 95 КБ');
  }
});

test('судьба типа: первый объект — своей картой, новый тип модели без карты — так и сказано', () => {
  assert.match(transferOfType('KnowSprint', objectsMap), /первый объект/);
  assert.match(transferOfType('KnowRepository', objectsMap), /в карте переноса нет/);
  assert.match(transferOfType('PlanTrack', objectsMap), /не переносится/);
  assert.equal(transferOfType('KnowADR', objectsMap), 'переносится по карте');
});
