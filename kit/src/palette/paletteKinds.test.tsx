// @vitest-environment jsdom
// Фильтр по типам в поиске (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14). Владелица
// 11.11.2026: «в поиске верните фильтры по типам объектов хотя бы в свёрнутом
// виде». В v1 они были (LoreSearchScreen, by_type), палитра v2 их потеряла.
// Правила: свёрнуто по умолчанию; пилюля — тип и число найденного; выбор
// оставляет в выдаче только эти типы (и загруженные, и найденные сервером);
// при выбранном фильтре свёрнутая строка говорит, что он есть.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { KitCtx, KitRecord } from '../core/contract';
import { createSafeStorage } from '../resilience/safeStorage';
import { CommandPalette } from './Palette';
import { createRecentList, kindFacets } from './paletteModel';
import type { PaletteRecordItem } from './paletteModel';
import { fixtureConfig, fixtureData } from './fixtures.test-helper';

const item = (id: string, kind: string, kindTitle: string): PaletteRecordItem =>
  ({ type: 'record', id, title: id, kind, kindTitle, icon: undefined, status: '' });

describe('модель: пилюли типов', () => {
  it('тип и число, порядок — по числу, при равенстве по подписи; пустой тип не считается', () => {
    const f = kindFacets([item('a', 'task', 'Задача'), item('b', 'adr', 'ADR'), item('c', 'task', 'Задача'), item('r', '', '')]);
    expect(f).toEqual([{ kind: 'task', title: 'Задача', n: 2 }, { kind: 'adr', title: 'ADR', n: 1 }]);
  });
});

describe('палитра: фильтр по типам', () => {
  const ctx: KitCtx = { data: fixtureData(), config: fixtureConfig(), href: id => `#${id}`, esc: s => s, md: s => s };
  const remote = async (): Promise<{ records: KitRecord[] }> => ({ records: [{ id: 'D-99', kind: 'doc', title: 'Задача в документе', status: '', fields: {} }] });

  async function open() {
    render(<CommandPalette open mode="search" onClose={() => {}} ctx={ctx} recent={createRecentList(createSafeStorage(() => null))} remote={remote} remoteDelayMs={0} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'задача' } });
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
  }

  it('свёрнут по умолчанию; развёрнутый — пилюли с числами по всей выдаче', async () => {
    await open();
    const toggle = screen.getByRole('button', { name: /Типы/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Задача 1' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Задача 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ADR 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Документ 1' })).toBeTruthy();
  });

  it('выбор типа оставляет только его — и среди загруженных, и среди найденных сервером; снятие возвращает всё', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Типы/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Документ 1' }));
    expect(screen.getAllByRole('option').map(o => o.getAttribute('data-id'))).toEqual(['record:D-99']);
    // Свёрнутая строка говорит, что фильтр стоит, — иначе пропажа выдачи выглядит как «не нашлось».
    fireEvent.click(screen.getByRole('button', { name: /Типы/ }));
    expect(screen.getByRole('button', { name: /Типы · 1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Типы/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Документ 1' }));
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1);
  });
});
