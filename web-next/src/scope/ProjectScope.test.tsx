// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03 — выбор проектов в шапке v2: список из
// слайсов LORE, выбор в URL (?proj=a,b), «мои» честно непроверенные без входа.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { LoreHttpError } from '../api/loreSlice';
import type { SliceFetcher } from '../api/loreSlice';
import { ProjectScope } from './ProjectScope';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const PROJECTS = { rows: [{ slug: 'tyr', name: 'TYR' }, { slug: 'unlimitedlore', name: 'Unlimited LORE' }] };

function fetcher(roles: unknown = { rows: [{ kc_sub: 'u1', projects: ['unlimitedlore'] }] }): SliceFetcher {
  return (async (slice: string) => {
    if (slice === 'git_projects') return PROJECTS;
    if (roles instanceof Error) throw roles;
    return roles;
  }) as SliceFetcher;
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function trigger() {
  return screen.getByRole('button', { name: /Проекты/ });
}

describe('S4-03 · выбор проектов в шапке v2', () => {
  it('выбор пишется в URL и читается из него', async () => {
    render(<ProjectScope fetch={fetcher()} sub="u1" narrow={false} />);
    await flush();
    fireEvent.click(trigger());
    const dlg = screen.getByRole('dialog', { name: 'Проекты' });
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /TYR/ }));
    expect(new URLSearchParams(window.location.search).get('proj')).toBe('tyr');
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /Unlimited LORE/ }));
    expect(new URLSearchParams(window.location.search).get('proj')).toBe('tyr,unlimitedlore');
    fireEvent.click(within(dlg).getByRole('button', { name: /Все проекты/ }));
    expect(new URLSearchParams(window.location.search).get('proj')).toBeNull();
  });

  it('открытие по ссылке с ?proj= — кнопка сразу подписана выбором', async () => {
    window.history.replaceState(null, '', '/?proj=tyr');
    render(<ProjectScope fetch={fetcher()} sub="u1" narrow={false} />);
    await flush();
    expect(trigger().textContent).toMatch(/TYR/);
  });

  it('«все мои» — по ролям пользователя', async () => {
    const onChange = vi.fn();
    render(<ProjectScope fetch={fetcher()} sub="u1" narrow={false} onChange={onChange} />);
    await flush();
    fireEvent.click(trigger());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Все мои/ }));
    expect(onChange).toHaveBeenLastCalledWith(['unlimitedlore']);
    expect(trigger().textContent).toMatch(/Все мои \(1\)/);
  });

  it('без входа — «все мои» недоступно с объяснением', async () => {
    render(<ProjectScope fetch={fetcher()} narrow={false} />);
    await flush();
    fireEvent.click(trigger());
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('button', { name: /Все мои/ }).getAttribute('aria-disabled')).toBe('true');
    expect(dlg.textContent).toMatch(/вход в v2 ещё не подключён/);
  });

  it('сбой слайса ролей — список есть, «мои» не проверены', async () => {
    render(<ProjectScope fetch={fetcher(new LoreHttpError(502, 'LORE_UPSTREAM', ''))} sub="u1" narrow={false} />);
    await flush();
    fireEvent.click(trigger());
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getAllByRole('checkbox').length).toBe(2);
    expect(dlg.textContent).toMatch(/слайс ролей не ответил/);
  });

  it('сам список не получен — ошибка с «Повторить», повтор перезагружает', async () => {
    let calls = 0;
    const f = (async (slice: string) => {
      if (slice !== 'git_projects') return { rows: [] };
      calls += 1;
      if (calls === 1) throw new LoreHttpError(503, 'LORE_UPSTREAM', '');
      return PROJECTS;
    }) as SliceFetcher;
    render(<ProjectScope fetch={f} narrow={false} />);
    await flush();
    fireEvent.click(trigger());
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('alert').textContent).toMatch(/503/);
    fireEvent.click(within(dlg).getByRole('button', { name: /Повторить/ }));
    await flush();
    expect(within(screen.getByRole('dialog')).getAllByRole('checkbox').length).toBe(2);
  });

  it('телефон — лист снизу', async () => {
    render(<ProjectScope fetch={fetcher()} sub="u1" narrow />);
    await flush();
    fireEvent.click(trigger());
    expect(screen.getByRole('dialog').className).toMatch(/sk-sheet--bottom/);
  });
});
