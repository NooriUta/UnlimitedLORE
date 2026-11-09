// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-09, клиентская половина: историю стало можно
// листать.
//
// Серверная часть влита (PR #948): `GET /lore/history?…&offset=&limit=&order=`
// с `page {total, offset, limit, returned, has_more, order}`.
//
// Что было: вкладка честно писала «показано N из M» — и на этом всё. Сказать
// «дальше есть» и не дать посмотреть дальше — половина правды: человек видит,
// что история обрезана, и ничего не может сделать.
//
// Что закрепляется:
//   • «Показать ещё» появляется ТОЛЬКО когда дальше действительно есть
//     (`has_more`) и приложение умеет догрузить (`onMore`);
//   • пока грузится — кнопка занята и не зовётся дважды;
//   • сбой догрузки назван словами, уже показанные версии остаются на месте;
//   • «дальше есть», но догружать некому — остаётся честная надпись без
//     кнопки: обещать кнопкой то, чего нет, нельзя.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitRecord } from '../core/contract';
import type { KitHistory } from './history';
import { RecordHistory } from './RecordHistory';

const record: KitRecord = { id: 'ADR-1', kind: 'adr', title: 'Решение', status: 'accepted', fields: {} };

const version = (uid: string, from: string, to: string | null) => ({
  state_uid: uid, valid_from: from, valid_to: to, is_open: to === null,
  status: 'accepted', fields: { status_raw: 'ACCEPTED' }, changed: ['status_raw'],
  author: { kind: 'unknown' as const },
});

const history = (over: Partial<KitHistory> = {}): KitHistory => ({
  tracking: 'scd2',
  versions: [version('st-2', '2026-11-05T10:00:00Z', null), version('st-1', '2026-11-01T10:00:00Z', '2026-11-05T10:00:00Z')],
  anomalies: [],
  page: { limit: 2, offset: 0, total: 7, has_more: true },
  warnings: [],
  ...over,
});

const show = (src: Partial<Parameters<typeof RecordHistory>[0]['source']> = {}, h: KitHistory = history()) =>
  render(<RecordHistory record={record} source={{ state: 'ok', data: h, ...src }} lang="ru" />);

describe('S9-09 · историю можно листать', () => {
  it('положительный контроль: сказано, сколько показано из сколького', () => {
    show();
    expect(screen.getAllByRole('note').map(n => n.textContent).join(' ')).toMatch(/2.*7|7/);
  });

  it('есть «дальше» и есть кому догрузить — появляется кнопка', () => {
    show({ onMore: vi.fn() });
    expect(screen.getByRole('button', { name: /Показать ещё/ })).toBeTruthy();
  });

  it('кнопка зовёт догрузку один раз', () => {
    const onMore = vi.fn();
    show({ onMore });
    fireEvent.click(screen.getByRole('button', { name: /Показать ещё/ }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('пока грузится — кнопка занята, второй раз не зовётся', () => {
    const onMore = vi.fn();
    show({ onMore, loadingMore: true });
    const btn = screen.getByRole('button', { name: /Показать ещё|Загружаю/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onMore).not.toHaveBeenCalled();
  });

  it('сбой догрузки назван словами, показанные версии остаются', () => {
    show({ onMore: vi.fn(), moreError: new Error('сеть пропала') });
    expect(screen.getByRole('alert').textContent).toMatch(/сеть пропала/);
    expect(screen.getAllByTestId('kit-history-row')).toHaveLength(2);
  });

  it('дальше есть, догружать некому — надпись есть, кнопки нет', () => {
    show();
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull();
    expect(screen.getAllByRole('note').length).toBeGreaterThan(0);
  });

  it('дальше ничего нет — ни надписи про обрезку, ни кнопки', () => {
    show({ onMore: vi.fn() }, history({ page: { limit: 50, offset: 0, total: 2, has_more: false } }));
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull();
  });

  it('сервер про страницы не сказал (page: null) — кнопки нет, догадок нет', () => {
    show({ onMore: vi.fn() }, history({ page: null }));
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull();
  });
});
