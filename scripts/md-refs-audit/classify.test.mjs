// Положительный контроль классификатора: заведомо правильные и заведомо неправильные ссылки.
// Запуск: node --test scripts/md-refs-audit/classify.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, CLASSES } from './classify.mjs';

const ids = {
  task: new Set(['SPRINT_A/PU-15', 'SPRINT_A/PU-09', 'SPRINT_B/PU-15', 'SPRINT_A/MD-READ-PEEK']),
  sprint: new Set(['SPRINT_A', 'SPRINT_B']),
  adr: new Set(['ADR-LORE-050']),
  decision: new Set(['D-2026-LORE-MD-REF-PASTE-CHECK', 'ADR-LORE-033-D14']),
  spec: new Set(['SPEC-LORE-MD-INLINE-REF']),
  doc: new Set(['claude_rules_global']),
  component: new Set(['FORSETI']),
  release: new Set(['v1.17.17']),
  uc: new Set(['UC-GIT-PR']),
};
const taskCodes = new Map([['PU-15', 2], ['PU-09', 1], ['MD-READ-PEEK', 1]]);
const all = new Set(Object.values(ids).flatMap((s) => [...s]));
const ctx = { ids, taskCodes, anyId: (x) => all.has(x), ownerSprint: 'SPRINT_A' };
const one = (md) => { const r = classify(md, ctx); assert.equal(r.length, 1, `одно упоминание в «${md}», получено ${JSON.stringify(r)}`); return r[0]; };

test('канон: wiki с типом', () => { const r = one('см. [[adr:ADR-LORE-050]].'); assert.equal(r.cls, 'wiki_typed'); assert.ok(!r.broken); });
test('канон: wiki без типа, вид ADR', () => assert.equal(one('[[ADR-LORE-050]]').cls, 'wiki_bare'));
test('канон: wiki без типа, док snake_case', () => assert.equal(one('[[claude_rules_global]]').cls, 'wiki_bare'));
test('канон: wiki без типа, компонент найден по БД', () => assert.equal(one('[[FORSETI]]').cls, 'wiki_bare'));
test('канон: тип:КОД задачи', () => { const r = one('закрыл task:SPRINT_A/PU-15.'); assert.equal(r.cls, 'typed'); assert.equal(r.id, 'SPRINT_A/PU-15'); assert.ok(!r.broken); });
test('канон: ADR:ADR-… в любом регистре типа', () => assert.equal(one('ADR:ADR-LORE-050').cls, 'typed'));
test('канон: release:v1.17.17', () => { const r = one('в release:v1.17.17'); assert.equal(r.cls, 'typed'); assert.ok(!r.broken); });
test('канон: по виду СПРИНТ/КОД', () => { const r = one('задача SPRINT_A/MD-READ-PEEK готова'); assert.equal(r.cls, 'shape'); assert.equal(r.type, 'task'); });
test('канон: по виду решение', () => assert.equal(one('D-2026-LORE-MD-REF-PASTE-CHECK').cls, 'shape'));
test('канон: по виду спринт', () => assert.equal(one('спринт SPRINT_B закрыт').type, 'sprint'));
test('канон: tana @ID', () => assert.equal(one('спроси @SPEC-LORE-MD-INLINE-REF').cls, 'tana'));
test('канон: tana #тип ID', () => assert.equal(one('#adr ADR-LORE-050').cls, 'tana'));

