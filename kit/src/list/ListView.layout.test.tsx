// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21, S4-22, S4-23 (волна 1a) — раскладка списка по прототипу v4.
// В v2 над таблицей стояли три полосы управления:
//   1) виды + «Быстро»;
//   2) [Фильтр][Группировка][Порядок];
//   3) текстовое эхо «Фильтр: … · группировка: …» и «Показано N из M».
// v4 держит одну полосу. Виды переезжают в строку заголовка экрана (ScreenHead),
// «Быстро» и «Показано N из M» — в полосу фильтров. Эхо появляется только когда
// есть что снять (активный фильтр), а не дублирует контролы текстом.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { ScreenHead } from './ScreenHead';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status, fields: {} });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: {
    views: ['list', 'board'],
    // «несуществующий» не совпадает ни с одной записью — счётчик 0 (аудит 10.11).
    quick: [
      { id: 'done', title: 'готово', filter: { status: 'done' } },
      { id: 'none', title: 'несуществующий', filter: { status: 'nonexistent' } },
    ],
    filters: ['status'],
    groupings: ['status'],
    columns: ['title+id', 'status'],
  },
};

const data: KitData = {
  records: [rec('1', 'todo'), rec('2', 'done'), rec('3', 'done')],
  edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z', total: 3, truncated: false },
};

/** Полосы управления между шапкой экрана и таблицей. */
const STRIPS = ['.sk-list__bar', '.sk-list__controls', '.sk-list__desc', '.sk-list__shown'].map(s => `.sk-list > ${s}`).join(', ');

describe('ScreenHead — строка заголовка экрана', () => {
  // Иконки видов задаёт приложение (S4-25: иконки — только из канона LORE v1, своих kit не выдумывает).
  it('заголовок h1, виды с иконками и слот действия — в одной строке', () => {
    render(<ListView config={cfg} data={data} urlState={false} viewIcons={{ list: 'checkbox-tree', board: 'calendar' }}
      head={{ title: 'Спринты', titleId: 'scr-title', actions: <button type="button">+ Создать</button> }} />);
    const head = screen.getByTestId('kit-screenhead');
    expect(within(head).getByRole('heading', { level: 1, name: 'Спринты' }).id).toBe('scr-title');
    const views = within(head).getByRole('radiogroup');
    const radios = within(views).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r.querySelector('.sk-icon'), r.textContent ?? '').not.toBeNull();
    expect(within(head).getByRole('button', { name: '+ Создать' })).toBeTruthy();
  });

  it('без head виды не теряются — они в той же единственной полосе фильтров', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    expect(screen.queryByTestId('kit-screenhead')).toBeNull();
    const controls = screen.getByTestId('kit-list-controls');
    expect(within(controls).getByRole('radiogroup')).toBeTruthy();
    expect(container.querySelectorAll(STRIPS)).toHaveLength(1);
  });

  it('ScreenHead отдельно: экран без списка тоже может собрать шапку', () => {
    render(<ScreenHead title="Новости" titleId="n" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Новости' })).toBeTruthy();
  });
});

describe('одна полоса управления над таблицей (правило S7A-12)', () => {
  it('без фильтра — ровно одна полоса; «Быстро» и «Показано N из M» внутри неё', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} head={{ title: 'Спринты' }} />);
    expect(container.querySelectorAll(STRIPS)).toHaveLength(1);
    const controls = screen.getByTestId('kit-list-controls');
    expect(within(controls).getByRole('group', { name: 'Быстро' })).toBeTruthy();
    expect(within(controls).getByTestId('kit-list-shown').textContent).toBe('Показано 3 из 3');
  });

  it('эхо появляется только с активным условием — и его можно снять', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} head={{ title: 'Спринты' }} />);
    expect(screen.queryByTestId('kit-list-desc')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Быстро' })).getByRole('button', { name: /готово/ }));
    const desc = screen.getByTestId('kit-list-desc');
    expect(desc.textContent).toContain('Быстро: готово');
    expect(container.querySelectorAll('[data-record-id]')).toHaveLength(2);
  });

  it('число быстрого фильтра — отдельный бейдж, не слитый с подписью', () => {
    render(<ListView config={cfg} data={data} urlState={false} />);
    const btn = within(screen.getByRole('group', { name: 'Быстро' })).getByRole('button', { name: /готово/ });
    const count = btn.querySelector('.sk-list__qcount');
    expect(count?.textContent).toBe('2');
    expect(count?.previousElementSibling?.textContent).toBe('готово');
  });

  it('чип «Быстро» с нулевым счётчиком не рисуется — «Без версии 0» — шум (аудит 10.11)', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    const quickGroup = screen.getByRole('group', { name: 'Быстро' });
    expect(within(quickGroup).queryByRole('button', { name: /несуществующий/ })).toBeNull();
    // Ненулевой при этом на месте — скрываем только нулевые.
    expect(within(quickGroup).getByRole('button', { name: /готово/ })).toBeTruthy();
    expect(container.querySelector('.sk-list__quick')).not.toBeNull();
  });

  it('включённый «Быстро» с нулём виден — иначе фильтр нечем снять (аудит 10.11)', () => {
    render(<ListView config={cfg} data={data} urlState={false} initial={{ quick: 'none' }} />);
    const quickGroup = screen.getByRole('group', { name: 'Быстро' });
    const btn = within(quickGroup).getByRole('button', { name: /несуществующий/ });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // Снять его можно: повторный щелчок убирает фильтр, чип исчезает.
    fireEvent.click(btn);
    expect(within(quickGroup).queryByRole('button', { name: /несуществующий/ })).toBeNull();
  });
});
