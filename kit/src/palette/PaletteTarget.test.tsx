// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14 — Ctrl+K над записью или выделением и
// поиск «/» через сервер (слайс search). Честные состояния: над чем действуем,
// «ищу на сервере», «сервер не ответил» — словами.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { KitCtx, KitRecord } from '../core/contract';
import { createSafeStorage } from '../resilience/safeStorage';
import { KitLangProvider } from '../i18n';
import { axeViolations } from '../test/axe';
import { CommandPalette, type CommandPaletteProps } from './Palette';
import { createRecentList, type PaletteAction, type PaletteRemoteSearch } from './paletteModel';
import { fixtureConfig, fixtureData } from './fixtures.test-helper';

function ctx(): KitCtx {
  return { data: fixtureData(), config: fixtureConfig(), href: id => `#rec=${id}`, esc: s => s, md: s => s };
}
const rec = (id: string): KitRecord => fixtureData().records.find(r => r.id === id)!;

function show(props: Partial<CommandPaletteProps> = {}, lang: 'ru' | 'en' = 'ru') {
  const onClose = vi.fn();
  const onOpenRecord = vi.fn();
  const recent = createRecentList(createSafeStorage(() => null));
  render(
    <KitLangProvider lang={lang}>
      <CommandPalette open mode="all" onClose={onClose} ctx={ctx()} recent={recent} onOpenRecord={onOpenRecord} {...props} />
    </KitLangProvider>,
  );
  return { onClose, onOpenRecord, recent };
}

