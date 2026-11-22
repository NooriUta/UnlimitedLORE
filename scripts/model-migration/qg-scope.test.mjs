// SPRINT_QG_REBUILD/QG-01 · охват гейта при переносе 1.18 (решение владелицы 19.11.2026 «2а 3а»,
// D-2026-MIG-118-OWNER-ANSWERS-1119). Смоук RFD2 21.11.2026: на базе переноса scope пуст у всех гейтов, четыре гейта
// гигиены LORE привязаны к проекту, QG-T13-SMOKE в draft. Правило — в переносе, чтобы повторялось на проде.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planQgScope, applyQgScope } from './qg-scope.mjs';
import { judgeQgScope } from './qg-scope.mjs';
import rule from './rules/qg-scope.json' with { type: 'json' };

const gates = [
  { qg_id: 'QG-LORE-BLOCKED-REASON', status: 'draft', projects: ['NooriUta/UnlimitedLORE'] },
  { qg_id: 'QG-LORE-PROJECT-BINDING', status: 'draft', projects: ['NooriUta/UnlimitedLORE'] },
  { qg_id: 'QG-LORE-PROJECT-ROLES', status: 'draft', projects: ['NooriUta/UnlimitedLORE'] },
  { qg_id: 'qg-lore-storage', status: 'draft', projects: ['NooriUta/UnlimitedLORE'] },
  { qg_id: 'QG-AIDA-ARCH', status: 'draft', projects: ['NooriUta/AIDA'] },
  { qg_id: 'QG-SITE-V2-COVERAGE', status: 'draft', projects: ['NooriUta/seidr-site'] },
  { qg_id: 'QG-T13-SMOKE', status: 'draft', projects: [] },
];

test('правило — решение владелицы: четыре общих гейта и снятый смоук T13', () => {
  assert.equal(rule.decision, 'D-2026-MIG-118-OWNER-ANSWERS-1119');
  assert.deepEqual(rule.global, ['QG-LORE-BLOCKED-REASON', 'QG-LORE-PROJECT-BINDING', 'QG-LORE-PROJECT-ROLES', 'qg-lore-storage']);
  assert.deepEqual(Object.keys(rule.retire), ['QG-T13-SMOKE']);
  assert.ok(rule.retire['QG-T13-SMOKE'].length > 0, 'снятие требует причины (ADR-LORE-053-D7)');
});

test('план: общие — global и без проекта, остальные с проектом — project, T13 — retired с причиной', () => {
  const p = planQgScope(gates, rule);
  assert.deepEqual(p.scope, {
    'QG-LORE-BLOCKED-REASON': 'global', 'QG-LORE-PROJECT-BINDING': 'global', 'QG-LORE-PROJECT-ROLES': 'global', 'qg-lore-storage': 'global',
    'QG-AIDA-ARCH': 'project', 'QG-SITE-V2-COVERAGE': 'project',
  });
  assert.deepEqual(p.dropProjectLinks, ['QG-LORE-BLOCKED-REASON', 'QG-LORE-PROJECT-BINDING', 'QG-LORE-PROJECT-ROLES', 'qg-lore-storage']);
  assert.deepEqual(p.retire, [{ qg_id: 'QG-T13-SMOKE', reason: rule.retire['QG-T13-SMOKE'] }]);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.counts, { global: 4, project: 2, retired: 1, project_links_dropped: 4 });
});

test('отклонения называются, а не теряются: гейт правила не найден, проектный без проекта, проектный с двумя проектами', () => {
  const p = planQgScope([
    { qg_id: 'QG-X', status: 'draft', projects: [] },
    { qg_id: 'QG-Y', status: 'active', projects: ['A/a', 'B/b'] },
  ], { global: ['QG-GONE'], retire: { 'QG-T13-SMOKE': 'r' } });
  assert.deepEqual(p.problems.map(x => x.qg_id + ':' + x.kind),
    ['QG-GONE:rule_gate_missing', 'QG-T13-SMOKE:rule_gate_missing', 'QG-X:no_project', 'QG-Y:many_projects']);
});

