import { describe, it, expect } from 'vitest';
import { normalizeUsId, templateFor, COCKBURN_CASUAL, COCKBURN_FULL } from './UsFormModal';

describe('PL-17 · форма US', () => {
  it('id получает префикс US-, если его не набрали', () => {
    expect(normalizeUsId('git-merge')).toBe('US-GIT-MERGE');
    expect(normalizeUsId('US-GIT-MERGE')).toBe('US-GIT-MERGE');
  });

  it('уже существующий префикс UC- не ломается', () => {
    // Корпус старше префикса US-: часть сценариев заведена как UC-. Припиши мы
    // им US-, правка существующей записи создала бы ДУБЛЬ под новым id.
    expect(normalizeUsId('UC-GIT-PR')).toBe('UC-GIT-PR');
  });

  it('пустой ввод не превращается в голый префикс', () => {
    expect(normalizeUsId('   ')).toBe('');
  });

  it('шаблон соответствует весу', () => {
    expect(templateFor('casual')).toBe(COCKBURN_CASUAL);
    expect(templateFor('fully-dressed')).toBe(COCKBURN_FULL);
  });

  it('заголовки шаблона — те, что матчит серверный линтер', () => {
    // Конвенция ADR-027 §1. Переименуй здесь заголовок — линтер перестанет
    // находить секцию, и форма будет вставлять шаблон, который сама же считает
    // неполным. Поэтому проверяются точные строки, а не «есть какие-то секции».
    for (const h of ['### Триггер', '### Основной сценарий', '### Минимальные гарантии']) {
      expect(COCKBURN_CASUAL).toContain(h);
      expect(COCKBURN_FULL).toContain(h);
    }
    for (const h of ['### Предусловия', '### Расширения', '### Гарантии успеха']) {
      expect(COCKBURN_FULL).toContain(h);
      expect(COCKBURN_CASUAL).not.toContain(h);
    }
  });

  it('основной сценарий шаблона — нумерованный список ≥2 шагов', () => {
    // Ровно то, что требует проверка main_scenario. Дай шаблон один шаг —
    // свежесозданная US открывалась бы с уже красным чек-листом.
    const steps = COCKBURN_CASUAL.split('\n').filter(l => /^\s*\d+[.)]\s+\S/.test(l));
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });
});
