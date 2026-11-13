// SPRINT_LORE_MODEL_AS_CONFIG/MC-07 (D-2026-LORE-MODEL-AUDIENCE-VISIBILITY): общее меню строится из
// модели (`surfaces.nav` в /lore/model), а не из списка в коде. Смена уровня видимости раздела в
// конфиге модели меняет меню без правки клиента; админские разделы (люди, агенты, машины) сервер в
// общее меню не кладёт вовсе. Модели нет — рукописное меню остаётся, и это видно по признаку источника.
import { describe, expect, it } from 'vitest';
import { menuFromModel, v2Config, type ModelNavGroup } from './v2Config';

const nav: ModelNavGroup[] = [
  { id: 'work', label_key: 'shell.grp.work', tone: 'var(--acc)', pin_top: false, items: [{ section: 'sprint', icon: 'sprint' }, { section: 'task', icon: 'lucide:list-checks' }] },
  { id: 'product', label_key: 'shell.grp.product', tone: 'var(--wrn)', pin_top: false, items: [{ section: 'product', icon: 'bullseye' }] },
];

describe('MC-07 · общее меню из модели', () => {
  it('группы и пункты — из surfaces.nav: чего нет в модели, того нет в меню', () => {
    const groups = v2Config('ru', undefined, undefined, nav).menu.groups;
    expect(groups.map(g => g.id)).toEqual(['work', 'product']);
    const items = groups.flatMap(g => g.items.map(i => i.id));
    expect(items).toEqual(['sprint', 'task', 'product']);
    expect(items).not.toContain('actor');
    expect(groups[0].title).toBe('Работа');
  });

  it('раздел, которого клиент не знает, не превращается в пустой пункт — отбрасывается', () => {
    const groups = menuFromModel('ru', [{ id: 'work', label_key: 'shell.grp.work', tone: 'var(--acc)', pin_top: false, items: [{ section: 'nope', icon: 'cog' }, { section: 'sprint', icon: 'sprint' }] }]);
    expect(groups.flatMap(g => g.items.map(i => i.id))).toEqual(['sprint']);
  });

  it('модели нет — прежнее рукописное меню (положительный контроль)', () => {
    const items = v2Config('ru').menu.groups.flatMap(g => g.items.map(i => i.id));
    expect(items).toContain('actor');
    expect(items).toContain('sprint');
  });
});
