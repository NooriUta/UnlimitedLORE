// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-02 — оболочка kit: модули сверху, меню групп по
// смыслу (из KitConfig.menu), «Мои виды» и «Недавние», drawer на телефоне.
// Состояние (модуль/раздел/вид) — в URL с фолбэком на «#», виды и недавние —
// в хранилище с откатом в память (S4-00f) и честной плашкой об этом.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { KitShell, createSafeStorage, registerGameIcons, useKitShell } from '../index';
import type { KitConfig, KitData } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const CONFIG: KitConfig = {
  modules: [
    { id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' },
    { id: 'research', title: 'Исследования', icon: 'raven' },
    { id: 'bragi', title: 'Bragi', icon: 'harp', status: 'planned' },
  ],
  menu: {
    groups: [
      {
        id: 'work', title: 'Работа', tone: 'acc', items: [
          { id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'list' },
          { id: 'tasks', title: 'Задачи', icon: 'checklist', view: 'board' },
        ],
      },
      {
        id: 'decide', title: 'Решения', tone: 'wrn', items: [
          { id: 'adr', title: 'ADR', icon: 'scales' },
        ],
      },
    ],
    myViews: true,
    recent: true,
  },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint' } },
  statuses: { items: [{ code: 'done', title: 'Готово', category: 'done', icon: 'check-mark', color: 'var(--suc)' }] },
};

const DATA: KitData = {
  records: [{ id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'done', fields: {} }],
  edges: [],
  journal: [],
  meta: { generated_at: '2026-11-07T00:00:00Z' },
};

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/kit', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
}

function Opener() {
  const api = useKitShell();
  return (
    <div>
      <p data-testid="nav">{`${api.nav.module}/${api.nav.item}/${api.nav.view}`}</p>
      <button type="button" onClick={() => api.openRecord('SPRINT_A')}>Открыть А</button>
      <button type="button" onClick={() => api.openRecord('GONE_1')}>Открыть пропавшую</button>
    </div>
  );
}

describe('KitShell — модули сверху', () => {
  it('модули из конфига; активный aria-current; planned — aria-disabled и клик не уводит', () => {
    const onNavigate = vi.fn();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} onNavigate={onNavigate} narrow={false} />);
    const mods = screen.getByRole('navigation', { name: 'Модули' });
    const btns = within(mods).getAllByRole('button');
    expect(btns.map(b => b.getAttribute('aria-label'))).toEqual(['LORE', 'Исследования', 'Bragi · скоро']);
    expect(btns[0].getAttribute('aria-current')).toBe('page');
    expect(btns[2].getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btns[2]);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(btns[1]);
    expect(onNavigate).toHaveBeenLastCalledWith({ module: 'research', item: 'sprints', view: 'list' });
    expect(btns[1].getAttribute('aria-current')).toBe('page');
  });
});

