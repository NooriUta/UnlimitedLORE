// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-11 · вкладка «История» записи kit: кто правил
// (человек/агент), сравнить две версии, вернуть старую как новую версию через
// write-API приложения. Честные состояния: загрузка ≠ ошибка ≠ «не ведётся» ≠ пусто.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { KitLangProvider } from '../i18n';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordHistory, RecordView, type KitHistory, type KitHistoryVersion, type RecordHistorySource } from './index';
import { axeViolations } from '../test/axe';

beforeAll(() => registerGameIcons(gameIcons));

const REC: KitRecord = { id: 'S/T-1', kind: 'Task', title: 'Задача', status: 'IN_PROGRESS', fields: {} };

const ver = (over: Partial<KitHistoryVersion>): KitHistoryVersion => ({
  state_uid: null, valid_from: null, valid_to: null, is_open: false, status: null,
  fields: {}, changed: [], author: { kind: 'unknown' }, ...over,
});

const V3 = ver({ state_uid: 's3', valid_from: '2026-11-07T10:00:00Z', is_open: true, status: 'IN_PROGRESS',
  fields: { note_md: 'третья', effort_days: 2 }, changed: ['effort_days', 'note_md'],
  author: { kind: 'agent', id: 'claude-code', name: null, owner: 'u-1' } });
const V2 = ver({ state_uid: 's2', valid_from: '2026-11-06T10:00:00Z', valid_to: '2026-11-07T10:00:00Z', status: 'TODO',
  fields: { note_md: 'вторая', effort_days: 1 }, changed: ['effort_days', 'note_md'],
  author: { kind: 'human', id: 'u-1', name: 'Маша' } });
const V1 = ver({ state_uid: 's1', valid_from: '2026-11-05T10:00:00Z', valid_to: '2026-11-06T10:00:00Z', status: 'TODO',
  fields: { note_md: 'первая' }, changed: ['note_md'] });

const hist = (over: Partial<KitHistory> = {}): KitHistory => ({
  tracking: 'scd2', versions: [V3, V2, V1], anomalies: [], page: null, warnings: [], ...over,
});

const ok = (over: Partial<RecordHistorySource> = {}): RecordHistorySource => ({
  state: 'ok', data: hist(), restorable: ['note_md', 'effort_days'], ...over,
});

function show(source: RecordHistorySource, lang: 'ru' | 'en' = 'ru') {
  return render(<KitLangProvider lang={lang}><RecordHistory record={REC} source={source} /></KitLangProvider>);
}

