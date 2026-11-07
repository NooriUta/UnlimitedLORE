// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-08 — виды списка: сохранить / сохранить как /
// сбросить, командные виды по умолчанию. Проверка задачи: сохранённый вид
// восстанавливается, «сохранить как» создаёт новый, «сбросить» возвращает
// командный вид по умолчанию. Состояния хранилища — честные (ошибка ≠ нет прав
// ≠ пусто), цели касания — классами kit (--tap).
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../../elements/GameIcon';
import { axeViolations } from '../../test/axe';
import type { KitConfig, KitData, KitRecord } from '../../core/contract';
import { DEFAULT_LIST_STATE } from '../../list/listModel';
import { ListView } from '../../list/ListView';
import { SavedListView } from './SavedListView';
import { createMemoryViewStore, listStateToQuery } from './savedViews';
import type { KitSavedListView, KitViewStore } from './savedViews';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status, fields: {} });
const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list'], filters: ['status'], groupings: ['status'], columns: ['title+id', 'status'] },
};
const data: KitData = {
  records: [rec('1', 'todo'), rec('2', 'done'), rec('3', 'done')], edges: [], journal: [],
  meta: { generated_at: '2026-11-07T00:00:00Z', total: 3 },
};
const team: KitSavedListView = {
  id: 'team-done', name: 'Готовые', section: 'tasks', owner: null, visibility: 'all', team_default: true,
  query: listStateToQuery({ ...DEFAULT_LIST_STATE, filters: { status: ['done'] } }),
};
const rows = (c: HTMLElement) => c.querySelectorAll('[data-record-id]');
// Фильтр поля — фасет (S4-05): кнопка «Статус…» и флажки значений. pickStatus
// оставляет отмеченным ровно одно значение — как прежний выбор в селекте.
const STATUS_TITLE: Record<string, string> = { todo: 'к работе', done: 'готово' };
function pickStatus(code: string) {
  const btn = within(screen.getByTestId('kit-list-controls')).getByRole('button', { name: /^Статус/ });
  if (btn.getAttribute('aria-expanded') !== 'true') fireEvent.click(btn);
  const panel = document.getElementById(btn.getAttribute('aria-controls')!)!;
  for (const box of within(panel).queryAllByRole('checkbox') as HTMLInputElement[]) {
    if (box.checked) fireEvent.click(box);
  }
  fireEvent.click(within(panel).getByRole('checkbox', { name: new RegExp(STATUS_TITLE[code]) }));
  fireEvent.click(btn);
}
const viewSelect = () => screen.getByLabelText('Вид') as HTMLSelectElement;

function setup(store: KitViewStore = createMemoryViewStore({ user: 'u-1', teamViews: [team] })) {
  const r = render(<SavedListView config={cfg} data={data} store={store} section="tasks" user="u-1" urlState={false} />);
  return { ...r, store };
}

describe('ListView — управляемое состояние (для видов)', () => {
  it('state снаружи задаёт фильтр; правка уходит в onStateChange, а не в своё состояние', () => {
    const seen: unknown[] = [];
    const { container, rerender } = render(
      <ListView config={cfg} data={data} urlState={false} state={{ ...DEFAULT_LIST_STATE, filters: { status: ['todo'] } }} onStateChange={s => seen.push(s)} />,
    );
    expect(rows(container)).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('kit-list-controls')).getByRole('button', { name: /^Статус/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /готово/ }));
    expect(seen).toEqual([{ ...DEFAULT_LIST_STATE, filters: { status: ['todo', 'done'] } }]);
    expect(rows(container)).toHaveLength(1); // пока родитель не применил
    rerender(<ListView config={cfg} data={data} urlState={false} state={{ ...DEFAULT_LIST_STATE, filters: { status: ['todo', 'done'] } }} onStateChange={() => {}} />);
    expect(rows(container)).toHaveLength(3);
  });
});

describe('командный вид по умолчанию', () => {
  it('открывается сам: фильтр командного вида применён, вид выбран, «изменён» нет', async () => {
    const { container } = setup();
    await waitFor(() => expect(viewSelect().value).toBe('team-done'));
    expect(rows(container)).toHaveLength(2);
    expect(screen.queryByTestId('kit-views-dirty')).toBeNull();
  });
});