describe('S4-14 · команды над записью', () => {
  it('цель видна в шапке, действия над ней — первой группой; Enter запускает с [id] и ctx', async () => {
    const run = vi.fn();
    const actions: PaletteAction[] = [
      { id: 'copy', title: 'Копировать код', scope: 'any', hotkey: 'Mod+Shift+C', run },
    ];
    const { onClose, recent } = show({ target: { type: 'record', record: rec('T-1') }, actions });
    expect(screen.getByTestId('kit-palette-target').textContent).toMatch(/T-1/);
    const group = screen.getByRole('group', { name: /Действия над T-1/ });
    expect(group.querySelector('[role="option"]')?.getAttribute('data-id')).toBe('action:copy');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', code: 'Enter' });
    await act(async () => {});
    expect(run).toHaveBeenCalledWith(['T-1'], expect.objectContaining({ href: expect.any(Function) }));
    expect(onClose).toHaveBeenCalled();
    // Действие зависит от цели — в «недавние» оно не пишется.
    expect(recent.list()).toEqual([]);
  });

  it('над выделением: «3 выбрано», действия получают все id выделения', async () => {
    const run = vi.fn();
    show({
      target: { type: 'selection', ids: ['T-1', 'T-2', 'ADR-1'] },
      actions: [
        { id: 'open', title: 'Открыть', scope: 'record', run: vi.fn() },
        { id: 'close-all', title: 'Закрыть выбранные', scope: 'selection', run },
      ],
    });
    expect(screen.getByTestId('kit-palette-target').textContent).toMatch(/3/);
    expect(screen.queryByRole('option', { name: /Открыть/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Закрыть выбранные/ }));
    await act(async () => {});
    expect(run).toHaveBeenCalledWith(['T-1', 'T-2', 'ADR-1'], expect.anything());
  });

  it('асинхронное действие: пока идёт — aria-busy; отказ — причина в role=alert, палитра открыта', async () => {
    let reject!: (e: Error) => void;
    const run = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const { onClose } = show({
      target: { type: 'record', record: rec('T-1') },
      actions: [{ id: 'close', title: 'Закрыть запись', scope: 'record', run }],
    });
    fireEvent.click(screen.getByRole('option', { name: /Закрыть запись/ }));
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true');
    await act(async () => { reject(new Error('409 конфликт версий')); });
    expect(screen.getByRole('alert').textContent).toMatch(/Закрыть запись.*409 конфликт версий/);
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('false');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('без цели действий нет и плашки цели нет', () => {
    show({ actions: [{ id: 'copy', title: 'Копировать код', scope: 'any', run: vi.fn() }] });
    expect(screen.queryByTestId('kit-palette-target')).toBeNull();
    expect(screen.queryByRole('option', { name: /Копировать код/ })).toBeNull();
  });

  it('en: цель и группа — из локали kit', () => {
    show({
      target: { type: 'selection', ids: ['T-1', 'T-2'] },
      actions: [{ id: 'copy', title: 'Copy codes', scope: 'any', run: vi.fn() }],
    }, 'en');
    expect(screen.getByTestId('kit-palette-target').textContent).toMatch(/2 selected/);
    expect(screen.getByRole('group', { name: /Actions on 2 selected/ })).toBeTruthy();
  });
});

describe('S4-14 · поиск через сервер', () => {
  const serverRec = (id: string, title: string, kind = 'adr'): KitRecord => ({ id, kind, title, status: '', fields: {} });

  it('серверная выдача — отдельной группой, без дублей с загруженным; Enter открывает серверную запись', async () => {
    const remote: PaletteRemoteSearch = vi.fn(async () => ({
      records: [serverRec('ADR-1', 'Решение о палитре'), serverRec('ADR-77', 'Решение с сервера')],
    }));
    const { onOpenRecord } = show({ mode: 'records', remote, remoteDelayMs: 0 });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'решение' } });
    const group = await screen.findByRole('group', { name: 'На сервере' });
    expect(remote).toHaveBeenCalledWith('решение', expect.any(AbortSignal));
    const ids = Array.from(group.querySelectorAll('[role="option"]')).map(o => o.getAttribute('data-id'));
    expect(ids).toEqual(['record:ADR-77']);
    fireEvent.click(screen.getByRole('option', { name: /Решение с сервера/ }));
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'ADR-77' }));
  });

  it('сервер не ответил — причина словами, загруженное остаётся', async () => {
    const remote: PaletteRemoteSearch = vi.fn(async () => { throw new Error('сервер LORE недоступен (502)'); });
    show({ mode: 'records', remote, remoteDelayMs: 0 });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'adr' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Поиск на сервере не ответил.*502/);
    expect(screen.getByRole('option', { name: /Решение о палитре/ })).toBeTruthy();
  });

  it('пока сервер ищет — «Ищу на сервере…»; ничего нигде — «ни среди загруженных, ни на сервере»', async () => {
    let resolve!: (v: { records: KitRecord[] }) => void;
    const remote: PaletteRemoteSearch = vi.fn(() => new Promise<{ records: KitRecord[] }>(r => { resolve = r; }));
    show({ mode: 'records', remote, remoteDelayMs: 0 });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzqqq' } });
    expect((await screen.findByTestId('kit-palette-remote')).textContent).toMatch(/Ищу на сервере/);
    await act(async () => { resolve({ records: [] }); });
    expect(screen.getByRole('status').textContent).toMatch(/zzzqqq.*ни среди загруженных, ни на сервере/);
  });

  it('сервер мог отдать не всё — палитра так и говорит', async () => {
    const remote: PaletteRemoteSearch = vi.fn(async () => ({ records: [serverRec('ADR-77', 'Решение с сервера')], partial: true }));
    show({ mode: 'records', remote, remoteDelayMs: 0 });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'реш' } });
    // Сначала строка говорит «Ищу…», после ответа — «мог отдать не всё».
    const line = await screen.findByText(/не всё/);
    expect(line.getAttribute('data-testid')).toBe('kit-palette-remote');
    expect(screen.getByRole('option', { name: /Решение с сервера/ })).toBeTruthy();
  });

  it('запрос короче 2 символов на сервер не уходит', async () => {
    const remote: PaletteRemoteSearch = vi.fn(async () => ({ records: [] }));
    show({ mode: 'records', remote, remoteDelayMs: 0 });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } });
    await act(async () => {});
    expect(remote).not.toHaveBeenCalled();
  });

  it('axe: без нарушений с целью и серверной выдачей', async () => {
    const remote: PaletteRemoteSearch = vi.fn(async () => ({ records: [serverRec('ADR-77', 'Решение с сервера')] }));
    show({
      remote, remoteDelayMs: 0,
      target: { type: 'record', record: rec('T-1') },
      actions: [{ id: 'copy', title: 'Копировать код', scope: 'any', run: vi.fn() }],
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'реш' } });
    await screen.findByRole('group', { name: 'На сервере' });
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });
});
