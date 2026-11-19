// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — раздел админки «Перенос»: у строки расхождения — ссылки на записи.
// Сухой прогон к образцу значения кладёт до трёх деловых ключей записей (task_uid, sprint_id…), чтобы
// экран вёл в паспорт записи, а не только называл число. У версий (…Hist) делового ключа нет — ссылок нет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dryRun, REF_KEYS } from './dry-run.mjs';

function fakeDb(rows) {
  return {
    env: { MIG_SRC_DB: 'src' },
    src: async () => [],
    async *scan(T) { for (const r of rows[T] || []) yield r; },
  };
}

test('отказ по значению несёт ключи записей (до трёх), у версий — без ключей', async () => {
  const sprint = (id, p) => ({ '@rid': '#1:' + id, sprint_id: 'SPRINT_' + id, name: 'S' + id, priority: p });
  const db = fakeDb({ KnowSprint: [sprint(1, 'zzz-вне'), sprint(2, 'zzz-вне'), sprint(3, 'zzz-вне'), sprint(4, 'zzz-вне'), sprint(5, 'high')] });
  const r = await dryRun(db, undefined);
  const rej = r.types.KnowSprint.rejects['priority · приоритет вне шкалы'];
  assert.ok(rej, JSON.stringify(r.types.KnowSprint.rejects));
  assert.equal(rej.n, 4);
  assert.equal(rej.samples['zzz-вне'], 4);
  assert.deepEqual(rej.refs['zzz-вне'], ['SPRINT_1', 'SPRINT_2', 'SPRINT_3']);
});

test('ссылки на записи не входят в отпечаток итога: прежние отпечатки приёмки остаются сравнимыми', async () => {
  const { reportFingerprint } = await import('./dry-run.mjs');
  const { fingerprint } = await import('./fingerprint.mjs');
  const bare = { source: 's', types: { KnowSprint: { records: 1, rejects: { 'priority · x': { n: 1, samples: { a: 1 } } } } } };
  const withRefs = { source: 's', types: { KnowSprint: { records: 1, rejects: { 'priority · x': { n: 1, samples: { a: 1 }, refs: { a: ['SPRINT_1'] } } } } } };
  assert.equal(reportFingerprint(withRefs), fingerprint(bare));
});

test('деловой ключ — только у записей; у версий его нет', () => {
  assert.equal(REF_KEYS.KnowTask, 'task_uid');
  assert.equal(REF_KEYS.KnowSprint, 'sprint_id');
  assert.equal(REF_KEYS.KnowTaskHist, undefined);
});
