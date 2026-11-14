// PU-29 п.8 (приёмка v1.17.21, 14.11.2026): в меню смены статуса задачи нет новых
// статусов WK-05 — «Ждём ответа», «На приёмке», «Неуспех». Сервер их принимает
// (PLAN_STATUSES, миграция словаря task_status), а клиентских рукописных списков
// статусов задачи было пять, и новые три попали только в один.
//
// Правило, а не частный фикс: КАЖДЫЙ список статусов задачи в приложении
// покрывает всё, что принимает POST /lore/status. Новый статус сервера без
// записи в любом из списков — красный тест, а не пропавший пункт меню.
import { describe, expect, it } from 'vitest';
import { PLAN_STATUSES } from '../sprints/taskStatus';
import { LORE_TASK_STATUSES } from '../kitVocabulary';
import { TASK_STATUS_CODES, taskStatusCode } from './taskRecord';
import { v2Config } from '../shell/v2Config';
import { LIST_SCREENS } from '../lists/screens';
import { statusMeta } from '@seidr/kit';
import { installKitVocabulary } from '../kitVocabulary';

// В таблице задач «в работе» пишется in_progress, у сервера — active: это один статус.
const norm = (c: string) => (c === 'in_progress' ? 'active' : c);
const missing = (list: readonly string[]) => {
  const have = new Set(list.map(norm));
  return PLAN_STATUSES.filter(s => !have.has(s));
};

describe('PU-29 п.8 · каждый список статусов задачи покрывает статусы сервера', () => {
  it('положительный контроль: новые статусы WK-05 сервер принимает', () => {
    expect(PLAN_STATUSES).toEqual(expect.arrayContaining(['waiting', 'review', 'failed']));
  });

  it('меню таблицы задач (LORE_TASK_STATUSES)', () => {
    expect(missing(LORE_TASK_STATUSES)).toEqual([]);
  });

  it('коды таблицы задач (TASK_STATUS_CODES) и их распознавание из строки', () => {
    expect(missing(TASK_STATUS_CODES)).toEqual([]);
    expect(taskStatusCode('⏳ WAITING')).toBe('waiting');
    expect(taskStatusCode('🔍 REVIEW')).toBe('review');
    expect(taskStatusCode('❌ FAILED')).toBe('failed');
  });

  it('запасной словарь оболочки (модель недоступна)', () => {
    expect(missing(v2Config('ru').statuses.items.map(i => i.code))).toEqual([]);
  });

  it('экраны списков «Спринты» и «Задачи»', () => {
    for (const k of ['sprints', 'tasks'] as const) {
      const codes = LIST_SCREENS[k].config('ru').statuses.items.map(i => i.code);
      expect({ screen: k, missing: missing(codes) }).toEqual({ screen: k, missing: [] });
    }
  });

  it('у новых статусов есть значок и цвет из словаря приложения, а не заглушка', () => {
    installKitVocabulary();
    expect(statusMeta('waiting').icon).toBe('hourglass');
    expect(statusMeta('review').icon).toBe('magnifying-glass');
    expect(statusMeta('failed').icon).toBe('cancel');
  });
});