describe('сохранить как / сохранить / восстановить', () => {
  it('«Сохранить как» создаёт новый вид с текущими фильтром и группировкой', async () => {
    const { store } = setup();
    await waitFor(() => expect(viewSelect().value).toBe('team-done'));
    pickStatus('todo');
    expect(screen.getByTestId('kit-views-dirty')).toBeTruthy();
    // на командном виде «Сохранить» недоступно — только «как»
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как…' }));
    fireEvent.change(screen.getByLabelText('Имя вида'), { target: { value: 'К работе' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Создать вид' })); });
    const all = await store.list('tasks');
    expect(all.map(v => v.name)).toEqual(['Готовые', 'К работе']);
    const created = all[1];
    expect(created.owner).toBe('u-1');
    expect(created.query).toBe(listStateToQuery({ ...DEFAULT_LIST_STATE, filters: { status: ['todo'] } }));
    await waitFor(() => expect(viewSelect().value).toBe(created.id));
    expect(screen.queryByTestId('kit-views-dirty')).toBeNull();
  });

  it('«Сохранить» перезаписывает свой вид; выбор вида восстанавливает его состояние', async () => {
    const mine: KitSavedListView = { id: 'v-1', name: 'Мой', section: 'tasks', owner: 'u-1', visibility: 'me', query: '' };
    const store = createMemoryViewStore({ user: 'u-1', teamViews: [team] });
    await store.create({ ...mine });
    const { container } = setup(store);
    await waitFor(() => expect(viewSelect().value).toBe('team-done'));
    const myId = (await store.list('tasks'))[1].id;
    fireEvent.change(viewSelect(), { target: { value: myId } });
    expect(rows(container)).toHaveLength(3);
    pickStatus('todo');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect((await store.list('tasks'))[1].query).toBe(listStateToQuery({ ...DEFAULT_LIST_STATE, filters: { status: ['todo'] } }));
    // уйти на командный и вернуться — состояние вида восстановлено
    fireEvent.change(viewSelect(), { target: { value: 'team-done' } });
    expect(rows(container)).toHaveLength(2);
    fireEvent.change(viewSelect(), { target: { value: myId } });
    expect(rows(container)).toHaveLength(1);
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('Статус: к работе');
  });
});

describe('сбросить', () => {
  it('правки — к сохранённому состоянию вида; без правок — к командному по умолчанию', async () => {
    const store = createMemoryViewStore({ user: 'u-1', teamViews: [team] });
    const mine = await store.create({ name: 'Все', section: 'tasks', query: '', visibility: 'me' });
    const { container } = setup(store);
    await waitFor(() => expect(viewSelect().value).toBe('team-done'));
    fireEvent.change(viewSelect(), { target: { value: mine.id } });
    pickStatus('todo');
    expect(rows(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(viewSelect().value).toBe(mine.id);
    expect(rows(container)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(viewSelect().value).toBe('team-done');
    expect(rows(container)).toHaveLength(2);
    // на командном без правок сбрасывать некуда — кнопка выключена, а не молчит
    expect((screen.getByRole('button', { name: 'Сбросить' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('честные состояния хранилища', () => {
  const failing = (err: unknown): KitViewStore => ({
    list: () => Promise.reject(err),
    create: () => Promise.reject(err),
    update: () => Promise.reject(err),
    remove: () => Promise.reject(err),
  });

  it('сбой загрузки — ошибка с «Повторить», список при этом работает', async () => {
    const { container } = setup(failing(Object.assign(new Error('boom'), { status: 500 })));
    await waitFor(() => expect(screen.getByTestId('kit-views').getAttribute('data-state')).toBe('error'));
    expect(screen.getByRole('alert').textContent).toContain('Виды не загрузились');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(rows(container)).toHaveLength(3);
  });

  it('403 — «нет прав на виды», не ошибка и не пусто', async () => {
    setup(failing(Object.assign(new Error('nope'), { status: 403 })));
    await waitFor(() => expect(screen.getByTestId('kit-views').getAttribute('data-state')).toBe('forbidden'));
  });

  it('видов нет — сказано прямо', async () => {
    setup(createMemoryViewStore({ user: 'u-1' }));
    await waitFor(() => expect(screen.getByTestId('kit-views').getAttribute('data-state')).toBe('empty'));
    expect(screen.getByTestId('kit-views').textContent).toContain('Видов пока нет');
  });

  it('сбой сохранения — ошибка видна, вид не подменён', async () => {
    const base = createMemoryViewStore({ user: 'u-1', teamViews: [team] });
    const store: KitViewStore = { ...base, create: () => Promise.reject(Object.assign(new Error('down'), { status: 503 })) };
    setup(store);
    await waitFor(() => expect(viewSelect().value).toBe('team-done'));
    pickStatus('todo');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как…' }));
    fireEvent.change(screen.getByLabelText('Имя вида'), { target: { value: 'X' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Создать вид' })); });
    expect(screen.getByRole('alert').textContent).toContain('Вид не сохранён');
    expect(viewSelect().value).toBe('team-done');
    expect(screen.getByTestId('kit-views-dirty')).toBeTruthy();
  });
});

describe('доступность', () => {
  it('axe без нарушений на панели видов с открытой формой «Сохранить как»', async () => {
    const { container } = setup();
    await waitFor(() => expect(viewSelect().value).toBe('team-done'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как…' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
