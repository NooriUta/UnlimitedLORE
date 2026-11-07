// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-01 — оболочка v2 в приложении: KitShell из
// Seiðr-kit (своей копии оболочки web-next не держит), приложения наверху,
// меню по смыслу со сворачиванием, drawer на телефоне, раздел — в URL.
// Несобранный экран — честное состояние «не собран», а не «пусто».
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import { axeViolations } from '../test/axe';
import App from '../App';

const here = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  registerGameIcons(gameIcons);
});

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}

const mem = () => createSafeStorage(() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
});

describe('оболочка v2 (S4-01)', () => {
  it('приложения наверху: Forseti текущее, мега-разделы — «скоро» и недоступны', async () => {
    const { container } = render(<App path="/" win={fakeWin()} storage={mem()} narrow={false} />);
    expect(container.querySelector('[data-lore-app="v2"]')).toBeTruthy();
    const mods = screen.getByRole('navigation', { name: 'Модули' });
    const forseti = within(mods).getByRole('button', { name: 'Forseti' });
    expect(forseti.getAttribute('aria-current')).toBe('page');
    expect(within(mods).getByRole('button', { name: /BRAGI/ }).getAttribute('aria-disabled')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('меню по смыслу: группы-раскрывашки; по умолчанию — первый раздел, его экран озаглавлен', () => {
    render(<App path="/" win={fakeWin()} storage={mem()} narrow={false} />);
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    const work = within(within(side).getByRole('heading', { name: 'Работа' })).getByRole('button');
    expect(work.getAttribute('aria-expanded')).toBe('true');
    expect(within(side).getByRole('button', { name: 'Спринты' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 1, name: 'Спринты' })).toBeTruthy();
  });

  it('выбор раздела пишется в URL и меняет экран; несобранный экран — «не собран», а не «пусто»', () => {
    const win = fakeWin();
    const { container } = render(<App path="/" win={win} storage={mem()} narrow={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новости' }));
    expect(new URLSearchParams(win.location.search).get('sec')).toBe('news');
    expect(screen.getByRole('heading', { level: 1, name: 'Новости' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.querySelector('[data-state="unbuilt"]')).toBeTruthy();
    expect(main.querySelector('[data-state="empty"]')).toBeNull();
    expect(container.querySelector('[data-section="news"]')).toBeTruthy();
  });

  it('списки (S4-04) — экраны разделов: ADR открывает список kit под одним заголовком раздела', () => {
    const win = fakeWin();
    const { container } = render(<App path="/" win={win} storage={mem()} narrow={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'ADR' }));
    expect(new URLSearchParams(win.location.search).get('sec')).toBe('adr');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.querySelector('[data-section="adr"] [data-screen="adrs"]')).toBeTruthy();
    expect(container.querySelector('[data-state="unbuilt"]')).toBeNull();
  });

  it('старый адрес /sprints ведёт в раздел оболочки ?sec=sprint', () => {
    const win = fakeWin();
    const { container } = render(<App path="/sprints" win={win} storage={mem()} narrow={false} />);
    expect(new URLSearchParams(win.location.search).get('sec')).toBe('sprint');
    expect(container.querySelector('[data-section="sprint"]')).toBeTruthy();
  });

  it('раздел из URL открывается сразу: ?sec=settings — личные настройки (переход v2 → v1)', () => {
    const { container } = render(<App path="/" win={fakeWin('?mod=forseti&sec=settings')} storage={mem()} narrow={false} />);
    expect(container.querySelector('[data-nav-switch="v2"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Настройки' }).getAttribute('aria-current')).toBe('page');
  });

  it('телефон: меню в drawer; выбор раздела закрывает drawer', async () => {
    render(<App path="/" win={fakeWin()} storage={mem()} narrow />);
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    const dlg = screen.getByRole('dialog');
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Задачи' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Задачи' })).toBeTruthy();
  });

  it('оболочка — KitShell из @seidr/kit, своей копии меню/drawer в web-next нет', () => {
    const shell = readFileSync(resolve(here, 'V2Shell.tsx'), 'utf8');
    expect(shell).toMatch(/import \{[^}]*\bKitShell\b[^}]*\} from '@seidr\/kit'/);
    expect(shell).not.toMatch(/sk-shell__/);
  });
});
