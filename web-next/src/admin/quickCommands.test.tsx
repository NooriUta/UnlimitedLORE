// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-31 п.5 (решение 5а) — «Быстрые команды» из старой
// вкладки v1 (QuickCommandsTab) переехали в раздел MCP: копируемые команды
// подключения, «Скопировать». Отказ буфера назван словами: вне https/localhost
// буфера нет — «выделите вручную», а не ложное «скопировано» (v1 Q-03).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { QuickCommands } from './QuickCommands';
import { McpScreen } from './McpScreen';
import { QUICK_GROUPS, tryCopy } from './quickCmds';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ok = { writeText: vi.fn(async () => {}) };
const deny = { writeText: vi.fn(async () => { throw new Error('NotAllowedError'); }) };

describe('S7B-31 · модель быстрых команд', () => {
  it('команды те же, что у v1: переход в проект и подключение канала minilore-link', () => {
    const cmds = QUICK_GROUPS.flatMap(g => g.items.map(i => i.cmd));
    expect(cmds).toContain('cd C:\\AIDA\\UnlimitedLORE');
    expect(cmds.some(c => c.includes('server:minilore-link') && c.includes('--resume <sessionId>'))).toBe(true);
  });

  it('копирование: ok · буфера нет · браузер отказал — три разных исхода', async () => {
    expect(await tryCopy('x', ok)).toBe('ok');
    expect(await tryCopy('x', undefined)).toBe('unavailable');
    expect(await tryCopy('x', deny)).toBe('failed');
  });
});

describe('S7B-31 · блок «Быстрые команды»', () => {
  const mount = (clip: typeof ok | null) => render(<KitLangProvider lang="ru"><QuickCommands clipboard={clip} /></KitLangProvider>);

  it('каждая команда видна текстом и копируется кнопкой «Скопировать»', async () => {
    mount(ok);
    const box = screen.getByTestId('adm-quick');
    const btns = within(box).getAllByRole('button', { name: /Скопировать/ });
    expect(btns).toHaveLength(QUICK_GROUPS.flatMap(g => g.items).length);
    expect(within(box).getByText('cd C:\\AIDA\\UnlimitedLORE')).toBeTruthy();
    fireEvent.click(btns[0]);
    expect(await within(box).findByText(/скопировано/)).toBeTruthy();
    expect(ok.writeText).toHaveBeenCalledWith('cd C:\\AIDA\\UnlimitedLORE');
  });

  it('буфера нет (не https/localhost) — сказано словами, команда остаётся видна', async () => {
    mount(null);
    fireEvent.click(screen.getAllByRole('button', { name: /Скопировать/ })[0]);
    const why = await screen.findByTestId('adm-quick-fail');
    expect(why.textContent).toMatch(/https/);
    expect(why.textContent).toMatch(/вручную/);
    expect(screen.getByText('cd C:\\AIDA\\UnlimitedLORE')).toBeTruthy();
  });

  it('браузер отказал — своя причина, не «скопировано»', async () => {
    mount(deny);
    fireEvent.click(screen.getAllByRole('button', { name: /Скопировать/ })[0]);
    const why = await screen.findByTestId('adm-quick-fail');
    expect(why.getAttribute('data-why')).toBe('failed');
    expect(screen.queryByText(/^скопировано$/)).toBeNull();
  });

  it('в разделе MCP — блоком', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    render(<KitLangProvider lang="ru"><McpScreen fetchImpl={f} now={0} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-quick')).toBeTruthy();
  });
});
