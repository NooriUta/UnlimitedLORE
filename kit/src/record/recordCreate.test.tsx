// @vitest-environment jsdom
// Режим «создание» в паспорте (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24). Владелица 08.11:
// «форма „новая“ открывает ту же форму, что и кнопка „читать целиком“»; 11.11 —
// «да» на прототип s4-24-record-form. Запись `_new` — тот же RecordView, пустой
// и в правке: черновик, обязательные помечены, «Сохранить» неактивна с причиной
// словами; запись — через hooks.onCreate; отказ — словами, набранное остаётся.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../index';
import { RecordView, KIT_NEW_ID } from './RecordView';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import type { FieldEditorDef } from '../fields/fieldKinds';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec: KitRecord = { id: KIT_NEW_ID, kind: 'adr', title: '', status: '', fields: {} };
const ctx = (hooks: KitConfig['hooks']): KitCtx => ({
  config: { modules: [], menu: { groups: [] }, statuses: { items: [] }, kinds: { adr: { title: 'ADR', icon: 'adr' } }, hooks },
  data: { records: [], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
  role: 'editor', href: id => '#' + id, esc: s => s, md: s => s,
});
const fields: FieldEditorDef[] = [
  { key: 'id', label: 'Код', kind: 'text', required: 'block' },
  { key: 'title', label: 'Название', kind: 'text', required: 'block' },
  { key: 'status', label: 'Статус', kind: 'enum', options: ['draft', 'accepted'] },
];
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const view = (hooks: KitConfig['hooks'], extra: { onCreated?: (id: string) => void; onCancel?: () => void } = {}) => render(
  <RecordView record={rec} ctx={ctx(hooks)} tab="" onTab={() => {}}
    create={{ fields, onCreated: extra.onCreated ?? (() => {}), onCancel: extra.onCancel ?? (() => {}) }} />,
);

describe('паспорт: режим «создание»', () => {
  it('черновик, заголовок «Новая: ADR», поля пустые; «Сохранить» неактивна, почему — словами', () => {
    view({ onCreate: async () => ({ id: 'X' }) });
    expect(screen.getByText('Черновик')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Новая.*ADR/ })).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Не заполнено: Код, Название/);
  });

  it('заполнили обязательные — запись через hooks.onCreate, затем onCreated с кодом', async () => {
    const onCreate = vi.fn(async () => ({ id: 'ADR-9' }));
    const onCreated = vi.fn();
    view({ onCreate }, { onCreated });
    fireEvent.change(screen.getByLabelText(/^Код/), { target: { value: 'ADR-9' } });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'Решение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await settle();
    expect(onCreate).toHaveBeenCalledWith({ type: 'adr', values: { id: 'ADR-9', title: 'Решение' } });
    expect(onCreated).toHaveBeenCalledWith('ADR-9');
  });

  it('сервер отказал — причина словами, набранное осталось', async () => {
    view({ onCreate: async () => { throw new Error('ADR-9 уже есть'); } });
    fireEvent.change(screen.getByLabelText(/^Код/), { target: { value: 'ADR-9' } });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'Решение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('ADR-9 уже есть');
    expect((screen.getByLabelText(/^Код/) as HTMLInputElement).value).toBe('ADR-9');
  });

  it('пути записи нет (нет hooks.onCreate) — сказано словами, «Сохранить» неактивна', () => {
    view({});
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toMatch(/некуда сохранить/i);
  });

  it('«Отмена» зовёт onCancel', () => {
    const onCancel = vi.fn();
    view({ onCreate: async () => ({ id: 'X' }) }, { onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
