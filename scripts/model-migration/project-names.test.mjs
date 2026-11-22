// 1.18 · код, краткое и полное название, описание проекта (владелица 21.11.2026: «не вижу на препроде полей,
// перепроверяй, я просила код, краткое название, полное название, описание»; подписи — ru/en/pl). Значения — раздел
// project_names файла решений; проект приёмника — по ключу или прежним ключам (aliases) после перегруппировки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNamesOf, planProjectNames, applyProjectNames } from './project-names.mjs';
import { judgeProjectNames } from './project-names.mjs';
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

test('строка CORE — это группа SEIDR_BACKOFFICE (опора core-services, влиты seidr-site, BRAGI, studio, freyja, mobilekit)', () => {
  const p = planProjectNames(projectNamesOf(decisions), projects);
  assert.equal(p.updates.find(u => u.code === 'CORE')?.slug, 'NooriUta/BRAGI', 'по любому прежнему ключу группы, какая бы опора ни вышла');
  const core = projectNamesOf(decisions).find(x => x.code === 'CORE');
  assert.equal(core.group, 'SEIDR_BACKOFFICE');
  assert.deepEqual([...core.slugs].sort(), ['AIDA/core-services', 'AIDA/freyja', 'AIDA/miniLoremobilekit', 'AIDA/studio', 'NooriUta/BRAGI', 'NooriUta/seidr-site']);
});

test('расхождения названы: проект слит в чужую группу, проекта нет в приёмнике', () => {
  const p = planProjectNames(projectNamesOf(decisions), [...projects, { slug: 'NooriUta/volva', aliases: ['NooriUta/volva'], regroup: 'HARPA' }]);
  const kinds = Object.fromEntries(p.problems.map(x => [x.code, x.kind]));
  assert.equal(kinds.VOLVA, 'merged_into_other_group', 'в чужую группу не пишется');
  assert.equal(kinds.DW, 'not_found');
  assert.ok(!p.updates.some(u => u.code === 'VOLVA'));
});

test('все 10 строк таблицы сходятся с группами перегруппировки 1.18', async () => {
  const groups = [
    ['AIDA/Datawanderers-ServerandLore', 'DW', ['AIDA/Datawanderers-ServerandLore', 'AIDA/Datawanderers-Unity']],
    ['AIDA/MIDGARD', 'MIDGARD', ['AIDA/MIDGARD', 'AIDA/GLADSHEIM', 'AIDA/TEIKN', 'AIDA/BOKVIT']],
    ['AIDA/core-services', 'SEIDR_BACKOFFICE', ['AIDA/core-services', 'NooriUta/seidr-site', 'NooriUta/BRAGI', 'AIDA/studio', 'AIDA/freyja', 'AIDA/miniLoremobilekit']],
    ['AIDA/miniLORE', 'MINILORE', ['AIDA/miniLORE', 'AIDA/miniLore_serverside', 'AIDA/qwen-code-fork']],
    ['AIDA/udwe-mig-gen', 'MIGGEN', ['AIDA/udwe-mig-gen', 'AIDA/udwe-engine', 'AIDA/udwe-rollout', 'ivanovalex32/UDWE']],
    ['NooriUta/AIDA', 'AIDA', ['NooriUta/AIDA', 'NooriUta/AIDA-TestPlayGround']],
    ['NooriUta/ODIN', 'ODIN', ['NooriUta/ODIN']],
    ['NooriUta/UnlimitedLORE', 'OMILORE', ['NooriUta/UnlimitedLORE', 'AIDA/forgejo-mcp']],
    ['NooriUta/aida-documentation', null, null],
    ['NooriUta/volva', 'VOLVA', ['NooriUta/volva']],
  ].map(([slug, regroup, aliases]) => ({ slug, regroup, aliases }));
  const state = new Map(groups.map(p => [p.slug, { ...p }]));
  const db = {
    dstCommand: async (sql, p = {}) => { if (sql.startsWith('UPDATE KnowGitProject')) { const { slug, ...set } = p; Object.assign(state.get(slug), set); } return []; },
    dstQuery: async () => [...state.values()],
  };
  const r = await applyProjectNames(db, projectNamesOf(decisions), groups, { log: () => {} });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.unfilled, []);
  assert.equal(r.applied, 10);
  assert.equal(r.ok, true);
  assert.equal(state.get('AIDA/core-services').short_code, 'CORE');
  assert.equal(state.get('AIDA/core-services').name, 'Общие сервисы студии');
});

test('перегруппировка: UnlimitedLORE — в OMILORE явно, а не «первым из двух» (продукты OMILORE и HARPA)', () => {
  assert.equal(decisions.projects.map['NooriUta/UnlimitedLORE'], 'OMILORE');
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
  assert.equal(r.applied, 4);
  assert.deepEqual(r.unfilled, []);
  assert.equal(state.get('AIDA/MIDGARD').short_title, 'MIDGARD');
  // 22.11.2026, MIG-04: прежде здесь ждали ok=false — «строки без проекта в приёмнике — сверка не сходится».
  // Правило изменено по находке прогона установщика: у друга база СТАРШЕ нашей таблицы, и «такого проекта нет»
  // значит «переносить нечего», а не ошибка. Пропуск обязан быть назван поимённо; красной установка от него
  // больше не становится. В строгом режиме нашей трубы прежнее поведение сохранено — см. тест ниже.
  assert.equal(r.ok, true, 'нет проекта в приёмнике — пропуск, а не расхождение');
  assert.ok(r.problems.length >= 1, 'пропущенные строки по-прежнему перечислены');
  assert.ok(r.absent_in_source.length >= 1, 'и названы отдельно от настоящих расхождений');
});

// ── База старше таблицы названий (MIG-04, прогон 22.11.2026) ──
// На бэкапе прода от 01.11 шаг краснел: код DW вёл сразу в два проекта (их слили в группу позже),
// часть строк не находила проекта вовсе. Переносить нечего — это не ошибка, но названо быть должно.
test('мягкий режим: «нет такого проекта» и «ещё не слиты в группу» не роняют установку', () => {
  const v = judgeProjectNames({ problems: [{ code: 'DW', kind: 'ambiguous', projects: ['a', 'b'] },
    { code: 'X', kind: 'not_found', slugs: ['Ghost/x'] }], unfilled: [] }, { strict: false });
  assert.equal(v.ok, true);
  assert.deepEqual(v.absent.map(p => p.code), ['DW', 'X']);
  assert.match(v.line, /DW/);
});

test('настоящее расхождение красное в обоих режимах', () => {
  for (const strict of [false, true]) {
    assert.equal(judgeProjectNames({ problems: [{ code: 'A', kind: 'same_project_as_B' }], unfilled: [] }, { strict }).ok, false);
    assert.equal(judgeProjectNames({ problems: [], unfilled: [{ code: 'A', fields: ['name'] }] }, { strict }).ok, false,
      'записали и не сошлось — это запись, а не отсутствие');
  }
});

test('строгий режим нашей трубы краснеет и на пропуске', () => {
  assert.equal(judgeProjectNames({ problems: [{ code: 'DW', kind: 'ambiguous' }], unfilled: [] }, { strict: true }).ok, false);
});
