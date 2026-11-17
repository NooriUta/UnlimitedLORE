// @vitest-environment jsdom
// K4-SUMMARY-QUEUE · очередь согласования. Решения владелицы 16.11.2026:
//  Q4 — «вернуть с правкой» пачкой: и общая причина, и своя у каждой записи;
//  Q5 — одна лента, вид дела — чип-фильтр;
//  Q6 — своя правка при selfApprove:false видна, «Согласовать» выключена с причиной; в пачке — в «не прошли».
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { KitCtx } from '../core/contract';
import { ApprovalQueue, queueItems } from './ApprovalQueue';

const ctx = (user = 'anna'): KitCtx => ({
  data: {
    records: [
      { id: 'Q-1', kind: 'quiz', title: 'Квиз о времени', status: 'review', fields: {} },
      { id: 'Q-2', kind: 'quiz', title: 'Квиз о снах', status: 'open', fields: {} },
      { id: 'Q-3', kind: 'quiz', title: 'Квиз о тропах', status: 'open', fields: {} },
    ],
    edges: [],
    journal: [
      { at: '2026-11-16T09:00:00Z', who: 'boris', record_id: 'Q-2', field: 'hint', from: 'старое', to: 'новое' },
      { at: '2026-11-16T10:00:00Z', who: 'anna', record_id: 'Q-3', field: 'title', from: 'Тропы', to: 'Квиз о тропах' },
      { at: '2026-11-15T10:00:00Z', who: 'boris', record_id: 'Q-3', field: 'level', from: 1, to: 2, approved_by: 'anna' },
    ],
    meta: { generated_at: '2026-11-16T12:00:00Z' },
  },
  config: {
    modules: [], menu: { groups: [] }, kinds: { quiz: { title: 'Квизы', icon: 'scroll-quill' } },
    statuses: { selfApprove: false, items: [{ code: 'open', title: 'Открыт', category: 'todo', icon: 'circle', color: 'inf' }, { code: 'review', title: 'На согласовании', category: 'active', icon: 'circle', color: 'wrn' }, { code: 'done', title: 'Готов', category: 'finished', icon: 'check', color: 'suc' }] },
  },
  user, href: id => `#${id}`, esc: s => s, md: s => <div>{s}</div>,
});

describe('queueItems — что ждёт решения', () => {
  it('записи в статусе согласования и несогласованные правки; согласованные — нет', () => {
    const items = queueItems(ctx(), { reviewStatuses: ['review'] });
    expect(items.map(i => `${i.type}:${i.recordId}`)).toEqual(['edit:Q-3', 'edit:Q-2', 'status:Q-1']);
  });
  it('Q6: своя правка при selfApprove:false помечена «своя», чужая — нет', () => {
    const items = queueItems(ctx('anna'), { reviewStatuses: ['review'] });
    expect(items.find(i => i.recordId === 'Q-3')?.self).toBe(true);
    expect(items.find(i => i.recordId === 'Q-2')?.self).toBe(false);
  });
});

describe('ApprovalQueue', () => {
  const ui = (over: Partial<Parameters<typeof ApprovalQueue>[0]> = {}) => render(
    <ApprovalQueue ctx={ctx()} reviewStatuses={['review']} onApprove={vi.fn(async () => ({ failed: [] }))} onReturn={vi.fn(async () => ({ failed: [] }))} {...over} />);

  it('Q5: одна лента, вид дела — чипами; «Правки» оставляют только правки', () => {
    ui();
    expect(screen.getAllByTestId('kit-queue-row')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /Правки/ }));
    expect(screen.getAllByTestId('kit-queue-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Мои правки/ }));
    expect(screen.getAllByTestId('kit-queue-row')).toHaveLength(1);
  });

  it('Q6: у своей правки «Согласовать» выключена, рядом причина', () => {
    ui();
    const mine = screen.getAllByTestId('kit-queue-row').find(r => r.textContent?.includes('Квиз о тропах'))!;
    const btn = within(mine).getByRole('button', { name: 'Согласовать' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(mine.textContent).toContain('Своё предложение не согласовать');
  });

  it('Q6: в пачке своя правка уходит в «не прошли», остальные — приложению', async () => {
    const onApprove = vi.fn(async () => ({ failed: [] }));
    ui({ onApprove });
    fireEvent.click(screen.getByRole('checkbox', { name: /Выбрать все/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Согласовать \(3\)/ })); });
    const sent = (onApprove.mock.calls[0] as unknown as [{ recordId: string }[]])[0].map(i => i.recordId).sort();
    expect(sent).toEqual(['Q-1', 'Q-2']);
    const res = screen.getByTestId('kit-queue-result');
    expect(res.textContent).toContain('Прошли: 2');
    expect(res.textContent).toContain('Не прошли: 1');
    expect(res.textContent).toContain('Квиз о тропах');
  });

  it('Q4: возврат пачкой — общая причина обязательна, своя у записи — по желанию', async () => {
    const onReturn = vi.fn(async () => ({ failed: [] }));
    ui({ onReturn });
    fireEvent.click(screen.getByRole('checkbox', { name: /Выбрать все/ }));
    fireEvent.click(screen.getByRole('button', { name: /Вернуть с правкой \(3\)/ }));
    const send = screen.getByRole('button', { name: 'Вернуть' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Общая причина'), { target: { value: 'Нет источника' } });
    const own = screen.getAllByLabelText(/Своя причина/);
    fireEvent.change(own[0], { target: { value: 'Опечатка в вопросе' } });
    expect(send.disabled).toBe(false);
    await act(async () => { fireEvent.click(send); });
    const [items, reasons] = onReturn.mock.calls[0] as unknown as [{ key: string }[], { common: string; per: Record<string, string> }];
    expect(items).toHaveLength(3);
    expect(reasons.common).toBe('Нет источника');
    expect(Object.values(reasons.per)).toEqual(['Опечатка в вопросе']);
  });

  it('очередь пуста — честный ноль, а не пустота', () => {
    render(<ApprovalQueue ctx={{ ...ctx(), data: { ...ctx().data, journal: [], records: [] } }} reviewStatuses={['review']} onApprove={vi.fn()} onReturn={vi.fn()} />);
    expect(screen.getByText(/Ничего не ждёт решения/)).toBeTruthy();
  });

  it('отказ приложения по записи — в «не прошли» с причиной', async () => {
    const onApprove = vi.fn(async (items: { key: string }[]) => ({ failed: [{ key: items[0].key, reason: 'конфликт версии' }] }));
    ui({ onApprove });
    const row = screen.getAllByTestId('kit-queue-row').find(r => r.textContent?.includes('Квиз о снах'))!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Согласовать' })); });
    expect(screen.getByTestId('kit-queue-result').textContent).toContain('конфликт версии');
  });
});
