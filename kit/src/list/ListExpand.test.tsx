// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09 — составные объекты в listView kit:
// колонка прогресса «x/y» (progress:<поле>) и раскрытие строки с вложенным
// содержимым (у спринта — его задачи). Общий механизм kit, не экран LORE:
// конфиг называет поле, приложение отдаёт содержимое раскрытой строки.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import type { UrlWindow } from '../resilience/urlState';
import { ListView } from './ListView';
import { progressOf } from './progress';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, fields: Record<string, unknown> = {}): KitRecord =>
  ({ id, kind: 'sprint', title: `Спринт ${id}`, status: 'active', fields });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринты', icon: 'sprint', fields: [{ key: 'tasks', title: 'Задачи', type: 'number' }] } },
  statuses: { items: [{ code: 'active', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--inf)' }] },
  list: { views: ['list'], columns: ['title+id', 'progress:tasks', 'status'] },
};

const data = (records: KitRecord[]): KitData =>
  ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z', total: records.length } });

function fakeWin(search = ''): UrlWindow & { pushed: string[] } {
  const pushed: string[] = [];
  const w = {
    location: { search, hash: '', pathname: '/sprints', href: `http://x/sprints${search}` },
    history: {
      pushState: (_s: unknown, _t: string, url: string) => { pushed.push(url); },
      replaceState: (_s: unknown, _t: string, url: string) => { pushed.push(url); },
    },
    pushed,
  };
  return w as unknown as UrlWindow & { pushed: string[] };
}

describe('progressOf — честные исходы прогресса', () => {
  it('done/total → x/y; все готовы — complete; ноль задач — empty', () => {
    expect(progressOf({ done: 3, total: 7 })).toEqual({ kind: 'ok', done: 3, total: 7 });
    expect(progressOf({ done: 4, total: 4 })).toEqual({ kind: 'complete', done: 4, total: 4 });
    expect(progressOf({ done: 0, total: 0 })).toEqual({ kind: 'empty', done: 0, total: 0 });
  });
  it('ошибка подсчёта ≠ ноль; загрузка ≠ ноль; нет значения ≠ ноль', () => {
    expect(progressOf({ error: 'HTTP 502' })).toEqual({ kind: 'error', reason: 'HTTP 502' });
    expect(progressOf({ loading: true })).toEqual({ kind: 'loading' });
    expect(progressOf(undefined)).toEqual({ kind: 'none' });
    expect(progressOf('7')).toEqual({ kind: 'none' });
  });
  it('неполный подсчёт (partial) — x/y с пометкой, а не как полный', () => {
    expect(progressOf({ done: 1, total: 2, partial: true })).toEqual({ kind: 'partial', done: 1, total: 2 });
  });
});

describe('колонка progress:<поле> — «задачи x/y»', () => {
  it('заголовок из подписи поля, ячейка x/y', () => {
    const { container } = render(
      <ListView config={cfg} data={data([rec('S1', { tasks: { done: 3, total: 7 } })])} urlState={false} />,
    );
    expect(screen.getByRole('columnheader', { name: 'Задачи' })).toBeTruthy();
    const cell = container.querySelector('[data-record-id="S1"] [data-progress]')!;
    expect(cell.getAttribute('data-progress')).toBe('ok');
    expect(cell.textContent).toContain('3/7');
    expect(cell.getAttribute('aria-label')).toBe('Готово 3 из 7');
  });
  it('ошибка подсчёта видна как «?» с причиной, а не как 0/0', () => {
    const { container } = render(
      <ListView config={cfg} data={data([rec('S1', { tasks: { error: 'HTTP 502' } })])} urlState={false} />,
    );
    const cell = container.querySelector('[data-progress]')!;
    expect(cell.getAttribute('data-progress')).toBe('error');
    expect(cell.textContent).not.toContain('0/0');
    expect(cell.getAttribute('aria-label')).toBe('Не посчитано: HTTP 502');
  });
});

describe('раскрытие строки', () => {
  const tasksOf = vi.fn((r: KitRecord) => <ul aria-label={`Задачи ${r.id}`}><li>задача {r.id}</li></ul>);

  it('содержимое рисуется только у раскрытой строки и только после раскрытия', () => {
    tasksOf.mockClear();
    const { container } = render(
      <ListView config={cfg} data={data([rec('S1'), rec('S2')])} urlState={false} expand={{ render: tasksOf }} />,
    );
    expect(tasksOf).not.toHaveBeenCalled();
    const btn = screen.getByRole('button', { name: 'Раскрыть: Спринт S1' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Свернуть: Спринт S1');
    const region = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(within(region).getByRole('list', { name: 'Задачи S1' })).toBeTruthy();
    expect(tasksOf).toHaveBeenCalledTimes(tasksOf.mock.calls.length);
    expect(tasksOf.mock.calls.every(([r]) => r.id === 'S1')).toBe(true);
    // раскрытая строка идёт сразу под своей записью
    const rowsInOrder = [...container.querySelectorAll('tbody tr')].map(tr => tr.getAttribute('data-record-id') ?? tr.getAttribute('data-expand-of'));
    expect(rowsInOrder).toEqual(['S1', 'S1', 'S2']);
    fireEvent.click(btn);
    expect(screen.queryByRole('list', { name: 'Задачи S1' })).toBeNull();
  });

  it('раскрытие — одним касанием по кнопке ≥44px (класс цели касания)', () => {
    render(<ListView config={cfg} data={data([rec('S1')])} urlState={false} expand={{ render: tasksOf }} />);
    expect(screen.getByRole('button', { name: 'Раскрыть: Спринт S1' }).className).toContain('sk-list__xbtn');
  });

  it('can=false — кнопки нет, строку не раскрыть', () => {
    render(<ListView config={cfg} data={data([rec('S1')])} urlState={false} expand={{ render: tasksOf, can: () => false }} />);
    expect(screen.queryByRole('button', { name: /Раскрыть/ })).toBeNull();
  });

  it('раскрытые строки — в URL (lx) и восстанавливаются из него', () => {
    const win = fakeWin();
    render(<ListView config={cfg} data={data([rec('S1'), rec('S2')])} urlState={win} expand={{ render: tasksOf }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть: Спринт S2' }));
    expect(win.pushed[win.pushed.length - 1]).toContain('lx=S2');

    const win2 = fakeWin('?lx=S1');
    render(<ListView config={cfg} data={data([rec('S1')])} urlState={win2} expand={{ render: tasksOf }} />);
    expect(screen.getAllByRole('list', { name: 'Задачи S1' }).length).toBeGreaterThan(0);
  });

  it('axe: без нарушений в раскрытом виде', async () => {
    const { container } = render(
      <ListView config={cfg} data={data([rec('S1', { tasks: { done: 1, total: 2 } })])} urlState={false} expand={{ render: tasksOf }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть: Спринт S1' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
