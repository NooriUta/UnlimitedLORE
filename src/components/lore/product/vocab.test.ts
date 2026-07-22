import { describe, it, expect } from 'vitest';
import { ucStatusLabel, rigorLabel, goalLevelLabel, levelLabel } from './vocab';
import type { TFunction } from 'i18next';

// Подделка i18next: отдаёт «перевод» только для известных ключей, иначе
// пустую строку — ровно так ведёт себя настоящий t() с defaultValue: ''.
const DICT: Record<string, string> = {
  'lore.product.vocab.ucStatus.proposed': 'предложен',
  'lore.product.vocab.rigor.fully-dressed': 'полный',
  'lore.product.vocab.goalLevel.sea-level': 'уровень моря',
  'lore.product.vocab.level.high': 'высокая',
};
const t = ((key: string) => DICT[key] ?? '') as unknown as TFunction;

describe('PL-35 · подписи словарных значений', () => {
  it('техническое значение заменяется русской подписью', () => {
    expect(ucStatusLabel(t, 'proposed')).toBe('предложен');
    expect(levelLabel(t, 'high')).toBe('высокая');
  });

  it('глиф приклеивается к подписи, а не заменяет её', () => {
    // Раньше на экране стояло «📋 fully-dressed»: глиф был, подписи не было.
    expect(rigorLabel(t, 'fully-dressed')).toBe('📋 полный');
    expect(goalLevelLabel(t, 'sea-level')).toBe('🌊 уровень моря');
  });

  it('НЕИЗВЕСТНОЕ значение показывается как есть, а не прочерком', () => {
    // Словари корпуса пополняются. Подмени мы незнакомое значение на «—», новое
    // значение исчезло бы ровно тогда, когда его надо заметить: запись выглядела
    // бы как запись вообще без значения.
    expect(ucStatusLabel(t, 'archived')).toBe('archived');
    expect(goalLevelLabel(t, 'stratosphere')).toBe('stratosphere');
  });

  it('пусто и null — прочерк', () => {
    expect(ucStatusLabel(t, null)).toBe('—');
    expect(ucStatusLabel(t, '   ')).toBe('—');
  });
});
