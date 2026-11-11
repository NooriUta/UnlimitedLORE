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
import { ADMIN_SECTIONS, adminAxisHref, legacyAdminHref } from '../admin/adminModule';
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
    // S7B-17: мастера UC-1/UC-2/UC-7 — во «Начале», рядом с Главной: это вход «хочу сделать».
    expect(groups.find(g => g.id === 'adm-start')!.items.map(i => i.id)).toEqual(['adm-home', 'adm-wiz']);
    // S7B-31 п.1 (решение 1а): «Словари» — в «Языке графа», рядом с правилами CLAUDE:
    // правка справочника меняет подписи и цвета на каждом экране — это язык системы,
    // а группа получает тон риска, как «Доступ» (раньше — нейтральный успех).
    expect(groups.find(g => g.id === 'adm-lang')!.items.map(i => i.id)).toEqual(['adm-dicts', 'adm-rules']);
    expect(groups.find(g => g.id === 'adm-lang')!.tone).toBe('var(--wrn)');
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

  it('S7B-31: вкладки старой админки v1 (section=admin&tab=…) ведут в новые места', () => {
    expect(legacyAdminHref('?section=admin&tab=dicts&dict=area')).toBe('/?mod=admin&sec=adm-dicts&adm-dict=area');
    expect(legacyAdminHref('?section=admin&tab=tags')).toBe('/?mod=admin&sec=adm-dicts&adm-dicts-tab=tags');
    // Настройки v1 раздали по экранам: чеклист — Главная, отказы — Журнал, параметры — Флаги.
    expect(legacyAdminHref('?section=admin&tab=settings')).toBe('/?mod=admin&sec=adm-flags');
    expect(legacyAdminHref('?section=admin&tab=quick')).toBe('/?mod=admin&sec=adm-mcp');
    expect(legacyAdminHref('?section=admin&tab=claudeRules')).toBe('/?mod=admin&sec=adm-rules');
    // Неизвестная вкладка v1 — Главная, а не пустой экран.
    expect(legacyAdminHref('?section=admin&tab=projects')).toBe('/?mod=admin&sec=adm-home');
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

// SPRINT_UXR_S7B_ADMIN/S7B-28 — владелица 11.11: «Кто где — странное разделение.
// Давай люди и проекты будут двумя разделами: "Люди и их проекты" и "Проекты"».
// Было: один раздел adm-who с переключателем «Люди / Проекты» (?adm-by=projects).
// Стало: два раздела меню — adm-who («Люди и их проекты») и adm-projects
// («Проекты», точка роста). Старые адреса с осью ведут в нужный раздел.
describe('S7B-28 · «Люди и их проекты» и «Проекты» — два раздела', () => {
  // S7B-ACL-3: «Доступ к машинам» — сосед «Агентов» в той же группе.
  it('в группе «Люди и агенты» — агенты, «Доступ к машинам», «Люди и их проекты», «Проекты»', () => {
    const grp = v2Config('ru', undefined, 'admin').menu.groups.find(g => g.id === 'adm-people')!;
    expect(grp.items.map(i => i.id)).toEqual(['adm-agents', 'adm-machines', 'adm-who', 'adm-projects']);
    expect(grp.items.map(i => i.title)).toEqual(['Агенты', 'Доступ к машинам', 'Люди и их проекты', 'Проекты']);
    const icons = (gameIcons as { icons: Record<string, unknown> }).icons;
    for (const i of grp.items) expect(icons[i.icon as string], `${i.id}:${i.icon}`).toBeTruthy();
    expect(new Set(grp.items.map(i => i.icon)).size).toBe(4);
  });

  it('старый /admin?adm=who с осью «проекты» — в раздел «Проекты»; без оси или «люди» — в «Люди и их проекты»', () => {
    expect(legacyAdminHref('?adm=who&adm-by=projects&adm-open=AIDA%2FminiLORE'))
      .toBe('/?mod=admin&sec=adm-projects&adm-open=AIDA%2FminiLORE');
    expect(legacyAdminHref('?adm=who&adm-open=u1')).toBe('/?mod=admin&sec=adm-who&adm-open=u1');
    expect(legacyAdminHref('?adm=who&adm-by=people&adm-q=x')).toBe('/?mod=admin&sec=adm-who&adm-q=x');
    expect(legacyAdminHref('?adm=projects')).toBe('/?mod=admin&sec=adm-projects');
  });

  it('адрес модуля sec=adm-who&adm-by=projects — переписывается в sec=adm-projects, прочее сохраняется', () => {
    expect(adminAxisHref('?mod=admin&sec=adm-who&adm-by=projects&adm-q=fro'))
      .toBe('/?mod=admin&sec=adm-projects&adm-q=fro');
    expect(adminAxisHref('?mod=admin&sec=adm-who&adm-by=people')).toBe('/?mod=admin&sec=adm-who');
    expect(adminAxisHref('?mod=admin&sec=adm-who&adm-open=u1')).toBeNull();
    expect(adminAxisHref('?mod=admin&sec=adm-projects')).toBeNull();
    expect(adminAxisHref('?mod=forseti&sec=news&adm-by=projects')).toBeNull();
  });

  it('App: старая ссылка с осью «проекты» открывает раздел «Проекты»', async () => {
    const w = fakeWin('?mod=admin&sec=adm-who&adm-by=projects');
    const { container } = render(<App path="/" win={w} storage={mem()} narrow={false} />);
    expect(w.location.search).toBe('?mod=admin&sec=adm-projects');
    expect(container.querySelector('[data-section="adm-projects"]')).toBeTruthy();
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(side).getByRole('link', { name: 'Проекты' }).getAttribute('aria-current')).toBe('page');
  });

  it('App: /admin?adm=who — раздел «Люди и их проекты»', () => {
    const w = fakeWin('?adm=who', '/admin');
    const { container } = render(<App path="/admin" win={w} storage={mem()} narrow={false} />);
    expect(w.location.search).toBe('?mod=admin&sec=adm-who');
    expect(container.querySelector('[data-section="adm-who"]')).toBeTruthy();
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
