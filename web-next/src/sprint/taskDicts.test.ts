// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36 — справочники для строки задачи.
//
// Срез `dictionary` отдаёт свои имена полей (label_ru, sort_order, is_active),
// а kit принимает статью в своей форме (code, title, icon, color). Здесь —
// перевод одного в другое и честное поведение при сбое: справочник не
// обязателен, без него строка показывает исходные коды и ничего о них не
// утверждает. Это лучше, чем ронять вкладку задач из-за украшений.
import { describe, expect, it } from 'vitest';
import { loadTaskDicts, toDictItems } from './taskDicts';

const rows = [
  { dict_type: 'task_type', code: 'dev', label_ru: 'Разработка', label_en: 'Development', icon: 'gears', color: '#4caf72', sort_order: 3, is_active: true },
  { dict_type: 'task_type', code: 'test', label_ru: 'Тестирование', label_en: null, icon: 'checkered-flag', color: '#d9a441', sort_order: 1, is_active: true },
  { dict_type: 'task_type', code: 'old', label_ru: 'Снятый', label_en: null, icon: null, color: null, sort_order: 99, is_active: false },
];

describe('toDictItems', () => {
  it('переводит строки среза в статьи kit и сортирует по порядку словаря', () => {
    expect(toDictItems(rows, 'ru').map(i => i.code)).toEqual(['test', 'dev', 'old']);
    expect(toDictItems(rows, 'ru')[1]).toEqual({ code: 'dev', title: 'Разработка', icon: 'gears', color: '#4caf72' });
  });

  it('английская подпись берётся, когда есть; иначе остаётся русская — пустого имени не бывает', () => {
    const en = toDictItems(rows, 'en');
    expect(en.find(i => i.code === 'dev')?.title).toBe('Development');
    expect(en.find(i => i.code === 'test')?.title).toBe('Тестирование');
  });

  it('снятые статьи остаются: запись с таким значением существует, и показать её надо', () => {
    expect(toDictItems(rows, 'ru').some(i => i.code === 'old')).toBe(true);
  });
});

describe('loadTaskDicts', () => {
  it('тянет оба словаря и раскладывает по видам', async () => {
    const calls: string[] = [];
    const load = async (slice: string, params: Record<string, string>) => {
      calls.push(`${slice}:${params.dict_type}`);
      return { rows: rows.filter(r => r.dict_type === params.dict_type) };
    };
    const d = await loadTaskDicts('ru', load);
    expect(calls.sort()).toEqual(['dictionary:task_type', 'dictionary:work_class']);
    expect(d.taskType?.map(i => i.code)).toEqual(['test', 'dev', 'old']);
    expect(d.workClass).toEqual([]);
  });

  it('сбой справочника не ломает вкладку: словарей просто нет', async () => {
    const d = await loadTaskDicts('ru', async () => { throw new Error('503'); });
    expect(d).toEqual({});
  });
});
