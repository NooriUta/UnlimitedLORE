// Приёмка препрода 14.11.2026: в виде «Таблица» колонка приёмщика называлась «Ревьюер», в «Дереве» и
// «Списке» — «Принимающий». Одна роль — одно слово во всех видах (kit-таблица и паспорт LORE).
// K5-PACKAGE-DELIVERY: словарь kit больше не читается файлом ../kit/src/i18n — kit стал пакетом.
// Сверяется то, что видит человек: строка kit через kitT (с наложенными словами LORE из test/setup).
import { describe, expect, it } from 'vitest';
import { kitT } from '@seidr/kit';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

describe('приёмщик задачи — одной подписью во всех видах', () => {
  it('ru: колонка таблицы kit = поле паспорта', () => {
    expect(kitT('ru', 'kit.tasks.col.reviewer')).toBe((ru as Record<string, string>)['pp.field.reviewer']);
  });
  it('en: колонка таблицы kit = поле паспорта', () => {
    expect(kitT('en', 'kit.tasks.col.reviewer')).toBe((en as Record<string, string>)['pp.field.reviewer']);
  });
});
