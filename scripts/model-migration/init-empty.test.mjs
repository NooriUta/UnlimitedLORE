// MIG-01 · «схема и база собираются заново из нормализованной модели». Свежая установка (сценарий А трубы установщика)
// создаёт пустую базу ИЗ МОДЕЛИ тем же путём, что перенос: создать приёмник → схема из модели → справочники; источника
// нет, записей нет. Шаги V на новой установке не запускаются. Эмуляция на ryzenai 21.11.2026: свежая установка строила
// старую схему шагами V (schema_version 93), и срез organizations отвечал 500 — типа KnowOrganization не было.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySourceResult } from './empty-source.mjs';
import { initEmpty, dictEntriesFromRules } from './init-empty.mjs';

test('пустой источник: счёт — ноль, границы ряда — пусто, остальное — ни одной строки', () => {
  assert.deepEqual(emptySourceResult('SELECT count(*) AS n FROM KnowTask'), [{ n: 0 }]);
  assert.deepEqual(emptySourceResult('SELECT o, i, count(*) AS n FROM (SELECT @out.@type AS o FROM X) GROUP BY o, i'), []);
  assert.deepEqual(emptySourceResult('SELECT min(ts) AS a, max(ts) AS b FROM AuditDbLogin'), [{ a: null, b: null }]);
  assert.deepEqual(emptySourceResult('SELECT name, type FROM schema:types'), []);
  assert.deepEqual(emptySourceResult('SELECT FROM KnowTask WHERE @rid > #-1:-1 ORDER BY @rid LIMIT 5000'), []);
});

/** Приёмник в памяти: помнит типы и команды; запросы счёта — ноль, список типов — заведённые. */
function fakeDst() {
  const types = new Set(), commands = [];
  let rid = 0;
  return {
    commands, types,
    env: { MIG_SRC_DB: '(нет источника)', MIG_DST_DB: 'lore', MIG_DB_URL: 'http://x', MIG_PLAN_BOARD: 'drop' },
    async src(q) { return emptySourceResult(q); },
    async *scan() {},
    async dstQuery(q) {
      if (/FROM schema:types/i.test(q)) return [...types].map(name => ({ name }));
      // как ArcadeDB: чтение несуществующего типа — ошибка (ryzenai 21.11: DEPENDS_ON на пустой базе)
      for (const m of String(q).matchAll(/\bFROM\s+([A-Z][A-Za-z0-9_]*)/g))
        if (!types.has(m[1])) throw new Error(`Type with name '${m[1]}' was not found`);
      if (/count\(\*\)/i.test(q)) return [{ n: 0 }];
      return [];
    },
    async dstCommand(q) {
      commands.push(q);
      const m = /^CREATE (?:VERTEX|EDGE|DOCUMENT)? ?TYPE (\w+)/i.exec(q) || /^CREATE TIMESERIES TYPE (\w+)/i.exec(q);
      if (m) types.add(m[1]);
      const d = /^DROP TYPE (\w+)/i.exec(q); if (d) types.delete(d[1]);
      return [{ '@rid': '#9:' + (rid++), count: 1 }];
    },
  };
}

test('пустая база из модели: типы 1.18, отметка схемы из модели, справочники; записей источника нет', async () => {
  const db = fakeDst();
  const r = await initEmpty(db, { log: () => {} });
  for (const T of ['KnowOrganization', 'KnowRepository', 'KnowPR', 'KnowTask', 'KnowSprint', 'LoreModelSchema'])
    assert.ok(db.types.has(T), 'нет типа ' + T + ' в пустой базе из модели');
  assert.ok(db.commands.some(c => /^INSERT INTO LoreModelSchema/.test(c)), 'нет отметки «схема из модели»');
  assert.ok(db.commands.some(c => /^INSERT INTO MigDictEntry/.test(c)), 'нет справочников');
  assert.ok(!db.types.has('LoreSchemaVersion'), 'журнал шагов V в базе из модели не заводится');
  assert.equal(r.ok, true, JSON.stringify(r.problems || []));
  assert.equal(r.records, 0, 'записей источника нет');
});

