// K-14 (SPRINT_UXR_S7B_ADMIN/S7B-23_2): статусы рабочего процесса приложения (у LORE —
// «к выкатке», UAT) — не умолчание kit. kit держит общий словарь и механизм,
// приложение регистрирует свои коды: иконку, токен цвета, категорию, подпись.
import { afterEach, describe, expect, it } from 'vitest';
import { KNOWN_STATUSES, registerStatuses, resetStatuses, statusLabel, statusMeta, sortStatusesByLifecycle as sortStatuses } from './statusMeta';
import { TASK_STATUSES, setTaskStatuses, resetTaskStatuses } from '../tasks/taskGroups';
import { taskStatusName } from '../tasks/TaskTable';

afterEach(() => { resetStatuses(); resetTaskStatuses(); });

describe('реестр статусов', () => {
  it('в умолчании kit нет статусов процесса приложения', () => {
    expect(KNOWN_STATUSES).not.toContain('ready_for_deploy');
    expect(statusMeta('ready_for_deploy').category).toBe('unknown');
    expect([...TASK_STATUSES]).not.toContain('ready_for_deploy');
  });

  it('приложение регистрирует код: иконка, цвет, категория, место в цикле, подпись', () => {
    registerStatuses({ shipped: { icon: 'wave-crest', color: 'st-done', category: 'review', label: { ru: 'Отгружено', en: 'Shipped' } } }, { after: 'partial' });
    expect(statusMeta('shipped')).toEqual({ code: 'shipped', icon: 'wave-crest', color: 'var(--st-done)', category: 'review' });
    expect(KNOWN_STATUSES[KNOWN_STATUSES.indexOf('partial') + 1]).toBe('shipped');
    expect(statusLabel('shipped', 'en')).toBe('Shipped');
    expect(sortStatuses(['done', 'shipped', 'active'])).toEqual(['active', 'shipped', 'done']);
  });

  it('неизвестный якорь «after» — отказ словами, а не молчаливый конец списка', () => {
    expect(() => registerStatuses({ x: { icon: 'help', color: 't3', category: 'active' } }, { after: 'nope' })).toThrow(/nope/);
  });

  it('набор статусов задачи и их подписи — от приложения', () => {
    registerStatuses({ shipped: { icon: 'wave-crest', color: 'st-done', category: 'review', label: { ru: 'Отгружено', en: 'Shipped' } } }, { after: 'partial' });
    setTaskStatuses(['todo', 'active', 'shipped', 'done']);
    expect([...TASK_STATUSES]).toEqual(['todo', 'active', 'shipped', 'done']);
    expect(taskStatusName('ru', 'shipped')).toBe('Отгружено');
    expect(taskStatusName('ru', 'active')).toBe('В работе');
  });
});
