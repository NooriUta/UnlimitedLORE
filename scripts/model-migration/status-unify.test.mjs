// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — унификация статусов перед переносом.
// Слова владелицы 16.11.2026: «это как правило переноса для конвейера текущие наши статусы привести к трем
// локализациям если на другой установке будет еще статусы их нужно проверить по тому принципу и сделать
// диалог унификации и проверки перед миграцией».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkRules, classify, buildDialog, FORMAT, LANGS, decisionsAgainstRules } from './status-unify.mjs';

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
  assert.deepEqual(classify('✅ DONE', plan), { kind: 'known', code: 'DONE' });
  assert.deepEqual(classify('🚀 READY FOR DEPLOY', plan), { kind: 'known', code: 'READY_FOR_DEPLOY' });
  assert.deepEqual(classify('ready_for_deploy', plan), { kind: 'known', code: 'READY_FOR_DEPLOY' });
  assert.deepEqual(classify('🔄 IN PROGRESS', plan), { kind: 'known', code: 'ACTIVE' });
  assert.deepEqual(classify('🧪 UAT TESTING', plan), { kind: 'known', code: 'UAT' });
  assert.deepEqual(classify('✅ DONE — PROD v1.4.6', plan), { kind: 'known', code: 'DONE' });
  assert.deepEqual(classify('Accepted', RULES.dictionaries.adr_status), { kind: 'known', code: 'ACCEPTED' });
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

test('диалог: знакомое сведено, незнакомое ждёт решения с вариантами; пустое — начальный статус (правило владелицы 19.11)', () => {
  const d = buildDialog(counts, RULES, NONE);
  assert.equal(d.rows.length, counts.length);
  const by = v => d.rows.find(r => r.value === v);
  assert.equal(by('✅ DONE').state, 'unified');
  assert.equal(by('✅ DONE').code, 'DONE');
  assert.equal(by('🔄 IN PROGRESS').code, 'ACTIVE');
  const hold = by('🟠 ON HOLD');
  assert.equal(hold.state, 'needs_decision');
  assert.deepEqual(hold.options.map(o => o.action), ['map_to', 'add_code', 'defer']);
  assert.ok(hold.options[0].codes.includes('WAITING'), 'привязать можно к любому коду справочника типа');
  const empty = by(null);
  assert.equal(empty.state, 'defaulted', 'правило владелицы 19.11.2026: пустой статус решения не ждёт');
  assert.equal(empty.why, 'пусто');
  assert.equal(empty.code, 'PROPOSED', 'начальный статус справочника (у спеки — первый)');
  assert.equal(by('REJECTED').state, 'needs_decision');
  assert.equal(d.summary.needs_decision, 3);
  assert.equal(d.summary.defaulted, 1);
  assert.equal(d.summary.records_waiting, 4 + 1 + 114);
  assert.equal(d.ready, false, 'пока есть строка без решения — перенос не начинается');
});

