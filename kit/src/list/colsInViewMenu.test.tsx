// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35, первая половина: выбор колонок в самом
// списке.
//
// Находка 09.11: `ColumnsChoice` был написан и покрыт тестами, но в `ListView`
// не вызывался — в прототипе владелицы (docs/prototypes/s4-35-columns.html)
// раздел «Колонки» живёт в полосе «Вид», а в коде его там не было. То есть
// выбрать колонки в списке было нельзя: компонент существовал, управление —
// нет. Тот же класс, что ширина колонок и вкладка «История».
//
// Что закрепляется:
//   • раздел «Колонки» — в том же поповере «Вид», где «Закрытые» и «Паспорт
//     открывается»: одна полоса настроек вида, а не вторая кнопка рядом;
//   • набор уходит в адрес (`?cols=`) — он командный, им делятся ссылкой
//     (решение владелицы 08.11: «ширина личная, набор командный»);
//   • «Запись» не снять — список без названия записи нечитаем;
//   • набор из адреса применяется к таблице, незнакомый ключ отбрасывается;
//   • колонки, которых нет в конфигурации вида, в выбор не попадают: нельзя
//     включить то, чего список не умеет показать.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { ListView, registerGameIcons } from '../index';
import type { KitConfig, KitData, UrlWindow } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задача', icon: 'checklist' } },
  statuses: { items: [{ code: 'active', title: 'В работе', category: 'in_progress', icon: 'gears', color: 'var(--inf)' }] },
  list: { views: ['list'], columns: ['title+id', 'status', 'kind'] },
};

const data: KitData = {
  records: [{ id: 'T-1', kind: 'task', title: 'Первая', status: 'active', fields: {} }],
  edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' },
};

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => w.history.pushState(null, '', url),
    },
  };
  return w;
}

const heads = () => within(screen.getByRole('table')).getAllByRole('columnheader').map(th => th.textContent?.trim());
const openViewMenu = () => fireEvent.click(screen.getByRole('button', { name: /^Вид/ }));

describe('S4-35 · выбор колонок в полосе «Вид»', () => {
  it('положительный контроль: поповер «Вид» открывается', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    openViewMenu();
    expect(screen.getByRole('dialog', { name: /Вид/ })).toBeTruthy();
  });

  it('в поповере есть раздел «Колонки» с галочками по колонкам вида', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    openViewMenu();
    const dlg = screen.getByRole('dialog', { name: /Вид/ });
    expect(within(dlg).getByText('Колонки')).toBeTruthy();
    expect(within(dlg).getByRole('checkbox', { name: 'Статус' })).toBeTruthy();
    expect(within(dlg).getByRole('checkbox', { name: 'Вид' })).toBeTruthy();
  });

  it('«Запись» снять нельзя: список без названия записи нечитаем', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    openViewMenu();
    const dlg = screen.getByRole('dialog', { name: /Вид/ });
    expect((within(dlg).getByRole('checkbox', { name: 'Запись' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('снятая колонка уходит из таблицы и набор пишется в адрес', () => {
    const win = fakeWin();
    render(<ListView config={config} data={data} urlState={win} />);
    openViewMenu();
    fireEvent.click(within(screen.getByRole('dialog', { name: /Вид/ })).getByRole('checkbox', { name: 'Вид' }));
    expect(heads()).not.toContain('Вид');
    expect(decodeURIComponent(win.location.search)).toMatch(/cols=title\+id,status|cols=title%2Bid,status/);
  });

  it('набор из адреса применяется; незнакомый ключ отбрасывается', () => {
    render(<ListView config={config} data={data} urlState={fakeWin('?cols=status,title%2Bid,выдумка')} />);
    expect(heads()).toEqual(['Статус', 'Запись']);
  });

  it('колонок вне конфигурации вида в выборе нет: включить нечего', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    openViewMenu();
    const dlg = screen.getByRole('dialog', { name: /Вид/ });
    expect(within(dlg).queryByRole('checkbox', { name: 'Вердикт' })).toBeNull();
  });
});