test('справочники сервера (KnowDictEntry) — из правил переноса: статусы задач и спринтов, остальные словари', async () => {
  const rows = dictEntriesFromRules();
  const todo = rows.find(r => r.dict_type === 'task_status' && r.code === 'TODO');
  assert.ok(todo, 'нет task_status/TODO');
  assert.equal(todo.label_ru, 'К выполнению');
  assert.equal(todo.label_en, 'To Do');
  assert.equal(todo.is_active, true);
  for (const d of ['sprint_status', 'adr_status', 'decision_status', 'spec_status', 'question_status', 'feature_status', 'qg_status', 'priority'])
    assert.ok(rows.some(r => r.dict_type === d), 'нет словаря ' + d);
  const db = fakeDst();
  await initEmpty(db, { log: () => {} });
  assert.ok(db.commands.some(c => /^INSERT INTO KnowDictEntry/.test(c)), 'справочники сервера не записаны');
});

test('связи модели заводятся видом, даже без данных: код сервера пишет их на пустой базе', async () => {
  const db = fakeDst();
  await initEmpty(db, { log: () => {} });
  for (const E of ['HAS_STATE', 'BELONGS_TO_PROJECT', 'HAS_PROJECT_ROLE', 'PART_OF', 'HAS_REPOSITORY'])
    assert.ok(db.types.has(E), 'нет связи ' + E);
});

// SPRINT_LORE_EXT_ISSUES_W2/ISS-02-DICT-SEED-GUARD: UI читает task_type, priority, agent_profile — свежая установка
// обязана их содержать (решение владельца 25.11.2026 «словари сеять каких нет»). Коды и цвета — те же, что у доводки
// схемы кода (UiDictSeed.java): установщик и доводка не расходятся, доводка на такой базе ничего не добавляет.
test('свежая установка сеет словари, которые читает UI: task_type (ADR-LORE-015), priority, agent_profile — с цветами', () => {
  const rows = dictEntriesFromRules();
  const codes = d => rows.filter(r => r.dict_type === d).map(r => r.code);
  assert.deepEqual(codes('task_type'), ['planning', 'design', 'dev', 'test', 'ops', 'research', 'analytics', 'docs', 'content']);
  assert.deepEqual(codes('priority'), ['critical', 'high', 'normal', 'low']);
  assert.deepEqual(codes('agent_profile'), ['full', 'architect', 'developer', 'tester', 'pm', 'analyst', 'marketer', 'product-analyst']);
  for (const d of ['task_type', 'priority', 'agent_profile'])
    for (const r of rows.filter(x => x.dict_type === d)) {
      assert.ok(r.color, `${d}.${r.code}: нет цвета`);
      assert.ok(r.label_en, `${d}.${r.code}: нет подписи en`);
    }
  assert.equal(rows.find(r => r.dict_type === 'priority' && r.code === 'critical').color, 'var(--dng)');
  assert.equal(rows.find(r => r.dict_type === 'task_type' && r.code === 'dev').icon, 'gears');
});

// SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS (решение владельца 25.11.2026): 5а — подписи шести палитр на свежей установке
// (экран настроек больше не пишет «без статьи — показан код»); 6а — цвет статьи справочника — токен темы, не hex.
// Те же статьи и цвета — у доводки схемы кода (PaletteDictSeed.java, UiDictSeed.java).
test('свежая установка сеет подписи шести палитр, цвета словарей — токены темы', () => {
  const rows = dictEntriesFromRules();
  const pal = rows.filter(r => r.dict_type === 'palette');
  assert.deepEqual(pal.map(r => r.code), ['amber-forest', 'lichen', 'slate', 'juniper', 'warm-dark', 'mono']);
  for (const r of pal) {
    assert.ok(r.label_en, 'palette.' + r.code + ': нет подписи en');
    assert.equal(r.color, 'var(--swatch-' + r.code + ')');
  }
  assert.equal(pal.find(r => r.code === 'mono').label_ru, 'приглушённая (mono)', 'подпись mono — как на проде');
  const ARG = String.raw`\s*(?:var\(--[a-z0-9_-]+\)|transparent)(?:\s+\d{1,3}%)?\s*`;
  const TOKEN = new RegExp(String.raw`^(?:var\(--[a-z0-9_-]+\)|color-mix\(\s*in\s+[a-z-]+\s*,` + ARG + ',' + ARG + String.raw`\))$`);
  const raw = rows.filter(r => r.color && !TOKEN.test(r.color)).map(r => r.dict_type + '/' + r.code + '=' + r.color);
  assert.deepEqual(raw, [], 'сырой цвет в правилах установщика');
  assert.equal(rows.find(r => r.dict_type === 'task_type' && r.code === 'dev').color, 'var(--suc)');
});
