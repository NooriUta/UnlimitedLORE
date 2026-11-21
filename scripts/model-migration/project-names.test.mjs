// 1.18 · код, краткое и полное название, описание проекта (владелица 21.11.2026: «не вижу на препроде полей,
// перепроверяй, я просила код, краткое название, полное название, описание»; подписи — ru/en/pl). Значения — раздел
// project_names файла решений; проект приёмника — по ключу или прежним ключам (aliases) после перегруппировки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNamesOf, planProjectNames, applyProjectNames } from './project-names.mjs';
import decisions from './rules/decisions.lore.json' with { type: 'json' };

const projects = [
  { slug: 'AIDA/MIDGARD', aliases: ['AIDA/MIDGARD', 'AIDA/GLADSHEIM', 'AIDA/TEIKN', 'AIDA/BOKVIT'], regroup: 'MIDGARD' },
  { slug: 'NooriUta/ODIN', aliases: ['NooriUta/ODIN'], regroup: 'ODIN' },
  { slug: 'NooriUta/aida-documentation', aliases: null, regroup: null },
  { slug: 'NooriUta/BRAGI', aliases: ['NooriUta/BRAGI', 'AIDA/core-services', 'NooriUta/seidr-site'], regroup: 'SEIDR_BACKOFFICE' },
];

test('таблица владелицы в файле решений: 10 проектов, у каждого код и три языка у названий', () => {
  const list = projectNamesOf(decisions);
  assert.deepEqual(list.map(x => x.code), ['DW', 'MIDGARD', 'CORE', 'MINILORE', 'MIGGEN', 'AIDA', 'ODIN', 'LORE', 'DOCS', 'VOLVA']);
  for (const x of list) {
    for (const f of ['short_title', 'title']) assert.deepEqual(Object.keys(x[f]), ['ru', 'en', 'pl'], x.code + '.' + f);
    assert.ok(x.slugs.length > 0, x.code + ': прежние ключи');
  }
  assert.equal(list.find(x => x.code === 'ODIN').description, null, 'у ODIN описания нет — пусто честно');
});

test('проект находится по ключу и по прежним ключам; группа сверяется', () => {
  const p = planProjectNames(projectNamesOf(decisions), projects);
  const by = Object.fromEntries(p.updates.map(u => [u.code, u.slug]));
  assert.equal(by.MIDGARD, 'AIDA/MIDGARD', 'по прежним ключам группы');
  assert.equal(by.ODIN, 'NooriUta/ODIN');
  assert.equal(by.DOCS, 'NooriUta/aida-documentation', 'без группы — по ключу');
  const midgard = p.updates.find(u => u.code === 'MIDGARD').set;
  assert.deepEqual(midgard, { short_code: 'MIDGARD', short_title: 'MIDGARD', short_title_en: 'MIDGARD', short_title_pl: 'MIDGARD',
    name: 'MIDGARD', title_en: 'MIDGARD', title_pl: 'MIDGARD',
    description: 'Хаб GLADSHEIM и сервисы BOKVIT, TEIKN', description_en: 'GLADSHEIM hub and the BOKVIT and TEIKN services',
    description_pl: 'Hub GLADSHEIM oraz usługi BOKVIT i TEIKN' });
  assert.equal(p.updates.find(u => u.code === 'ODIN').set.description, null, 'нет описания — null, не выдумано');
});

test('расхождения названы: проект слит в чужую группу, проекта нет в приёмнике', () => {
  const p = planProjectNames(projectNamesOf(decisions), projects);
  const kinds = Object.fromEntries(p.problems.map(x => [x.code, x.kind]));
  assert.equal(kinds.CORE, 'merged_into_other_group', 'core-services слит в SEIDR_BACKOFFICE — названия CORE легли бы на чужую группу');
  assert.equal(kinds.DW, 'not_found');
  assert.ok(!p.updates.some(u => u.code === 'CORE'), 'на чужую группу не пишется');
});

test('ключи двух строк ведут в один проект — двусмысленность, не тихая перезапись', () => {
  const p = planProjectNames([
    { code: 'A', slugs: ['x/a'], group: 'G', short_title: { ru: 'A' }, title: { ru: 'A' }, description: null },
    { code: 'B', slugs: ['x/b'], group: 'G', short_title: { ru: 'B' }, title: { ru: 'B' }, description: null },
  ], [{ slug: 'x/a', aliases: ['x/a', 'x/b'], regroup: 'G' }]);
  assert.deepEqual(p.problems.map(x => x.code + ':' + x.kind), ['B:same_project_as_A']);
});

test('применение: поля в приёмнике и сверка «после» — у каждого найденного проекта поля заполнены', async () => {
  const state = new Map(projects.map(p => [p.slug, { ...p }]));
  const db = {
    dstCommand: async (sql, p = {}) => {
      if (sql.startsWith('UPDATE KnowGitProject')) { const { slug, ...set } = p; Object.assign(state.get(slug), set); }
      return [];
    },
    dstQuery: async () => [...state.values()],
  };
  const r = await applyProjectNames(db, projectNamesOf(decisions), projects, { log: () => {} });
  assert.equal(r.applied, 3);
  assert.deepEqual(r.unfilled, []);
  assert.equal(state.get('AIDA/MIDGARD').short_title, 'MIDGARD');
  assert.equal(r.ok, false, 'CORE и строки без проекта — сверка не сходится, пока владелица не решит');
  assert.ok(r.problems.length >= 1);
});
