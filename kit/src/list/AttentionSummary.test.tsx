// @vitest-environment jsdom
// K4-SUMMARY-QUEUE · сводка «требует внимания». Решения владелицы 16.11.2026 (пилот согласен):
//  Q1 — группы сводки = быстрые фильтры списка (list.quick): один фильтр и для счётчика, и для списка;
//  Q2 — число даёт хук приложения hooks.count; хука нет — kit считает по загруженным, при обрезке пишет «≈»;
//  Q3 — сколько записей под группой — настройка summary.top: 5 на широком экране, 3 на телефоне.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitCtx, KitRecord } from '../core/contract';
import { AttentionSummary } from './AttentionSummary';

const recs: KitRecord[] = Array.from({ length: 7 }, (_, i) => ({
  id: `T-${i + 1}`, kind: 'task', title: `Задача ${i + 1}`, status: i < 6 ? 'blocked' : 'active', fields: { overdue: i < 2 ? 'yes' : 'no' },
}));
const ctx = (over: Partial<KitCtx['config']> = {}, truncated = false): KitCtx => ({
  data: { records: recs, edges: [], journal: [], meta: { generated_at: '2026-11-16T12:00:00Z', ...(truncated ? { truncated: true } : {}) } },
  config: {
    modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'scroll-quill' } }, statuses: { items: [] },
    list: { views: ['list'], quick: [
      { id: 'blocked', title: 'Заблокировано', filter: { status: 'blocked' } },
      { id: 'overdue', title: 'Просрочено', filter: { 'fields.overdue': 'yes' } },
    ] },
    ...over,
  },
  href: id => `#${id}`, esc: s => s, md: s => <div>{s}</div>,
});
const card = (title: string) => screen.getAllByTestId('kit-attn-group').find(g => g.textContent?.includes(title))!;

describe('AttentionSummary', () => {
  it('Q1: группы — быстрые фильтры списка, число — по тому же фильтру', () => {
    render(<AttentionSummary records={recs} ctx={ctx()} />);
    expect(screen.getAllByTestId('kit-attn-group')).toHaveLength(2);
    expect(within(card('Заблокировано')).getByTestId('kit-attn-count').textContent).toBe('6');
    expect(within(card('Просрочено')).getByTestId('kit-attn-count').textContent).toBe('2');
  });

  it('Q2: число от хука приложения главнее подсчёта по загруженным; без хука при обрезке — «≈»', () => {
    const { unmount } = render(<AttentionSummary records={recs} ctx={ctx({ hooks: { count: ({ quick }) => (quick === 'blocked' ? 40 : undefined) } })} />);
    expect(within(card('Заблокировано')).getByTestId('kit-attn-count').textContent).toBe('40');
    unmount();
    render(<AttentionSummary records={recs} ctx={ctx({}, true)} />);
    expect(within(card('Заблокировано')).getByTestId('kit-attn-count').textContent).toBe('≈6');
  });

  it('Q3: под группой первые N записей и «ещё M»; N — настройка, по умолчанию 5 на широком и 3 на узком', () => {
    const { unmount } = render(<AttentionSummary records={recs} ctx={ctx()} narrow={false} />);
    expect(within(card('Заблокировано')).getAllByRole('listitem')).toHaveLength(5);
    expect(card('Заблокировано').textContent).toContain('ещё 1');
    unmount();
    const { unmount: u2 } = render(<AttentionSummary records={recs} ctx={ctx()} narrow />);
    expect(within(card('Заблокировано')).getAllByRole('listitem')).toHaveLength(3);
    u2();
    render(<AttentionSummary records={recs} ctx={ctx()} top={2} />);
    expect(within(card('Заблокировано')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('группа ведёт в список с её быстрым фильтром — силами приложения, без перезагрузки', () => {
    const onNavigate = vi.fn();
    render(<AttentionSummary records={recs} ctx={ctx()} hrefOf={q => `#list?lq=${q}`} onNavigate={onNavigate} />);
    const link = within(card('Просрочено')).getByRole('link', { name: /Просрочено/ });
    expect(link.getAttribute('href')).toBe('#list?lq=overdue');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('overdue');
  });

  it('пустая группа — честный ноль; быстрых фильтров нет — так и сказано', () => {
    const { unmount } = render(<AttentionSummary records={recs.filter(r => r.status !== 'blocked')} ctx={ctx()} />);
    expect(within(card('Заблокировано')).getByTestId('kit-attn-count').textContent).toBe('0');
    unmount();
    render(<AttentionSummary records={recs} ctx={ctx({ list: { views: ['list'] } })} />);
    expect(screen.getByText(/Групп нет/)).toBeTruthy();
  });
});
