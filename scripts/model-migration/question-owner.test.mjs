// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH A6 · Ответственный вопроса — ребро, а не текст.
// Владелица 19.11.2026, ответ «1а»: «Ответственный» у вопроса (KnowQuestion.owner) — ребро к пользователю.
//   - пять написаний владелицы (owner, владелец, владелица, alexa, omiloreadmin) → ребро к пользователю omiloreadmin;
//   - прочий свободный текст: совпал с id агента или пользователя реестра — ребро к нему; иначе ребра нет,
//     значение — в остаток с причиной;
//   - в отчёте — счёт по каждому случаю.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import model from '../../shared/model/lore-model.json' with { type: 'json' };
import { OWNER_EDGE, OWNER_ALIASES, planQuestionOwners, applyQuestionOwners } from './question-owner.mjs';

const users = [
  { rid: '#30:1', kc_sub: '52f6-uuid', display_name: 'omiloreadmin' },
  { rid: '#30:2', kc_sub: '77aa-uuid', display_name: 'ivanovalex32' },
];
const agents = [
  { rid: '#40:1', actor_id: 'AGENT-FULL-msbt0fed' },
  { rid: '#40:2', actor_id: 'AGENT-LORE-ARCH' },
];
const q = (id, owner, rid = '#20:' + id.replace(/\D/g, '')) => ({ rid, question_id: id, owner, mig_src_rid: '#9:' + id.replace(/\D/g, '') });

test('ребро — то, что объявлено в модели: связь вопроса, историчная, поле owner читается с неё', () => {
  assert.equal(OWNER_EDGE, 'ANSWERABLE_BY');
  const qt = model.types.find(t => t.type === 'question');
  assert.ok(qt.relations.some(r => r.rel === OWNER_EDGE && r.dir === 'out'), 'связь вопроса в модели');
  assert.equal(model.edge_fields['question.owner'], OWNER_EDGE, 'поле «Ответственный» — с ребра');
  assert.ok(model.edge_history.edges[OWNER_EDGE], 'история в самом ребре: кто отвечал раньше');
  assert.deepEqual([...OWNER_ALIASES].sort(), ['alexa', 'omiloreadmin', 'owner', 'владелец', 'владелица']);
});

test('пять написаний владелицы → одно ребро к пользователю omiloreadmin, регистр и пробелы не мешают', () => {
  const p = planQuestionOwners({
    questions: [q('Q-1', 'owner'), q('Q-2', 'Владелец'), q('Q-3', ' владелица '), q('Q-4', 'alexa'), q('Q-5', 'omiloreadmin'), q('Q-6', 'OWNER')],
    users, agents,
  });
  assert.equal(p.edges.length, 6);
  for (const e of p.edges) {
    assert.equal(e.to, '#30:1');
    assert.equal(e.target_kind, 'user');
    assert.equal(e.method, 'alias');
  }
  assert.equal(p.counts.alias, 6);
  assert.deepEqual(p.by_value.alias, { owner: 2, 'владелец': 1, 'владелица': 1, alexa: 1, omiloreadmin: 1 });
});

test('свободный текст: id агента или пользователя реестра — ребро к нему; иначе ребра нет, значение в остатке с причиной', () => {
  const p = planQuestionOwners({
    questions: [
      q('Q-1', 'AGENT-FULL-msbt0fed'),
      q('Q-2', 'ivanovalex32'),
      q('Q-3', '77aa-uuid'),
      q('Q-4', 'серверная половина шлюза'),
      q('Q-5', 'AGENT-FULL-нет-такого'),
      q('Q-6', null),
      q('Q-7', '  '),
      q('Q-8', 'owner + claude'),
    ],
    users, agents,
  });
  const by = Object.fromEntries(p.edges.map(e => [e.question, e]));
  assert.equal(by['Q-1'].to, '#40:1');
  assert.equal(by['Q-1'].target_kind, 'agent');
  assert.equal(by['Q-1'].method, 'registry');
  assert.equal(by['Q-2'].to, '#30:2', 'логин пользователя (display_name)');
  assert.equal(by['Q-3'].to, '#30:2', 'kc_sub пользователя');
  assert.deepEqual(p.leftovers.map(x => [x.question, x.value]), [['Q-4', 'серверная половина шлюза'], ['Q-5', 'AGENT-FULL-нет-такого'], ['Q-8', 'owner + claude']]);
  for (const x of p.leftovers) assert.match(x.why, /не совпадает ни с одним id агента или пользователя/);
  assert.deepEqual(p.counts, { questions: 8, alias: 0, registry_user: 2, registry_agent: 1, leftover: 3, empty: 2 });
});

test('пользователя omiloreadmin в реестре нет — написания владелицы не становятся ребром «куда-нибудь», а уходят в остаток', () => {
  const p = planQuestionOwners({ questions: [q('Q-1', 'владелица')], users: [users[1]], agents });
  assert.equal(p.edges.length, 0);
  assert.equal(p.leftovers.length, 1);
  assert.match(p.leftovers[0].why, /omiloreadmin/);
  assert.equal(p.counts.leftover, 1);
});