describe('KitShell — меню групп по смыслу', () => {
  it('группы с заголовками и тоном, пункты — кнопки; по умолчанию первый пункт', async () => {
    const { container } = render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false}><Opener /></KitShell>);
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(side).getByRole('heading', { name: 'Работа' })).toBeTruthy();
    const grp = within(side).getByRole('heading', { name: 'Решения' }).closest('.sk-shell__grp')!;
    expect(grp.className).toMatch(/\bsk-shell__grp--wrn\b/);
    expect(within(side).getByRole('button', { name: 'Спринты' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('nav').textContent).toBe('lore/sprints/list');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('клик по пункту: aria-current, вид пункта, onNavigate и URL', () => {
    const win = fakeWin();
    const onNavigate = vi.fn();
    render(<KitShell config={CONFIG} win={win} storage={createSafeStorage(memStorage)} narrow={false} onNavigate={onNavigate}><Opener /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Задачи' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ module: 'lore', item: 'tasks', view: 'board' });
    expect(screen.getByRole('button', { name: 'Задачи' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Спринты' }).getAttribute('aria-current')).toBeNull();
    const q = new URLSearchParams(win.location.search);
    expect([q.get('mod'), q.get('sec'), q.get('view')]).toEqual(['lore', 'tasks', 'board']);
  });

  it('состояние берётся из URL; неизвестные значения — откат к умолчанию', () => {
    const { unmount } = render(<KitShell config={CONFIG} win={fakeWin('?mod=research&sec=adr')} storage={createSafeStorage(memStorage)} narrow={false}><Opener /></KitShell>);
    expect(screen.getByTestId('nav').textContent).toBe('research/adr/null');
    unmount();
    render(<KitShell config={CONFIG} win={fakeWin('?mod=bragi&sec=nope')} storage={createSafeStorage(memStorage)} narrow={false}><Opener /></KitShell>);
    expect(screen.getByTestId('nav').textContent).toBe('lore/sprints/list');
  });

  it('пустое меню в конфиге — честная подпись, а не пустая колонка', () => {
    render(<KitShell config={{ ...CONFIG, menu: { groups: [] } }} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false} />);
    expect(screen.getByRole('navigation', { name: 'Разделы' }).textContent).toContain('В конфиге нет групп меню');
  });
});

describe('KitShell — «Недавние» и «Мои виды»', () => {
  it('недавние: пусто честно; открытая запись — с заголовком из данных; нет в выгрузке — помечено; переживает перерисовку', () => {
    const storage = createSafeStorage(memStorage);
    const onOpenRecord = vi.fn();
    const { unmount } = render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={storage} narrow={false} onOpenRecord={onOpenRecord}><Opener /></KitShell>);
    const recent = () => screen.getByRole('heading', { name: 'Недавние' }).closest('.sk-shell__grp') as HTMLElement;
    expect(recent().textContent).toContain('Пока пусто');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть пропавшую' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть А' }));
    expect(onOpenRecord).toHaveBeenLastCalledWith('SPRINT_A');
    const items = within(recent()).getAllByRole('button');
    expect(items[0].textContent).toContain('Спринт А');
    expect(items[1].textContent).toContain('GONE_1');
    expect(items[1].textContent).toContain('нет в выгрузке');
    fireEvent.click(items[1]);
    expect(onOpenRecord).toHaveBeenLastCalledWith('GONE_1');
    unmount();
    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={storage} narrow={false} />);
    expect(within(recent()).getAllByRole('button')[0].textContent).toContain('GONE_1');
  });

  it('мои виды: пусто честно; сохранить текущий; клик возвращает; удалить', () => {
    const onNavigate = vi.fn();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false} onNavigate={onNavigate}><Opener /></KitShell>);
    const views = () => screen.getByRole('heading', { name: 'Мои виды' }).closest('.sk-shell__grp') as HTMLElement;
    expect(views().textContent).toContain('Видов пока нет');
    fireEvent.click(screen.getByRole('button', { name: 'Задачи' }));
    fireEvent.click(within(views()).getByRole('button', { name: 'Сохранить вид' }));
    const saved = within(views()).getByRole('button', { name: 'Задачи · вид 1' });
    fireEvent.click(screen.getByRole('button', { name: 'ADR' }));
    fireEvent.click(saved);
    expect(onNavigate).toHaveBeenLastCalledWith({ module: 'lore', item: 'tasks', view: 'board' });
    fireEvent.click(within(views()).getByRole('button', { name: 'Удалить вид «Задачи · вид 1»' }));
    expect(within(views()).queryByRole('button', { name: 'Задачи · вид 1' })).toBeNull();
  });

  it('myViews/recent выключены в конфиге — групп нет', () => {
    render(<KitShell config={{ ...CONFIG, menu: { groups: CONFIG.menu.groups } }} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false} />);
    expect(screen.queryByRole('heading', { name: 'Мои виды' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Недавние' })).toBeNull();
  });

  it('хранилище недоступно — честная плашка, виды работают в памяти', () => {
    render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(() => null)} narrow={false} />);
    expect(screen.getByRole('status').textContent).toMatch(/не сохран/i);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вид' }));
    expect(screen.getByRole('button', { name: 'Спринты · вид 1' })).toBeTruthy();
  });
});

