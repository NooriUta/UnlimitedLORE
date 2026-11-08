import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sprintRecord } from './records';
import { sprintKitData } from '../record/loreRecord';

// 08.11.2026, прод v1.17.0: список «Спринты» v2 показывал 72 спринта «вне словаря:
// in_progress» и десятки «вне словаря: done_merged_to_develop…». Причина: после
// переезда «Спринтов» на общий ListScreen (#885) статус спринта брался наивной
// склейкой слов (normStatus), а не словарём shared/lore-statuses.json (planStatusOf):
// «🔄 IN PROGRESS» → in_progress вместо active, «✅ DONE — merged…» → мусорный код.
// Правило: status_raw спринта и задачи читается ТОЛЬКО planStatusOf.
const row = (status_raw: string) => ({ sprint_id: 'S', name: 'S', status_raw });

describe('статус спринта/задачи из status_raw — только словарём (planStatusOf)', () => {
  it.each([
    ['🔄 IN PROGRESS', 'active'],
    ['✅ DONE', 'done'],
    ['✅ DONE — merged to develop', 'done'],
    ['✅ fully done prod v1.2', 'done'],
    ['📋 PLANNED', 'planned'],
    ['🚀 READY FOR DEPLOY', 'ready_for_deploy'],
    ['🟡 PARTIAL', 'partial'],
    ['🔬 DESIGN', 'design'],
    ['🚫 CANCELLED', 'cancelled'],
    ['in_progress', 'active'],
    ['deferred', 'deferred'],
  ])('список: %s → %s', (raw, code) => {
    expect(sprintRecord(row(raw)).status).toBe(code);
  });

  it('паспорт спринта и его задачи — тем же словарём', () => {
    const { record, data } = sprintKitData(
      { ...row('🔄 IN PROGRESS'), planned_end_date: null, context_md: null, valid_from: null } as never,
      [{ task_id: 'T1', title: 't', status_raw: '✅ DONE — merged', order_index: 1 }] as never,
      '2026-11-08T00:00:00Z',
    );
    expect(record.status).toBe('active');
    expect(data.records.find(r => r.id !== record.id)?.status).toBe('done');
  });

  it('сторож: status_raw нигде не нормализуется в обход planStatusOf', () => {
    const files = ['lists/records.ts', 'record/loreRecord.ts', 'record/passportAdapters.ts'];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, '..', f), 'utf8');
      for (const line of src.split('\n')) {
        if (!/status_raw/.test(line) || /^\s*(\/\/|\*|status_raw\s*[?:])/.test(line.trim())) continue;
        if (/norm\(|normStatus\(|toLowerCase\(\)/.test(line)) throw new Error(`${f}: наивный разбор status_raw — ${line.trim()}`);
      }
    }
  });
});
