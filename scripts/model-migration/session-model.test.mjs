// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Новые связи модели сессий из данных LORE (D-2026-LORE-SESSION-MACHINE-PLACE-MODEL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonMachine, planSessionModel } from './session-model.mjs';

const NOT_MACHINES = ['legion'];

test('машина — строчными; LEGION — имя пользователя Windows, не машина', () => {
  assert.deepEqual(canonMachine('LORCETUS', NOT_MACHINES), { id: 'lorcetus' });
  assert.deepEqual(canonMachine(' LorCetus ', NOT_MACHINES), { id: 'lorcetus' });
  assert.equal(canonMachine('LEGION', NOT_MACHINES).id, null);
  assert.match(canonMachine('LEGION', NOT_MACHINES).why, /пользовател/);
  assert.equal(canonMachine('', NOT_MACHINES).id, null);
});

const base = () => ({
  sessions: [
    { rid: '#s:1', session_id: 'a1', machine_id: 'LORCETUS', project: 'NooriUta/UnlimitedLORE', started_at: '2026-11-10 10:00:00', last_activity_at: '2026-11-11 10:00:00' },
    { rid: '#s:2', session_id: 'a2', machine_id: 'lorcetus', project: 'UnlimitedLORE', started_at: '2026-11-12 10:00:00' },
    { rid: '#s:3', session_id: 'a3', machine_id: 'arharaga', project: 'нет-такого', started_at: '2026-11-01 09:00:00', last_activity_at: '2026-11-02 09:00:00' },
    { rid: '#s:4', session_id: 'a4', machine_id: 'LEGION' },
  ],
  machines: [{ rid: '#m:1', machine_id: 'lorcetus' }],
  projects: [{ rid: '#p:1', slug: 'UnlimitedLORE', full_name: 'NooriUta/UnlimitedLORE' }],
  harness: [{ rid: '#d:1', code: 'claude' }, { rid: '#d:2', code: 'kimi' }],
  actors: [{ rid: '#a:1', harness: 'claude' }, { rid: '#a:2', harness: 'kimi' }, { rid: '#a:3', harness: 'codex' }, { rid: '#a:4' }],
  versions: [
    { rid: '#v:1', changed_by_session: 'a1', changed_by_machine: 'lorcetus' },
    { rid: '#v:2', changed_by_session: 'zz', changed_by_machine: 'lorcetus' },
    { rid: '#v:3' },
  ],
  notMachines: NOT_MACHINES,
});

test('машины из сессий регистрируются: arharaga — новая, со временем первой и последней активности; lorcetus — уже есть', () => {
  const p = planSessionModel(base());
  assert.deepEqual(p.newMachines, [{ machine_id: 'arharaga', first_seen_at: '2026-11-01 09:00:00', last_seen_at: '2026-11-02 09:00:00', registered_from: 'sessions' }]);
});

test('сессия → машина: четыре написания сводятся, LEGION — в отчёт с причиной', () => {
  const p = planSessionModel(base());
  assert.deepEqual(p.edges.NEW_ON_MACHINE, [['#s:1', 'machine:lorcetus'], ['#s:2', 'machine:lorcetus'], ['#s:3', 'machine:arharaga']]);
  assert.equal(p.unresolved.NEW_ON_MACHINE.length, 1);
  assert.match(p.unresolved.NEW_ON_MACHINE[0].why, /пользовател/);
});

test('сессия → проект: по полному имени или slug без учёта регистра; неизвестный — в отчёт', () => {
  const p = planSessionModel(base());
  assert.deepEqual(p.edges.NEW_IN_PROJECT, [['#s:1', '#p:1'], ['#s:2', '#p:1']]);
  assert.deepEqual(p.unresolved.NEW_IN_PROJECT.map(x => x.value), ['нет-такого']);
});

test('агент → harness: код справочника; кода нет в справочнике — в отчёт; harness не задан — не связь', () => {
  const p = planSessionModel(base());
  assert.deepEqual(p.edges.NEW_RUNS_IN, [['#a:1', '#d:1'], ['#a:2', '#d:2']]);
  assert.deepEqual(p.unresolved.NEW_RUNS_IN.map(x => x.value), ['codex']);
});

test('версия → сессия: по паре «машина + код»; сессии нет — в отчёт', () => {
  const p = planSessionModel(base());
  assert.deepEqual(p.edges.NEW_CHANGED_IN, [['#v:1', '#s:1']]);
  assert.deepEqual(p.unresolved.NEW_CHANGED_IN.map(x => x.value), ['lorcetus|zz']);
});

test('ключ сессии — пара: один код на двух машинах — две разные сессии', () => {
  const b = base();
  b.sessions.push({ rid: '#s:5', session_id: 'a1', machine_id: 'arharaga' });
  b.versions = [{ rid: '#v:9', changed_by_session: 'a1', changed_by_machine: 'arharaga' }];
  assert.deepEqual(planSessionModel(b).edges.NEW_CHANGED_IN, [['#v:9', '#s:5']]);
});
