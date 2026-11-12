// Варианты цели связи для выбора с поиском (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
// Владелица 11.11.2026: «где значения задаются рёбрами — dropdown, а не
// корректировка текста». Карта «тип цели → срез» — от серверной сессии 50109daa;
// закрытые спринты не предлагаются; источника нет или срез не прочитался —
// ошибка словами (kit покажет «не загрузилось» и «Повторить»), а не свободный ввод.
import { describe, expect, it, vi } from 'vitest';
import { relationOptionsHook } from './relationOptions';

const rels = [
  { key: 'components', label: 'Компоненты', relation: 'attribute' as const, rel: 'BELONGS_TO', dir: 'out' as const, count: 0, target_type: 'component' },
  { key: 'dependsOn', label: 'Зависит от', relation: 'association' as const, rel: 'DEPENDS_ON', dir: 'out' as const, count: 0, target_type: 'sprint' },
  { key: 'files', label: 'Файлы', relation: 'attribute' as const, rel: 'EDITED_IN', dir: 'in' as const, count: 0, target_type: 'file' },
];

describe('relationOptionsHook', () => {
  it('компоненты: срез components, код и название по полям среза, поиск по коду и названию без регистра', async () => {
    const slice = vi.fn(async () => ({ rows: [{ component_id: 'FORSETI', full_name: 'Forseti — LORE v2' }, { component_id: 'ODIN', full_name: 'Odin' }] }));
    const hook = relationOptionsHook(rels, slice);
    const out = await hook({ type: 'sprint', id: 'S_A', rel: 'BELONGS_TO', dir: 'out', query: 'lore' });
    expect(slice).toHaveBeenCalledWith('components', undefined);
    expect(out).toEqual([{ id: 'FORSETI', title: 'Forseti — LORE v2', type: 'component' }]);
  });

  it('спринты: закрытые (done, cancelled) не предлагаются; сама запись — тоже', async () => {
    const slice = vi.fn(async () => ({ rows: [
      { sprint_id: 'S_A', name: 'Сама', status_raw: '🔄 IN PROGRESS' },
      { sprint_id: 'S_B', name: 'Открытый', status_raw: '📋 PLANNED' },
      { sprint_id: 'S_C', name: 'Закрытый', status_raw: '✅ DONE' },
      { sprint_id: 'S_D', name: 'Отменён', status_raw: '🚫 CANCELLED' },
    ] }));
    const out = await relationOptionsHook(rels, slice)({ type: 'sprint', id: 'S_A', rel: 'DEPENDS_ON', dir: 'out', query: 's_' });
    expect(out.map(o => o.id)).toEqual(['S_B']);
  });

  it('источника вариантов для связи нет — ошибка словами, а не пустой список', async () => {
    await expect(relationOptionsHook(rels, vi.fn())({ type: 'sprint', id: 'S_A', rel: 'EDITED_IN', dir: 'in', query: 'x' })).rejects.toThrow(/нет источника/);
  });
});
