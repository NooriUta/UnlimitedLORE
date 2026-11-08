// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33 — раскладка паспорта по решению владелицы 08.11:
// «снизу» и «на весь экран» — большой блок справа: вкладки того, без чего
// изменения не сохранить (Текст, Свойства, свои вкладки типа); узкая колонка
// слева — вычисляемое (связи, граф, журнал, история), только чтение.
// «Панелью справа» — левой колонки нет, всё вкладками одного блока: сначала
// вкладки записи, затем вычисляемые с пометкой зоны.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { spec: { title: 'Спека', icon: 'scroll-quill', fields: [{ key: 'projects', title: 'Проекты', type: 'ref' }, { key: 'version', title: 'Версия', type: 'text' }] } },
  statuses: { items: [{ code: 'proposed', title: 'предложено', category: 'active', icon: 'calendar', color: 'var(--acc)' }] },
};
const rec: KitRecord = { id: 'S-1', kind: 'spec', title: 'Спека', status: 'proposed', fields: { projects: ['P'], version: '1.0' }, body_md: 'Текст спеки' };
const ctx: KitCtx = {
  config, data: { records: [rec, { id: 'P', kind: 'spec', title: 'Проект', status: 'proposed', fields: {} }], edges: [{ from: 'S-1', to: 'P', type: 'BELONGS_TO_PROJECT' }], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } },
  href: id => `#${id}`, esc: s => s, md: s => s,
};
const view = (placement: 'right' | 'bottom' | 'full', tab = 'overview', aroundAs?: 'tabs' | 'column') =>
  render(<RecordView record={rec} ctx={ctx} tab={tab} onTab={() => {}} placement={placement} aroundAs={aroundAs} />);
const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent?.replace(/\d+$/, ''));

describe('по умолчанию (владелица 08.11, «пока как в MVP») — вычисляемое вкладками основного блока', () => {
  it.each(['bottom', 'full'] as const)('%s: колонки слева нет; связи, граф, журнал — вкладками', p => {
    const { container } = view(p);
    expect(tabNames()).toEqual(['Текст', 'Связи', 'Граф', 'Журнал']);
    expect(container.querySelector('aside[data-zone="around"]')).toBeNull();
  });
});

describe('снизу / на весь экран — свойства колонкой справа (владелица 08.11)', () => {
  // во весь экран свойства свёрткой и рейкой (S4-CONTENT-V4, fullV4.test.tsx)
  it.each(['bottom'] as const)('%s: контент и свойства видны сразу, без переключения вкладок', p => {
    const { container } = view(p);
    expect(screen.getByText('Текст спеки')).toBeTruthy();
    const side = container.querySelector('aside[data-zone="props"]') as HTMLElement;
    expect(side).not.toBeNull();
    expect(within(side).getByTestId('kit-fields').textContent).toContain('1.0');
    expect(side.parentElement?.classList.contains('sk-rec__body')).toBe(true); // 08.11: вровень с контентом, под шапкой
    expect(container.querySelector('.sk-rec__content')?.nextElementSibling).toBe(side);
  });
  it('на другой вкладке колонка свойств остаётся', () => {
    const { container } = view('bottom', 'links');
    expect(container.querySelector('aside[data-zone="props"] [data-testid="kit-fields"]')).not.toBeNull();
  });
});

describe('aroundAs="column": снизу / на весь экран — вычисляемое колонкой слева', () => {
  it.each(['bottom'] as const)('%s: слева — связи, граф, журнал; в центре — Текст; справа — свойства', p => {
    const { container } = view(p, 'overview', 'column');
    expect(screen.queryAllByRole('tab')).toHaveLength(0); // одна вкладка — ряд не рисуем
    expect(screen.getByText('Текст спеки')).toBeTruthy();
    const around = container.querySelector('[data-zone="around"]')!;
    expect(around.tagName).toBe('ASIDE');
    expect(within(around as HTMLElement).getByRole('heading', { name: /Связи/ })).toBeTruthy();
    expect(within(around as HTMLElement).getByRole('heading', { name: /Граф/ })).toBeTruthy();
    expect(within(around as HTMLElement).getByRole('heading', { name: /Журнал/ })).toBeTruthy();
    expect(container.querySelector('aside[data-zone="props"]')).not.toBeNull();
    expect(container.querySelector('.sk-rec')?.getAttribute('data-placement')).toBe(p);
  });
});

