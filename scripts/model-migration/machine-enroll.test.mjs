// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Регистрация машины из окна установщика: POST /lore/actor/machine (machine_new).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrollBody, enrollVerdict } from './machine-enroll.mjs';

test('тело: код машины строчными, без префикса учётки; harness — код miniLORE', () => {
  assert.deepEqual(enrollBody({ machineId: 'LorCetus', harness: 'claude', dryRun: true }), { machine_id: 'lorcetus', harness: 'claude', dry_run: true });
  assert.deepEqual(enrollBody({ machineId: 'lorcetus' }), { machine_id: 'lorcetus', dry_run: false });
});

test('тело: префикс учётки и кривые символы отбиваются до запроса', () => {
  assert.throws(() => enrollBody({ machineId: 'minilore-link-lorcetus' }), /без префикса/);
  assert.throws(() => enrollBody({ machineId: 'my machine' }), /машин/);
  assert.throws(() => enrollBody({ machineId: '' }), /машин/);
  assert.throws(() => enrollBody({ machineId: 'x', harness: 'Claude Code' }), /harness/);
});

test('план: create — показать, что будет заведено', () => {
  const v = enrollVerdict({ status: 200, body: JSON.stringify({ ok: true, dry_run: true, client_id: 'minilore-link-x', plan: { kind: 'create' }, agents_to_link: ['a1'] }) });
  assert.equal(v.state, 'plan');
  assert.match(v.reason, /minilore-link-x/);
  assert.match(v.reason, /a1/);
});

test('повтор — unchanged, это не ошибка', () => {
  const v = enrollVerdict({ status: 200, body: JSON.stringify({ ok: true, client_id: 'minilore-link-x', plan: { kind: 'unchanged' } }) });
  assert.equal(v.state, 'ok');
  assert.match(v.reason, /уже заведена/);
});

test('записано — ok', () => {
  const v = enrollVerdict({ status: 200, body: JSON.stringify({ ok: true, client_id: 'minilore-link-x', plan: { kind: 'create' }, applied: 3 }) });
  assert.equal(v.state, 'ok');
});

test('чужая машина — 409 с причиной сервера, не перезапись', () => {
  const v = enrollVerdict({ status: 409, body: JSON.stringify({ error: 'MACHINE_TAKEN', message: 'машина x уже заведена, её владелец — Иван' }) });
  assert.equal(v.state, 'fail');
  assert.match(v.reason, /Иван/);
});

test('нет входа или роли — понятная причина; нет ответа — «не смогли»', () => {
  assert.match(enrollVerdict({ status: 401, body: '' }).reason, /вход/);
  assert.equal(enrollVerdict({ status: 403, body: JSON.stringify({ error: 'MACHINE_ENROLL_FORBIDDEN', message: 'только себе' }) }).state, 'fail');
  assert.equal(enrollVerdict({ error: 'ECONNREFUSED' }).state, 'unchecked');
});
