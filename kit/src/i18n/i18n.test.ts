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

  it('kitT отдаёт строку локали, неизвестный язык — русский', () => {
    expect(kitT('en', 'kit.error.retry')).toBe('Retry');
    expect(kitT('ru', 'kit.error.retry')).toBe('Повторить');
    expect(kitT('de' as 'ru', 'kit.error.retry')).toBe('Повторить');
  });
});