describe('панелью справа — переключатель видов над шапкой (владелица 08.11)', () => {
  const sw = () => screen.getByRole('group', { name: 'Вид паспорта' });
  const pressed = () => within(sw()).getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);
  it('«Контент · Свойства · Аналитика» стоит над заголовком', () => {
    view('right');
    expect(within(sw()).getAllByRole('button').map(b => b.textContent)).toEqual(['Контент', 'Свойства', 'Аналитика']);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(sw().compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('Контент: текст, без вкладок «Свойства» и аналитики', () => {
    const { container } = view('right');
    expect(pressed()).toEqual(['Контент']);
    expect(screen.getByText('Текст спеки')).toBeTruthy();
    expect(screen.queryAllByRole('tab').map(t => t.textContent)).not.toContain('Свойства');
    expect(container.querySelector('aside[data-zone="around"]')).toBeNull();
    expect(container.querySelector('aside[data-zone="props"]')).toBeNull();
  });
  it('Свойства: поля записи', () => {
    view('right', 'props');
    expect(pressed()).toEqual(['Свойства']);
    expect(screen.getByTestId('kit-fields').textContent).toContain('1.0');
  });
  it('Аналитика: вкладки Связи, Граф, Журнал', () => {
    view('right', 'links');
    expect(pressed()).toEqual(['Аналитика']);
    expect(tabNames()).toEqual(['Связи', 'Граф', 'Журнал']);
  });
  it('переключение вида ведёт на первую вкладку вида', () => {
    const onTab = vi.fn();
    render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={onTab} placement="right" />);
    fireEvent.click(within(sw()).getByRole('button', { name: 'Аналитика' }));
    expect(onTab).toHaveBeenLastCalledWith('links');
    fireEvent.click(within(sw()).getByRole('button', { name: 'Свойства' }));
    expect(onTab).toHaveBeenLastCalledWith('props');
  });
});

describe('без placement — прежнее поведение', () => {
  it('вкладки как раньше: Обзор с полями внутри', () => {
    render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} />);
    expect(screen.getAllByRole('tab')[0].textContent).toBe('Обзор');
    expect(screen.getByTestId('kit-fields')).toBeTruthy();
  });
});

describe('RecordDock — место паспорта', () => {
  it('right/bottom: под панелью виден фон-список; full — фона нет', async () => {
    const { RecordDock } = await import('./RecordDock');
    const { container, rerender } = render(<RecordDock placement="bottom" backdrop={<span>список</span>}><p>паспорт</p></RecordDock>);
    expect(container.querySelector('.sk-dock')?.getAttribute('data-placement')).toBe('bottom');
    expect(container.querySelector('.sk-dock__backdrop')?.textContent).toBe('список');
    rerender(<RecordDock placement="full" backdrop={<span>список</span>}><p>паспорт</p></RecordDock>);
    expect(container.querySelector('.sk-dock__backdrop')).toBeNull();
    expect(screen.getByText('паспорт')).toBeTruthy();
  });
  it('full — настоящий полный экран: слой поверх страницы, выход кнопкой и Esc', async () => {
    const { RecordDock } = await import('./RecordDock');
    const onExit = vi.fn();
    const { container } = render(<RecordDock placement="full" onExitFull={onExit}><p>паспорт</p></RecordDock>);
    const dock = container.querySelector('.sk-dock')!;
    expect(dock.getAttribute('role')).toBe('dialog');
    expect(dock.getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из полного экрана' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(2);
  });
  it('right/bottom — не диалог и без кнопки выхода', async () => {
    const { RecordDock } = await import('./RecordDock');
    const { container } = render(<RecordDock placement="bottom" onExitFull={() => {}}><p>паспорт</p></RecordDock>);
    expect(container.querySelector('.sk-dock')?.getAttribute('role')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Выйти из полного экрана' })).toBeNull();
  });
});
