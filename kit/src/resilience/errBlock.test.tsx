// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-06: errBlock ≠ «пусто (проверено)».
// Три разных ответа блока, и ни один не выдаёт себя за другой:
//   error      — блок не смогли проверить (meta.errors[{block, reason}]) или
//                его render упал — рисуется ТОЛЬКО на месте этого блока;
//   unverified — 0 записей, но выдача обрезана / метаданных нет — проверенным
//                нулём это назвать нельзя;
//   empty      — запрос выполнен, записей нет: «Пусто (проверено)».
// errBlock переиспользуют K-10/K-13.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { blockOutcome, ErrBlock, ErrBlockBoundary, KitBlock, KitSlot } from './errBlock';
import type { KitCtx, KitMeta, KitRecord } from '../core/contract';
import { KitLangProvider } from '../i18n';

const meta = (over: Partial<KitMeta> = {}): KitMeta => ({ generated_at: '2026-11-07T00:00:00Z', ...over });

describe('blockOutcome: чем блок ответил', () => {
  it('блок в meta.errors — error с причиной, даже если записи есть', () => {
    const m = meta({ errors: [{ block: 'journal', reason: 'HTTP 503' }] });
    expect(blockOutcome(m, 'journal', 0)).toEqual({ kind: 'error', reason: 'HTTP 503' });
    expect(blockOutcome(m, 'journal', 3)).toEqual({ kind: 'error', reason: 'HTTP 503' });
  });

  it('ошибка чужого блока этот блок не трогает', () => {
    const m = meta({ errors: [{ block: 'journal', reason: 'HTTP 503' }] });
    expect(blockOutcome(m, 'edges', 0)).toEqual({ kind: 'empty' });
  });

  it('«*» в errors — не проверен ни один блок', () => {
    expect(blockOutcome(meta({ errors: [{ block: '*', reason: 'offline' }] }), 'edges', 0).kind).toBe('error');
  });

  it('0 записей при truncated или без meta — unverified, а не «пусто»', () => {
    expect(blockOutcome(meta({ truncated: true }), 'records', 0)).toEqual({ kind: 'unverified' });
    expect(blockOutcome(undefined, 'records', 0)).toEqual({ kind: 'unverified' });
  });

  it('0 записей при полной выдаче — проверенный ноль; есть записи — ok', () => {
    expect(blockOutcome(meta(), 'records', 0)).toEqual({ kind: 'empty' });
    expect(blockOutcome(meta(), 'records', 2)).toEqual({ kind: 'ok' });
  });
});

describe('ErrBlock: «не смогли проверить» ≠ «пусто»', () => {
  it('role=alert, data-state=error, data-block, причина и «это не пусто»', () => {
    render(<ErrBlock block="journal" reason="HTTP 503" />);
    const el = screen.getByRole('alert');
    expect(el.getAttribute('data-state')).toBe('error');
    expect(el.closest('[data-block]')?.getAttribute('data-block')).toBe('journal');
    expect(el.textContent).toContain('HTTP 503');
    expect(el.textContent).toContain('не смогли проверить');
    expect(el.textContent).not.toContain('Пусто (проверено)');
  });

  it('английская локаль; кнопка «Повторить» только при onRetry', () => {
    const onRetry = vi.fn();
    const { unmount } = render(<KitLangProvider lang="en"><ErrBlock block="edges" reason="timeout" onRetry={onRetry} /></KitLangProvider>);
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t check');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
    unmount();
    render(<ErrBlock block="edges" reason="timeout" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('KitBlock: выбор состояния блока', () => {
  it('error из meta — ErrBlock, детей не рисует', () => {
    render(
      <KitBlock block="journal" meta={meta({ errors: [{ block: 'journal', reason: 'HTTP 503' }] })} count={0}>
        <p>журнал</p>
      </KitBlock>,
    );
    expect(screen.getByRole('alert').textContent).toContain('HTTP 503');
    expect(screen.queryByText('журнал')).toBeNull();
  });

  it('проверенный ноль — «Пусто (проверено)», без role=alert', () => {
    const { container } = render(<KitBlock block="edges" meta={meta()} count={0}><p>связи</p></KitBlock>);
    expect(container.textContent).toContain('Пусто (проверено)');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('0 при обрезанной выдаче — свой текст, не «пусто» и не ошибка', () => {
    const { container } = render(<KitBlock block="records" meta={meta({ truncated: true })} count={0}><p>x</p></KitBlock>);
    expect(container.querySelector('[data-state="unverified"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Пусто (проверено)');
  });

  it('ok — дети в своей границе ошибок', () => {
    render(<KitBlock block="records" meta={meta()} count={1}><p>запись</p></KitBlock>);
    expect(screen.getByText('запись')).toBeTruthy();
  });
});

describe('хук ошибки рендера: падает только свой блок', () => {
  const rec: KitRecord = { id: 'K-06', kind: 'task', title: 'Устойчивость', status: 'todo', fields: {} };
  const ctx = {} as KitCtx;

  it('исключение в overview — errBlock на его месте, соседний блок жив', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = () => { throw new Error('overview упал'); };
    const { container } = render(
      <div>
        <ErrBlockBoundary block="overview"><KitSlot render={boom} record={rec} ctx={ctx} /></ErrBlockBoundary>
        <ErrBlockBoundary block="tab:links"><KitSlot render={(r) => `связи ${r.id}`} record={rec} ctx={ctx} /></ErrBlockBoundary>
      </div>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('overview упал');
    expect(alert.closest('[data-block]')?.getAttribute('data-block')).toBe('overview');
    expect(container.textContent).toContain('связи K-06');
    vi.restoreAllMocks();
  });

  it('смена resetKey (другая запись) снимает ошибку блока', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const r = (x: KitRecord) => { if (fail) throw new Error('сбой'); return x.title; };
    const { rerender, container } = render(
      <ErrBlockBoundary block="overview" resetKey="A"><KitSlot render={r} record={rec} ctx={ctx} /></ErrBlockBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fail = false;
    rerender(<ErrBlockBoundary block="overview" resetKey="B"><KitSlot render={r} record={rec} ctx={ctx} /></ErrBlockBoundary>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent).toContain('Устойчивость');
    vi.restoreAllMocks();
  });
});
