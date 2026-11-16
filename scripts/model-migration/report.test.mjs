// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — отчёт о переносе документом (шаг 11 описания процесса, 16.11.2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from './report.mjs';

const input = () => ({
  when: '2026-11-16T19:00:00Z', who: 'omiloreadmin', source: 'migration_src_2026_11_15', target: 'migration_dst_win_A',
  dialog: { summary: { unified: 190, decided: 106, needs_decision: 0, records: 23945 }, fingerprint: 'e7a7c29de00f4691' },
  decisions: [
    { id: 'ST-01', scope: { type: 'KnowADRHist', field: 'status_raw', why: 'пусто' }, action: 'map_to', to: 'DRAFT', by: 'omiloreadmin', at: '2026-11-16T16:40:00Z' },
    { id: 'A-012', scope: { type: 'KnowSprintHist', field: 'status_raw', value: '✅ CLOSED' }, action: 'map_to', to: 'DONE', by: 'агент', at: '2026-11-16T18:30:00Z' },
  ],
  transfer: { stages: { read: { KnowSprint: 542 }, write: { records: { KnowSprint: 542 }, links: 18444, leftovers: 1447 },
    verify: { ok: true, counts: { KnowSprint: { source: 542, target: 542 } } } } },
  edges: { ok: true, moved: { PART_OF: { source: 6787, target: 6787 } }, waiting: { BELONGS_TO_PROJECT: { links: 585 } }, dropped: { HAS_PR: 155 }, anomalies: [] },
  fingerprint: { total: '92c1908f785fa21b', types: { KnowSprint: { n: 542, fp: 'x' } } },
});

test('отчёт называет источник, новую базу, кто и когда, итог сверки и отпечаток', () => {
  const h = buildReport(input());
  for (const s of ['migration_src_2026_11_15', 'migration_dst_win_A', 'omiloreadmin', '2026-11-16', '92c1908f785fa21b', 'e7a7c29de00f4691', 'Сверка сошлась'])
    assert.ok(h.includes(s), s);
});

test('отчёт перечисляет решения с автором и что не перенесено с причиной', () => {
  const h = buildReport(input());
  assert.ok(h.includes('ST-01') && h.includes('DRAFT') && h.includes('A-012'), 'решения');
  assert.ok(h.includes('BELONGS_TO_PROJECT') && h.includes('585'), 'ждут своего объекта');
  assert.ok(h.includes('HAS_PR') && h.includes('155'), 'не переносится');
  assert.ok(h.includes('1447'), 'остаток');
});

test('несошедшаяся сверка — красный итог, не «сошлось»', () => {
  const x = input(); x.transfer.stages.verify.ok = false;
  const h = buildReport(x);
  assert.ok(h.includes('Сверка НЕ сошлась'));
  assert.ok(!h.includes('Сверка сошлась'));
});

test('отчёт — светлая тема и без внешних скриптов; текст экранирован', () => {
  const x = input(); x.decisions[1].scope.value = '<script>alert(1)</script>';
  const h = buildReport(x);
  assert.ok(h.includes('color-scheme:light'));
  assert.ok(!/<script/i.test(h), 'в отчёте нет исполняемого кода');
  assert.ok(h.includes('&lt;script&gt;'));
});
