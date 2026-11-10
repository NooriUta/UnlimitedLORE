// D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS, продолжение (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Владелица 10.11, вопрос №49: «по последней дате изменения — это свежесть».
//
// Свежесть записи kit (updated_at) берётся из changed_at среза — времени
// последнего изменения записи (valid_from открытой версии SCD2, иначе дата
// заведения), а не из даты заведения. У задач и спек времени раньше не было
// вовсе — теперь есть, и раздел получает умолчание «свежее сверху».
import { describe, expect, it } from 'vitest';
import {
  adrRecord, decisionRecord, featureRecord, questionRecord, releaseRecord,
  specRecord, sprintRecord, taskListRecord,
} from './records';
import { LIST_SCREENS } from './screens';

const CHANGED = '2026-11-10T09:30:00.000Z';
const OLD = '2026-01-01';

/** Маппер · ключ строки · прежний источник свежести (дата заведения или своя дата). */
const cases = [
  ['sprints', sprintRecord, { sprint_id: 'S', valid_from: OLD, created_date: OLD }],
  ['adrs', adrRecord, { adr_id: 'A', date_created: OLD }],
  ['decisions', decisionRecord, { decision_id: 'D', date_created: OLD }],
  ['features', featureRecord, { uc_id: 'U', date_created: OLD }],
  ['questions', questionRecord, { question_id: 'Q', opened_date: OLD }],
  ['releases', releaseRecord, { release_uid: 'R', release_date: OLD }],
  ['tasks', taskListRecord, { task_uid: 'SPRINT_X/T1' }],
  ['specs', specRecord, { spec_id: 'SPEC-X' }],
] as const;

describe('свежесть записи = changed_at среза (вопрос №49)', () => {
  it.each(cases)('%s: updated_at берётся из changed_at, а не из даты заведения', (_id, map, row) => {
    expect(map({ ...row, changed_at: CHANGED }).updated_at).toBe(CHANGED);
  });

  it('задачи и спеки без changed_at времени не выдумывают', () => {
    expect(taskListRecord({ task_uid: 'SPRINT_X/T1' }).updated_at).toBeUndefined();
    expect(specRecord({ spec_id: 'SPEC-X' }).updated_at).toBeUndefined();
  });

  it('у задач и спек теперь умолчание порядка — свежее сверху', () => {
    expect((LIST_SCREENS.tasks as { defaultSort?: unknown }).defaultSort).toEqual({ key: 'updated_at', dir: 'desc' });
    expect((LIST_SCREENS.specs as { defaultSort?: unknown }).defaultSort).toEqual({ key: 'updated_at', dir: 'desc' });
  });
});
