// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-03 — listView kit (только чтение): Список/Доска,
// «Быстро»-счётчики как фильтр, строка «фильтр / группировка / порядок»,
// «Показано N из M» из meta, бюджет строк S9, выделение и массовые действия
// через хук. Оба пилот-конфига (LORE и «Дата-странники») — без правки kit.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { hasGameIcon, registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { datawanderersConfig } from '../../demo/datawanderers.config';
import { loreConfig } from '../../demo/lore.config';
import { datawanderersData, loreData } from '../../demo/fixtures';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string, fields: Record<string, unknown> = {}): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: {
    views: ['list', 'board'],
    quick: [{ id: 'done', title: 'готово', filter: { status: 'done' } }],
    filters: ['status'],
    groupings: ['status'],
    columns: ['select', 'title+id', 'status', 'verdict'],
  },
};

const data = (records: KitRecord[], meta: Partial<KitData['meta']> = {}): KitData =>
  ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z', ...meta } });

const rows = (c: HTMLElement) => c.querySelectorAll('[data-record-id]');

describe('иконки пилот-конфигов есть в наборе game-icons', () => {
  it('модули, виды и статусы обоих конфигов', () => {
    for (const c of [loreConfig, datawanderersConfig]) {
      const slugs = [
        ...c.modules.map(m => m.icon),
        ...Object.values(c.kinds).map(k => k.icon),
        ...c.statuses.items.map(s => s.icon),
      ];
      for (const s of slugs) expect(hasGameIcon(s), s).toBe(true);
    }
  });
});

describe('«Показано N из M» — честно из meta', () => {
  it('полная выдача: «Показано 3 из 3»', () => {
    render(<ListView config={cfg} data={data([rec('1', 'todo'), rec('2', 'done'), rec('3', 'done')], { total: 3, truncated: false })} urlState={false} />);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 3 из 3');
  });

  it('обрезано сервером: M — серверный итог, плюс сколько загружено и что фильтр по загруженному', () => {
    render(<ListView config={datawanderersConfig} data={datawanderersData()} urlState={false} />);
    const line = screen.getByTestId('kit-list-shown');
    expect(line.textContent).toContain('Показано 181 из 240');
    expect(line.textContent).toContain('загружено 181');
    expect(line.getAttribute('data-kind')).toBe('truncated');
  });

  it('обрезано без итога — «из M» не выдумывается', () => {
    render(<ListView config={cfg} data={data([rec('1', 'todo')], { truncated: true })} urlState={false} />);
    const line = screen.getByTestId('kit-list-shown');
    expect(line.textContent).not.toMatch(/из \d/);
    expect(line.textContent).toContain('всего неизвестно');
  });
});

describe('бюджет строк S9 — не больше 50 на группу, «ещё N»', () => {
  it('120 записей в группе → 50 строк и кнопка «ещё 70»; клик добавляет ещё 50', () => {
    const rs = Array.from({ length: 120 }, (_, i) => rec(String(i), 'done'));
    const { container } = render(<ListView config={cfg} data={data(rs)} urlState={false} />);
    expect(rows(container)).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'ещё 70' }));
    expect(rows(container)).toHaveLength(100);
    expect(screen.getByRole('button', { name: 'ещё 20' })).toBeTruthy();
  });

  it('LORE: группировка по спринту (24 группы) → 10 групп + «Прочие», все свёрнуты', () => {
    const { container } = render(
      <ListView config={loreConfig} data={loreData()} urlState={false} initial={{ group: 'fields.sprint' }} />,
    );
    const heads = container.querySelectorAll('[data-group-key]');
    expect(heads).toHaveLength(11);
    expect(heads[10].getAttribute('data-other')).toBe('true');
    expect(within(heads[10] as HTMLElement).getByRole('button').textContent).toContain('Прочие');
    expect(rows(container)).toHaveLength(0);
    // развернуть одну — строки появляются, но в пределах бюджета
    fireEvent.click(within(heads[0] as HTMLElement).getByRole('button'));
    expect(rows(container).length).toBeGreaterThan(0);
    expect(rows(container).length).toBeLessThanOrEqual(50);
  });
});

describe('«Быстро»-счётчики — кнопки-фильтры', () => {
  it('счётчик по выдаче; клик включает фильтр (aria-pressed), повторный — снимает', () => {
    const rs = [rec('1', 'todo'), rec('2', 'done'), rec('3', 'done')];
    const { container } = render(<ListView config={cfg} data={data(rs, { total: 3 })} urlState={false} />);
    const btn = screen.getByRole('button', { name: /готово/ });
    expect(btn.textContent).toContain('2');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(rows(container)).toHaveLength(2);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 2 из 3');
    fireEvent.click(btn);
    expect(rows(container)).toHaveLength(3);
  });
});

