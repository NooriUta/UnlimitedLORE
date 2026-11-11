// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-07 — палитра Ctrl+K и поиск «/» на витрине /kit:
// компонент из @seidr/kit, а не своя копия; клавиши по e.code.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import KitPage from './KitPage';

const here = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  registerGameIcons(gameIcons);
});

describe('K-07 · палитра на витрине /kit', () => {
  it('раздел «Палитра» есть, палитра берётся из @seidr/kit', () => {
    render(<KitPage />);
    expect(document.getElementById('kit-palette')).toBeTruthy();
    const page = readFileSync(resolve(here, 'KitPage.tsx'), 'utf8');
    expect(page).toMatch(/CommandPalette[\s\S]*from '@seidr\/kit'|from '@seidr\/kit'[\s\S]*CommandPalette/);
  });

  it('Ctrl+K в русской раскладке открывает палитру; поиск находит демо-запись', () => {
    render(<KitPage />);
    act(() => { fireEvent.keyDown(window, { code: 'KeyK', key: 'л', ctrlKey: true }); });
    // Поле поиска — внутри диалога палитры: на витрине есть и другие
    // combobox (выбор из списка в «Редакторах полей», S4-FIELD-EDITORS).
    const box = within(screen.getByRole('dialog')).getByRole('combobox');
    fireEvent.change(box, { target: { value: 'S4-00d' } });
    expect(within(screen.getByRole('dialog')).getAllByRole('option')[0].getAttribute('data-id')).toBe('record:SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00d');
  });

  it('кнопка «Поиск /» открывает поиск по записям, Enter — запись в недавние', () => {
    render(<KitPage />);
    fireEvent.click(screen.getByRole('button', { name: /Поиск по записям/ }));
    expect(screen.getByRole('dialog').getAttribute('data-mode')).toBe('records');
    // Поле поиска — внутри диалога палитры: на витрине есть и другие
    // combobox (выбор из списка в «Редакторах полей», S4-FIELD-EDITORS).
    const box = within(screen.getByRole('dialog')).getByRole('combobox');
    fireEvent.change(box, { target: { value: 'палитр' } });
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Открыть палитру/ }));
    expect(screen.getByRole('group', { name: 'Недавние' })).toBeTruthy();
  });
});
