// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-23 (волна 3) — шапка и меню v2 по прототипу v4:
// порядок приложений Forseti · BRAGI · MUNINN · TYR (как в v4 и в v1 shellNav),
// «Новости» — первой группой меню, охват проектов сразу за приложениями,
// поиск и «Команды» — подписанные кнопки с клавишами.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import App from '../App';
import { v2Config } from './v2Config';

beforeAll(() => { registerGameIcons(gameIcons); });

function fakeWin(): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {} },
  };
  return w;
}
const mem = () => createSafeStorage(() => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } as unknown as Storage;
});

describe('меню и приложения', () => {
  it('приложения: Forseti · BRAGI · MUNINN · TYR', () => {
    expect(v2Config('ru').modules.map(m => m.id)).toEqual(['forseti', 'bragi', 'muninn', 'tyr']);
  });
  it('«Новости» — первой группой меню', () => {
    expect(v2Config('ru').menu.groups[0].items.map(i => i.id)).toEqual(['news']);
  });
});

describe('шапка', () => {
  it('охват проектов — сразу за приложениями; поиск и «Команды» подписаны', () => {
    const { container } = render(<App path="/" win={fakeWin()} storage={mem()} narrow={false} />);
    const top = container.querySelector('.sk-shell__top')!;
    const start = top.querySelector('.sk-shell__top-start');
    expect(start).not.toBeNull();
    expect(start!.previousElementSibling?.classList.contains('sk-shell__mods')).toBe(true);
    expect(within(start as HTMLElement).getByRole('button', { name: /Проекты/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Поиск по LORE/ }).textContent).toContain('/');
    expect(within(screen.getByRole('button', { name: /Команды/ })).getByText('Команды')).toBeTruthy();
  });
});