describe('строка «фильтр / группировка / порядок»', () => {
  it('описывает активные фильтры словами словаря; «Сбросить» снимает всё', () => {
    const rs = [rec('1', 'todo'), rec('2', 'done')];
    const { container } = render(<ListView config={cfg} data={data(rs)} urlState={false} />);
    // S4-05: фильтр поля — фасет (условие + значения со счётчиком), а не голый select
    fireEvent.click(screen.getByRole('button', { name: /^Статус/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^готово/ }));
    const desc = screen.getByTestId('kit-list-desc');
    expect(desc.textContent).toContain('Статус: готово');
    expect(rows(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр' }));
    expect(rows(container)).toHaveLength(2);
    // S4-21: нечего снимать — эха нет вовсе (раньше висело «все записи»), «Показано» на месте.
    expect(screen.queryByTestId('kit-list-desc')).toBeNull();
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 2 из 2');
  });

  it('порядок меняется селектом и направлением', () => {
    const rs = [rec('b', 'todo'), rec('a', 'todo'), rec('c', 'todo')];
    const { container } = render(<ListView config={cfg} data={data(rs)} urlState={false} initial={{ group: null }} />);
    fireEvent.change(screen.getByLabelText('Порядок'), { target: { value: 'title' } });
    expect([...rows(container)].map(r => r.getAttribute('data-record-id'))).toEqual(['a', 'b', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'по убыванию' }));
    expect([...rows(container)].map(r => r.getAttribute('data-record-id'))).toEqual(['c', 'b', 'a']);
  });
});

describe('Список / Доска', () => {
  it('доска — колонки статусов словаря с числом карточек', () => {
    const rs = [rec('1', 'todo'), rec('2', 'done'), rec('3', 'done')];
    render(<ListView config={cfg} data={data(rs)} urlState={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Доска' }));
    const cols = screen.getAllByRole('region');
    expect(cols.map(c => c.getAttribute('aria-label'))).toEqual(['к работе: 1', 'готово: 2']);
  });

  it('состояние вида пишется в URL (фолбэк — в «#»)', () => {
    const win = {
      location: { pathname: '/kit', search: '', hash: '' },
      history: { pushState: vi.fn(() => { throw new Error('sandbox'); }), replaceState: vi.fn(() => { throw new Error('sandbox'); }) },
    };
    render(<ListView config={cfg} data={data([rec('1', 'todo')])} urlState={win} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Доска' }));
    expect(win.location.hash).toContain('lv=board');
  });
});

describe('выделение и массовые действия (через хук)', () => {
  it('галочки → «Выбрано: 2», действие получает id; «Выбрать все» берёт все показанные', () => {
    const run = vi.fn();
    const rs = [rec('1', 'todo'), rec('2', 'done'), rec('3', 'done')];
    render(<ListView config={cfg} data={data(rs)} urlState={false} bulkActions={[{ id: 'x', title: 'Экспорт', run }]} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: Запись 2' }));
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 2');
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(run).toHaveBeenCalledWith(['1', '2']);
    fireEvent.click(screen.getByRole('checkbox', { name: /Выбрать все показанные/ }));
    expect(screen.getByTestId('kit-list-selbar').textContent).toContain('Выбрано: 3');
  });
});

describe('честные состояния', () => {
  it('проверенный ноль — EmptyState, а не пустая таблица', () => {
    const { container } = render(<ListView config={cfg} data={data([], { total: 0, truncated: false })} urlState={false} />);
    expect(container.querySelector('[data-state="empty"]')).toBeTruthy();
  });

  it('фильтр отсеял всё — своё сообщение и «Сбросить фильтр»', () => {
    render(<ListView config={cfg} data={data([rec('1', 'todo')])} urlState={false} initial={{ filters: { status: ['done'] } }} />);
    expect(screen.getByText('Под фильтр ничего не подошло')).toBeTruthy();
  });

  it('ошибка блока списка из meta.errors — errBlock с причиной', () => {
    const { container } = render(<ListView config={cfg} data={data([rec('1', 'todo')], { errors: [{ block: 'records', reason: 'timeout 30s' }] })} urlState={false} />);
    const err = container.querySelector('[data-state="error"]');
    expect(err?.textContent).toContain('timeout 30s');
    expect(rows(container)).toHaveLength(1);
  });

  it('вердикт бросил исключение — ошибка только в своей ячейке, список живёт', () => {
    const bad: KitConfig = { ...cfg, verdict: r => { if (r.id === '2') throw new Error('boom'); return { score: 1, max: 1, failed: [], hints: [] }; } };
    const { container } = render(<ListView config={bad} data={data([rec('1', 'todo'), rec('2', 'todo')])} urlState={false} />);
    expect(rows(container)).toHaveLength(2);
    expect(container.querySelectorAll('[data-verdict="error"]')).toHaveLength(1);
    expect(container.querySelector('[data-record-id="1"] [data-verdict="ok"]')?.textContent).toBe('1/1');
  });
});

describe('оба пилот-конфига без правки kit + axe', () => {
  it('«Дата-странники»: список и доска, вердикт из сервера', async () => {
    const { container } = render(<ListView config={datawanderersConfig} data={datawanderersData()} urlState={false} />);
    expect(rows(container).length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-verdict="fail"]').length).toBeGreaterThan(0);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: 'Доска' }));
    expect(screen.getAllByRole('region').map(c => c.getAttribute('aria-label')?.split(':')[0]))
      .toEqual(['не смотрели', 'нужна правка', 'согласовано']);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('LORE: полная выдача, «Показано 260 из 260»', async () => {
    const { container } = render(<ListView config={loreConfig} data={loreData()} urlState={false} />);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 260 из 260');
    expect(await axeViolations(container)).toEqual([]);
  });
});
