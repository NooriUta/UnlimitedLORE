// Правило владелицы 19.11.2026 для пустого статуса и пустого типа при переносе 1.18:
//   «ставить начальный, где без статуса», «и без типа», «если тип обязательный — проставить»,
//   «если нельзя вычислить — задайте по умолчанию, и переходит на него», «для нас мои выборы — отдельным скриптом».
// Порядок: вычислить из данных (однозначно) → выбор владелицы из файла решений (только наша установка) →
// начальный статус справочника типа (универсально). Каждая подстановка видна: r.filled с основанием.
// Необязательный пустой тип или вид остаётся пустым.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyMap } from './apply-map.mjs';
import { initialStatus, statusSourceOf, fillEmptyStatus, computeEmptyStatuses, filledSummary, OWNER_RULE } from './empty-fill.mjs';
import { buildDialog } from './status-unify.mjs';
import { MAP, RULES, VOCAB, CODE_CASE } from './resources.mjs';

const OURS = JSON.parse(fs.readFileSync(new URL('./rules/decisions.lore.json', import.meta.url), 'utf8'));
const dictOf = T => (RULES.sources.find(s => s.type === T && (s.field === 'status' || s.field === 'status_raw')) || {}).dict;
const ctxOf = (T, decisions) => ({ statusDict: dictOf(T), statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, decisions, codeCase: CODE_CASE, statusRules: RULES.dictionaries[dictOf(T)] });

test('начальный статус — из справочника типа: empty_default, иначе первый код; у выводимого (фаза) — нет', () => {
  const want = { adr_status: 'DRAFT', milestone_status: 'UPCOMING', spec_status: 'PROPOSED', decision_status: 'PROPOSED', plan_status: 'BACKLOG', question_status: 'OPEN', feature_status: 'PROPOSED', qg_status: 'DRAFT' };
  for (const [d, code] of Object.entries(want)) assert.equal(initialStatus(RULES.dictionaries[d]), code, d);
  assert.equal(initialStatus(RULES.dictionaries.phase_status), null, 'статус фазы выводится по задачам');
  assert.equal(initialStatus({ kind: 'other', codes: [{ code: 'normal' }] }), null, 'не статус — не подставляется');
});

test('источник статуса типа — по карте и правилам, в том числе копия статуса на записи', () => {
  assert.deepEqual(statusSourceOf('KnowADRHist', MAP.KnowADRHist, RULES), { field: 'status_raw', dict: 'adr_status' });
  assert.deepEqual(statusSourceOf('KnowSpecHist', MAP.KnowSpecHist, RULES), { field: 'status', dict: 'spec_status' });
  assert.deepEqual(statusSourceOf('KnowDecision', MAP.KnowDecision, RULES), { field: 'status_raw', dict: 'decision_status' });
  assert.equal(statusSourceOf('KnowPhaseHist', MAP.KnowPhaseHist, RULES), null, 'фаза — по задачам');
  assert.equal(statusSourceOf('KnowRelease', MAP.KnowRelease, RULES), null, 'у релиза статуса нет');
});

test('чужая установка (без нашего файла решений): ADR, веха, спека, решение получают начальный статус по умолчанию', () => {
  const cases = [['KnowADRHist', {}, 'DRAFT', 'adr_status'], ['KnowMilestoneHist', {}, 'UPCOMING', 'milestone_status'],
    ['KnowSpecHist', {}, 'PROPOSED', 'spec_status'], ['KnowDecision', { status_raw: '' }, 'PROPOSED', 'decision_status']];
  for (const [T, rec, code, dict] of cases) {
    const r = applyMap(T, MAP[T], rec, ctxOf(T, undefined));
    assert.equal(r.out.status, code, T);
    assert.deepEqual(r.rejects, [], T + ': пустота закрыта правилом, а не оставлена несоответствием');
    assert.deepEqual(r.filled, [{ field: 'status', value: code, how: 'по умолчанию', from: `начальный статус справочника ${dict}`, basis: OWNER_RULE }], T);
  }
  assert.equal(OWNER_RULE, 'правило владелицы 19.11');
});

