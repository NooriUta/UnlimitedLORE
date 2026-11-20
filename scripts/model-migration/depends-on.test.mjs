// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Одна связь «зависит от» при переносе.
// DEPENDS_ON переносится шагом связей (карта: keep, свойства kind и reason), историчная по модели — получает
// valid_from. После копирования связи планирования приводятся к правилам 1.18 (владелица 20.11.2026):
//   - вид — код объединённого справочника dependency_kind; прежний hard — синоним blocks;
//   - вид пустой — по ответу человека в мастере (шаг «Вид зависимостей»), без ответа — без вида, «ждёт решения»;
//   - причина обязательна: старая связь без причины получает «перенесено без причины (до 1.18)», а не отказ.
// Сверка «было → стало» по паре концов и виду: потерь 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEP_EDGE, NO_KIND, MIGRATED_NO_REASON, depKindCodes, classifyDepKind, countDeps, compareDeps, planDependsOnFix } from './depends-on.mjs';
import { isHistoric, edgeHistoryDdl } from './edge-history.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./rules/status-unification.json', import.meta.url), 'utf8'));
const EDGES = JSON.parse(fs.readFileSync(new URL('./map/all.edges.json', import.meta.url), 'utf8')).edges;

test('объединённый справочник видов: виды спринтов и спеки, hard — синоним blocks; подписи на трёх языках', () => {
  const d = RULES.dictionaries.dependency_kind;
  assert.ok(d, 'справочник dependency_kind заведён в правилах');
  assert.equal(d.kind, 'other');
  assert.deepEqual(depKindCodes(RULES), ['blocks', 'waits', 'soft', 'gate', 'informs', 'relates']);
  assert.deepEqual(d.synonyms, { hard: 'blocks' });
  for (const c of d.codes) for (const lang of RULES.languages) assert.ok(c.labels[lang] && c.labels[lang].trim(), `${c.code}: подпись ${lang}`);
  for (const c of d.codes) assert.ok(c.meaning && c.meaning.trim(), `${c.code}: смысл назван`);
});

test('DEPENDS_ON — историчная связь модели: перенос даёт ей valid_from / valid_to', () => {
  assert.equal(DEP_EDGE, 'DEPENDS_ON');
  assert.ok(isHistoric('DEPENDS_ON'));
  assert.deepEqual(edgeHistoryDdl('DEPENDS_ON'), ['CREATE PROPERTY DEPENDS_ON.valid_from DATETIME', 'CREATE PROPERTY DEPENDS_ON.valid_to DATETIME']);
  assert.equal(EDGES.DEPENDS_ON.rule, 'keep');
  assert.deepEqual(EDGES.DEPENDS_ON.props, ['kind', 'reason']);
});

test('разбор вида: известный, синоним, другой регистр, без вида, неизвестный', () => {
  assert.deepEqual(classifyDepKind('soft', RULES), { kind: 'known', code: 'soft' });
  assert.deepEqual(classifyDepKind('hard', RULES), { kind: 'synonym', code: 'blocks' });
  assert.deepEqual(classifyDepKind(' Gate ', RULES), { kind: 'normalized', code: 'gate' });
  assert.deepEqual(classifyDepKind(null, RULES), { kind: 'empty', code: null });
  assert.deepEqual(classifyDepKind('', RULES), { kind: 'empty', code: null });
  assert.deepEqual(classifyDepKind('blocker', RULES), { kind: 'unknown', code: null });
});

// Прод 16.11.2026: DEPENDS_ON спринт → спринт 117 — hard 42, soft 30, gate 9, informs 6, без вида 30; ADR → ADR 311.
const sprintRows = [
  ...Array(42).fill('hard'), ...Array(30).fill('soft'), ...Array(9).fill('gate'), ...Array(6).fill('informs'), ...Array(30).fill(null),
].map((kind, n) => ({ r: `#1:${n}`, o: 'KnowSprint', i: 'KnowSprint', from: `S${n}`, to: `T${n}`, kind, reason: kind ? 'есть' : null }));
const adrRows = Array(311).fill(0).map((_, n) => ({ r: `#2:${n}`, o: 'KnowADR', i: 'KnowADR', from: `A${n}`, to: `B${n}`, kind: null, reason: null }));

test('счёт по видам после правил переноса: hard → blocks, без вида по ответу мастера, ADR как есть', () => {
  const answers = { 'S87>T87': 'blocks', 'S88>T88': null };
  const c = countDeps([...sprintRows, ...adrRows], RULES, answers);
  assert.equal(c.total, 428);
  assert.deepEqual(c.by_pair['KnowSprint>KnowSprint'], { total: 117, kinds: { blocks: 43, soft: 30, gate: 9, informs: 6, [NO_KIND]: 29 } });
  assert.deepEqual(c.by_pair['KnowADR>KnowADR'], { total: 311, kinds: { [NO_KIND]: 311 } }, 'ADR → ADR — не планирование, вид не нужен');
  assert.deepEqual(c.unknown, []);
});

test('план правки приёмника: синоним, ответ мастера, причина по умолчанию только у связей планирования', () => {
  const answers = { 'S87>T87': 'waits' };
  const plan = planDependsOnFix([...sprintRows, ...adrRows], RULES, answers);
  assert.equal(plan.updates.filter(u => u.set.kind === 'blocks').length, 42, 'hard → blocks');
  assert.deepEqual(plan.updates.find(u => u.r === '#1:87').set, { kind: 'waits', reason: MIGRATED_NO_REASON });
  assert.equal(plan.updates.filter(u => u.set.reason === MIGRATED_NO_REASON).length, 30, 'без причины — 30 спринтовых, ADR не трогаются');
  assert.equal(plan.counts.no_kind_waiting, 29);
  assert.equal(plan.counts.kind_by_answer, 1);
  assert.equal(plan.counts.synonym, 42);
  assert.equal(plan.counts.reason_default, 30);
  assert.ok(!plan.updates.some(u => u.r.startsWith('#2:')));
  assert.equal(MIGRATED_NO_REASON, 'перенесено без причины (до 1.18)');
});

test('было → стало: всё совпало — потерь 0; пропажа или неизвестный вид — не сошлось', () => {
  const src = countDeps([...sprintRows, ...adrRows], RULES, {});
  const same = compareDeps(src, countDeps([...sprintRows, ...adrRows].map(r => ({ ...r, kind: r.kind === 'hard' ? 'blocks' : r.kind })), RULES, {}));
  assert.equal(same.ok, true);
  assert.equal(same.lost, 0);
  assert.deepEqual(same.rows.find(r => r.pair === 'KnowSprint>KnowSprint' && r.kind === 'blocks'), { pair: 'KnowSprint>KnowSprint', kind: 'blocks', was: 42, now: 42 });
  const lostOne = compareDeps(src, countDeps([...sprintRows.slice(1), ...adrRows], RULES, {}));
  assert.equal(lostOne.ok, false);
  assert.equal(lostOne.lost, 1);
  const bad = countDeps([{ o: 'KnowTask', i: 'KnowSprint', kind: 'blocker' }], RULES, {});
  assert.equal(compareDeps(bad, bad).ok, false, 'неизвестный вид — не «сошлось»');
  const raw = countDeps([{ o: 'KnowTask', i: 'KnowSprint', kind: 'hard' }], RULES, {});
  assert.equal(compareDeps(raw, raw).ok, false, 'в приёмнике остался синоним, а не код — не «сошлось»');
});
