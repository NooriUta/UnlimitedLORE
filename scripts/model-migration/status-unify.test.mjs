// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — унификация статусов перед переносом.
// Слова владелицы 16.11.2026: «это как правило переноса для конвейера текущие наши статусы привести к трем
// локализациям если на другой установке будет еще статусы их нужно проверить по тому принципу и сделать
// диалог унификации и проверки перед миграцией».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkRules, classify, buildDialog, FORMAT, LANGS } from './status-unify.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./rules/status-unification.json', import.meta.url), 'utf8'));
const plan = RULES.dictionaries.plan_status;

test('файл правил годен: у каждого кода подписи на трёх языках', () => {
  assert.equal(RULES.format, FORMAT);
  assert.deepEqual(LANGS, ['ru', 'en', 'pl']);
  assert.deepEqual(checkRules(RULES), []);
});

test('код без подписи на одном из языков называется, а не пропускается', () => {
  const broken = structuredClone(RULES);
  delete broken.dictionaries.plan_status.codes[0].labels.pl;
  broken.dictionaries.phase_status.codes[1].labels.en = '  ';
  const bad = checkRules(broken);
  assert.equal(bad.length, 2);
  assert.match(bad[0], /plan_status.*pl/);
  assert.match(bad[1], /phase_status.*en/);
});

test('источник правил ссылается только на существующий справочник, синоним — на существующий код', () => {
  const broken = structuredClone(RULES);
  broken.sources.push({ type: 'KnowX', field: 'status', dict: 'нет_такого', required: true });
  broken.dictionaries.plan_status.synonyms['SOMETHING'] = 'нет_кода';
  const bad = checkRules(broken);
  assert.ok(bad.some(x => /нет_такого/.test(x)), bad.join('; '));
  assert.ok(bad.some(x => /нет_кода/.test(x)), bad.join('; '));
});

test('наши написания статуса сводятся к коду: значок, регистр, пробел, приписка', () => {
  assert.deepEqual(classify('✅ DONE', plan), { kind: 'known', code: 'done' });
  assert.deepEqual(classify('🚀 READY FOR DEPLOY', plan), { kind: 'known', code: 'ready_for_deploy' });
  assert.deepEqual(classify('ready_for_deploy', plan), { kind: 'known', code: 'ready_for_deploy' });
  assert.deepEqual(classify('🔄 IN PROGRESS', plan), { kind: 'known', code: 'active' });
  assert.deepEqual(classify('🧪 UAT TESTING', plan), { kind: 'known', code: 'uat' });
  assert.deepEqual(classify('✅ DONE — PROD v1.4.6', plan), { kind: 'known', code: 'done' });
  assert.deepEqual(classify('Accepted', RULES.dictionaries.adr_status), { kind: 'known', code: 'accepted' });
});

test('пустое и незнакомое — разные исходы; незнакомое не превращается в первый попавшийся код', () => {
  assert.deepEqual(classify(null, plan), { kind: 'empty', code: null });
  assert.deepEqual(classify('   ', plan), { kind: 'empty', code: null });
  assert.deepEqual(classify('🟠 ON HOLD', plan), { kind: 'unknown', code: null });
  assert.deepEqual(classify('DONEISH', plan), { kind: 'unknown', code: null });
  assert.deepEqual(classify('rejected', RULES.dictionaries.adr_status), { kind: 'unknown', code: null });
});

const counts = [
  { type: 'KnowTaskHist', field: 'status_raw', value: '✅ DONE', n: 5290 },
  { type: 'KnowTaskHist', field: 'status_raw', value: '🔄 IN PROGRESS', n: 36 },
  { type: 'KnowTaskHist', field: 'status_raw', value: '🟠 ON HOLD', n: 4 },
  { type: 'KnowSpecHist', field: 'status', value: null, n: 413 },
  { type: 'KnowADRHist', field: 'status_raw', value: 'REJECTED', n: 1 },
  { type: 'KnowDecisionHist', field: 'status_raw', value: 'fixed', n: 114 },
];
const NONE = { format: 'mig-decisions/1', decisions: [] };