test('нарушение: ID в обратных кавычках', () => { const r = one('правило `ADR-LORE-050` гласит'); assert.equal(r.cls, 'backtick'); });
test('нарушение: [[…]] в обратных кавычках — тоже кавычки', () => assert.equal(one('`[[ADR-LORE-050]]`').cls, 'backtick'));
test('нарушение: одинокий код задачи', () => { const r = one('см. PU-15 выше'); assert.equal(r.cls, 'lone_task'); assert.equal(r.ambiguity, 2); assert.ok(r.sameSprint); });
test('нарушение: одинокий код в [[…]]', () => assert.equal(one('[[PU-09]]').cls, 'lone_task_wiki'));
test('нарушение: URL экрана LORE', () => assert.equal(one('открой http://192.168.3.131:4400/lore?section=sprints&passport=SPRINT_A').cls, 'url_lore'));
test('нарушение: URL new.lore …?open=', () => assert.equal(one('https://new.lore.example/?open=task:SPRINT_A/PU-15').cls, 'url_lore'));
test('нарушение: markdown-ссылка на LORE — одно нарушение, не два', () => { const r = one('[SPRINT_A/PU-15](http://192.168.3.131:4400/lore?passport=x)'); assert.equal(r.cls, 'url_lore'); assert.equal(r.label, 'SPRINT_A/PU-15'); });
// Владелица 13.11.2026: «общие ссылки вида https://github.com/NooriUta/AIDA/pull/495 тоже являются
// легитимными, править не надо» и «внешние ссылки MD должно не быть багом и не быть лишним шумом».
// Внешняя ссылка — не упоминание объекта LORE: её нет ни в нарушениях, ни в справке.
test('внешние ссылки не считаются вовсе: GitHub, Forgejo, любой сайт', () => {
  assert.deepEqual(classify('https://github.com/NooriUta/AIDA/pull/495 и [#710](https://git.seidrstudio.pro/AIDA/aida-root/pulls/710) и https://arcadedb.com/docs', ctx), []);
  assert.equal(CLASSES.url_github, undefined);
  assert.equal(CLASSES.url_forgejo, undefined);
});
test('ID в подписи внешней ссылки — тоже не нарушение и не шум', () => {
  assert.deepEqual(classify('[SPRINT_A/PU-15](https://github.com/x/y/pull/1)', ctx), []);
});
test('нарушение: экранированная wiki', () => assert.equal(one('\\[\\[ADR-LORE-050\\]\\]').cls, 'wiki_escaped'));
test('нарушение: [[…]] с неизвестным типом', () => assert.equal(one('[[foo:BAR]]').cls, 'wiki_unknown'));
test('битая: формы с типом и по виду', () => {
  assert.ok(one('[[ADR-LORE-999]]').broken);
  assert.ok(one('task:SPRINT_A/NOPE-1').broken);
  assert.ok(one('SPEC-NOT-THERE').broken);
});
test('битая: явная ссылка ≠ голый ID без записи', () => {
  assert.equal(one('[[ADR-LORE-999]]').broken, 'explicit');
  assert.equal(one('UC-1 по сценарию').broken, 'shape');
});
test('вид врёт: решение с ID вида ADR-…-Dn — не битая, а «не тот тип»', () => {
  const r = one('реализует [[ADR-LORE-033-D14]]');
  assert.equal(r.cls, 'wiki_bare'); assert.ok(!r.broken); assert.equal(r.wrongType, 'decision');
});
test('кавычки: одинокий код в кавычках — кавычки, не «битая задача»', () => {
  const r = one('`PU-09`'); assert.equal(r.cls, 'backtick'); assert.ok(r.lone); assert.ok(!r.broken);
});
test('не ссылка на объект: голый адрес стенда и API', () => {
  assert.deepEqual(classify('MINILORE_LORE_BASE_URL=http://192.168.3.131:4400 и http://127.0.0.1:4400/lore/version', ctx), []);
});
test('справка: ID в блоке кода', () => assert.equal(one('```\nSPRINT_A/PU-15\n```').cls, 'codeblock'));

test('не ссылки: UTF-8, ISO-8601, время 10:35, путь C:/x, почта a@b', () => {
  assert.deepEqual(classify('UTF-8 и ISO-8601 в 10:35, файл C:/x/y.md, почта a@ADR-LORE-050.ru', ctx).map((r) => r.cls), []);
});
test('не ссылки: код задачи внутри пары не считается одиноким', () => {
  assert.deepEqual(classify('SPRINT_A/PU-15', ctx).map((r) => r.cls), ['shape']);
});
test('детерминизм: тот же вход — тот же выход', () => {
  const md = 'a [[ADR-LORE-050]] b `PU-15` c PU-09 https://github.com/x';
  assert.deepEqual(classify(md, ctx), classify(md, ctx));
});
