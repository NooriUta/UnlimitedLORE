// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Одна связь «зависит от» при переносе.
// DEPENDS_ON переносится как есть (карта: keep, свойства kind и reason), историчная по модели — получает
// valid_from; вид сверяется со справочником dependency_kind (как у спринтов: hard, soft, gate, informs).
// Сверка «было → стало» по каждому виду и каждой паре концов: потерь 0, неизвестный вид — не молча.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEP_EDGE, depKindCodes, classifyDepKind, countDeps, compareDeps } from './depends-on.mjs';
import { isHistoric, edgeHistoryDdl } from './edge-history.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./rules/status-unification.json', import.meta.url), 'utf8'));
const EDGES = JSON.parse(fs.readFileSync(new URL('./map/all.edges.json', import.meta.url), 'utf8')).edges;

test('справочник видов зависимости — как у спринтов, строчными, с подписями на трёх языках', () => {
  const d = RULES.dictionaries.dependency_kind;
  assert.ok(d, 'справочник dependency_kind заведён в правилах');
  assert.equal(d.kind, 'other');
  assert.deepEqual(depKindCodes(RULES), ['hard', 'soft', 'gate', 'informs']);
  for (const c of d.codes) for (const lang of RULES.languages) assert.ok(c.labels[lang] && c.labels[lang].trim(), `${c.code}: подпись ${lang}`);
});

test('DEPENDS_ON — историчная связь модели: перенос даёт ей valid_from / valid_to', () => {
  assert.equal(DEP_EDGE, 'DEPENDS_ON');
  assert.ok(isHistoric('DEPENDS_ON'));
  assert.deepEqual(edgeHistoryDdl('DEPENDS_ON'), ['CREATE PROPERTY DEPENDS_ON.valid_from DATETIME', 'CREATE PROPERTY DEPENDS_ON.valid_to DATETIME']);
  assert.equal(EDGES.DEPENDS_ON.rule, 'keep', 'связь переносится как есть — вид и причина в её свойствах');
  assert.deepEqual(EDGES.DEPENDS_ON.props, ['kind', 'reason']);
});

test('разбор вида: известный, без вида, другой регистр, неизвестный', () => {
  assert.deepEqual(classifyDepKind('hard', RULES), { kind: 'known', code: 'hard' });
  assert.deepEqual(classifyDepKind(' Gate ', RULES), { kind: 'normalized', code: 'gate' });
  assert.deepEqual(classifyDepKind(null, RULES), { kind: 'empty', code: null });
  assert.deepEqual(classifyDepKind('', RULES), { kind: 'empty', code: null });
  assert.deepEqual(classifyDepKind('blocker', RULES), { kind: 'unknown', code: null });
});

// Прод 16.11.2026 (заметка задачи): DEPENDS_ON спринт → спринт 117 — hard 42, soft 30, gate 9, informs 6, пусто 30;
// ADR → ADR 311 (вида у ADR нет).
const sprintRows = [
  ...Array(42).fill('hard'), ...Array(30).fill('soft'), ...Array(9).fill('gate'), ...Array(6).fill('informs'), ...Array(30).fill(null),
].map(kind => ({ o: 'KnowSprint', i: 'KnowSprint', kind }));
const adrRows = Array(311).fill(0).map(() => ({ o: 'KnowADR', i: 'KnowADR', kind: null }));

test('счёт по видам и парам концов — прод 16.11: 117 спринтовых и 311 ADR', () => {
  const c = countDeps([...sprintRows, ...adrRows], RULES);
  assert.equal(c.total, 428);
  assert.deepEqual(c.by_pair['KnowSprint>KnowSprint'], { total: 117, kinds: { hard: 42, soft: 30, gate: 9, informs: 6, '(без вида)': 30 } });
  assert.deepEqual(c.by_pair['KnowADR>KnowADR'], { total: 311, kinds: { '(без вида)': 311 } });
  assert.deepEqual(c.unknown, []);
});

test('было → стало: всё совпало — потерь 0; пропажа или неизвестный вид — не сошлось с причиной', () => {
  const src = countDeps([...sprintRows, ...adrRows], RULES);
  const same = compareDeps(src, countDeps([...sprintRows, ...adrRows], RULES));
  assert.equal(same.ok, true);
  assert.equal(same.lost, 0);
  assert.deepEqual(same.rows.find(r => r.pair === 'KnowSprint>KnowSprint' && r.kind === 'hard'), { pair: 'KnowSprint>KnowSprint', kind: 'hard', was: 42, now: 42 });
  const lostOne = compareDeps(src, countDeps([...sprintRows.slice(1), ...adrRows], RULES));
  assert.equal(lostOne.ok, false);
  assert.equal(lostOne.lost, 1);
  const bad = countDeps([{ o: 'KnowTask', i: 'KnowSprint', kind: 'blocker' }], RULES);
  assert.equal(bad.unknown.length, 1);
  assert.equal(compareDeps(bad, bad).ok, false, 'неизвестный вид — не «сошлось», даже если число то же');
});
