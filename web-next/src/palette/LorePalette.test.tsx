// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14 — палитра v2: «/» ищет через слайс search,
// Ctrl+K работает над записью или выделением (S4-10). Всё — из kit
// (CommandPalette, useKitPalette); web-next даёт только источник и действия.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider, createSafeStorage, type KitRecord } from '@seidr/kit';
import { LorePalette, type LorePaletteProps } from './LorePalette';
import { copyActions, searchKinds, toKitRecords } from './paletteSource';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const key = (init: Partial<KeyboardEventInit> & { code: string; key: string }) =>
  act(() => { fireEvent.keyDown(window, init); });

function show(props: Partial<LorePaletteProps> = {}, lang: 'ru' | 'en' = 'ru') {
  const onOpenRecord = vi.fn();
  render(
    <KitLangProvider lang={lang}>
      <LorePalette storage={createSafeStorage(() => null)} remoteDelayMs={0} onOpenRecord={onOpenRecord} {...props} />
    </KitLangProvider>,
  );
  return { onOpenRecord };
}

describe('S4-14 · модель палитры v2', () => {
  it('toKitRecords: строка слайса → запись контракта, заголовок без title — код', () => {
    expect(toKitRecords([{ type: 'sprint', ref_id: 'SPRINT_X', title: null }])).toEqual([
      { id: 'SPRINT_X', kind: 'sprint', title: 'SPRINT_X', status: '', fields: {} },
    ]);
  });

  it('searchKinds: каждый тип слайса search назван в обеих локалях', () => {
    const ru = searchKinds('ru');
    const en = searchKinds('en');
    for (const t of ['adr', 'sprint', 'task', 'spec', 'decision', 'quality_gate', 'runbook', 'doc', 'question', 'use_case', 'pain', 'gain', 'job', 'actor']) {
      expect(ru[t]?.title, t).toBeTruthy();
      expect(en[t]?.title, t).toBeTruthy();
      expect(ru[t].icon, t).toBeTruthy();
    }
    expect(ru.sprint.title).toBe('Спринт');
    expect(en.sprint.title).toBe('Sprint');
  });

  it('copyActions: «Копировать коды» над выделением пишет id построчно', async () => {
    const writeText = vi.fn(async () => {});
    const [codes] = copyActions('ru', id => `/x?rec=${id}`, { writeText });
    await codes.run(['T-1', 'T-2'], {} as never);
    expect(writeText).toHaveBeenCalledWith('T-1\nT-2');
  });

  it('copyActions: буфер обмена недоступен — отказ с причиной, а не молчание', async () => {
    const [codes] = copyActions('ru', id => id, null);
    await expect(Promise.resolve().then(() => codes.run(['T-1'], {} as never))).rejects.toThrow(/Буфер обмена недоступен/);
  });
});

describe('S4-14 · «/» — поиск через слайс search', () => {
  it('«/» (русская раскладка) открывает поиск; запрос уходит в слайс; выдача с типами', async () => {
    const fetchImpl = vi.fn(async () => json({ rows: [
      { type: 'adr', ref_id: 'ADR-LORE-038', title: 'Продукт над проектами' },
      { type: 'sprint', ref_id: 'SPRINT_UXR_S4', title: 'Оболочка и списки' },
    ] }));
    const { onOpenRecord } = show({ fetchImpl });
    key({ code: 'Slash', key: '.' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'продукт' } });
    const group = await screen.findByRole('group', { name: 'На сервере' });
    expect(String(fetchImpl.mock.calls[0]?.[0 as never])).toContain('/lore/slice/search?pattern=');
    expect(group.textContent).toMatch(/ADR-LORE-038/);
    expect(group.textContent).toMatch(/Спринт/);
    fireEvent.click(screen.getByRole('option', { name: /Оболочка и списки/ }));
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'SPRINT_UXR_S4', kind: 'sprint' }));
  });

  it('сервер ответил 403 — палитра называет причину', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'SCOPE_EMPTY' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    show({ fetchImpl });
    key({ code: 'Slash', key: '/' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'adr' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/403.*нет доступа/);
  });
});

describe('S4-14 · Ctrl+K над выделением', () => {
  it('выделение из списка — цель; «Копировать коды» отдаёт все id', async () => {
    const writeText = vi.fn(async () => {});
    show({ fetchImpl: vi.fn(), target: { type: 'selection', ids: ['T-1', 'T-2'] }, clipboard: { writeText } });
    key({ code: 'KeyK', key: 'л', ctrlKey: true });
    expect(screen.getByTestId('kit-palette-target').textContent).toMatch(/2/);
    fireEvent.click(screen.getByRole('option', { name: /Копировать коды/ }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith('T-1\nT-2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('над записью есть «Открыть»; без буфера обмена — честный отказ в палитре', async () => {
    const rec: KitRecord = { id: 'ADR-1', kind: 'adr', title: 'Палитра', status: 'active', fields: {} };
    show({ fetchImpl: vi.fn(), target: { type: 'record', record: rec }, clipboard: null });
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    expect(screen.getByRole('option', { name: /Открыть/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Копировать ссылки/ }));
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toMatch(/Буфер обмена недоступен/);
  });

  it('en: подписи действий из локали web-next', () => {
    show({ fetchImpl: vi.fn(), target: { type: 'selection', ids: ['T-1'] } }, 'en');
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    expect(screen.getByRole('option', { name: /Copy codes/ })).toBeTruthy();
  });
});

describe('S4-14 · кнопки для сенсора (у каждой клавиши есть кнопка)', () => {
  it('trigger: «Поиск» открывает «/», «Команды» — Ctrl+K; клавиши в aria-keyshortcuts', () => {
    show({ fetchImpl: vi.fn(), trigger: true });
    const search = screen.getByRole('button', { name: 'Поиск' });
    expect(search.getAttribute('aria-keyshortcuts')).toBe('/');
    fireEvent.click(search);
    expect(screen.getByRole('dialog').getAttribute('data-mode')).toBe('records');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape', code: 'Escape' });
    const cmds = screen.getByRole('button', { name: 'Команды' });
    expect(cmds.getAttribute('aria-keyshortcuts')).toBe('Control+K');
    fireEvent.click(cmds);
    expect(screen.getByRole('dialog').getAttribute('data-mode')).toBe('all');
  });
});
