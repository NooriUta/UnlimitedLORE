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
    // Приёмка препрода efe20f03: три из четырёх пунктов бара были «скоро» — бар в зоне большого
    // пальца только для рабочих модулей, как в v1 (MOB-12: там в баре только рабочие ипостаси).
    // Заглушки «скоро» остаются в шапке широкого экрана (положительный контроль ниже).
    const items = within(dock).getAllByRole('button');
    expect(items).toHaveLength(2);
    expect(within(dock).queryByRole('button', { name: /Bragi/ })).toBeNull();
    expect(dock.querySelector('[aria-disabled="true"]')).toBeNull();
    // Подпись под иконкой видна, а не только в aria-label.
    expect(within(dock).getByText('Исследования')).toBeTruthy();
    // Текущий модуль отмечен для чтения с экрана.
    expect(within(dock).getByRole('button', { name: 'LORE' }).getAttribute('aria-current')).toBe('page');
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(within(dock).getByRole('button', { name: 'Исследования' }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ module: 'research' }));
    expect(within(dock).getByRole('button', { name: 'Исследования' }).getAttribute('aria-current')).toBe('page');
    expect(await axeViolations(container)).toEqual([]);
  });

  // K4-SHELL-PHONE-BARS, выбор владелицы 14.11.2026 из прототипа k4-phone-bars: «Вариант 2 — бар, ☰ без
  // модулей. Модули — только в нижнем баре (переключение одним касанием). В ☰ — только разделы текущего
  // модуля». Заголовок листа — «<модуль> · разделы», как в прототипе.
  it('узко, вариант 2: в ☰ только разделы текущего модуля и заголовок «<модуль> · разделы», модулей в ☰ нет', () => {
    render(<KitShell config={CONFIG} win={fakeWin()} storage={mem()} narrow />);
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('LORE · разделы');
    expect(within(sheet).queryByRole('button', { name: 'Исследования' })).toBeNull();
    expect(within(sheet).queryByRole('navigation', { name: 'Модули' })).toBeNull();
    expect(sheet.textContent).toContain('Спринты');
  });

  it('широко (положительный контроль): модули в шапке, нижней панели нет', () => {
    const { container } = render(<KitShell config={CONFIG} win={fakeWin()} storage={mem()} narrow={false} />);
    const nav = screen.getByRole('navigation', { name: 'Модули' });
    expect(container.querySelector('header')!.contains(nav)).toBe(true);
    expect(container.querySelector('.sk-shell__dock')).toBeNull();
    // В шапке широкого экрана «скоро» остаётся: там это анонс, а не навигация в зоне пальца.
    expect(within(nav).getByRole('button', { name: 'Bragi · скоро' }).getAttribute('aria-disabled')).toBe('true');
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

// SPRINT_UXR_MOBILE_POLISH/MP2-15-BOTTOM-BAR — слово владельца 25.11.2026 (канал): «нижний бар … можно ли
// как-то его уменьшить и закрыть эту задачу?» — ответ на развилку задачи «скрывать ли нижнее меню модулей,
// когда показан один модуль». Один рабочий модуль — переключать нечего: панели нет, и место под неё
// (48 px + полоса жестов) отдано содержимому. Два и больше — панель как была (тест выше).
describe('KitShell — один рабочий модуль на телефоне (MP2-15)', () => {
  const ONE: KitConfig = { ...CONFIG, modules: [
    { id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' },
    { id: 'bragi', title: 'Bragi', icon: 'harp', status: 'planned' },
  ] };
  it('панели модулей нет, у оболочки отметка «без дока» — отступ снизу не резервируется', () => {
    const { container } = render(<KitShell config={ONE} win={fakeWin()} storage={mem()} narrow />);
    expect(screen.queryByRole('navigation', { name: 'Модули' })).toBeNull();
    expect(container.querySelector('.sk-shell__dock')).toBeNull();
    expect(container.querySelector('.sk-shell')!.className).toMatch(/\bsk-shell--no-dock\b/);
  });
  it('положительный контроль: два рабочих модуля — панель есть, отметки «без дока» нет', () => {
    const { container } = render(<KitShell config={CONFIG} win={fakeWin()} storage={mem()} narrow />);
    expect(screen.getByRole('navigation', { name: 'Модули' })).toBeTruthy();
    expect(container.querySelector('.sk-shell')!.className).not.toMatch(/sk-shell--no-dock/);
  });
  it('CSS: при отметке «без дока» высота дока обнуляется', () => {
    const css = readFileSync(resolve(__dirname, '../styles/seidr.css'), 'utf8');
    expect(css).toMatch(/\.sk-shell--narrow\.sk-shell--no-dock\s*\{[^}]*--sk-dock-h:\s*0(px)?\s*;/);
  });
});
