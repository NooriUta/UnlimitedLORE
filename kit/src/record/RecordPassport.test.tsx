// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33 — раскладка паспорта по решению владелицы 08.11:
// «снизу» и «на весь экран» — большой блок справа: вкладки того, без чего
// изменения не сохранить (Текст, Свойства, свои вкладки типа); узкая колонка
// слева — вычисляемое (связи, граф, журнал, история), только чтение.
// «Панелью справа» — левой колонки нет, всё вкладками одного блока: сначала
// вкладки записи, затем вычисляемые с пометкой зоны.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('по умолчанию (владелица 08.11, «пока как в MVP») — всё вкладками основного блока', () => {
  it.each(['right', 'bottom', 'full'] as const)('%s: колонки нет, вычисляемое — вкладками после вкладок записи', p => {
    const { container } = view(p);
    expect(tabNames()).toEqual(['Текст', 'Свойства', 'Связи', 'Граф', 'Журнал']);
    expect(container.querySelector('aside[data-zone="around"]')).toBeNull();
    expect(container.querySelector('.sk-rec--zones')).toBeNull();
  });
});

describe('aroundAs="column": снизу / на весь экран — две зоны', () => {
  it.each(['bottom', 'full'] as const)('%s: вкладки записи справа — Текст, Свойства; аналитика — колонкой слева', p => {
    const { container } = view(p, 'overview', 'column');
    expect(tabNames()).toEqual(['Текст', 'Свойства']);
    const around = container.querySelector('[data-zone="around"]')!;
    expect(around.tagName).toBe('ASIDE');
    expect(within(around as HTMLElement).getByRole('heading', { name: /Связи/ })).toBeTruthy();
    expect(within(around as HTMLElement).getByRole('heading', { name: /Граф/ })).toBeTruthy();
    expect(within(around as HTMLElement).getByRole('heading', { name: /Журнал/ })).toBeTruthy();
    expect(container.querySelector('.sk-rec')?.getAttribute('data-placement')).toBe(p);
  });

  it('«Текст» — только тело; поля — во вкладке «Свойства»', () => {
    const { unmount } = view('bottom', 'overview', 'column');
    expect(screen.getByText('Текст спеки')).toBeTruthy();
    expect(screen.queryByTestId('kit-fields')).toBeNull();
    unmount();
    view('bottom', 'props', 'column');
    expect(screen.getByTestId('kit-fields').textContent).toContain('1.0');
  });
});

describe('панелью справа — всё вкладками', () => {
  it('сначала вкладки записи, затем вычисляемые с пометкой зоны; колонки нет', () => {
    const { container } = view('right');
    expect(tabNames()).toEqual(['Текст', 'Свойства', 'Связи', 'Граф', 'Журнал']);
    expect(container.querySelector('aside[data-zone="around"]')).toBeNull();
    const around = screen.getAllByRole('tab').filter(t => t.getAttribute('data-zone') === 'around').map(t => t.textContent?.replace(/\d+$/, ''));
    expect(around).toEqual(['Связи', 'Граф', 'Журнал']);
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
});
