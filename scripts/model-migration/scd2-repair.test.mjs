// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH Б6 — перенос лечит битую историю SCD2: пустой state_uid, лишние открытые
// версии, запись без текущей версии. Три вида дефекта — три теста, плюс детерминизм и подключение к переносу.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repairVersions, stateUidFor } from './scd2-repair.mjs';

const v = (rid, out) => ({ rid, res: { out: { ...out } } });

test('пустой state_uid заполняется из rid источника — детерминированно', () => {
  const own = [v('#10:1', { state_uid: null, valid_from: '2026-01-01T00:00:00.000Z' }), v('#10:2', { state_uid: '', valid_from: '2026-02-01T00:00:00.000Z', valid_to: null })];
  own[0].res.out.valid_to = '2026-02-01T00:00:00.000Z';
  const r = repairVersions(own, { parent: '#9:1', type: 'KnowTaskHist' });
  assert.equal(r.fixes.state_uid_filled, 2);
  assert.equal(own[0].res.out.state_uid, stateUidFor('#10:1'));
  assert.match(own[1].res.out.state_uid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(own[0].res.out.state_uid, own[1].res.out.state_uid);
  assert.equal(stateUidFor('#10:1'), stateUidFor('#10:1'), 'тот же rid — тот же ключ в каждом прогоне');
  assert.equal(r.leftovers.filter(x => x.field === 'state_uid').length, 2, 'что заполнено — видно в остатке');
});

test('лишние открытые версии закрываются, текущей остаётся самая новая', () => {
  const own = [
    v('#10:1', { state_uid: 'a', valid_from: '2026-01-01T00:00:00.000Z' }),
    v('#10:3', { state_uid: 'c', valid_from: '2026-03-01T00:00:00.000Z' }),
    v('#10:2', { state_uid: 'b', valid_from: '2026-02-01T00:00:00.000Z' }),
  ];
  const r = repairVersions(own);
  assert.equal(r.fixes.extra_open_closed, 2);
  const open = own.filter(x => x.res.out.valid_to == null);
  assert.deepEqual(open.map(x => x.rid), ['#10:3'], 'одна открытая — самая новая');
  for (const x of own.filter(x => x.rid !== '#10:3')) assert.equal(x.res.out.valid_to, '2026-03-01T00:00:00.000Z', 'закрыта моментом открытия текущей');
});

test('запись без текущей версии получает её по последней', () => {
  const own = [
    v('#10:1', { state_uid: 'a', valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-02-01T00:00:00.000Z' }),
    v('#10:2', { state_uid: 'b', valid_from: '2026-02-01T00:00:00.000Z', valid_to: '2026-04-01T00:00:00.000Z' }),
  ];
  const r = repairVersions(own, { parent: '#9:1', type: 'KnowSprintHist' });
  assert.equal(r.fixes.current_reopened, 1);
  assert.equal(own[1].res.out.valid_to, null, 'последняя стала текущей');
  assert.equal(own[0].res.out.valid_to, '2026-02-01T00:00:00.000Z', 'прежние не тронуты');
  const lo = r.leftovers.find(x => x.field === 'valid_to');
  assert.equal(lo.value, '2026-04-01T00:00:00.000Z', 'прежний конец действия сохранён в остатке, ничего не выброшено');
});

test('здоровая история не меняется', () => {
  const own = [
    v('#10:1', { state_uid: 'a', valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-02-01T00:00:00.000Z' }),
    v('#10:2', { state_uid: 'b', valid_from: '2026-02-01T00:00:00.000Z' }),
  ];
  const before = JSON.stringify(own);
  const r = repairVersions(own);
  assert.deepEqual(r.fixes, { state_uid_filled: 0, extra_open_closed: 0, current_reopened: 0 });
  assert.equal(JSON.stringify(own), before);
  assert.equal(r.leftovers.length, 0);
});

test('тип без valid_to или state_uid в схеме — лечится только то, что он ведёт', () => {
  const own = [v('#10:1', { valid_from: '2026-01-01T00:00:00.000Z' }), v('#10:2', { valid_from: '2026-02-01T00:00:00.000Z' })];
  const r = repairVersions(own, { intervals: false, stateUid: false });
  assert.deepEqual(r.fixes, { state_uid_filled: 0, extra_open_closed: 0, current_reopened: 0 });
  assert.ok(own.every(x => !('valid_to' in x.res.out) && !('state_uid' in x.res.out)), 'полей вне схемы не заводим');
});

test('перенос вызывает лечение до сведения полей в текущую версию и пишет счёт в отчёт', () => {
  const src = fs.readFileSync(new URL('./transfer.mjs', import.meta.url), 'utf8');
  assert.ok(/import \{[^}]*repairVersions[^}]*\} from '\.\/scd2-repair\.mjs'/.test(src), 'transfer.mjs подключает scd2-repair.mjs');
  const repairAt = src.indexOf('repairVersions(');
  const openAt = src.indexOf("const open = own.filter");
  assert.ok(repairAt > 0 && repairAt < openAt, 'лечение — до выбора текущей версии');
  assert.ok(/report\.stages\.scd2_repair/.test(src), 'счёт лечения — в отчёте переноса');
});