test('наша установка (decisions.lore.json): выбор владелицы ST поверх умолчания и с её кодом решения', () => {
  const cases = [['KnowADRHist', 'DRAFT', 'ST-01'], ['KnowMilestoneHist', 'UPCOMING', 'ST-06'], ['KnowSpecHist', 'PROPOSED', 'ST-07']];
  for (const [T, code, id] of cases) {
    const r = applyMap(T, MAP[T], {}, ctxOf(T, OURS));
    assert.equal(r.out.status, code, T);
    assert.deepEqual(r.filled.map(f => [f.how, f.from, f.basis]), [['выбор владелицы', id, OWNER_RULE]], T);
    assert.deepEqual(r.decided.map(d => d.decision), [id], T);
  }
  // решения: ST о пустом статусе нет — то же умолчание, что у чужой установки
  const d = applyMap('KnowDecision', MAP.KnowDecision, {}, ctxOf('KnowDecision', OURS));
  assert.deepEqual([d.out.status, d.filled[0].how], ['PROPOSED', 'по умолчанию']);
});

test('выбор владелицы берётся только из файла решений: другой файл — другое значение, без файла — умолчание', () => {
  const other = { format: 'mig-decisions/1', decisions: [{ id: 'X-1', scope: { type: 'KnowADRHist', field: 'status_raw', why: 'пусто' }, action: 'map_to', to: 'PROPOSED', by: 'чужая установка', at: '2026-11-19T00:00:00Z' }] };
  assert.equal(applyMap('KnowADRHist', MAP.KnowADRHist, {}, ctxOf('KnowADRHist', other)).out.status, 'PROPOSED');
  assert.equal(applyMap('KnowADRHist', MAP.KnowADRHist, {}, ctxOf('KnowADRHist', undefined)).out.status, 'DRAFT');
});

test('в коде установщика нет ни одного выбора владелицы (ST-xx) — только в файле решений', () => {
  for (const f of ['apply-map.mjs', 'transfer.mjs', 'empty-fill.mjs', 'status-unify.mjs', 'dry-run.mjs', 'decisions.mjs']) {
    const code = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /\bST-\d{2}\b/, f);
  }
});

test('вычислить раньше умолчания и раньше выбора владелицы: версия — по предыдущей, копия на записи — по открытой версии', () => {
  const T = 'KnowADRHist';
  const v = (rid, from, to, status) => {
    const res = applyMap(T, MAP[T], status ? { status_raw: status } : {}, { ...ctxOf(T, OURS), deferEmpty: true });
    res.out.valid_from = from; if (to) res.out.valid_to = to;
    return { rid, res };
  };
  const calc = {
    KnowADRHist: [v('#2:1', '2026-01-01', '2026-02-01', 'ACCEPTED'), v('#2:2', '2026-02-01', null, null), v('#2:3', '2026-01-05', null, null)],
    KnowSpec: [{ rid: '#3:1', res: applyMap('KnowSpec', MAP.KnowSpec, {}, { ...ctxOf('KnowSpec', OURS), deferEmpty: true }) },
      { rid: '#3:2', res: applyMap('KnowSpec', MAP.KnowSpec, {}, { ...ctxOf('KnowSpec', OURS), deferEmpty: true }) }],
    KnowSpecHist: [{ rid: '#4:1', res: { ...applyMap('KnowSpecHist', MAP.KnowSpecHist, { status: 'Accepted' }, ctxOf('KnowSpecHist', OURS)) } }],
  };
  assert.equal(calc.KnowADRHist[1].res.out.status, undefined, 'в отложенном режиме исполнитель карты не подставляет сам');
  const parentOf = { '#2:1': '#1:1', '#2:2': '#1:1', '#2:3': '#1:9', '#4:1': '#3:1' };
  computeEmptyStatuses(calc, parentOf, T2 => ({ ...ctxOf(T2, OURS) }));
  const [, second, lone] = calc.KnowADRHist;
  assert.equal(second.res.out.status, 'ACCEPTED');
  assert.deepEqual(second.res.filled, [{ field: 'status', value: 'ACCEPTED', how: 'вычислено', from: 'предыдущая версия', basis: OWNER_RULE }]);
  assert.equal(lone.res.out.status, 'DRAFT', 'первая версия записи: вычислить не из чего');
  assert.equal(lone.res.filled[0].how, 'выбор владелицы');
  const [spec, specNoVer] = calc.KnowSpec;
  assert.equal(spec.res.out.status, 'ACCEPTED');
  assert.deepEqual(spec.res.filled[0], { field: 'status', value: 'ACCEPTED', how: 'вычислено', from: 'открытая версия', basis: OWNER_RULE });
  assert.equal(specNoVer.res.out.status, 'PROPOSED', 'версий нет — правило дальше');
  assert.deepEqual(filledSummary(calc), {
    KnowADRHist: { 'status · вычислено': 1, 'status · выбор владелицы': 1 },
    KnowSpec: { 'status · вычислено': 1, 'status · выбор владелицы': 1 },
  });
});

