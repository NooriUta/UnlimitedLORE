// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-01 — конфиг оболочки v2: приложения сверху
// (Forseti — рабочее, остальные мега-разделы — «скоро»), меню группами по
// смыслу, разделы MVP (D-2026-UXR-MVP: новости, ADR, спринты, задачи) на
// месте. Конфиг проходит валидатор ядра kit без ошибок и предупреждений.
import { beforeAll, describe, expect, it } from 'vitest';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { hasGameIcon, registerGameIcons } from '@seidr/kit';
import { validateKitConfig } from '@seidr/kit/core';
import { V2_SECTIONS, v2Config } from './v2Config';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

describe('конфиг оболочки v2', () => {
  it('проходит валидатор ядра kit: ни ошибок, ни предупреждений, все иконки в наборе', () => {
    for (const lang of ['ru', 'en'] as const) {
      const v = validateKitConfig(v2Config(lang), { iconExists: hasGameIcon });
      expect(v.errors, lang).toEqual([]);
      expect(v.warnings, lang).toEqual([]);
    }
  });

  it('приложения сверху: Forseti рабочее и первое; BRAGI/MUNINN/TYR — только «скоро»', () => {
    const mods = v2Config('ru').modules;
    expect(mods[0]).toMatchObject({ id: 'forseti', status: 'active' });
    for (const id of ['bragi', 'muninn', 'tyr']) {
      expect(mods.find(m => m.id === id)?.status, id).toBe('planned');
    }
    expect(mods.filter(m => m.status !== 'planned').map(m => m.id)).toEqual(['forseti']);
  });

  it('меню — группы по смыслу (у каждой тон-токен), разделы MVP есть, ни один пункт не повторяется', () => {
    const { groups } = v2Config('ru').menu;
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const g of groups) expect(g.tone, g.id).toMatch(/^var\(--(acc|suc|wrn|dng|inf)\)$/);
    const items = groups.flatMap(g => g.items.map(i => i.id));
    expect(new Set(items).size).toBe(items.length);
    for (const id of ['news', 'sprint', 'task', 'adr', 'settings']) expect(items, id).toContain(id);
    expect([...items].sort()).toEqual([...V2_SECTIONS].sort());
    // Спринты и задачи — одна группа «работа», ADR — не в ней: меню по смыслу, а не по таблицам.
    const groupOf = (id: string) => groups.find(g => g.items.some(i => i.id === id))?.id;
    expect(groupOf('sprint')).toBe(groupOf('task'));
    expect(groupOf('adr')).not.toBe(groupOf('sprint'));
  });

  it('подписи — из локалей: ru и en различаются и не пусты', () => {
    const ru = v2Config('ru');
    const en = v2Config('en');
    const titles = (c: typeof ru) => c.menu.groups.flatMap(g => [g.title, ...g.items.map(i => i.title)]);
    for (const t of [...titles(ru), ...titles(en)]) expect(t.trim()).not.toBe('');
    expect(titles(ru)).not.toEqual(titles(en));
    expect(ru.menu.recent).toBe(true);
    expect(ru.menu.myViews).toBe(true);
  });
});