test('совпадение сразу с агентом и пользователем — неоднозначно: ребра нет, причина названа', () => {
  const p = planQuestionOwners({ questions: [q('Q-1', 'twin')], users: [{ rid: '#30:9', kc_sub: 'twin', display_name: 'twin' }], agents: [{ rid: '#40:9', actor_id: 'twin' }] });
  assert.equal(p.edges.length, 0);
  assert.match(p.leftovers[0].why, /неоднозначно/);
});

test('план детерминирован: порядок строк источника не меняет результат', () => {
  const qs = [q('Q-2', 'alexa'), q('Q-1', 'AGENT-FULL-msbt0fed'), q('Q-3', 'проза')];
  const a = planQuestionOwners({ questions: qs, users, agents });
  const b = planQuestionOwners({ questions: [...qs].reverse(), users: [...users].reverse(), agents: [...agents].reverse() });
  assert.deepEqual(a, b);
  assert.deepEqual(a.edges.map(e => e.question), ['Q-1', 'Q-2']);
});

// Приёмник в памяти: рёбра ANSWERABLE_BY и остаток MigLeftover.
function fakeDb() {
  const edges = [], left = [], ddl = [];
  return {
    edges, left, ddl,
    env: { MIG_DST_DB: 'migration_dst_test' },
    async dstQuery(sql) {
      if (/schema:types/.test(sql)) return [];
      if (/FROM ANSWERABLE_BY/.test(sql)) return edges.filter(e => e.c.mig_rule === 'question-owner').map(e => ({ o: e.from, i: e.to, s: e.c.mig_question }));
      if (/FROM MigLeftover/.test(sql)) return [{ n: left.filter(x => x.kind === 'question_owner').length }];
      throw new Error('запрос не ожидался: ' + sql);
    },
    async dstCommand(sql, p) {
      const m = /CREATE EDGE ANSWERABLE_BY FROM (\S+) TO (\S+)/.exec(sql);
      if (m) { edges.push({ from: m[1], to: m[2], c: p.c }); return [{}]; }
      if (/DELETE FROM ANSWERABLE_BY/.test(sql)) { for (let i = edges.length - 1; i >= 0; i--) if (edges[i].c.mig_rule === 'question-owner') edges.splice(i, 1); return []; }
      if (/DELETE FROM MigLeftover/.test(sql)) { for (let i = left.length - 1; i >= 0; i--) if (left[i].kind === 'question_owner') left.splice(i, 1); return []; }
      if (/INSERT INTO MigLeftover/.test(sql)) { left.push(p.c); return [{}]; }
      if (/CREATE (PROPERTY|EDGE TYPE)/.test(sql)) { ddl.push(sql); return []; }
      throw new Error('команда не ожидалась: ' + sql);
    },
  };
}

test('перенос: рёбра и остаток записаны, сверка сходится, отчёт со счётом по случаям, повтор не плодит дублей', async () => {
  const db = fakeDb();
  const plan = planQuestionOwners({ questions: [q('Q-1', 'owner'), q('Q-2', 'AGENT-FULL-msbt0fed'), q('Q-3', 'проза'), q('Q-4', null)], users, agents });
  const logs = [];
  let r = await applyQuestionOwners(db, plan, { at: '2026-11-19T22:00:00Z', log: (...s) => logs.push(s.join(' ')) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { questions: 4, alias: 1, registry_user: 0, registry_agent: 1, leftover: 1, empty: 1 });
  assert.equal(r.edges, 2);
  assert.equal(r.leftovers, 1);
  assert.ok(db.ddl.some(s => /CREATE EDGE TYPE ANSWERABLE_BY/.test(s)), 'тип ребра заводится');
  assert.ok(db.ddl.some(s => /ANSWERABLE_BY\.valid_from/.test(s)), 'историчная связь: поля версии объявлены');
  const e = db.edges.find(x => x.c.mig_question === 'Q-1');
  assert.equal(e.from, '#20:1');
  assert.equal(e.to, '#30:1');
  assert.equal(e.c.valid_from, '2026-11-19T22:00:00Z');
  assert.equal(e.c.origin, 'migration:alias');
  assert.equal(e.c.mig_value, 'owner');
  assert.deepEqual(db.left[0], { src_type: 'KnowQuestion', src_rid: '#9:3', field: 'owner', value: 'проза', kind: 'question_owner', why: db.left[0].why });
  assert.ok(logs.some(s => /ответственный вопроса/.test(s) && /остаток 1/.test(s)), 'счёт — в журнале: ' + logs.join(' | '));
  r = await applyQuestionOwners(db, plan, { at: '2026-11-19T22:05:00Z', log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(db.edges.length, 2, 'повторный перенос не плодит рёбра');
  assert.equal(db.left.length, 1, 'и остаток');
});