test('диалог: решение человека закрывает строку; добавленный код обязан прийти с тремя подписями', () => {
  const dec = { format: 'mig-decisions/1', decisions: [
    { id: 'S1', scope: { type: 'KnowTaskHist', field: 'status_raw', value: '🟠 ON HOLD' }, action: 'map_to', to: 'WAITING', by: 'владелица', at: '2026-11-16T12:00:00Z' },
    { id: 'S2', scope: { type: 'KnowSpecHist', field: 'status', why: 'пусто' }, action: 'map_to', to: 'PROPOSED', by: 'владелица', at: '2026-11-16T12:00:00Z' },
    { id: 'S3', scope: { type: 'KnowADRHist', field: 'status_raw', value: 'REJECTED' }, action: 'add_code', to: 'REJECTED',
      labels: { ru: 'Отклонён', en: 'Rejected', pl: 'Odrzucony' }, by: 'владелица', at: '2026-11-16T12:00:00Z' },
    { id: 'S4', scope: { type: 'KnowDecisionHist', field: 'status_raw', value: 'fixed' }, action: 'map_to', to: 'ACCEPTED', by: 'владелица', at: '2026-11-16T12:00:00Z' },
  ] };
  const d = buildDialog(counts, RULES, dec);
  assert.equal(d.summary.needs_decision, 0);
  assert.equal(d.ready, true);
  assert.equal(d.rows.find(r => r.value === '🟠 ON HOLD').code, 'WAITING');
  assert.equal(d.rows.find(r => r.value === 'REJECTED').code, 'REJECTED');
  assert.deepEqual(d.added, [{ dict: 'adr_status', code: 'REJECTED', labels: { ru: 'Отклонён', en: 'Rejected', pl: 'Odrzucony' } }]);

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

test('регистр кода — правило: владелица 16.11.2026 «uppercase»; код не в регистре правил не принимается', () => {
  assert.equal(RULES.code_case.status, 'upper');
  for (const d of Object.values(RULES.dictionaries)) if (d.kind === 'status') for (const c of d.codes) assert.equal(c.code, c.code.toUpperCase());
  const broken = structuredClone(RULES);
  broken.dictionaries.plan_status.codes[0].code = 'todo';
  assert.match(checkRules(broken).join('; '), /todo.*TODO/);
});

test('владелица 16.11.2026: «статусная модель uppercase остальные в lower»; приоритет — такой же справочник', () => {
  assert.deepEqual(RULES.code_case, { status: 'upper', other: 'lower' });
  const p = RULES.dictionaries.priority;
  assert.equal(p.kind, 'other');
  assert.deepEqual(p.codes.map(c => c.code), ['critical', 'high', 'normal', 'low']);
  // не статусная модель — приоритет, harness (17.11.2026: harness в правилах, коды miniLORE строчными), вид зависимости (MDL-13),
  // вид задачи и профиль агента (ISS-02-DICT-SEED-GUARD, 25.11.2026: словари, которые читает UI)
  for (const [name, d] of Object.entries(RULES.dictionaries)) if (!['priority', 'harness', 'dependency_kind', 'task_type', 'agent_profile', 'palette'].includes(name)) assert.equal(d.kind, 'status', name);
  assert.deepEqual(classify('P1', p), { kind: 'known', code: 'high' });
  assert.deepEqual(classify('🔴 HIGH', p), { kind: 'known', code: 'high' });
  assert.deepEqual(classify('blocker', p), { kind: 'known', code: 'critical' });
  // medium — середина шкалы (ST-74, 16.11): тот же разбор, что у переноса (apply-map toPriority)
  assert.deepEqual(classify('medium', p), { kind: 'known', code: 'normal' });
  // приоритет необязателен: пустое сведено без решения, незнакомое — строка диалога
  const d = buildDialog([
    { type: 'KnowSprintHist', field: 'priority', value: null, n: 400 },
    { type: 'KnowSprintHist', field: 'priority', value: 'medium', n: 6 },
    { type: 'KnowQuestion', field: 'priority', value: 'normal', n: 208 },
  ], RULES, NONE);
  assert.deepEqual(d.rows.map(r => r.state), ['unified', 'unified', 'unified'], 'medium сведён синонимом, решения не ждёт');
  // справочник не статусов с заглавным кодом не принимается
  const broken = structuredClone(RULES);
  broken.dictionaries.priority.codes[0].code = 'CRITICAL';
  assert.match(checkRules(broken).join('; '), /priority.*CRITICAL.*critical/);
});

test('решение с кодом не из справочника поля отбивается до записи файла (16.11: ST-74 «NORMAL» испортил файл решений)', () => {
  const doc = { format: 'mig-decisions/1', decisions: [
    { id: 'ST-74', scope: { type: 'KnowSprintHist', field: 'priority', value: 'medium' }, action: 'map_to', to: 'NORMAL', by: 'x' },
    { id: 'ST-75', scope: { type: 'KnowSprintHist', field: 'priority', value: 'med' }, action: 'map_to', to: 'normal', by: 'x' },
  ] };
  const bad = decisionsAgainstRules(RULES, doc);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /ST-74: кода NORMAL в справочнике priority нет/);
});

test('справочник решений: кодов FIXED и DONE нет — владелица свела fixed и done к ACCEPTED (ST-02, ST-03, 16.11)', () => {
  const codes = RULES.dictionaries.decision_status.codes.map(c => c.code);
  assert.ok(!codes.includes('FIXED') && !codes.includes('DONE'), 'иначе fixed/done молча свелись бы к своим кодам мимо её решения');
  assert.deepEqual(checkRules(RULES), []);
});

test('harness — в правилах проверки и унификации (владелица 17.11: «завели в правила проверки и унификации»): коды miniLORE, синонимы старых кодов', () => {
  const d = RULES.dictionaries.harness;
  assert.ok(d, 'справочник harness в правилах');
  assert.equal(d.kind, 'other', 'не статусная модель — строчными');
  assert.deepEqual(d.codes.map(c => c.code), ['claude', 'kimi', 'qwen', 'dsh', 'codex', 'opencode', 'cursor']);
  assert.equal(d.synonyms['claude-code'], 'claude');
  assert.equal(d.synonyms['kimi-code'], 'kimi');
  assert.ok(RULES.sources.some(s => s.type === 'KnowActor' && s.field === 'harness' && s.dict === 'harness'));
  assert.deepEqual(checkRules(RULES), []);
  assert.deepEqual(classify('claude-code', d), { kind: 'known', code: 'claude' });
});
