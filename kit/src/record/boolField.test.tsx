// @vitest-environment jsdom
// SPRINT_LORE_MODEL_AS_CONFIG/MC-08 — вид поля bool. Модель отдаёт флаги (sprint.no_release,
// product.is_active) видом bool; kit показывал их словом «true»/«false» и правил как текст.
// Правило: флаг читается «Да»/«Нет», незаданный — «—» (а не «Нет»: null ≠ false); правится
// тем же FieldEditor, видом boolean (три состояния); в сводке свёрнутых «Свойств» — название
// включённого флага, а не голое «true».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { RecordView, propsSummary } from './RecordView';
import { validateKitConfig } from '../core/validate';
import type { KitConfig, KitCtx, KitRecord, KindConfig } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const fields: NonNullable<KindConfig['fields']> = [
  { key: 'no_release', title: 'Не требует релиза', type: 'bool', editable: true },
  { key: 'is_active', title: 'Активен', type: 'bool' },
  { key: 'unknown_flag', title: 'Не задан', type: 'bool' },
];

function ctxWith(record: KitRecord, hooks: KitConfig['hooks'] = {}): KitCtx {
  return {
    config: {
      modules: [], menu: { groups: [] }, statuses: { items: [] },
      kinds: { sprint: { title: 'Спринт', icon: 'scroll-unfurled', fields } },
      hooks,
    },
    data: { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-13T00:00:00Z' } },
    role: 'editor', href: () => '#', esc: s => s, md: s => s,
  };
}

const rec = (f: Record<string, unknown>): KitRecord => ({ id: 'SP-1', kind: 'sprint', title: 'Спринт', status: 'active', fields: f });
const rowOf = (title: string) => screen.getByText(title, { selector: 'dt' }).parentElement as HTMLElement;

describe('MC-08 · вид поля bool', () => {
  it('валидатор kit знает вид bool', () => {
    const r = validateKitConfig(ctxWith(rec({})).config);
    expect(r.errors.filter(e => /fields\[\d\]\.type/.test(e.path))).toEqual([]);
  });

  it('флаг читается «Да»/«Нет», незаданный — «—», а не «true»/«false»', () => {
    render(<RecordView record={rec({ no_release: true, is_active: false, unknown_flag: null })} ctx={ctxWith(rec({}))} tab="overview" onTab={() => {}} propsOpen />);
    expect(within(rowOf('Не требует релиза')).getByText('Да')).toBeTruthy();
    expect(within(rowOf('Активен')).getByText('Нет')).toBeTruthy();
    expect(within(rowOf('Не задан')).queryByText('Нет')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\btrue\b|\bfalse\b/);
  });

  it('строковое «true» сервера читается так же, как true', () => {
    render(<RecordView record={rec({ no_release: 'true' })} ctx={ctxWith(rec({}))} tab="overview" onTab={() => {}} propsOpen />);
    expect(within(rowOf('Не требует релиза')).getByText('Да')).toBeTruthy();
  });

  it('правится флагом (FieldEditor boolean): «Нет» → «Сохранить» отправляет было/стало', async () => {
    const onSave = vi.fn(async () => {});
    const r = rec({ no_release: true });
    render(<RecordView record={r} ctx={ctxWith(r, { onSave })} tab="overview" onTab={() => {}} propsOpen />);
    fireEvent.click(screen.getByRole('button', { name: 'Править «Не требует релиза»' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Нет' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith({ type: 'sprint', id: 'SP-1', field: 'no_release', from: true, to: false });
  });

  it('в сводке свёрнутых «Свойств» — название включённого флага, выключенный не печатается', () => {
    const sum = propsSummary(rec({ no_release: true, is_active: false }), { title: 'Спринт', icon: 'x', fields }, 'ru');
    expect(sum).toMatch(/Не требует релиза/);
    expect(sum).not.toMatch(/Активен|true|false/);
  });

  it('«Редактировать всё»: флаг — выбор «Да / Нет / —», уходит булевым, а не словом', async () => {
    const onSave = vi.fn(async () => {});
    const r = rec({ no_release: true });
    render(<RecordView record={r} ctx={ctxWith(r, { onSave })} tab="overview" onTab={() => {}} placement="full" />);
    fireEvent.click(screen.getByRole('button', { name: /Редактировать/ }));
    const sel = screen.getByLabelText('Не требует релиза') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    expect(sel.value).toBe('true');
    fireEvent.change(sel, { target: { value: 'false' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith({ type: 'sprint', id: 'SP-1', field: 'no_release', from: true, to: false });
  });
});
