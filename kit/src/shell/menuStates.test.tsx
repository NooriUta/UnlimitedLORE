// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MENU-STATES — левое меню в трёх состояниях:
// открыто / рейка иконок / скрыто до ушка. Кнопка переключения ходит по кругу,
// выбор запоминается в хранилище.
//
// Отдельно закреплено, что сворачивание на время чтения (S5-05 ·
// D-2026-UXR-READ-COLLAPSE) остаётся прежним: setMenuCollapsed по-прежнему
// уводит меню в ушко, но в хранилище не пишет — это действие приложения, а не
// выбор человека, и переживать перезагрузку он не должен.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { KitShell, createSafeStorage, registerGameIcons, useKitShell } from '../index';
import type { KitConfig, KitData } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: {
    groups: [
      {
        id: 'work', title: 'Работа', tone: 'acc', items: [
          { id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'list' },
          { id: 'tasks', title: 'Задачи', icon: 'checklist', view: 'board' },
        ],
      },
    ],
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

/** Хранилище на карте — то же, что переживает перезагрузку. */
function memStorage() {
  const m = new Map<string, string>();
  const s = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
  return { storage: s, map: m };
}

/** Показывает режим из API и даёт позвать сворачивание «как режим чтения». */
function Probe() {
  const api = useKitShell();
  return (
    <div>
      <p data-testid="mode">{api.menuMode}</p>
      <p data-testid="collapsed">{String(api.menuCollapsed)}</p>
      <button type="button" onClick={() => api.setMenuCollapsed(true)}>Читать</button>
      <button type="button" onClick={() => api.setMenuMode('rail')}>В рейку</button>
    </div>
  );
}

const root = () => document.querySelector('.sk-shell')!;
/**
 * Кнопка переключения В ШАПКЕ. Их теперь две: вторая — в самой колонке меню,
 * с видимой подписью (замечание владелицы «левое меню не имеет свойства к
 * сворачиванию»: кнопка была только здесь, иконкой без подписи, и не
 * находилась). Поэтому выбираем явно, а не «первую подходящую».
 */
const toggle = () => within(document.querySelector('.sk-shell__top') as HTMLElement).getByRole('button', { name: /Меню:/ });

describe('S4-MENU-STATES · три состояния левого меню', () => {
  it('по умолчанию открыто: ни рейки, ни свёрнутого, меню видно', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><Probe /></KitShell>);
    expect(screen.getByTestId('mode').textContent).toBe('open');
    expect(root().className).not.toMatch(/sk-shell--menu-rail/);
    expect(root().className).not.toMatch(/sk-shell--menu-collapsed/);
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(side).getByRole('link', { name: 'Спринты' })).toBeTruthy();
  });

  it('кнопка переключения ходит по кругу: открыто → рейка → ушко → открыто', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><Probe /></KitShell>);

    fireEvent.click(toggle());
    expect(screen.getByTestId('mode').textContent).toBe('rail');
    expect(root().className).toMatch(/\bsk-shell--menu-rail\b/);
    expect(root().className).not.toMatch(/sk-shell--menu-collapsed/);

    fireEvent.click(toggle());
    expect(screen.getByTestId('mode').textContent).toBe('hidden');
    expect(root().className).toMatch(/\bsk-shell--menu-collapsed\b/);
    expect(root().className).not.toMatch(/sk-shell--menu-rail/);

    fireEvent.click(toggle());
    expect(screen.getByTestId('mode').textContent).toBe('open');
    expect(root().className).not.toMatch(/sk-shell--menu-rail|sk-shell--menu-collapsed/);
  });

  it('в рейке пункты остаются доступны по имени, ушка нет', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><Probe /></KitShell>);
    fireEvent.click(toggle());
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(side).getByRole('link', { name: 'Спринты' })).toBeTruthy();
    expect(within(side).getByRole('link', { name: 'Задачи' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Меню' })).toBeNull();
  });

  it('в ушке меню спрятано, видно ушко «Меню», и оно возвращает к открытому', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><Probe /></KitShell>);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    const ear = screen.getByRole('button', { name: 'Меню' });
    fireEvent.click(ear);
    expect(screen.getByTestId('mode').textContent).toBe('open');
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
  });

  it('выбор запоминается: рейка переживает перезагрузку', () => {
    const { storage, map } = memStorage();
    const safe = createSafeStorage(() => storage);
    const first = render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={safe} narrow={false}><Probe /></KitShell>);
    fireEvent.click(toggle());
    expect(map.get('seidr-kit.menuMode')).toBe('rail');
    first.unmount();

    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><Probe /></KitShell>);
    expect(screen.getByTestId('mode').textContent).toBe('rail');
    expect(root().className).toMatch(/\bsk-shell--menu-rail\b/);
  });

  it('S5-05 не сломан: сворачивание на время чтения уводит в ушко, но выбор не перезаписывает', () => {
    const { storage, map } = memStorage();
    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><Probe /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'В рейку' }));
    expect(map.get('seidr-kit.menuMode')).toBe('rail');

    fireEvent.click(screen.getByRole('button', { name: 'Читать' }));
    expect(screen.getByTestId('collapsed').textContent).toBe('true');
    expect(root().className).toMatch(/\bsk-shell--menu-collapsed\b/);
    // Выбор человека остался прежним — чтение его не переписало.
    expect(map.get('seidr-kit.menuMode')).toBe('rail');
  });

  it('на узком экране кнопки переключения нет — меню и так в drawer', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow><Probe /></KitShell>);
    expect(screen.queryByRole('button', { name: /Меню:/ })).toBeNull();
  });

  it('доступность: в рейке нарушений axe нет', async () => {
    const { storage } = memStorage();
    const { container } = render(<KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><Probe /></KitShell>);
    fireEvent.click(toggle());
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('S4-MENU-STATES · CSS рейки — в общем слое', () => {
  // В jsdom путь — от process.cwd(), не от import.meta.url (ловушка kit).
  const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

  it('у рейки есть правило ширины колонки и скрытия подписей', () => {
    expect(css).toMatch(/\.sk-shell--menu-rail\s+\.sk-shell__body/);
    expect(css).toMatch(/\.sk-shell--menu-rail[^{]*\.sk-shell__label/);
  });
});