test('вычисление только однозначное: у записи две открытые версии — копия статуса не вычисляется', () => {
  const ctx = T => ({ ...ctxOf(T, undefined) });
  const ver = (rid, status) => ({ rid, res: applyMap('KnowSpecHist', MAP.KnowSpecHist, { status }, ctx('KnowSpecHist')) });
  const calc = { KnowSpec: [{ rid: '#3:1', res: applyMap('KnowSpec', MAP.KnowSpec, {}, { ...ctx('KnowSpec'), deferEmpty: true }) }], KnowSpecHist: [ver('#4:1', 'Accepted'), ver('#4:2', 'Deprecated')] };
  computeEmptyStatuses(calc, { '#4:1': '#3:1', '#4:2': '#3:1' }, ctx);
  assert.deepEqual([calc.KnowSpec[0].res.out.status, calc.KnowSpec[0].res.filled[0].how], ['PROPOSED', 'по умолчанию']);
});

test('заданный статус не трогается; необязательный пустой тип (релиз, док) остаётся пустым', () => {
  const r = applyMap('KnowADRHist', MAP.KnowADRHist, { status_raw: 'Accepted' }, ctxOf('KnowADRHist', OURS));
  assert.equal(r.out.status, 'ACCEPTED');
  assert.deepEqual(r.filled, []);
  const rel = applyMap('KnowRelease', MAP.KnowRelease, { release_uid: 'r1', type: '' }, {});
  assert.ok(!('type' in rel.out));
  assert.deepEqual([rel.filled, rel.rejects], [[], []]);
  const doc = applyMap('KnowDoc', MAP.KnowDoc, { doc_id: 'd1', kind: null }, {});
  assert.ok(!('kind' in doc.out));
  assert.deepEqual(doc.filled, []);
});

test('диалог статусов: пустой статус не ждёт решения — строка «по умолчанию» с начальным кодом, перенос не блокируется', () => {
  const d = buildDialog([{ type: 'KnowADRHist', field: 'status_raw', value: null, n: 152 }, { type: 'KnowDecision', field: 'status_raw', value: '', n: 47 }], RULES, { format: 'mig-decisions/1', decisions: [] });
  assert.deepEqual(d.rows.map(r => [r.type, r.state, r.code, r.basis]), [['KnowADRHist', 'defaulted', 'DRAFT', OWNER_RULE], ['KnowDecision', 'defaulted', 'PROPOSED', OWNER_RULE]]);
  assert.equal(d.ready, true);
  const ours = buildDialog([{ type: 'KnowADRHist', field: 'status_raw', value: null, n: 152 }], RULES, OURS);
  assert.deepEqual([ours.rows[0].state, ours.rows[0].decision, ours.rows[0].code], ['decided', 'ST-01', 'DRAFT']);
});
