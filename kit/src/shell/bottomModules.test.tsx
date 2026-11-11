// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-COMPARE — модули нижней панелью на
// телефоне (решение владелицы D-2026-UXR-MOBILE-FOLLOWS-V1: образец — v1,
// SPRINT_LORE_MOBILE_UX/MOB-12; её слова: «я бы меню мини иконками сделала или
// бы вообще убрала бы в низ в мобилке»).
//
// Замер живого v2 при 360 px: модули в шапке выходили за правый край (right 375),
// «Проекты» и поиск обрезались. На узком экране модули уезжают вниз —
// навигацией в зоне большого пальца; на широком всё как было.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { KitShell, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => { registerGameIcons(gameIcons); });

const CONFIG: KitConfig = {
  modules: [
    { id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' },
    { id: 'research', title: 'Исследования', icon: 'raven' },
    { id: 'bragi', title: 'Bragi', icon: 'harp', status: 'planned' },
  ],
  menu: { groups: [{ id: 'work', title: 'Работа', items: [{ id: 'sprints', title: 'Спринты', icon: 'sprint' }] }] },
  kinds: {},
  statuses: { items: [] },
};

function fakeWin(): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/kit', search: '', hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}
const mem = () => createSafeStorage(() => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } as unknown as Storage;
});

describe('KitShell — модули нижней панелью на телефоне (S4-MOBILE-COMPARE)', () => {
  it('узко: модули — в нижней навигации, в шапке их нет', async () => {
    const onNavigate = vi.fn();
    const { container } = render(<KitShell config={CONFIG} win={fakeWin()} storage={mem()} narrow onNavigate={onNavigate} />);
    const header = container.querySelector('header')!;
    expect(header.querySelector('.sk-shell__mods, .sk-shell__mod')).toBeNull();
    const dock = screen.getByRole('navigation', { name: 'Модули' });
    expect(dock.className).toMatch(/\bsk-shell__dock\b/);
    expect(header.contains(dock)).toBe(false);
    const items = within(dock).getAllByRole('button');
    expect(items).toHaveLength(3);
    // Подпись под иконкой видна, а не только в aria-label.
    expect(within(dock).getByText('Исследования')).toBeTruthy();
    // Текущий модуль отмечен для чтения с экрана.
    expect(within(dock).getByRole('button', { name: 'LORE' }).getAttribute('aria-current')).toBe('page');
    // «Скоро» — приглушённо и с понятным именем, нажатие ничего не делает.
    const planned = within(dock).getByRole('button', { name: 'Bragi · скоро' });
    expect(planned.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(planned);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(within(dock).getByRole('button', { name: 'Исследования' }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ module: 'research' }));
    expect(within(dock).getByRole('button', { name: 'Исследования' }).getAttribute('aria-current')).toBe('page');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('широко (положительный контроль): модули в шапке, нижней панели нет', () => {
    const { container } = render(<KitShell config={CONFIG} win={fakeWin()} storage={mem()} narrow={false} />);
    const nav = screen.getByRole('navigation', { name: 'Модули' });
    expect(container.querySelector('header')!.contains(nav)).toBe(true);
    expect(container.querySelector('.sk-shell__dock')).toBeNull();
  });

  it('CSS: панель прибита к низу, содержимое отступает под неё с учётом safe-area', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/seidr.css'), 'utf8');
    const body = (sel: string) => {
      const i = css.indexOf(sel + ' {');
      expect(i, `правила ${sel} нет`).toBeGreaterThan(-1);
      return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
    };
    const dock = body('.sk-shell__dock');
    expect(dock).toMatch(/position:\s*fixed/);
    expect(dock).toMatch(/bottom:\s*0/);
    expect(dock).toMatch(/env\(safe-area-inset-bottom/);
    expect(body('.sk-shell--narrow .sk-shell__body')).toMatch(/padding-bottom:[^;]*env\(safe-area-inset-bottom/);
    expect(body('.sk-shell__dock-item[aria-current="page"]')).toMatch(/var\(--acc\)/);
    expect(body('.sk-shell__dock-item[aria-disabled="true"]')).toMatch(/opacity/);
  });
});
