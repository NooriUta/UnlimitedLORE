// Статус «UAT — приёмка» (uat, 🧪 UAT TESTING) в v1, правило владелицы 13.11.2026.
import { describe, expect, it } from 'vitest';
import { taskTick, statusMeta } from './lore-status';
import { STATUS_ORDER } from './LorePlanBoard';
import { categoryOf } from '../../api/contracts/s1';

describe('v1: статус uat', () => {
  it('taskTick читает 🧪 UAT TESTING как uat, задача не закрыта', () => {
    expect(taskTick('🧪 UAT TESTING')).toEqual({ status: 'uat', done: false });
    expect(taskTick('UAT TESTING')).toEqual({ status: 'uat', done: false });
  });

  it('иконка stamper и цвет --st-uat', () => {
    expect(statusMeta('uat')).toMatchObject({ icon: 'stamper', color: 'var(--st-uat)' });
  });

  it('на доске стоит сразу после ready_for_deploy', () => {
    expect(STATUS_ORDER[STATUS_ORDER.indexOf('ready_for_deploy') + 1]).toBe('uat');
  });

  it('категория — в работе', () => {
    expect(categoryOf('task', 'uat')).toBe('in_progress');
  });
});
