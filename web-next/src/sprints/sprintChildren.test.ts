// PU-07 (вопрос владелицы 14.11.2026): у задачи — релиз, в который уехал ЕЁ PR, а не релиз
// спринта. Вложенная таблица задач под строкой спринта брала релиз родителя, и запланированная
// или отменённая задача показывала «v1.17.0» спринта (приёмка препрода 0dccfe73, SPRINT_UXR_S7A_NEWS).
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '@seidr/kit';
import { loadSprintChildren } from './sprintChildren';
import type { LoreClient } from './loreClient';

const sprint = { id: 'SPRINT_X', kind: 'sprint', title: 'S', status: 'active', fields: { release: ['v1.17.0'] } } as unknown as KitRecord;

function clientWith(rows: Record<string, unknown>[]): LoreClient {
  return { slice: async () => ({ rows }) } as unknown as LoreClient;
}

describe('loadSprintChildren — релиз задачи (PU-07)', () => {
  it('задача без PR в релизе — колонка пуста, релиз спринта не наследуется', async () => {
    const rows = await loadSprintChildren(clientWith([{ task_uid: 'SPRINT_X/T1', task_id: 'T1', title: 't', status_raw: '📋 PLANNED' }]), sprint, new AbortController().signal);
    expect(rows[0].fields.release).toEqual([]);
  });

  it('задача, чей PR уехал в релиз, — релиз её PR', async () => {
    const rows = await loadSprintChildren(clientWith([{ task_uid: 'SPRINT_X/T2', task_id: 'T2', title: 't', status_raw: '✅ DONE', release_ids: ['v1.17.20'] }]), sprint, new AbortController().signal);
    expect(rows[0].fields.release).toEqual(['v1.17.20']);
  });
});
