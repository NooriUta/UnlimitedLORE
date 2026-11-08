// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-26 — поповер «Группировка» как в прототипе v4 + подгруппа.
// Скрин владелицы (114908): «Группировка · одна на список, доску и таймлайн»,
// пункты с ✓ у выбранного, «Подгруппа · внутри „Статус“», пояснение внизу.
// Значение живёт в самой кнопке («Группировка: Статус ▾»), а не в метке рядом
// с селектом. Подгруппа — вторая ступень (lg2 в URL); доска и таймлайн
// используют только первую — поповер пишет это текстом.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { DEFAULT_LIST_STATE, readListState, writeListState } from './listModel';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string, area: string): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields: { area } });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'active', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--acc)' },
  ] },
  list: { views: ['list', 'board'], columns: ['title+id', 'status'], groupings: ['status', 'area'] },
};
const data: KitData = {
  records: [rec('1', 'todo', 'ui'), rec('2', 'todo', 'api'), rec('3', 'active', 'ui'), rec('4', 'todo', 'ui')],
  edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z', total: 4, truncated: false },
};

const trigger = () => screen.getByRole('button', { name: /^Группировка:/ });
const open = () => { fireEvent.click(trigger()); return screen.getByRole('dialog', { name: 'Группировка' }); };

describe('кнопка-значение и поповер', () => {
  it('значение — в кнопке; поповер: раздел группировки с ✓ у выбранного и пояснение', () => {
    render(<ListView config={cfg} data={data} urlState={false} />);
    expect(trigger().getAttribute('aria-label')).toMatch(/Группировка: без группировки/); // 08.11: подпись — в рамке сегмента, в кнопке только значение
    expect(trigger().textContent).toMatch(/без группировки/);
    const dlg = open();
    const g = within(dlg).getByRole('radiogroup', { name: /одна на список, доску и таймлайн/ });
    expect(within(g).getByRole('radio', { name: /без группировки/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dlg).queryByRole('radiogroup', { name: /Подгруппа/ })).toBeNull();
    expect(dlg.textContent).toMatch(/доска и таймлайн используют первую/);
  });

  it('выбор группы — группы в списке, значение в кнопке, появляется раздел «Подгруппа · внутри „…“»', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    const dlg = open();
    fireEvent.click(within(dlg).getByRole('radio', { name: /Статус/ }));
    expect(container.querySelectorAll('[data-group-key]')).toHaveLength(2);
    expect(trigger().getAttribute('aria-label')).toMatch(/Группировка: Статус/);
    expect(within(dlg).getByRole('radiogroup', { name: /Подгруппа · внутри «Статус»/ })).toBeTruthy();
  });
});

describe('подгруппа — вторая ступень', () => {
  it('статус → область: внутри «к работе» подгруппы ui (2) и api (1) со своими счётчиками', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} initial={{ group: 'status' }} />);
    const dlg = open();
    fireEvent.click(within(within(dlg).getByRole('radiogroup', { name: /Подгруппа/ })).getByRole('radio', { name: /Область|area/ }));
    const todo = container.querySelector('[data-group-key="todo"]')!.closest('tbody')!;
    const subs = [...todo.querySelectorAll('[data-subgroup-key]')].map(s => [s.getAttribute('data-subgroup-key'), s.querySelector('.sk-list__gcount')?.textContent]);
    expect(subs).toEqual([['ui', '2'], ['api', '1']]);
    expect(todo.querySelectorAll('[data-record-id]')).toHaveLength(3);
  });

  it('подгруппа = группе не предлагается; смена группы на «без» снимает подгруппу', () => {
    render(<ListView config={cfg} data={data} urlState={false} initial={{ group: 'status', group2: 'area' }} />);
    const dlg = open();
    const sub = within(dlg).getByRole('radiogroup', { name: /Подгруппа/ });
    expect(within(sub).queryByRole('radio', { name: /^Статус/ })).toBeNull();
    fireEvent.click(within(within(dlg).getByRole('radiogroup', { name: /одна на список/ })).getByRole('radio', { name: /без группировки/ }));
    expect(within(dlg).queryByRole('radiogroup', { name: /Подгруппа/ })).toBeNull();
  });

  it('на доске подгруппа не применяется', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} initial={{ view: 'board', group: 'area', group2: 'status' }} />);
    expect(container.querySelector('[data-subgroup-key]')).toBeNull();
  });

  it('URL: lg2 туда и обратно; без группы подгруппа не пишется', () => {
    expect(writeListState({ ...DEFAULT_LIST_STATE, group: 'status', group2: 'area' }).lg2).toBe('area');
    expect(writeListState({ ...DEFAULT_LIST_STATE, group: null, group2: 'area' }).lg2).toBeNull();
    expect(readListState(new URLSearchParams('lg=status&lg2=area')).group2).toBe('area');
  });
});
