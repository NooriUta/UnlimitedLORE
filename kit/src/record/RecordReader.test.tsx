// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-04 · чтение записи целиком: текст, «‹ x из y ›»
// (листание соседей по списку, из которого открыли), свойства — в ушке справа.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordPager, RecordReader, pagerOf } from './index';
import { KitLangProvider } from '../i18n';
import { axeViolations } from '../test/axe';

beforeAll(() => registerGameIcons(gameIcons));

const REC: KitRecord = { id: 'S/T-2', kind: 'task', title: 'Вторая задача', status: 'todo', fields: {}, body_md: 'тело **задачи**' };

const CFG: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [{ code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: 'var(--st-todo)' }] },
};

const CTX: KitCtx = {
  config: CFG,
  data: { records: [REC], edges: [], journal: [], meta: { generated_at: 'x' } },
  href: id => `?passport=${encodeURIComponent(id)}`,
  esc: s => s,
  md: s => <div data-testid="md">{s}</div>,
};

describe('S5-04 · pagerOf — позиция записи в списке', () => {
  it('середина списка: оба соседа, позиция с единицы', () => {
    expect(pagerOf(['a', 'b', 'c'], 'b')).toEqual({ index: 1, pos: 2, total: 3, prev: 'a', next: 'c' });
  });
  it('края: у первой нет предыдущей, у последней — следующей (без закольцовки)', () => {
    expect(pagerOf(['a', 'b', 'c'], 'a')).toMatchObject({ pos: 1, prev: null, next: 'b' });
    expect(pagerOf(['a', 'b', 'c'], 'c')).toMatchObject({ pos: 3, prev: 'b', next: null });
  });
  it('записи нет в списке — index −1 и никаких соседей, а не «1 из N»', () => {
    expect(pagerOf(['a', 'b'], 'z')).toEqual({ index: -1, pos: 0, total: 2, prev: null, next: null });
  });
});

describe('S5-04 · RecordPager «‹ x из y ›»', () => {
  it('показывает «2 из 3» и листает соседей', () => {
    const onGo = vi.fn();
    render(<RecordPager ids={['a', 'b', 'c']} current="b" onGo={onGo} />);
    const nav = screen.getByRole('navigation', { name: 'Листать записи списка' });
    expect(within(nav).getByText('2 из 3')).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Предыдущая: a' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Следующая: c' }));
    expect(onGo.mock.calls).toEqual([['a'], ['c']]);
  });
  it('на краю кнопка выключена, а не прячется (раскладка не прыгает)', () => {
    render(<RecordPager ids={['a', 'b']} current="a" onGo={() => {}} />);
    expect((screen.getByRole('button', { name: 'Предыдущей нет' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Следующая: b' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('записи нет в списке — честное «нет в списке», а не «1 из N»', () => {
    render(<RecordPager ids={['a', 'b']} current="z" onGo={() => {}} />);
    expect(screen.getByText('нет в списке из 2')).toBeTruthy();
  });
  it('клавиши [ и ] листают — у каждой клавиши есть кнопка (aria-keyshortcuts)', () => {
    const onGo = vi.fn();
    render(<RecordPager ids={['a', 'b', 'c']} current="b" onGo={onGo} hotkeys />);
    expect(screen.getByRole('button', { name: 'Следующая: c' }).getAttribute('aria-keyshortcuts')).toBe(']');
    fireEvent.keyDown(document, { key: ']', code: 'BracketRight' });
    fireEvent.keyDown(document, { key: '[', code: 'BracketLeft' });
    expect(onGo.mock.calls).toEqual([['c'], ['a']]);
  });
  it('английская локаль', () => {
    render(<KitLangProvider lang="en"><RecordPager ids={['a', 'b', 'c']} current="b" onGo={() => {}} /></KitLangProvider>);
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next: c' })).toBeTruthy();
  });
});

describe('S5-04 · RecordReader — текст, листание, свойства в ушке', () => {
  function reader(open: boolean, onAside = vi.fn()) {
    return render(
      <RecordReader record={REC} ctx={CTX} tab="overview" onTab={() => {}}
        pager={<RecordPager ids={['S/T-1', 'S/T-2', 'S/T-3']} current="S/T-2" onGo={() => {}} />}
        aside={<p>исполнитель: agent-1</p>} asideOpen={open} onAside={onAside} />,
    );
  }

  it('текст записи на месте, листалка над ним', () => {
    reader(false);
    expect(screen.getByRole('heading', { level: 1, name: 'Вторая задача' })).toBeTruthy();
    expect(screen.getByTestId('md').textContent).toBe('тело **задачи**');
    expect(screen.getByText('2 из 3')).toBeTruthy();
  });

  it('свёрнуто: ушко «Свойства» с aria-expanded=false, содержимое не отрисовано', () => {
    const onAside = vi.fn();
    reader(false, onAside);
    // S4-28: «Свойства» — и ушко, и кнопка в строке над записью; управляют одной колонкой.
    const [bar, ear] = screen.getAllByRole('button', { name: 'Свойства' });
    expect(bar.getAttribute('aria-controls')).toBe(ear.getAttribute('aria-controls'));
    expect(bar.getAttribute('aria-expanded')).toBe(ear.getAttribute('aria-expanded'));
    expect(ear.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('исполнитель: agent-1')).toBeNull();
    fireEvent.click(ear);
    expect(onAside).toHaveBeenCalledWith(true);
  });

  it('раскрыто: колонка свойств связана с ушком (aria-controls) и подписана', () => {
    const onAside = vi.fn();
    reader(true, onAside);
    // S4-28: «Свойства» — и ушко, и кнопка в строке над записью; управляют одной колонкой.
    const [bar, ear] = screen.getAllByRole('button', { name: 'Свойства' });
    expect(bar.getAttribute('aria-controls')).toBe(ear.getAttribute('aria-controls'));
    expect(bar.getAttribute('aria-expanded')).toBe(ear.getAttribute('aria-expanded'));
    expect(ear.getAttribute('aria-expanded')).toBe('true');
    const aside = screen.getByRole('complementary', { name: 'Свойства' });
    expect(ear.getAttribute('aria-controls')).toBe(aside.id);
    expect(within(aside).getByText('исполнитель: agent-1')).toBeTruthy();
    fireEvent.click(ear);
    expect(onAside).toHaveBeenCalledWith(false);
  });

  it('без свойств — без ушка (пустое ушко обманывает)', () => {
    render(<RecordReader record={REC} ctx={CTX} tab="overview" onTab={() => {}} asideOpen={false} onAside={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Свойства' })).toBeNull();
  });

  it('axe: нарушений нет (раскрытое ушко)', async () => {
    const { container } = reader(true);
    expect(await axeViolations(container)).toEqual([]);
  });
});
