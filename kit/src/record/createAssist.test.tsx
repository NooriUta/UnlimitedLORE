// @vitest-environment jsdom
// SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT (решения владельца 25.11.2026):
//   2б — код записи предлагается из названия, его можно поправить; свободен ли код — проверяется ДО записи;
//   1б — «+ боль» во вкладке связей паспорта: новая запись, связь ставит приложение.
// Kit не знает правил кода и типов: подсказку (suggest), проверку (check) и «+ …» (hooks.createLinked)
// даёт приложение; kit рисует и держит правило «не смогли проверить ≠ свободно».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../index';
import { RecordView, KIT_NEW_ID } from './RecordView';
import { RecordRelations } from './RecordRelations';
import type { KitConfig, KitCtx, KitRecord, KitRelationDef } from '../core/contract';
import type { FieldEditorDef } from '../fields/fieldKinds';
import type { RecordCreateSpec } from './RecordCreate';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec: KitRecord = { id: KIT_NEW_ID, kind: 'pain', title: '', status: '', fields: {} };
const ctx = (hooks: KitConfig['hooks'], role = 'editor'): KitCtx => ({
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] }, kinds: { pain: { title: 'Боль', icon: 'pain' } }, hooks,
    roles: { editor: { canEdit: true }, reader: { canEdit: false } } as unknown as KitConfig['roles'],
  },
  data: { records: [], edges: [], journal: [], meta: { generated_at: '2026-11-25T00:00:00Z' } },
  role, href: id => '#' + id, esc: s => s, md: s => s,
});
const fields: FieldEditorDef[] = [
  { key: 'title', label: 'Название', kind: 'text', required: 'block' },
  { key: 'id', label: 'Код', kind: 'text', required: 'block' },
];
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const view = (extra: Partial<RecordCreateSpec>, onCreate = vi.fn(async () => ({ id: 'PAIN-X' }))) => {
  render(
    <RecordView record={rec} ctx={ctx({ onCreate })} tab="" onTab={() => {}}
      create={{ fields, onCreated: () => {}, onCancel: () => {}, ...extra }} />,
  );
  return onCreate;
};
const code = () => screen.getByLabelText(/^Код/) as HTMLInputElement;

describe('создание: код из названия (2б)', () => {
  it('набрали название — код подставлен из подсказки приложения', () => {
    view({ suggest: v => ({ id: v.title ? `PAIN-${String(v.title).toUpperCase()}` : '' }) });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'токен' } });
    expect(code().value).toBe('PAIN-ТОКЕН');
  });

  it('код поправили руками — подсказка его больше не перезаписывает', () => {
    view({ suggest: v => ({ id: `PAIN-${String(v.title ?? '')}` }) });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'a' } });
    fireEvent.change(code(), { target: { value: 'PAIN-MINE' } });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'ab' } });
    expect(code().value).toBe('PAIN-MINE');
  });
});

describe('создание: проверка кода ДО записи (2б)', () => {
  it('код занят — сказано словами рядом с полем, «Сохранить» неактивна', async () => {
    const onCreate = view({ check: { key: 'id', run: async () => ({ ok: false, message: 'Код занят: PAIN-X' }) } });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'x' } });
    fireEvent.change(code(), { target: { value: 'PAIN-X' } });
    await wait(400);
    expect(screen.getByTestId('kit-create-check').textContent).toContain('Код занят: PAIN-X');
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await settle();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('не смогли проверить — тоже не сохраняем: «не проверено» ≠ «свободно»', async () => {
    view({ check: { key: 'id', run: async () => ({ ok: null, message: 'Не смогли проверить: HTTP 502' }) } });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'x' } });
    fireEvent.change(code(), { target: { value: 'PAIN-X' } });
    await wait(400);
    expect(screen.getByTestId('kit-create-check').textContent).toContain('HTTP 502');
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('код свободен — «Сохранить» доступна, запись уходит', async () => {
    const onCreate = view({ check: { key: 'id', run: async () => ({ ok: true, message: 'Код свободен' }) } });
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'x' } });
    fireEvent.change(code(), { target: { value: 'PAIN-X' } });
    await wait(400);
    expect(screen.getByTestId('kit-create-check').textContent).toContain('Код свободен');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await settle();
    expect(onCreate).toHaveBeenCalledWith({ type: 'pain', values: { title: 'x', id: 'PAIN-X' } });
  });
});

describe('вкладка связей: «+ боль» (1б)', () => {
  const feature: KitRecord = { id: 'FEAT-A', kind: 'feature', title: 'Фича', status: '', fields: {} };
  const def: KitRelationDef = { key: 'pains', label: 'Боли', relation: 'association', rel: 'ADDRESSES', dir: 'out', manageable: true, targetKind: 'pain' };
  const relCtx = (hooks: KitConfig['hooks'], role = 'editor'): KitCtx => ({ ...ctx(hooks, role), data: { records: [feature], edges: [], journal: [], meta: { generated_at: 'x' } } });

  it('приложение дало «+ боль» — кнопка есть, щелчок открывает создание с той же связью', () => {
    const open = vi.fn();
    const createLinked = vi.fn((c: { rel: string }) => (c.rel === 'ADDRESSES' ? { label: '+ боль', open } : null));
    render(<RecordRelations record={feature} ctx={relCtx({ onRelation: async () => {}, createLinked })} defs={[def]} lang="ru" />);
    expect(createLinked).toHaveBeenCalledWith({ type: 'feature', id: 'FEAT-A', rel: 'ADDRESSES', dir: 'out', targetKind: 'pain' });
    fireEvent.click(screen.getByRole('button', { name: '+ боль' }));
    expect(open).toHaveBeenCalled();
  });

  it('без права править — кнопки нет', () => {
    const createLinked = () => ({ label: '+ боль', open: () => {} });
    render(<RecordRelations record={feature} ctx={relCtx({ onRelation: async () => {}, createLinked }, 'reader')} defs={[def]} lang="ru" />);
    expect(screen.queryByRole('button', { name: '+ боль' })).toBeNull();
  });
});
