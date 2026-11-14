// @vitest-environment jsdom
// Владелица 14.11.2026 (скрин вложенной таблицы):
//   • «щелчок на колонке — переключение сортировки по этой колонке»;
//   • «если статус у задач просто иконка, может везде иконка (без подписи названия статуса —
//     его везде во всплывающие подсказки)».
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { ListView, registerGameIcons } from '../index';
import type { KitConfig, KitData, KitRecord } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'sprint', fields: [{ key: 'effort', title: 'Оценка', type: 'number' }] } },
  statuses: { items: [
    { code: 'done', title: 'Готово', color: 'var(--suc)', icon: 'check-mark', category: 'finished' },
    { code: 'active', title: 'В работе', color: 'var(--inf)', icon: 'gears', category: 'in_progress' },
  ] },
  list: { views: ['list'], columns: ['status', 'id', 'title', 'effort'] },
};
const rec = (id: string, title: string, status: string, effort: number): KitRecord =>
  ({ id, kind: 'task', title, status, fields: { effort } });
const data: KitData = {
  records: [rec('T1', 'Бета', 'active', 3), rec('T2', 'Альфа', 'done', 1), rec('T3', 'Гамма', 'active', 2)],
  edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z', total: 3 },
};
const order = () => screen.getAllByRole('row').slice(1).map(r => r.getAttribute('data-record-id')).filter(Boolean);

describe('щелчок по заголовку — сортировка по колонке', () => {
  it('по возрастанию → по убыванию → без сортировки; aria-sort говорит, что сейчас', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    const th = screen.getByRole('columnheader', { name: /Оценка/ });
    const btn = th;
    fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(order()).toEqual(['T2', 'T3', 'T1']);
    fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(order()).toEqual(['T1', 'T3', 'T2']);
    fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBeNull();
  });

  // Приёмка препрода 0dccfe73 (AP-04): после «снять» список шёл «как пришло» (по коду), хотя до
  // сортировки экран стоял на своём умолчании «Изменено ↓». Снять — значит вернуть умолчание экрана.
  it('«снять» возвращает сортировку экрана по умолчанию, а не «как пришло»', () => {
    render(<ListView config={config} data={data} urlState={false} initial={{ sort: { key: 'title', dir: 'asc' } }} />);
    expect(order()).toEqual(['T2', 'T1', 'T3']);
    const th = screen.getByRole('columnheader', { name: /Оценка/ });
    fireEvent.click(th);
    fireEvent.click(th);
    fireEvent.click(th);
    expect(th.getAttribute('aria-sort')).toBeNull();
    expect(order()).toEqual(['T2', 'T1', 'T3']);
  });

  it('умолчание на этой же колонке: третий щелчок снимает сортировку совсем, а не зацикливается', () => {
    render(<ListView config={config} data={data} urlState={false} initial={{ sort: { key: 'effort', dir: 'asc' } }} />);
    const th = screen.getByRole('columnheader', { name: /Оценка/ });
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(th);
    expect(th.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(th);
    expect(th.getAttribute('aria-sort')).toBeNull();
  });
});

describe('статус в ячейке списка — иконка, название в подсказке', () => {
  it('текста статуса в ячейке нет; title и подпись для скринридера — название', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    const cell = document.querySelector('tr[data-record-id="T2"] [data-status="done"]') as HTMLElement;
    expect(cell).not.toBeNull();
    expect(cell.getAttribute('title')).toBe('Готово');
    expect(cell.getAttribute('aria-label')).toBe('Готово');
    expect(cell.textContent?.trim()).toBe('');
  });
});

describe('код строки — ссылка на паспорт', () => {
  it('у строки с href код ведёт туда же, куда название', () => {
    render(<ListView config={config} data={data} urlState={false} href={id => '/?open=' + id} />);
    const row = document.querySelector('tr[data-record-id="T1"]') as HTMLElement;
    const links = [...row.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(links.filter(h => h === '/?open=T1').length).toBe(2);
  });
});
