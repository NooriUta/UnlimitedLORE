// Статус задачи «UAT — приёмка» (uat, 🧪 UAT TESTING), правило владелицы 13.11.2026:
// после 🚀 READY FOR DEPLOY агент проверяет задачу на стенде как пользователь и
// переводит её в UAT; принимает и ставит done только человек.
import { describe, expect, it } from 'vitest';
import { planStatusOf, PLAN_STATUSES, planStatuses } from './taskStatus';
import { taskStatusCode, TASK_STATUS_CODES } from '../tasks/taskRecord';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

describe('статус uat в v2', () => {
  it('сырой статус сервера читается как uat обоими читателями', () => {
    for (const raw of ['🧪 UAT TESTING', 'UAT TESTING', 'Приёмка у владелицы']) {
      expect(planStatusOf(raw)).toBe('uat');
      expect(taskStatusCode(raw)).toBe('uat');
    }
    expect(planStatusOf('🚀 READY FOR DEPLOY')).toBe('ready_for_deploy');
  });

  it('пишется через /lore/status и стоит между RFD и done', () => {
    expect(PLAN_STATUSES).toContain('uat');
    const items = planStatuses(c => c).items.map(i => i.code);
    expect(items[items.indexOf('ready_for_deploy') + 1]).toBe('uat');
    const codes = [...TASK_STATUS_CODES];
    expect(codes[codes.indexOf('ready_for_deploy') + 1]).toBe('uat');
  });

  it('чип: иконка stamper и цвет --st-uat, категория «в работе»', () => {
    const it = planStatuses(c => c).items.find(i => i.code === 'uat');
    expect(it).toMatchObject({ icon: 'stamper', color: 'var(--st-uat)', category: 'active' });
  });

  it('подписи во всех словарях v2', () => {
    const r = ru as Record<string, string>, e = en as Record<string, string>;
    for (const k of ['lists.status.uat', 'status.uat', 'record.status.uat']) {
      expect(r[k], k).toBeTruthy();
      expect(e[k], k).toBeTruthy();
    }
  });
});
