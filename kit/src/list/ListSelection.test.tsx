// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-10 — выделение в строках движка списка:
// долгое нажатие (телефон), чекбоксы режима выбора, панель действий вместо
// шапки, массовые действия с честным ходом (выполняется / ошибка с причиной).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { LONG_PRESS } from './listSelection';

beforeAll(() => { registerGameIcons(gameIcons); });

// jsdom не знает PointerEvent: без шима fireEvent.pointer* шлёт голый Event без
// координат и pointerType, и сдвиг пальца в тесте был бы невидим.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? '';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
}

const rec = (id: string, status: string): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status, fields: {} });

// Без колонки 'select': чекбоксы появляются только в режиме выбора.
const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list', 'board'], filters: ['status'], columns: ['title+id', 'status'] },
};
const data = (records: KitRecord[]): KitData =>
  ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z', total: records.length } });
const three = () => data([rec('1', 'todo'), rec('2', 'done'), rec('3', 'done')]);
const row = (c: HTMLElement, id: string) => c.querySelector(`[data-record-id="${id}"]`) as HTMLElement;
const touch = { pointerType: 'touch', clientX: 10, clientY: 10, isPrimary: true, button: 0 };

function longPress(el: HTMLElement) {
  fireEvent.pointerDown(el, touch);
  act(() => { vi.advanceTimersByTime(LONG_PRESS.ms + 10); });
  fireEvent.pointerUp(el, touch);
  fireEvent.click(el);
}

describe('долгое нажатие на строку (телефон)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('включает режим выбора, выбирает строку, появляются чекбоксы; клик отпускания не снимает выбор', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    longPress(row(container, '2'));
    const root = container.querySelector('.sk-list') as HTMLElement;
    expect(root.getAttribute('data-selecting')).toBe('true');
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 1');
    expect((screen.getByRole('checkbox', { name: 'Выбрать: Запись 2' }) as HTMLInputElement).checked).toBe(true);
    expect(row(container, '2').getAttribute('aria-selected')).toBe('true');
  });

  it('короткое касание — не выбор; сдвиг пальца (прокрутка) отменяет долгое нажатие', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} />);
    const r = row(container, '1');
    fireEvent.pointerDown(r, touch);
    act(() => { vi.advanceTimersByTime(LONG_PRESS.ms / 2); });
    fireEvent.pointerUp(r, touch);
    act(() => { vi.advanceTimersByTime(LONG_PRESS.ms); });
    expect(screen.queryByTestId('kit-list-selbar')).toBeNull();

    fireEvent.pointerDown(r, touch);
    fireEvent.pointerMove(r, { ...touch, clientY: 10 + LONG_PRESS.slop + 20 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS.ms * 2); });
    expect(screen.queryByTestId('kit-list-selbar')).toBeNull();
  });

  it('в режиме выбора касание строки переключает её, а ссылка заголовка не уводит со страницы', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} href={id => `/x/${id}`} />);
    longPress(row(container, '1'));
    fireEvent.click(row(container, '3'));
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 2');
    const link = within(row(container, '3')).getByRole('link');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 1');
  });

  it('долгое нажатие на карточку доски — тоже выбор', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} initial={{ view: 'board' }} />);
    longPress(row(container, '3'));
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 1');
    expect(row(container, '3').className).toContain('is-selected');
  });
});

describe('панель действий вместо шапки', () => {
  it('кнопка «Выбрать» (клавиатура/мышь) включает режим; панель — первой, на месте шапки', () => {
    const { container } = render(
      <ListView config={cfg} data={three()} urlState={false} bulkActions={[{ id: 'x', title: 'Экспорт', run: () => {} }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    const root = container.querySelector('.sk-list') as HTMLElement;
    expect(root.getAttribute('data-selecting')).toBe('true');
    expect(root.firstElementChild?.getAttribute('data-testid')).toBe('kit-list-selbar');
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 0');
    expect(screen.getAllByRole('checkbox').length).toBe(4); // «все» + 3 строки
    // действие без выбора недоступно — не запускается вхолостую
    expect((screen.getByRole('button', { name: 'Экспорт' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('без массовых действий кнопки «Выбрать» нет — режим выбора незачем', () => {
    render(<ListView config={cfg} data={three()} urlState={false} />);
    expect(screen.queryByRole('button', { name: 'Выбрать' })).toBeNull();
  });

  it('«Готово» и Esc выходят из режима и снимают выделение', () => {
    const { container } = render(
      <ListView config={cfg} data={three()} urlState={false} bulkActions={[{ id: 'x', title: 'Экспорт', run: () => {} }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.queryByTestId('kit-list-selbar')).toBeNull();
    expect(container.querySelector('.sk-list')?.getAttribute('data-selecting')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 2' }));
    fireEvent.keyDown(container.querySelector('.sk-list') as HTMLElement, { key: 'Escape' });
    expect(screen.queryByTestId('kit-list-selbar')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('CSS: на телефоне в режиме выбора шапка списка скрыта, панель прилипает сверху, цели ≥ --tap', () => {
    // В jsdom import.meta.url не file:, путь — от корня пакета kit (там стартует vitest).
    const css = readFileSync(resolve(process.cwd(), 'src/styles/seidr.css'), 'utf8');
    expect(css).toMatch(/--fs-base/); // положительный контроль
    const media = /@media \(max-width: 720px\), \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf('S4-10')));
    expect(media, 'media-блок S4-10').toBeTruthy();
    expect(media![1]).toMatch(/\.sk-list\[data-selecting='true'\] \.sk-list__bar[\s\S]*display:\s*none/);
    expect(media![1]).toMatch(/\.sk-list\[data-selecting='true'\] \.sk-list__controls/);
    expect(media![1]).toMatch(/\.sk-list__selbar\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.sk-list__selbar \.sk-btn\s*\{[^}]*min-height:\s*max\(var\(--tap\)/);
  });
});

describe('массовые действия', () => {
  it('действие получает только видимые выбранные: скрытое фильтром не трогается', () => {
    const run = vi.fn();
    render(<ListView config={cfg} data={three()} urlState={false} bulkActions={[{ id: 'x', title: 'Экспорт', run }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 2' }));
    // Фильтр поля — фасет (S4-05): кнопка «Статус…» и флажок значения.
    const statusBtn = within(screen.getByTestId('kit-list-controls')).getByRole('button', { name: /^Статус/ });
    fireEvent.click(statusBtn);
    fireEvent.click(within(document.getElementById(statusBtn.getAttribute('aria-controls')!)!).getByRole('checkbox', { name: /готово/ }));
    fireEvent.click(statusBtn);
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(run).toHaveBeenCalledWith(['2']);
  });

  it('асинхронное действие: пока идёт — кнопки заняты; отказ — причина в role=alert, выбор сохранён', async () => {
    let reject!: (e: Error) => void;
    const run = vi.fn(() => new Promise<void>((_, rj) => { reject = rj; }));
    render(<ListView config={cfg} data={three()} urlState={false} bulkActions={[{ id: 'x', title: 'Экспорт', run }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    const bar = screen.getByTestId('kit-list-selbar');
    expect(bar.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: 'Экспорт' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { reject(new Error('403 нет прав')); });
    expect(bar.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('alert').textContent).toContain('403 нет прав');
    expect(screen.getByRole('alert').textContent).toContain('Экспорт');
    expect(bar.textContent).toContain('Выбрано: 1');
  });

  it('axe: режим выбора со списком и панелью — без нарушений', async () => {
    const { container } = render(
      <ListView config={cfg} data={three()} urlState={false} bulkActions={[{ id: 'x', title: 'Экспорт', run: () => {} }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 1' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
