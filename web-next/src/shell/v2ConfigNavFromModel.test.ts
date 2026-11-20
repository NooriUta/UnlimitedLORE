// SPRINT_LORE_MODEL_AS_CONFIG/MC-07 (D-2026-LORE-MODEL-AUDIENCE-VISIBILITY): общее меню строится из
// модели (`surfaces.nav` в /lore/model), а не из списка в коде. Смена уровня видимости раздела в
// конфиге модели меняет меню без правки клиента; админские разделы (люди, агенты, машины) сервер в
// общее меню не кладёт вовсе. Модели нет — рукописное меню остаётся, и это видно по признаку источника.
//
// SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS: разбор документа в меню живёт в kit (`navFromModel`),
// приложение даёт только словарь подписей и список своих разделов. Копии разбора в приложении нет.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { menuFromModel, v2Config } from './v2Config';

const nav = [
  { id: 'work', label_key: 'shell.grp.work', tone: 'var(--acc)', pin_top: false, items: [{ section: 'sprint', icon: 'sprint' }, { section: 'task', icon: 'lucide:list-checks' }] },
  { id: 'product', label_key: 'shell.grp.product', tone: 'var(--wrn)', pin_top: false, items: [{ section: 'product', icon: 'bullseye' }] },
];
const model = { surfaces: { nav } };

describe('MC-07 · общее меню из модели', () => {
  it('группы и пункты — из surfaces.nav: чего нет в модели, того нет в меню', () => {
    const groups = v2Config('ru', undefined, undefined, model).menu.groups;
    expect(groups.map(g => g.id)).toEqual(['work', 'product']);
    const items = groups.flatMap(g => g.items.map(i => i.id));
    expect(items).toEqual(['sprint', 'task', 'product']);
    expect(items).not.toContain('actor');
    expect(groups[0].title).toBe('Работа');
    expect(groups[0].items[0].title).toBe('Спринты');
  });

  it('раздел, которого клиент не знает, не превращается в пустой пункт — отбрасывается', () => {
    const groups = menuFromModel('ru', { surfaces: { nav: [{ id: 'work', label_key: 'shell.grp.work', tone: 'var(--acc)', pin_top: false, items: [{ section: 'nope', icon: 'cog' }, { section: 'sprint', icon: 'sprint' }] }] } });
    expect(groups.flatMap(g => g.items.map(i => i.id))).toEqual(['sprint']);
  });

  it('модели нет — прежнее рукописное меню (положительный контроль)', () => {
    const items = v2Config('ru').menu.groups.flatMap(g => g.items.map(i => i.id));
    expect(items).toContain('actor');
    expect(items).toContain('sprint');
  });

  it('в документе нет surfaces.nav — тоже рукописное меню, а не пустое', () => {
    const items = v2Config('ru', undefined, undefined, { surfaces: {} }).menu.groups.flatMap(g => g.items.map(i => i.id));
    expect(items).toContain('sprint');
  });
});

describe('K5-MODEL-NAV-EDGE-LABELS · разбор меню — в kit, не в приложении', () => {
  const src = (f: string) => readFileSync(`${process.cwd()}/src/shell/${f}`, 'utf8').replace(/\/\/.*$/gm, '');
  it('v2Config зовёт navFromModel из kit', () => {
    expect(src('v2Config.ts')).toMatch(/navFromModel\(/);
  });
  it('useModelStatuses не разбирает surfaces.nav сам', () => {
    expect(src('useModelStatuses.ts')).not.toMatch(/surfaces\??\.nav/);
    expect(src('useModelStatuses.ts')).not.toMatch(/ModelNavGroup/);
  });
});
