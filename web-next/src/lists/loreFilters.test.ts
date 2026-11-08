// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05 — фильтры списков LORE в v2: поля
// фасетов (в т.ч. «Релиз» = release_ids слайса спринтов), иконки значений как
// в прототипе v4 и релиз задачи, унаследованный от её спринта (слайс задач
// релиза не отдаёт — считаем на клиенте, без новой серверной колонки).
import { describe, expect, it } from 'vitest';
import gameIcons from '@iconify-json/game-icons/icons.json';
import type { KitRecord } from '@seidr/kit';
import { applyFilterSet, facetOf, hasGameIcon, registerGameIcons } from '@seidr/kit';
import { LORE_FILTER_FIELDS, SPRINT_FILTERS, TASK_FILTERS, loreValueIcon, tasksWithSprintRelease } from './loreFilters';

const rec = (id: string, kind: string, fields: Record<string, unknown>): KitRecord =>
  ({ id, kind, title: id, status: 'todo', fields });

describe('поля фильтров LORE', () => {
  it('у спринтов и задач есть «Релиз»; ключи — fields.* слайса', () => {
    expect(LORE_FILTER_FIELDS.release).toBe('fields.release_ids');
    expect(SPRINT_FILTERS).toContain(LORE_FILTER_FIELDS.release);
    expect(TASK_FILTERS).toContain(LORE_FILTER_FIELDS.release);
    expect(SPRINT_FILTERS[0]).toBe('status');
  });
});

// S4-25: иконки — выбор владелицы (SPEC-LORE-UXR-ICONS): проект — castle, P0 — lucide:flame.
describe('иконки значений — по канону S4-25, есть в зарегистрированных наборах', () => {
  registerGameIcons(gameIcons);
  const known = (slug: string) => hasGameIcon(slug);
  it.each([
    [LORE_FILTER_FIELDS.release, 'v1.2.0', 'open-book', 'var(--suc)'],
    [LORE_FILTER_FIELDS.component, 'LORE-ygg', 'cog', 'var(--inf)'],
    [LORE_FILTER_FIELDS.project, 'NooriUta/UnlimitedLORE', 'castle', 'var(--acc)'],
    [LORE_FILTER_FIELDS.milestone, 'M1', 'crossed-axes', 'var(--wrn)'],
    [LORE_FILTER_FIELDS.priority, 'P0', 'lucide:flame', 'var(--dng)'],
  ])('%s=%s → %s', (key, value, icon, color) => {
    expect(loreValueIcon(key, value)).toEqual({ icon, color });
    expect(known(icon)).toBe(true);
  });
  it('статус и вид — не перекрываются (берутся из словаря конфига); пустое значение — без иконки', () => {
    expect(loreValueIcon('status', 'done')).toBeUndefined();
    expect(loreValueIcon('kind', 'sprint')).toBeUndefined();
    expect(loreValueIcon(LORE_FILTER_FIELDS.release, '')).toBeNull();
  });
});

describe('релиз задачи — от её спринта, на клиенте', () => {
  const sprints = [rec('SPRINT_A', 'sprint', { release_ids: ['v1.2.0'] }), rec('SPRINT_B', 'sprint', { release_ids: null })];
  const tasks = [
    rec('SPRINT_A/A-1', 'task', { sprint_id: 'SPRINT_A' }),
    rec('SPRINT_B/B-1', 'task', { sprint_id: 'SPRINT_B' }),
    rec('BACKLOG-1', 'task', {}),
  ];
  it('фильтр «Релиз: пусто» у задач работает по унаследованному полю', () => {
    const ts = tasksWithSprintRelease(tasks, sprints);
    expect(ts[0].fields.release_ids).toEqual(['v1.2.0']);
    const set = { fields: { [LORE_FILTER_FIELDS.release]: { op: 'empty' as const, values: [] } } };
    expect(applyFilterSet(ts, set).map(t => t.id)).toEqual(['SPRINT_B/B-1', 'BACKLOG-1']);
    expect(facetOf(ts, { fields: {} }, LORE_FILTER_FIELDS.release).values).toEqual([{ value: 'v1.2.0', count: 1 }]);
  });
});