describe('KitShell — телефон: меню в drawer', () => {
  it('узко: меню не в колонке, кнопка «Меню» открывает drawer; выбор закрывает и возвращает фокус', async () => {
    render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow><Opener /></KitShell>);
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    const burger = screen.getByRole('button', { name: 'Меню' });
    expect(burger.getAttribute('aria-expanded')).toBe('false');
    burger.focus();
    fireEvent.click(burger);
    const dlg = screen.getByRole('dialog', { name: 'LORE' });
    expect(burger.getAttribute('aria-expanded')).toBe('true');
    expect(within(dlg).getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(within(dlg).getByRole('button', { name: 'ADR' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('nav').textContent).toBe('lore/adr/null');
    expect(document.activeElement).toBe(burger);
  });

  it('без явного narrow — по matchMedia(max-width: 720px), с подпиской на смену', () => {
    let listener: ((e: { matches: boolean }) => void) | null = null;
    const mql = {
      matches: true,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => { listener = l; },
      removeEventListener: () => { listener = null; },
    };
    // jsdom matchMedia не реализует — подставляем свой и возвращаем как было.
    const w = window as unknown as { matchMedia?: unknown };
    const orig = w.matchMedia;
    w.matchMedia = (q: string) => (q === '(max-width: 720px)' ? mql : { matches: false, addEventListener() {}, removeEventListener() {} });
    try {
      render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} />);
      expect(screen.getByRole('button', { name: 'Меню' })).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
      act(() => { mql.matches = false; listener?.({ matches: false }); });
      expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    } finally {
      w.matchMedia = orig;
    }
  });
});

// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-01 — меню по смыслу со сворачиванием групп.
describe('KitShell — сворачивание групп меню (S4-01)', () => {
  const toggle = (name: string) => within(screen.getByRole('heading', { name })).getByRole('button');

  it('заголовок группы — кнопка-раскрывашка; свёрнуто — пункты спрятаны, текущий остаётся', async () => {
    const { container } = render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false}><Opener /></KitShell>);
    const work = toggle('Работа');
    expect(work.getAttribute('aria-expanded')).toBe('true');
    expect(work.className).toMatch(/\bsk-shell__grp-toggle\b/);
    const listId = work.getAttribute('aria-controls')!;
    expect(document.getElementById(listId)).toBeTruthy();
    fireEvent.click(work);
    expect(work.getAttribute('aria-expanded')).toBe('false');
    // Текущий раздел (Спринты) не пропадает из вида — «где я» видно всегда.
    expect(screen.getByRole('button', { name: 'Спринты' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Задачи' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(work);
    expect(screen.getByRole('button', { name: 'Задачи' })).toBeTruthy();
  });

  it('свёрнутая группа без текущего пункта прячет все пункты; выбор запоминается в хранилище', () => {
    const storage = createSafeStorage(memStorage);
    const { unmount } = render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} storageKey="t" narrow={false} />);
    fireEvent.click(toggle('Решения'));
    expect(screen.queryByRole('button', { name: 'ADR' })).toBeNull();
    expect(storage.get('t.collapsed')).toBe(JSON.stringify(['decide']));
    unmount();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} storageKey="t" narrow={false} />);
    expect(toggle('Решения').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'ADR' })).toBeNull();
    expect(toggle('Работа').getAttribute('aria-expanded')).toBe('true');
  });

  it('«Мои виды» и «Недавние» не сворачиваются — служебные группы без раскрывашки', () => {
    render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false} />);
    expect(within(screen.getByRole('heading', { name: 'Мои виды' })).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('heading', { name: 'Недавние' })).queryByRole('button')).toBeNull();
  });

  it('тон группы в форме токена var(--wrn) (как требует валидатор конфига) красит группу так же, как wrn', () => {
    const groups = CONFIG.menu.groups.map(g => ({ ...g, tone: g.tone ? `var(--${g.tone})` : undefined }));
    render(<KitShell config={{ ...CONFIG, menu: { ...CONFIG.menu, groups } }} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false} />);
    const grp = screen.getByRole('heading', { name: 'Решения' }).closest('.sk-shell__grp')!;
    expect(grp.className).toMatch(/\bsk-shell__grp--wrn\b/);
  });

  it('метка рядом с именем приложения (brandTag) — в шапке, после имени', () => {
    const { container } = render(<KitShell config={CONFIG} brand="LORE" brandTag={<span data-testid="tag">v2</span>} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow={false} />);
    const brand = container.querySelector('.sk-shell__brand')!;
    expect(brand.textContent).toBe('LOREv2');
    expect(within(brand as HTMLElement).getByTestId('tag')).toBeTruthy();
  });

  it('сворачивание работает и в drawer на телефоне', () => {
    render(<KitShell config={CONFIG} win={fakeWin()} storage={createSafeStorage(memStorage)} narrow />);
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    const dlg = screen.getByRole('dialog');
    const t = within(within(dlg).getByRole('heading', { name: 'Решения' })).getByRole('button');
    fireEvent.click(t);
    expect(within(dlg).queryByRole('button', { name: 'ADR' })).toBeNull();
  });
});
