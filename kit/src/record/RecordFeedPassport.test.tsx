// @vitest-environment jsdom
// Паспорт записи в ленте (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED).
//
// Прототип принят владельцем 25.11.2026: порядок зон — свойства → тело целиком →
// связи → история свёрткой, и история грузится ТОЛЬКО при раскрытии. Зоны —
// те же компоненты, что у паспорта (Fields, Overview, RecordLinks,
// RecordHistory), а не новая вёрстка: иначе лента и паспорт разошлись бы.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { RecordFeedPassport } from './RecordFeedPassport';

const record: KitRecord = {
  id: 'S4-18', kind: 'task', title: 'Лента паспортов', status: 'todo',
  fields: { owner: 'Ann', note_md: 'Первый абзац.\n\nВторой абзац.\n\nТретий.\n\nЧетвёртый — в ленте целиком.' },
};
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    task: {
      title: 'Задача', icon: 'scroll-quill',
      fields: [{ key: 'owner', title: 'Исполнитель', type: 'text' }],
      bodySections: [{ key: 'note_md', title: 'Заметка' }],
    },
  },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
};
const data = (edges: KitData['edges'] = []): KitData => ({
  records: [record, { id: 'ADR-LORE-051', kind: 'task', title: 'ADR', status: 'todo', fields: {} }],
  edges, journal: [], meta: { generated_at: '2026-11-25T00:00:00Z', total: 2 },
});
const ctx = (d: KitData = data()): KitCtx => ({
  config, data: d, role: 'reader', href: id => `#${id}`, esc: s => s,
  md: s => <div className="md">{s}</div>,
});
const zones = (c: HTMLElement) => [...c.querySelectorAll('[data-zone]')].map(e => e.getAttribute('data-zone'));

describe('BP-01 · зоны паспорта в ленте', () => {
  it('порядок: свойства → тело → связи → история', () => {
    const { container } = render(<RecordFeedPassport record={record} ctx={ctx()} history={{ onOpen: () => {} }} />);
    expect(zones(container)).toEqual(['props', 'body', 'links', 'history']);
  });

  it('тело — целиком, без обрезки «первые 3 абзаца»', () => {
    render(<RecordFeedPassport record={record} ctx={ctx()} />);
    expect(screen.getByText(/Четвёртый — в ленте целиком/)).toBeTruthy();
  });

  it('свойства — те же поля, что в паспорте', () => {
    render(<RecordFeedPassport record={record} ctx={ctx()} />);
    expect(screen.getByText('Исполнитель')).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
  });

  it('связи — из рёбер записи; нет рёбер — честное «связей нет», а не пустое место', () => {
    const { unmount } = render(<RecordFeedPassport record={record} ctx={ctx(data([{ from: 'S4-18', to: 'ADR-LORE-051', type: 'IMPLEMENTS' }]))} />);
    expect(screen.getAllByText('ADR').length).toBeGreaterThan(0);
    unmount();
    render(<RecordFeedPassport record={record} ctx={ctx()} />);
    expect(screen.getByText('Связей нет')).toBeTruthy();
  });

  it('у типа без истории зоны истории нет', () => {
    const { container } = render(<RecordFeedPassport record={record} ctx={ctx()} />);
    expect(zones(container)).not.toContain('history');
  });
});

describe('BP-01 · история свёрткой, грузится при раскрытии', () => {
  it('свёрнута и не запрошена, пока её не раскрыли', () => {
    const onOpen = vi.fn();
    const { container } = render(<RecordFeedPassport record={record} ctx={ctx()} history={{ onOpen }} />);
    const det = container.querySelector('[data-zone="history"] details') as HTMLDetailsElement;
    expect(det.open).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    det.open = true;
    fireEvent(det, new Event('toggle'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('раскрыта и не дошла — причина словами, а не пустая история', () => {
    const { container } = render(<RecordFeedPassport record={record} ctx={ctx()}
      history={{ onOpen: () => {}, source: { state: 'error', error: new Error('сеть упала') } }} />);
    const det = container.querySelector('[data-zone="history"] details') as HTMLDetailsElement;
    det.open = true;
    fireEvent(det, new Event('toggle'));
    expect(container.querySelector('[data-zone="history"]')?.textContent).toMatch(/сеть упала/);
  });
});