describe('S5-11 · RecordHistory: честные состояния', () => {
  it('загрузка — role=status, не «пусто»', () => {
    show({ state: 'loading' });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('Правок нет')).toBeNull();
  });

  it('ошибка — alert с причиной и «Повторить»', () => {
    const retry = vi.fn();
    show({ state: 'error', error: new Error('HTTP 500'), onRetry: retry });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('История не загрузилась');
    expect(alert.textContent).toContain('HTTP 500');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('нет прав — свой текст, не ошибка и не пусто', () => {
    const { container } = show({ state: 'forbidden', error: 'вне ваших проектов' });
    expect(container.querySelector('[data-state="forbidden"]')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('«история не ведётся» (not_tracked) отличается от «правок нет»', () => {
    const { container, unmount } = show(ok({ data: hist({ tracking: 'not_tracked', versions: [] }) }));
    expect(container.textContent).toContain('История не ведётся');
    unmount();
    show(ok({ data: hist({ versions: [] }) }));
    expect(screen.getByText('Правок нет')).toBeTruthy();
  });
});

describe('S5-11 · RecordHistory: кто правил', () => {
  it('новейшая сверху; агент, человек и «автор неизвестен» помечены словами; текущая версия отмечена', () => {
    show(ok());
    const rows = screen.getAllByTestId('kit-history-row');
    expect(rows.map(r => r.getAttribute('data-author'))).toEqual(['agent', 'human', 'unknown']);
    expect(rows[0].textContent).toContain('бот');
    expect(rows[0].textContent).toContain('claude-code');
    expect(rows[0].textContent).toContain('текущая');
    expect(rows[1].textContent).toContain('человек');
    expect(rows[1].textContent).toContain('Маша');
    expect(rows[2].textContent).toContain('автор неизвестен');
  });

  it('у всех версий автора нет — честная пометка, что сервер его не записал', () => {
    show(ok({ data: hist({ versions: [ver({ ...V2, author: { kind: 'unknown' } }), V1] }) }));
    expect(screen.getByRole('note').textContent).toContain('Автор правок не записан');
  });

  it('предупреждения и аномалии сервера видны, а неполная выдача сказана числом', () => {
    show(ok({ data: hist({ warnings: ['legacy slice'], anomalies: ['multiple_open_versions'],
      page: { limit: 3, offset: 0, total: 9, has_more: true } }) }));
    const notes = screen.getAllByRole('note').map(n => n.textContent).join(' | ');
    expect(notes).toContain('legacy slice');
    expect(notes).toContain('multiple_open_versions');
    expect(notes).toContain('3 из 9');
  });
});

describe('S5-11 · RecordHistory: сравнить версии', () => {
  it('выбранная версия сравнивается с предыдущей; список «сравнить с» меняет пару', () => {
    show(ok());
    // по умолчанию выбрана текущая (s3) против s2
    let diff = screen.getByTestId('kit-history-diff');
    expect(within(diff).getAllByTestId('kit-history-diff-row').map(r => r.getAttribute('data-field'))).toEqual(['effort_days', 'note_md']);
    expect(diff.textContent).toContain('вторая');
    expect(diff.textContent).toContain('третья');

    fireEvent.change(screen.getByLabelText('Сравнить с'), { target: { value: 's1' } });
    diff = screen.getByTestId('kit-history-diff');
    expect(diff.textContent).toContain('первая');
    expect(diff.textContent).not.toContain('вторая');
  });

  it('клик по версии выбирает её (aria-pressed); у самой первой — сравнение с пустым', () => {
    show(ok());
    const pick = screen.getAllByRole('button', { name: /Выбрать версию/ });
    fireEvent.click(pick[2]);
    expect(pick[2].getAttribute('aria-pressed')).toBe('true');
    const diff = screen.getByTestId('kit-history-diff');
    expect(within(diff).getAllByTestId('kit-history-diff-row').map(r => r.getAttribute('data-change'))).toEqual(['added']);
  });

  it('одинаковые версии — «Различий нет», а не пустой блок', () => {
    show(ok({ data: hist({ versions: [V3, ver({ ...V2, fields: V3.fields })] }) }));
    expect(screen.getByTestId('kit-history-diff').textContent).toContain('Различий нет');
  });
});

describe('S5-11 · RecordHistory: вернуть как новую версию', () => {
  it('у текущей версии кнопки возврата нет', () => {
    show(ok({ onRestore: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Вернуть как новую версию' })).toBeNull();
  });

  it('два касания: «Вернуть как новую версию» → «Вернуть»; уходят только отличающиеся поля; успех сказан', async () => {
    const onRestore = vi.fn().mockResolvedValue(undefined);
    show(ok({ onRestore }));
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать версию/ })[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть как новую версию' }));
    expect(onRestore).not.toHaveBeenCalled();
    const confirm = screen.getByTestId('kit-history-confirm');
    expect(confirm.textContent).toContain('2');
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Вернуть' })); });
    expect(onRestore).toHaveBeenCalledTimes(1);
    const req = onRestore.mock.calls[0][0];
    expect(req.record_id).toBe('S/T-1');
    expect(req.version.state_uid).toBe('s1');
    expect(req.changes.map((c: { field: string }) => c.field)).toEqual(['effort_days', 'note_md']);
    expect(req.changes.find((c: { field: string }) => c.field === 'note_md')).toMatchObject({ from: 'третья', to: 'первая' });
    expect(screen.getByRole('status').textContent).toContain('новая версия');
  });

  it('«Отмена» ничего не пишет', () => {
    const onRestore = vi.fn();
    show(ok({ onRestore }));
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать версию/ })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть как новую версию' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.queryByTestId('kit-history-confirm')).toBeNull();
  });

  it('отказ сервера — alert с причиной, запись не считается вернувшейся', async () => {
    const onRestore = vi.fn().mockRejectedValue(new Error('CONFLICT: версия устарела'));
    show(ok({ onRestore }));
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать версию/ })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть как новую версию' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Вернуть' })); });
    expect(screen.getByRole('alert').textContent).toContain('CONFLICT');
    expect(screen.queryByText(/создана новая версия/)).toBeNull();
  });

  it('без write-API — кнопка выключена и сказано почему', () => {
    show(ok());
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать версию/ })[1]);
    const btn = screen.getByRole('button', { name: 'Вернуть как новую версию' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('kit-history-restore-why').textContent).toContain('только для чтения');
  });

  it('версия совпадает с текущей по возвращаемым полям — возвращать нечего', () => {
    show(ok({ onRestore: vi.fn(), data: hist({ versions: [V3, ver({ ...V2, fields: { ...V3.fields, other: 1 } })] }) }));
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать версию/ })[1]);
    expect((screen.getByRole('button', { name: 'Вернуть как новую версию' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('kit-history-restore-why').textContent).toContain('совпадает');
  });

  it('en-локаль: подписи на английском', () => {
    show(ok(), 'en');
    expect(screen.getAllByTestId('kit-history-row')[0].textContent).toContain('bot');
    expect(screen.getByLabelText('Compare with')).toBeTruthy();
  });

  it('axe: без нарушений', async () => {
    const { container } = show(ok({ onRestore: vi.fn() }));
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('S5-11 · RecordView: вкладка «История»', () => {
  const config: KitConfig = {
    modules: [], menu: { groups: [] }, kinds: { Task: { title: 'Задачи', icon: 'scroll-quill' } },
    statuses: { items: [] },
  };
  const ctx: KitCtx = {
    data: { records: [REC], edges: [], journal: [], meta: { generated_at: '2026-11-07T12:00:00Z' } },
    config, href: id => `#${id}`, esc: s => s, md: s => <div>{s}</div>,
  };

  it('без источника истории вкладки нет', () => {
    render(<RecordView record={REC} ctx={ctx} tab="overview" onTab={() => {}} />);
    expect(screen.queryByRole('tab', { name: /История/ })).toBeNull();
  });

  it('с источником — вкладка «История» с числом версий и панель истории', () => {
    const onTab = vi.fn();
    const { rerender } = render(<RecordView record={REC} ctx={ctx} tab="overview" onTab={onTab} history={ok()} />);
    const tab = screen.getByRole('tab', { name: /История/ });
    expect(tab.textContent).toContain('3');
    fireEvent.click(tab);
    expect(onTab).toHaveBeenCalledWith('history');
    rerender(<RecordView record={REC} ctx={ctx} tab="history" onTab={onTab} history={ok()} />);
    expect(screen.getAllByTestId('kit-history-row')).toHaveLength(3);
  });
});
