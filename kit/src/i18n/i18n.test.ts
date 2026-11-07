// Локали kit живут в самом kit (не в src/i18n v1) и обязаны совпадать по
// ключам: ключ только в одной локали = непереведённая строка на экране.
import { describe, expect, it } from 'vitest';
import ru from './ru.json';
import en from './en.json';
import { kitT } from './index';

describe('локали Seiðr-kit', () => {
  it('ru и en содержат одинаковый набор ключей', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it('нет пустых строк ни в одной локали', () => {
    for (const [k, v] of [...Object.entries(ru), ...Object.entries(en)]) expect(v.trim(), k).not.toBe('');
  });

  it('kitT отдаёт строку локали, неизвестный язык — русский', () => {
    expect(kitT('en', 'kit.state.error.retry')).toBe('Retry');
    expect(kitT('ru', 'kit.state.error.retry')).toBe('Повторить');
    expect(kitT('de' as 'ru', 'kit.state.error.retry')).toBe('Повторить');
  });

  it('подстановка {name}; плейсхолдеры в ru и en одинаковые', () => {
    expect(kitT('ru', 'kit.state.truncated.paged', { from: 1, to: 50, total: 180 })).toContain('1–50');
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(ru) as (keyof typeof ru)[]) expect(ph(en[k]), k).toEqual(ph(ru[k]));
  });
});

describe('локали Seiðr-kit · устойчивость (S4-00f)', () => {
  it('kitT отдаёт строки error boundary и плашки хранилища', () => {
    expect(kitT('en', 'kit.error.retry')).toBe('Retry');
    expect(kitT('ru', 'kit.error.retry')).toBe('Повторить');
    expect(kitT('de' as 'ru', 'kit.error.retry')).toBe('Повторить');
    expect(kitT('ru', 'kit.storage.unavailable')).toContain('Хранилище');
  });
});
