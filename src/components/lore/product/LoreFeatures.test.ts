import { describe, it, expect } from 'vitest';
import { sprintTone } from './LoreFeatures';

describe('PL-16 · тон спринт-чипа', () => {
  it('отменённый спринт предупреждает, а не выглядит нейтрально', () => {
    // Главный случай: задача в отменённом спринте. Покрась его серым «как
    // прочие» — строка читалась бы как «просто ещё не начали», хотя работа
    // снята вовсе. Именно ради этого различия чип берёт статус СПРИНТА.
    expect(sprintTone('🚫 CANCELLED')).toBe('warn');
  });

  it('живой и закрытый спринты различимы', () => {
    expect(sprintTone('🔄 IN PROGRESS')).toBe('act');
    expect(sprintTone('✅ DONE')).toBe('ok');
  });

  it('неизвестное и отсутствующее — нейтральный тон, а не падение', () => {
    // Статусы приходят строкой из корпуса: словарь пополняется, и незнакомое
    // значение должно оставаться серым, а не выбирать случайный тон.
    expect(sprintTone(null)).toBe('muted');
    expect(sprintTone(undefined)).toBe('muted');
    expect(sprintTone('📋 PLANNED')).toBe('muted');
  });

  it('эмодзи-префикс не мешает — сверка вхождением, а не равенством', () => {
    expect(sprintTone('done')).toBe('ok');
    expect(sprintTone('  ✅ DONE  ')).toBe('ok');
  });
});
