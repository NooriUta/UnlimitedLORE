// @vitest-environment jsdom
// Связи паспорта — выбором с поиском, а не вводом кода (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
// Владелица 11.11.2026: «где значения задаются рёбрами — dropdown, а не корректировка
// текста». Варианты даёт приложение хуком relationOptions (K-14: kit не знает срезов);
// не загрузились — причина и «Повторить», свободного ввода нет. Хука нет — прежний ввод кода.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../index';
import { RecordRelations } from './RecordRelations';
import type { KitConfig, KitCtx, KitRecord, KitRelationDef } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec: KitRecord = { id: 'S_A', kind: 'sprint', title: 'Спринт', status: '', fields: {} };
const def: KitRelationDef = { key: 'components', label: 'Компоненты', relation: 'association', rel: 'BELONGS_TO', dir: 'out' };
const ctx = (hooks: KitConfig['hooks']): KitCtx => ({
  config: { modules: [], menu: { groups: [] }, statuses: { items: [] }, kinds: { sprint: { title: 'Спринт', icon: 'sprint' } }, roles: { editor: { canEdit: true, canStatus: true } }, hooks },
  data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
  role: 'editor', href: id => '#' + id, esc: s => s, md: s => s,
});
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

describe('связь: выбор цели с поиском', () => {
  it('поиск зовёт хук с запросом; щелчок по найденному привязывает; свободного поля кода нет', async () => {
    const relationOptions = vi.fn(async () => [{ id: 'FORSETI', title: 'Forseti' }, { id: 'ODIN', title: 'Odin' }]);
    const onRelation = vi.fn(async () => {});
    render(<RecordRelations record={rec} ctx={ctx({ relationOptions, onRelation })} defs={[def]} lang="ru" />);
    expect(screen.queryByPlaceholderText(/код/i)).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: /Компоненты/ }), { target: { value: 'for' } });
    await settle();
    expect(relationOptions).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'S_A', rel: 'BELONGS_TO', dir: 'out', query: 'for' }));
    fireEvent.click(screen.getByRole('button', { name: /Привязать.*FORSETI/ }));
    await settle();
    expect(onRelation).toHaveBeenCalledWith(expect.objectContaining({ target: 'FORSETI', action: 'add' }));
  });

  it('варианты не загрузились — причина и «Повторить», а не пустота', async () => {
    let fail = true;
    const relationOptions = vi.fn(async () => { if (fail) throw new Error('HTTP 502'); return [{ id: 'X', title: 'X' }]; });
    render(<RecordRelations record={rec} ctx={ctx({ relationOptions, onRelation: async () => {} })} defs={[def]} lang="ru" />);
    fireEvent.change(screen.getByRole('searchbox', { name: /Компоненты/ }), { target: { value: 'x' } });
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('HTTP 502');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await settle();
    expect(screen.getByRole('button', { name: /Привязать.*X/ })).toBeTruthy();
  });

  it('ничего не нашлось — словами', async () => {
    render(<RecordRelations record={rec} ctx={ctx({ relationOptions: async () => [], onRelation: async () => {} })} defs={[def]} lang="ru" />);
    fireEvent.change(screen.getByRole('searchbox', { name: /Компоненты/ }), { target: { value: 'zzz' } });
    await settle();
    expect(screen.getByText(/ничего не нашлось/i)).toBeTruthy();
  });

  it('хука нет — прежний ввод кода (приложения без хука не ломаются)', () => {
    render(<RecordRelations record={rec} ctx={ctx({ onRelation: async () => {} })} defs={[def]} lang="ru" />);
    expect(screen.getByRole('textbox', { name: /Компоненты/ })).toBeTruthy();
  });
});
