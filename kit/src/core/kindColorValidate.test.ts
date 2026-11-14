// K4-MENTION-LOOK: цвет вида в конфиге — токен темы. Семейство `--type-*` — палитра
// видов в теме kit: имена видов называет приложение (K-14), поэтому валидатор знает
// семейство, а не перечень имён. Сырое значение — ошибка, чужой токен — предупреждение.
import { describe, expect, it } from 'vitest';
import { validateKitConfig } from './validate';

const cfg = (color: unknown) => ({
  modules: [{ id: 'm', title: 'M', icon: 'cog' }],
  menu: { groups: [{ id: 'g', title: 'G', items: [{ id: 'a', title: 'A' }] }] },
  kinds: { a: { title: 'A', icon: 'cog', color } },
  statuses: { items: [] },
});
const at = (color: unknown) => (v => [...v.errors, ...v.warnings])(validateKitConfig(cfg(color))).filter(i => i.path === 'kinds.a.color');

describe('валидатор: цвет вида', () => {
  it('токен семейства --type-* — без замечаний', () => {
    expect(at('var(--type-adrs)')).toEqual([]);
  });
  it('ключ color у вида известен контракту', () => {
    expect((v => [...v.errors, ...v.warnings])(validateKitConfig(cfg('var(--type-adrs)'))).filter(i => i.code === 'unknown-key' && i.path.startsWith('kinds.a'))).toEqual([]);
  });
  it('сырой hex — ошибка', () => {
    expect(at('#B48EAD').map(i => i.level)).toEqual(['error']);
  });
  it('незнакомый токен — предупреждение (может быть токеном приложения)', () => {
    expect(at('var(--my-own)').map(i => i.code)).toEqual(['color-token-unknown']);
  });
});