test('применение в приёмник: признак, снятие проектных связей общих, снятие T13 — и сверка «после»', async () => {
  const cmds = [];
  const state = new Map(gates.map(g => [g.qg_id, { ...g, scope: null }]));
  const db = {
    dstCommand: async (sql, p = {}) => {
      cmds.push(sql);
      if (sql.startsWith('UPDATE QualityGate SET scope')) state.get(p.id).scope = p.s;
      if (sql.startsWith('UPDATE QualityGate SET status')) Object.assign(state.get(p.id), { status: 'retired', retired_reason: p.r });
      if (sql.startsWith('DELETE FROM #')) for (const g of state.values()) if (g.edgeRids && g.edgeRids.includes(sql.slice(12))) g.projects = [];
      return [];
    },
    dstQuery: async (sql, p = {}) => {
      if (sql.includes('FROM BELONGS_TO_PROJECT')) return p.ids.flatMap(id => state.get(id).projects.map((s, i) => {
        const r = `#9:${id.length}${i}`; (state.get(id).edgeRids ||= []).push(r); return { r };
      }));
      return [...state.values()].map(g => ({ qg_id: g.qg_id, status: g.status, scope: g.scope, retired_reason: g.retired_reason || null, projects: g.projects }));
    },
  };
  const r = await applyQgScope(db, gates, rule, { log: () => {} });
  assert.ok(cmds.includes('CREATE PROPERTY QualityGate.scope IF NOT EXISTS STRING'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.after, { global: 4, project: 2, retired: 1, global_with_project: 0, unscoped: 0 });
  assert.equal(r.project_links_dropped, 4);
  assert.equal(state.get('QG-T13-SMOKE').status, 'retired');
});

// ── База старше правила: гейта ещё не существовало (MIG-04, прогон 22.11.2026) ──
// На бэкапе прода от 01.11 правило называло QG-LORE-BLOCKED-REASON и QG-LORE-PROJECT-BINDING,
// которых в той базе нет. Переносить нечего — установка идти должна, пропуск — вслух.
test('мягкий режим: гейта нет в источнике — пропуск с именем, не ошибка', () => {
  const v = judgeQgScope({ ok: true, problems: [{ qg_id: 'QG-LORE-BLOCKED-REASON', kind: 'rule_gate_missing' }] }, { strict: false });
  assert.equal(v.ok, true);
  assert.match(v.line, /QG-LORE-BLOCKED-REASON/);
});

// Правка 22.11.2026 по живому прогону на чужой машине. Сначала я записала «гейт без проекта — красный всегда».
// Прогон показал, что для чужой установки это неверно: на снимке нашего прода 20 гейтов без проекта, и перенос
// объявлял «НЕ сошлась», хотя НИЧЕГО не записал неправильно — охват просто нечему задать. Человек получил бы
// красную установку и список, который не может починить. Теперь: мягкий режим — остаток с именем; строгий (наша
// труба на свежем снимке) по-прежнему красный, потому что у НАС это настоящая дыра в данных.
test('мягкий режим: гейт без проекта — остаток с именем, перенос не роняется', () => {
  const v = judgeQgScope({ ok: true, problems: [{ qg_id: 'QG-X', kind: 'no_project' }] }, { strict: false });
  assert.equal(v.ok, true);
  assert.match(v.line, /QG-X/);
  assert.match(v.line, /нет проекта/, 'причина называется своими словами, а не «нет в источнике»');
});

test('строгий режим: гейт без проекта — красный, это дыра в наших данных', () => {
  assert.equal(judgeQgScope({ ok: true, problems: [{ qg_id: 'QG-X', kind: 'no_project' }] }, { strict: true }).ok, false);
});

test('гейт в нескольких проектах — красный всегда: охват неоднозначен', () => {
  for (const strict of [false, true])
    assert.equal(judgeQgScope({ ok: true, problems: [{ qg_id: 'QG-Z', kind: 'many_projects' }] }, { strict }).ok, false);
});

test('строгий режим нашей трубы краснеет и на отсутствующем гейте', () => {
  assert.equal(judgeQgScope({ ok: true, problems: [{ qg_id: 'QG-Y', kind: 'rule_gate_missing' }] }, { strict: true }).ok, false);
});

test('несошедшаяся запись остаётся красной и без отклонений', () => {
  assert.equal(judgeQgScope({ ok: false, problems: [] }, { strict: false }).ok, false);
});

// ── «Записалось ли» не должно требовать невозможного (прогон на чужой машине 22.11.2026) ──
// Утренняя правка вердикта (no_project — остаток, а не отказ) не помогла: шаг всё равно объявлял «НЕ сошлась»,
// потому что признак «записалось» требовал after.unscoped === 0. А гейты без проекта охвата не получают НИКОГДА —
// им его неоткуда взять. Получалось условие, которое на снимке нашего прода (20 таких гейтов) не выполнимо,
// сколько ни чини вердикт. Правильно: без охвата могут остаться ровно те гейты, у которых нет проекта.
import { qgWritten } from './qg-scope.mjs';

test('записалось: без охвата остались ровно гейты без проекта — это полная запись', () => {
  assert.equal(qgWritten({ after: { global: 2, project: 0, global_with_project: 0, unscoped: 20 },
    counts: { global: 2, project: 0, project_links_dropped: 0 }, dropped: 0, noProject: 20, retireOk: true }), true);
});

test('записалось: без охвата остался ЛИШНИЙ гейт — запись неполна, это красный', () => {
  assert.equal(qgWritten({ after: { global: 2, project: 0, global_with_project: 0, unscoped: 21 },
    counts: { global: 2, project: 0, project_links_dropped: 0 }, dropped: 0, noProject: 20, retireOk: true }), false);
});

test('записалось: общий гейт со связью на проект — всегда красный, связь обязаны были снять', () => {
  assert.equal(qgWritten({ after: { global: 2, project: 0, global_with_project: 1, unscoped: 0 },
    counts: { global: 2, project: 0, project_links_dropped: 0 }, dropped: 0, noProject: 0, retireOk: true }), false);
});