test('диалог: знакомое сведено, незнакомое и пустое обязательного поля ждут решения с вариантами', () => {
  const d = buildDialog(counts, RULES, NONE);
  assert.equal(d.rows.length, counts.length);
  const by = v => d.rows.find(r => r.value === v);
  assert.equal(by('✅ DONE').state, 'unified');
  assert.equal(by('✅ DONE').code, 'done');
  assert.equal(by('🔄 IN PROGRESS').code, 'active');
  const hold = by('🟠 ON HOLD');
  assert.equal(hold.state, 'needs_decision');
  assert.deepEqual(hold.options.map(o => o.action), ['map_to', 'add_code', 'defer']);
  assert.ok(hold.options[0].codes.includes('waiting'), 'привязать можно к любому коду справочника типа');
  const empty = by(null);
  assert.equal(empty.state, 'needs_decision');
  assert.equal(empty.why, 'пусто');
  assert.equal(empty.suggest, 'proposed', 'предложение — первый статус справочника');
  assert.equal(by('REJECTED').state, 'needs_decision');
  assert.equal(d.summary.needs_decision, 4);
  assert.equal(d.summary.records_waiting, 4 + 413 + 1 + 114);
  assert.equal(d.ready, false, 'пока есть строка без решения — перенос не начинается');
});

test('диалог: решение человека закрывает строку; добавленный код обязан прийти с тремя подписями', () => {
  const dec = { format: 'mig-decisions/1', decisions: [
    { id: 'S1', scope: { type: 'KnowTaskHist', field: 'status_raw', value: '🟠 ON HOLD' }, action: 'map_to', to: 'waiting', by: 'владелица', at: '2026-11-16T12:00:00Z' },
    { id: 'S2', scope: { type: 'KnowSpecHist', field: 'status', why: 'пусто' }, action: 'map_to', to: 'proposed', by: 'владелица', at: '2026-11-16T12:00:00Z' },
    { id: 'S3', scope: { type: 'KnowADRHist', field: 'status_raw', value: 'REJECTED' }, action: 'add_code', to: 'rejected',
      labels: { ru: 'Отклонён', en: 'Rejected', pl: 'Odrzucony' }, by: 'владелица', at: '2026-11-16T12:00:00Z' },
    { id: 'S4', scope: { type: 'KnowDecisionHist', field: 'status_raw', value: 'fixed' }, action: 'map_to', to: 'accepted', by: 'владелица', at: '2026-11-16T12:00:00Z' },
  ] };
  const d = buildDialog(counts, RULES, dec);
  assert.equal(d.summary.needs_decision, 0);
  assert.equal(d.ready, true);
  assert.equal(d.rows.find(r => r.value === '🟠 ON HOLD').code, 'waiting');
  assert.equal(d.rows.find(r => r.value === 'REJECTED').code, 'rejected');
  assert.deepEqual(d.added, [{ dict: 'adr_status', code: 'rejected', labels: { ru: 'Отклонён', en: 'Rejected', pl: 'Odrzucony' } }]);

  const noPl = structuredClone(dec);
  delete noPl.decisions[2].labels.pl;
  assert.throws(() => buildDialog(counts, RULES, noPl), /S3.*pl/);
  const badCode = structuredClone(dec);
  badCode.decisions[0].to = 'нет_такого';
  assert.throws(() => buildDialog(counts, RULES, badCode), /S1.*нет_такого/);
});

test('тип и поле, которых нет в правилах, выходят отдельной строкой — чужая установка не теряется молча', () => {
  const d = buildDialog([{ type: 'KnowFooHist', field: 'status', value: 'ok', n: 2 }], RULES, NONE);
  assert.equal(d.rows[0].state, 'no_rule');
  assert.equal(d.ready, false);
});
