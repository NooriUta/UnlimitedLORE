// @vitest-environment jsdom
// SPRINT_VIZ_EMBED/EMB-L2 — «вид приложения» в списке: приложение добавляет
// к видам из list.views свой вид со своей отрисовкой (встроенный график
// Völva в «Спринтах» — рядом с таймлайном, а не вместо него,
// D-2026-LORE-VIZ-EMBED-PLACES). Выбор — в адресе (lav), как и прочие виды.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { readListState, writeListState, DEFAULT_LIST_STATE } from './listModel';

const rec = (id: string, start: string): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status: 'todo', fields: { start } });
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree', fields: [{ key: 'start', title: 'Начало', type: 'date' }] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list', 'timeline'], columns: ['title+id', 'status'], timeline: { start: 'start' }, showClosed: 'all' },
};
const data: KitData = { records: [rec('a', '2026-11-01'), rec('b', '2026-11-03')], edges: [], journal: [], meta: { generated_at: '2026-11-08T12:00:00Z', total: 2 } };
const appViews = [{ id: 'volva', label: 'Völva', render: () => <div data-testid="app-view-body">график</div> }];
const radios = () => within(screen.getByRole('radiogroup', { name: /Вид/ })).getAllByRole('radio');

describe('вид приложения в списке', () => {
  it('стоит после видов конфига; прежние виды на месте', () => {
    render(<ListView config={config} data={data} urlState={false} appViews={appViews} />);
    expect(radios().map(r => r.textContent)).toEqual(['Список', 'Таймлайн', 'Völva']);
  });

  it('выбор рисует тело приложения; возврат к таймлайну — снова таймлайн', () => {
    render(<ListView config={config} data={data} urlState={false} appViews={appViews} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Völva' }));
    expect(screen.getByTestId('app-view-body')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Völva' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Список' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('radio', { name: 'Таймлайн' }));
    expect(screen.queryByTestId('app-view-body')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Таймлайн' }).getAttribute('aria-checked')).toBe('true');
  });

  it('без appViews — ничего не меняется', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    expect(radios().map(r => r.textContent)).toEqual(['Список', 'Таймлайн']);
  });

  it('вид приложения пропал (настройка выключена) — список, а не пустой экран', () => {
    render(<ListView config={config} data={data} urlState={false} initial={{ appView: 'volva' }} />);
    expect(screen.getByRole('radio', { name: 'Список' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Запись a')).toBeTruthy();
  });

  it('выбор в адресе: lav пишется и читается', () => {
    expect(writeListState({ ...DEFAULT_LIST_STATE, appView: 'volva' }).lav).toBe('volva');
    expect(writeListState(DEFAULT_LIST_STATE).lav).toBeNull();
    expect(readListState(new URLSearchParams('lav=volva')).appView).toBe('volva');
    expect(readListState(new URLSearchParams('')).appView).toBeUndefined();
  });
});

// Приёмка препрода 14.11.2026: при `lav=volva` в адресе после перезагрузки и после смены проекта
// активен «Список» — «Völva» приходилось нажимать снова. Корень: initialState переносил из адреса
// только часть полей. Правило: при загрузке восстанавливается КАЖДОЕ поле, которое умеет читать
// readListState (вид приложения, месяц календаря, фильтр библиотеки и т.д.).
import type { UrlWindow } from '../resilience/urlState';
const winAt = (search: string): UrlWindow => ({
  location: { pathname: '/', search, hash: '' },
  history: { pushState: () => {}, replaceState: () => {} },
} as unknown as UrlWindow);
describe('вид приложения восстанавливается из адреса', () => {
  it('lav=volva в адресе — сразу открыт вид приложения', () => {
    render(<ListView config={config} data={data} urlState={winAt('?lav=volva')} appViews={appViews} />);
    expect(screen.getByTestId('app-view-body')).toBeTruthy();
  });
  it('вид приложения пришёл позже (настройка догрузилась) — выбор из адреса подхватывается', () => {
    const { rerender } = render(<ListView config={config} data={data} urlState={winAt('?lav=volva')} />);
    rerender(<ListView config={config} data={data} urlState={winAt('?lav=volva')} appViews={appViews} />);
    expect(screen.getByTestId('app-view-body')).toBeTruthy();
  });
});
