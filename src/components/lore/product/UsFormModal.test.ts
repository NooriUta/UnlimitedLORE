import { describe, it, expect } from 'vitest';
import {
  normalizeUsId, templateFor,
  COCKBURN_CASUAL, COCKBURN_FULL, COCKBURN_EXAMPLE, ACCEPTANCE_EXAMPLE,
} from './UsFormModal';

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

  it('пример СОДЕРЖАТЕЛЕН, а не тот же скелет с прочерками', () => {
    // Смысл примера ровно в этом: показать, чем заполняют. Окажись в нём
    // курсивные подсказки и «1. …», он был бы вторым шаблоном под другим
    // именем — и линтер справедливо оценил бы его в ноль.
    expect(COCKBURN_EXAMPLE).not.toContain('…');
    expect(COCKBURN_EXAMPLE).not.toMatch(/^_.*_$/m);
    const steps = COCKBURN_EXAMPLE.split('\n').filter(l => /^\s*\d+[.)]\s+\S/.test(l));
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const s of steps) expect(s.replace(/^\s*\d+[.)]\s*/, '').length).toBeGreaterThan(5);
  });

  it('пример приёмки несёт обе секции полного веса', () => {
    // Приёмка — половина оформления по Кокберну: образец сценария без образца
    // приёмки оставил бы вторую половину там же, ради чего пример и заводился.
    expect(ACCEPTANCE_EXAMPLE).toContain('### Проверки');
    expect(ACCEPTANCE_EXAMPLE).toContain('### Покрытие расширений');
  });

  it('расширения примера ссылаются на существующие шаги', () => {
    // Правило линтера extensions_ref_steps. Сошлись пример на несуществующий
    // шаг — он бы сам не проходил проверку, которую призван иллюстрировать.
    const body = COCKBURN_EXAMPLE.split('### Расширения')[1] ?? '';
    const refs = [...body.matchAll(/^\s*(\d+)[a-z]\b/gm)].map(m => Number(m[1]));
    const steps = [...COCKBURN_EXAMPLE.matchAll(/^\s*(\d+)[.)]\s+\S/gm)].map(m => Number(m[1]));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(steps).toContain(r);
  });

  it('основной сценарий шаблона — нумерованный список ≥2 шагов', () => {
    // Ровно то, что требует проверка main_scenario. Дай шаблон один шаг —
    // свежесозданная US открывалась бы с уже красным чек-листом.
    const steps = COCKBURN_CASUAL.split('\n').filter(l => /^\s*\d+[.)]\s+\S/.test(l));
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });
});
