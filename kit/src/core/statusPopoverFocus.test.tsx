// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11 — фокус и ARIA во всплывающем меню
// статуса: Tab не уходит из поповера, Esc закрывает и возвращает фокус на
// чип, у меню — имя и связь с чипом (aria-controls).
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../index';
import type { KitConfig, KitRecord } from './contract';
import { StatusChip, StatusPopover } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

const statuses: KitConfig['statuses'] = {
  items: [
    { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: '--t3' },
    { code: 'active', title: 'В работе', category: 'active', icon: 'progression', color: 'acc' },
    { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ],
};
const config: KitConfig = { modules: [], menu: { groups: [] }, kinds: {}, statuses };
const rec: KitRecord = { id: 'T-1', kind: 'task', title: 'Задача', status: 'todo', fields: {} };

describe('StatusPopover — ловушка Tab', () => {
  it('Tab с «Отмена» — на первый пункт, Shift+Tab с первого — на «Отмена»', () => {
    render(<StatusPopover statuses={statuses} current="todo" onPick={() => {}} onCancel={() => {}} />);
    const items = screen.getAllByRole('menuitem');
    const cancel = screen.getByRole('button', { name: 'Отмена' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });
});

describe('StatusChip — фокус возвращается на чип', () => {
  it('открыть, Esc — фокус снова на чипе, меню закрыто', () => {
    render(<StatusChip record={rec} config={config} save={async () => {}} />);
    const chip = screen.getByRole('button', { name: /Статус: К работе/ });
    chip.focus();
    fireEvent.click(chip);
    const menu = screen.getByRole('menu');
    expect(chip.getAttribute('aria-controls')).toBeTruthy();
    expect(document.getElementById(chip.getAttribute('aria-controls')!)?.contains(menu)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });
});
