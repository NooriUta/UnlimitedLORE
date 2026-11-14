// @vitest-environment jsdom
// Владелица 14.11.2026: «сделай в поиске кнопку перехода на паспорт объекта в полной развёртке —
// когда надо посмотреть один объект, а не искать его среди других». У найденной записи — кнопка
// «во весь экран» (и Shift+Enter): палитра отдаёт приложению запись с пометкой full.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createSafeStorage } from '../resilience/safeStorage';
import type { KitCtx } from '../core/contract';
import { CommandPalette } from './Palette';
import { createRecentList } from './paletteModel';
import { fixtureConfig, fixtureData } from './fixtures.test-helper';

const ctx: KitCtx = { data: fixtureData({}), config: fixtureConfig(() => {}), href: id => `#rec=${id}`, esc: s => s, md: s => s };
const show = () => {
  const onOpenRecord = vi.fn();
  render(<CommandPalette open mode="all" onClose={() => {}} ctx={ctx} recent={createRecentList(createSafeStorage(() => null))} onOpenRecord={onOpenRecord} />);
  act(() => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'релиза' } }); });
  return onOpenRecord;
};

describe('поиск: открыть найденное во весь экран', () => {
  it('у найденной записи есть кнопка «→» с подсказкой «во весь экран» — она отдаёт full', () => {
    const onOpenRecord = show();
    const opt = screen.getByRole('option', { name: /План релиза весны/ });
    fireEvent.click(within(opt).getByTitle(/во весь экран/));
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), { full: true });
  });
  it('обычный выбор — без full (прежнее поведение)', () => {
    const onOpenRecord = show();
    fireEvent.click(screen.getByRole('option', { name: /План релиза весны/ }));
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), { full: false });
  });
  it('Shift+Enter на выбранной записи — во весь экран', () => {
    const onOpenRecord = show();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', shiftKey: true });
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), { full: true });
  });
});
