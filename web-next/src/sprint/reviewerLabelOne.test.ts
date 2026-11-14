// Приёмка препрода 14.11.2026: в виде «Таблица» колонка приёмщика называлась «Ревьюер», в «Дереве» и
// «Списке» — «Принимающий». Одна роль — одно слово во всех видах (kit-таблица и паспорт LORE).
import { describe, expect, it } from 'vitest';
import kitRu from '../../../kit/src/i18n/ru.json';
import kitEn from '../../../kit/src/i18n/en.json';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

describe('приёмщик задачи — одной подписью во всех видах', () => {
  it('ru: колонка таблицы kit = поле паспорта', () => {
    expect((kitRu as Record<string, string>)['kit.tasks.col.reviewer']).toBe((ru as Record<string, string>)['pp.field.reviewer']);
  });
  it('en: колонка таблицы kit = поле паспорта', () => {
    expect((kitEn as Record<string, string>)['kit.tasks.col.reviewer']).toBe((en as Record<string, string>)['pp.field.reviewer']);
  });
});
