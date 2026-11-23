// SPRINT_LORE_ADMIN_POLISH/AP-DICT-UPSERT-DUP · настройка qg.actions_projects → гейт канала Actions с ребром на проект.
// Решение владелицы 21.11.2026 «перевязать не к репозиторию, а к проекту, они схлопнутся»; выбор владельца 23.11.2026 —
// вариант «а»: гейт QG-LORE-CI-ACTIONS с ребром BELONGS_TO_PROJECT (QG-01), настройка удаляется.
// На снимке прода две строки: «AIDA/UnlimitedLORE» (путь на Forgejo) и «NooriUta/UnlimitedLORE» (slug проекта).
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitActionsSetting, planQgActions, applyQgActions, isActionsGate, ACTIONS_ROUTINE, GATE_ID } from './qg-actions.mjs';

const row = (rid, code, label) => ({ rid, res: { out: { dict_type: 'app_setting', code, label_ru: label } } });
const LORE = { slug: 'NooriUta/UnlimitedLORE', hosts: [
  { role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE' },
  { role: 'mirror', base_url: 'https://github.com/NooriUta/UnlimitedLORE' }] };
const AIDA = { slug: 'NooriUta/AIDA', hosts: [{ role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/aida-root' }] };

test('строки настройки снимаются из справочника, убыль объявлена с причиной; прочие настройки на месте', () => {
  const rows = [row('#340:155', 'qg.actions_projects', 'AIDA/UnlimitedLORE'), row('#340:156', 'qg.actions_projects', 'NooriUta/UnlimitedLORE'),
    row('#340:10', 'charts.layer', 'volva')];
  const r = splitActionsSetting(rows);
  assert.deepEqual(r.keep.map(x => x.rid), ['#340:10']);
  assert.deepEqual(r.values, ['AIDA/UnlimitedLORE', 'NooriUta/UnlimitedLORE']);
  assert.deepEqual(r.leftovers.map(x => [x.src_rid, x.kind, x.value]), [
    ['#340:155', 'replaced_by_gate', 'AIDA/UnlimitedLORE'], ['#340:156', 'replaced_by_gate', 'NooriUta/UnlimitedLORE']]);
  assert.match(r.leftovers[0].why, new RegExp(GATE_ID));
});

test('обе строки — один проект (slug и путь основного репозитория): схлопываются в один гейт с ребром на проект', () => {
  const p = planQgActions({ values: ['AIDA/UnlimitedLORE', 'NooriUta/UnlimitedLORE'], gates: [], projects: [LORE, AIDA] });
  assert.deepEqual(p.create, [{ qg_id: GATE_ID, project: 'NooriUta/UnlimitedLORE' }]);
  assert.deepEqual(p.problems, []);
});

test('гейт канала Actions уже есть в источнике — новый не заводится', () => {
  const gates = [{ qg_id: 'QG-LORE-CI-ACTIONS', status: 'active', content_md: '**Routine:** `qg-actions-poll`', projects: ['NooriUta/UnlimitedLORE'] }];
  const p = planQgActions({ values: ['NooriUta/UnlimitedLORE'], gates, projects: [LORE] });
  assert.deepEqual(p.create, []);
  assert.deepEqual(p.existing, ['QG-LORE-CI-ACTIONS']);
});

test('перегруппировка: гейт ведёт в проект-опору группы', () => {
  const p = planQgActions({ values: ['NooriUta/UnlimitedLORE'], gates: [], projects: [LORE], anchorOf: { 'NooriUta/UnlimitedLORE': 'LORE' } });
  assert.deepEqual(p.create, [{ qg_id: GATE_ID, project: 'LORE' }]);
});

test('значение не ведёт ни в один проект — отклонение названо, гейт не выдумывается', () => {
  const p = planQgActions({ values: ['ghost/repo'], gates: [], projects: [LORE] });
  assert.deepEqual(p.create, []);
  assert.deepEqual(p.problems, [{ value: 'ghost/repo', kind: 'value_no_project' }]);
});

test('настройки не было — делать нечего', () => {
  assert.deepEqual(planQgActions({ values: [], gates: [], projects: [LORE] }), { create: [], existing: [], problems: [] });
});

test('признак гейта канала Actions — рутина полем или в тексте; снятый не в счёт', () => {
  assert.equal(isActionsGate({ qg_id: 'X', routine_name: ACTIONS_ROUTINE }), true);
  assert.equal(isActionsGate({ qg_id: 'X', content_md: '**Routine:** `qg-actions-poll`' }), true);
  assert.equal(isActionsGate({ qg_id: 'X', status: 'retired', routine_name: ACTIONS_ROUTINE }), false);
  assert.equal(isActionsGate({ qg_id: 'X', content_md: '**Routine:** `qg-aida-arch`' }), false);
});

test('запись: гейт project/active с рутиной и ребром на проект; повторный перенос не плодит второй', async () => {
  const cmds = [];
  const gates = new Map();
  const db = {
    dstCommand: async (sql, p = {}) => {
      cmds.push(sql);
      if (sql.startsWith('INSERT INTO QualityGate')) gates.set(p.c.qg_id, { ...p.c, projects: [] });
      if (sql.startsWith('CREATE EDGE BELONGS_TO_PROJECT')) gates.get(p.id).projects.push(p.s);
      return [];
    },
    dstQuery: async (sql, p = {}) => {
      if (sql.includes('FROM KnowGitProject')) return [{ slug: p.s }];
      if (sql.includes('FROM QualityGate')) return [...gates.values()].filter(g => !p.id || g.qg_id === p.id);
      return [];
    },
  };
  const plan = { create: [{ qg_id: GATE_ID, project: 'NooriUta/UnlimitedLORE' }], existing: [], problems: [] };
  const r = await applyQgActions(db, plan, { log: () => {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  const g = gates.get(GATE_ID);
  assert.equal(g.scope, 'project');
  assert.equal(g.status, 'active');
  assert.equal(g.routine_name, ACTIONS_ROUTINE);
  assert.match(g.content_md, /\*\*Routine:\*\* `qg-actions-poll`/);
  assert.deepEqual(g.projects, ['NooriUta/UnlimitedLORE']);
  const again = await applyQgActions(db, plan, { log: () => {} });
  assert.equal(again.ok, true);
  assert.equal(cmds.filter(s => s.startsWith('INSERT INTO QualityGate')).length, 1, 'второй прогон гейт не заводит');
});

test('проекта в приёмнике нет — сверка не сходится, а не молчит', async () => {
  const db = { dstCommand: async () => [], dstQuery: async () => [] };
  const r = await applyQgActions(db, { create: [{ qg_id: GATE_ID, project: 'NooriUta/UnlimitedLORE' }], existing: [], problems: [] }, { log: () => {} });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing_project, ['NooriUta/UnlimitedLORE']);
});
