// @vitest-environment jsdom
// S4-24 (решение 14.11.2026, выбор делегирован владелицей): команда «Новая запись в …» в палитре
// Ctrl+K открывает ТУ ЖЕ одобренную форму s4-24 (паспорт `_new` в разделе), что кнопка «Новая»
// списка. Новый вход, не новый UX. Правило прав то же: создать нельзя — команды нет, а не 403
// после заполнения формы.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import { v2Config } from '../shell/v2Config';
import { SectionPalette } from './SectionPalette';

beforeAll(() => { registerGameIcons(gameIcons); });

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => {
        const s = String(url);
        w.location.search = s.includes('?') ? s.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
      },
      replaceState: (_s, _t, url) => w.history.pushState(null, '', url),
    },
  };
  return w;
}
const mem = () => {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
};

/** Сервер: создавать можно ADR, нельзя спринт, задачу — не ответил. */
const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
  const u = String(input);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/lore/record/adr/_new')) return json({ perms: { can_create: true } });
  if (u.includes('/lore/record/sprint/_new')) return json({ perms: { can_create: false, reason: 'нет роли' } });
  if (u.includes('/lore/record/task/_new')) return json({ error: 'X' }, 500);
  return json({ rows: [] });
}) as unknown as typeof fetch;

function mount() {
  const win = fakeWin();
  const storage = mem();
  render(
    <KitShell config={v2Config('ru')} win={win} storage={storage} narrow={false}
      topEnd={<SectionPalette storage={storage} fetchImpl={fetchImpl} />}>
      <p>экран</p>
    </KitShell>,
  );
  return win;
}
const openPalette = () => act(() => { fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true }); });

describe('S4-24 · «Новая запись…» в палитре', () => {
  it('команда есть только там, где сервер разрешил создавать', async () => {
    mount();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/lore/record/adr/_new')));
    openPalette();
    const dlg = screen.getByRole('dialog');
    await waitFor(() => expect(within(dlg).getByText(/Новая запись в «ADR»/)).toBeTruthy());
    expect(within(dlg).queryByText(/Новая запись в «Спринты»/)).toBeNull();
    expect(within(dlg).queryByText(/Новая запись в «Задачи»/)).toBeNull();
  });

  it('команда открывает форму создания в разделе: ?sec=adr&open=_new', async () => {
    const win = mount();
    openPalette();
    const dlg = screen.getByRole('dialog');
    const cmd = await within(dlg).findByText(/Новая запись в «ADR»/);
    act(() => { fireEvent.click(cmd); });
    expect(win.location.search).toMatch(/sec=adr/);
    expect(win.location.search).toMatch(/open=_new/);
  });
});
