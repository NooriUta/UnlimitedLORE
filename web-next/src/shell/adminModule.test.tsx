// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-01 — админка отдельным модулем ?mod=admin в оболочке
// v2 (прототип docs/prototypes/s7b-admin-v6.html), вход — из меню аватара.
//
// Было: отдельная страница /admin со своей полосой вкладок вне оболочки
// (OutsideShell «вне приложения»): ни меню, ни охвата проектов, ни «назад».
// Стало: модуль оболочки KitShell со своим меню — группы по смыслу и риску
// (Люди и агенты · Доступ · Язык графа · Система), раздел в адресе (sec=adm-…).
// Старые ссылки /admin?adm=… не ломаются — переписываются в модуль.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import App from '../App';
import { ADMIN_SECTIONS, legacyAdminHref } from '../admin/adminModule';
import { AccountMenu } from '../settings/AccountMenu';
import { createLocalS2Client } from '../api/me';
import { v2Config } from './v2Config';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // Экраны админки зовут сервер; здесь сервер «не пускает» — нам важна навигация.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  })));
});
afterEach(() => { vi.unstubAllGlobals(); });

function fakeWin(search = '', pathname = '/'): UrlWindow {
  const w: UrlWindow = {
    location: { pathname, search, hash: '' },
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

describe('S7B-01 · конфиг модуля admin', () => {
  it('в модуле admin — своё меню: группы по смыслу и риску, каждый раздел админки ровно один раз', () => {
    const cfg = v2Config('ru', undefined, 'admin');
    expect(cfg.modules.find(m => m.id === 'admin')).toMatchObject({ status: 'active', title: 'Админка' });
    const groups = cfg.menu.groups;
    expect(groups.map(g => g.id)).toEqual(['adm-start', 'adm-people', 'adm-access', 'adm-lang', 'adm-system']);
    for (const g of groups) expect(g.tone, g.id).toMatch(/^var\(--(acc|suc|wrn|dng|inf)\)$/);
    const items = groups.flatMap(g => g.items.map(i => i.id));
    expect(new Set(items).size).toBe(items.length);
    expect([...items].sort()).toEqual([...ADMIN_SECTIONS].sort());
    // «Доступ» — группа риска: тон предупреждения, а не нейтральный.
    expect(groups.find(g => g.id === 'adm-access')!.tone).toBe('var(--wrn)');
    // Личные «Мои виды» и «Недавние» — про записи Forseti, в админке их нет.
    expect(cfg.menu.myViews).toBeFalsy();
    expect(cfg.menu.recent).toBeFalsy();
  });

  it('вне админки модуля admin в шапке нет: вход — из меню аватара', () => {
    expect(v2Config('ru').modules.map(m => m.id)).not.toContain('admin');
  });

  it('у каждого раздела админки есть подпись на обоих языках', () => {
    for (const lang of ['ru', 'en'] as const) {
      const items = v2Config(lang, undefined, 'admin').menu.groups.flatMap(g => g.items);
      for (const i of items) expect(i.title, `${lang}:${i.id}`).toMatch(/\S/);
    }
  });
});

describe('S7B-01 · старые адреса /admin?adm=…', () => {
  it('переписываются в модуль: раздел и параметры раздела сохраняются', () => {
    expect(legacyAdminHref('?adm=log&adm-batch=rb-1')).toBe('/?mod=admin&sec=adm-log&adm-batch=rb-1');
    expect(legacyAdminHref('?adm=roles&adm-person=u1&adm-view=matrix'))
      .toBe('/?mod=admin&sec=adm-roles&adm-person=u1&adm-view=matrix');
    expect(legacyAdminHref('')).toBe('/?mod=admin&sec=adm-home');
    expect(legacyAdminHref('?adm=zzz')).toBe('/?mod=admin&sec=adm-home');
  });

  it('App на /admin переписывает адрес и рисует раздел внутри оболочки', async () => {
    const w = fakeWin('?adm=flags', '/admin');
    const { container } = render(<App path="/admin" win={w} storage={mem()} narrow={false} />);
    expect(w.location.search).toBe('?mod=admin&sec=adm-flags');
    expect(container.querySelector('.sk-shell')).toBeTruthy();
    expect(container.querySelector('[data-section="adm-flags"]')).toBeTruthy();
  });
});

describe('S7B-01 · модуль в оболочке', () => {
  it('?mod=admin&sec=adm-flags — модуль «Админка» текущий, меню админки, экран раздела', async () => {
    const { container } = render(<App path="/" win={fakeWin('?mod=admin&sec=adm-flags')} storage={mem()} narrow={false} />);
    const mods = screen.getByRole('navigation', { name: 'Модули' });
    expect(within(mods).getByRole('button', { name: 'Админка' }).getAttribute('aria-current')).toBe('page');
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    for (const name of ['Люди и агенты', 'Доступ', 'Язык графа', 'Система']) {
      expect(within(side).getByRole('heading', { name }), name).toBeTruthy();
    }
    expect(within(side).getByRole('link', { name: 'Флаги и версия' }).getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-section="adm-flags"]')).toBeTruthy();
    // Раздел Forseti в меню админки не мешается.
    expect(within(side).queryByRole('link', { name: 'Новости' })).toBeNull();
  });

  it('пункт меню переключает раздел админки, выбор в адресе', async () => {
    const w = fakeWin('?mod=admin&sec=adm-flags');
    const { container } = render(<App path="/" win={w} storage={mem()} narrow={false} />);
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    fireEvent.click(within(side).getByRole('link', { name: 'Роли' }));
    await waitFor(() => expect(container.querySelector('[data-section="adm-roles"]')).toBeTruthy());
    expect(new URLSearchParams(w.location.search).get('sec')).toBe('adm-roles');
    expect(new URLSearchParams(w.location.search).get('mod')).toBe('admin');
  });

  it('без раздела в адресе — Главная «что требует внимания» (S7B-26)', () => {
    const { container } = render(<App path="/" win={fakeWin('?mod=admin')} storage={mem()} narrow={false} />);
    expect(container.querySelector('[data-section="adm-home"]')).toBeTruthy();
  });

  it('из админки обратно в Forseti — меню Forseti, первый его раздел', async () => {
    const w = fakeWin('?mod=admin&sec=adm-flags');
    const { container } = render(<App path="/" win={w} storage={mem()} narrow={false} />);
    const mods = screen.getByRole('navigation', { name: 'Модули' });
    fireEvent.click(within(mods).getByRole('button', { name: 'Forseti' }));
    await waitFor(() => expect(container.querySelector('[data-section="news"]')).toBeTruthy());
    expect(new URLSearchParams(w.location.search).get('mod')).toBe('forseti');
  });
});

describe('S7B-01 · вход из меню аватара', () => {
  it('в меню аватара — ссылка «Админка» на модуль', async () => {
    const backing = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } as unknown as Storage;
    };
    render(<AccountMenu client={createLocalS2Client(createSafeStorage(backing))} lang="ru"
      root={document.createElement('div')} loadPalettes={async () => ({ options: [], default: null, fromModel: false, notes: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /личные настройки/i }));
    const dlg = await screen.findByRole('dialog');
    const link = within(dlg).getByRole('link', { name: 'Админка' });
    expect(link.getAttribute('href')).toBe('/?mod=admin');
  });
});
