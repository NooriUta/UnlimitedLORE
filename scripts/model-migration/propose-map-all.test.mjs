// MIG-01 · Карта переноса всех остальных объектов — выводится правилами из переписи полей, а не пишется руками.
// Слово владелицы 17.11.2026: «перенеси по собственным рекомендациям и нашим правилам все объекты».
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleFor, typePlan, proposeMap, RETIRED_V89 } from './propose-map-all.mjs';

test('правило поля: служебные — как есть; статус и приоритет — к справочнику; даты — настоящим типом', () => {
  assert.equal(ruleFor('KnowADRHist', 'valid_from').rule, 'keep');
  assert.equal(ruleFor('KnowADRHist', 'changed_by').rule, 'keep');
  assert.deepEqual([ruleFor('KnowADRHist', 'status_raw').rule, ruleFor('KnowADRHist', 'status_raw').how, ruleFor('KnowADRHist', 'status_raw').basis], ['transform', 'status', 'owner']);
  assert.equal(ruleFor('KnowQuestion', 'priority').how, 'priority');
  assert.equal(ruleFor('KnowDoc', 'date_created').how, 'DATE');
  assert.equal(ruleFor('KnowRelease', 'updated_at').how, 'DATETIME');
});

test('правило поля: компонент, проект и ссылки строкой — ждут шага связей; hist_for и status_category не переносятся', () => {
  for (const f of ['component_id', 'project', 'git_project', 'adr_refs', 'sprint_refs', 'pr_refs']) {
    const e = ruleFor('KnowDecision', f);
    assert.equal(e.rule, 'open', f + ': удерживается, пока связь не построена');
    assert.match(e.question, /связ/);
  }
  assert.equal(ruleFor('KnowDocHist', 'hist_for').rule, 'drop');
  assert.equal(ruleFor('KnowSpecHist', 'status_category').rule, 'drop');
});

test('правило поля: остальное — как есть, основание delegated (данные не теряем)', () => {
  const e = ruleFor('BragiPublication', 'annotation_md');
  assert.deepEqual([e.rule, e.basis], ['keep', 'delegated']);
});

// Пустой тип решает перепись, а не имя: typePlan судит только по имени, пустоту — proposeMap (MD-02 8а, 19.11.2026).
test('типы: план-доска и журнал шагов не переносятся; первый объект — своей картой; по имени тип переносится', () => {
  assert.equal(typePlan('PlanTrack').move, false);
  assert.match(typePlan('PlanTrack').why, /план-доск/);
  assert.equal(typePlan('LoreSchemaVersion').move, false);
  assert.equal(typePlan('KnowTask').move, false, 'первый объект уже в своей карте');
  assert.equal(typePlan('KnowCanvas').move, true);
});

test('карта по переписи: каждое поле каждого переносимого типа получает правило; детерминирована', () => {
  const census = { KnowADRHist: { fields: [{ name: 'status_raw', filled: 3 }, { name: 'valid_from', filled: 3 }, { name: 'hist_for', filled: 1 }] }, PlanTrack: { fields: [{ name: 'label', filled: 1 }] } };
  const m = proposeMap(census);
  assert.deepEqual(Object.keys(m.types), ['KnowADRHist']);
  // + служебные поля правки у каждого типа версий (снимок 18.11.2026: без правила перенос терял их как «вне карты»)
  // + причина правки (WK-01, 20.11.2026) — тоже служебное поле версии
  assert.deepEqual(Object.keys(m.types.KnowADRHist).sort(), ['change_reason', 'changed_by_harness', 'changed_by_harness_note', 'changed_by_machine', 'changed_by_session', 'hist_for', 'status_raw', 'valid_from']);
  // + снятые V89 легаси-словари — всегда, даже если перепись их не видела (MD-02)
  assert.deepEqual(Object.keys(m.skipped), ['PlanTrack', ...RETIRED_V89].sort());
  assert.equal(JSON.stringify(proposeMap(census)), JSON.stringify(m));
});

test('статус: копия на записи (ADR, решение, спека) — к коду; в версиях спеки status_raw — дубль status, не переносится', () => {
  for (const [T, f] of [['KnowADR', 'status'], ['KnowDecision', 'status_raw'], ['KnowSpec', 'status']]) assert.equal(ruleFor(T, f).how, 'status', T + '.' + f);
  assert.equal(ruleFor('KnowSpecHist', 'status_raw').rule, 'drop');
  assert.equal(ruleFor('KnowSpecHist', 'status').how, 'status');
});

test('date_display у вехи — подпись («18 апр», «прогноз Q4 2026»), не дата (пробный расчёт 17.11: 46 отказов «не дата»)', () => {
  assert.equal(ruleFor('KnowMilestone', 'date_display').rule, 'keep');
  assert.equal(ruleFor('KnowMilestone', 'date_created').how, 'DATE');
});

test('harness агента — к кодам miniLORE (владелица 17.11: «как у minilore»): claude-code → claude, kimi-code → kimi', async () => {
  const { applyMap } = await import('./apply-map.mjs');
  assert.deepEqual([ruleFor('KnowActor', 'harness').rule, ruleFor('KnowActor', 'harness').how], ['transform', 'harness']);
  const m = { harness: ruleFor('KnowActor', 'harness') };
  assert.equal(applyMap('KnowActor', m, { harness: 'claude-code' }, {}).out.harness, 'claude');
  assert.equal(applyMap('KnowActor', m, { harness: 'kimi-code' }, {}).out.harness, 'kimi');
  assert.equal(applyMap('KnowActor', m, { harness: 'codex' }, {}).out.harness, 'codex');
  assert.deepEqual(applyMap('KnowActor', m, { harness: 'vim' }, {}).rejects.map(r => r.why), ['harness вне справочника miniLORE']);
});

test('ключ своего типа — не «связь»: component_id у LoreComponent остаётся полем (18.11.2026: в новой базе component_id = null)', () => {
  // Правило «компонент и проект — только связью» про ССЫЛКУ на компонент из другой записи, а не про ключ самого компонента.
  assert.equal(ruleFor('LoreComponent', 'component_id').rule, 'keep');
  assert.equal(ruleFor('KnowADR', 'component_id').rule, 'open', 'у ADR component_id по-прежнему ссылка → связь');
});
