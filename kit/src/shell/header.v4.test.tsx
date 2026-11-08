// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-23 (волна 3) — шапка как в прототипе v4:
// охват проектов сразу за приложениями (в v2 был у правого края), с числом и ▾;
// поиск — строкой «Поиск по LORE… /», команды — кнопкой с подписью «Команды Ctrl K»
// (в v2 обе были безымянными иконками у аватара). Правило: где есть клавиша —
// она написана и работает.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig } from '../core/contract';
import { KitShell } from './KitShell';
import { ScopePicker } from '../picker/ScopePicker';
import { PaletteTriggers } from '../palette/PaletteTriggers';

beforeAll(() => { registerGameIcons(gameIcons); });

const cfg: KitConfig = {
  modules: [{ id: 'forseti', title: 'Forseti', icon: 'compass', status: 'active' }, { id: 'bragi', title: 'BRAGI', icon: 'harp', status: 'planned' }],
  menu: { groups: [] }, kinds: {}, statuses: { items: [] },
};
const opts = ['a', 'b', 'c', 'd'].map(id => ({ id, title: `Проект ${id}` }));

describe('KitShell: слот topStart — сразу за приложениями', () => {
  it('содержимое topStart стоит после навигации модулей и до topEnd', () => {
    const { container } = render(
      <KitShell config={cfg} narrow={false} topStart={<span data-testid="ts">охват</span>} topEnd={<span data-testid="te">конец</span>} />,
    );
    const top = container.querySelector('.sk-shell__top')!;
    const kids = [...top.children];
    const mods = kids.findIndex(k => k.classList.contains('sk-shell__mods'));
    const ts = kids.findIndex(k => k.contains(screen.getByTestId('ts')));
    const te = kids.findIndex(k => k.contains(screen.getByTestId('te')));
    expect(mods).toBeGreaterThan(-1);
    expect(ts).toBe(mods + 1);
    expect(te).toBeGreaterThan(ts);
  });
});

describe('ScopePicker: число и шеврон', () => {
  it('«все» — с числом проектов; у кнопки есть ▾', () => {
    render(<ScopePicker options={opts} value={[]} onChange={() => {}} />);
    const btn = screen.getByRole('button', { name: /Проекты/ });
    expect(btn.textContent).toContain('Все проекты · 4');
    expect(btn.querySelector('.sk-scope__chev')?.textContent).toBe('▾');
  });
});

describe('PaletteTriggers: поиск строкой и «Команды» с подписью', () => {
  it('обе кнопки подписаны текстом и клавишей; щелчок зовёт обработчики', () => {
    const onSearch = vi.fn();
    const onCommands = vi.fn();
    render(<PaletteTriggers onSearch={onSearch} onCommands={onCommands} />);
    const search = screen.getByRole('button', { name: /Поиск по LORE/ });
    expect(search.textContent).toContain('/');
    expect(search.getAttribute('aria-keyshortcuts')).toBe('/');
    const cmd = screen.getByRole('button', { name: /Команды/ });
    expect(within(cmd).getByText('Команды')).toBeTruthy();
    expect(cmd.getAttribute('aria-keyshortcuts')).toBe('Control+K');
    fireEvent.click(search);
    fireEvent.click(cmd);
    expect(onSearch).toHaveBeenCalled();
    expect(onCommands).toHaveBeenCalled();
  });
});
