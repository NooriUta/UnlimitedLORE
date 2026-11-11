// @vitest-environment jsdom
// Строка состояния v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21, ответ владелицы 7а):
// во всю ширину внизу окна — сеть, проекты, свежесть (когда сервер ответил).
// Честно: «сервер не ответил» ≠ «ещё не спрашивали»; «нет сети» — словами.
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { KitLangProvider } from '@seidr/kit';
import { StatusBar } from './StatusBar';
import { createServerPulse } from './serverPulse';

afterEach(() => { window.history.replaceState(null, '', '/'); });

const show = (pulse = createServerPulse()) =>
  render(<KitLangProvider lang="ru"><StatusBar pulse={pulse} /></KitLangProvider>);

describe('строка состояния', () => {
  it('сеть: «в сети» и «нет сети» по событиям браузера', () => {
    show();
    expect(screen.getByText('в сети')).toBeTruthy();
    act(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText('нет сети')).toBeTruthy();
    act(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); window.dispatchEvent(new Event('online')); });
    expect(screen.getByText('в сети')).toBeTruthy();
  });

  it('проекты: без выбора — «все», с выбором — число (выбор в адресе ?proj=)', () => {
    const { unmount } = show();
    expect(screen.getByText('проекты: все')).toBeTruthy();
    unmount();
    window.history.replaceState(null, '', '/?proj=AIDA%2FminiLORE,NooriUta%2FUnlimitedLORE');
    show();
    expect(screen.getByText('проекты: 2')).toBeTruthy();
  });

  it('свежесть: «ещё не спрашивали» → время ответа сервера → «сервер не ответил»', async () => {
    const pulse = createServerPulse();
    const calls: string[] = [];
    const base = (async (u: string) => {
      calls.push(String(u));
      if (String(u).includes('fail')) return new Response('', { status: 502 });
      // Не-LORE ответ «свежее» сбоя: если бы его учли, строка сказала бы «ответил».
      if (String(u).includes('fonts')) return new Response('', { status: 200, headers: { date: 'Fri, 01 Jan 2099 00:00:00 GMT' } });
      return new Response('{}', { status: 200, headers: { date: 'Wed, 11 Nov 2026 14:02:00 GMT' } });
    }) as unknown as typeof fetch;
    const f = pulse.wrap(base);
    show(pulse);
    expect(screen.getByText('сервер: ещё не спрашивали')).toBeTruthy();
    await act(async () => { await f('/lore/slice/sprints'); });
    const t = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date('2026-11-11T14:02:00Z'));
    expect(screen.getByText(`сервер ответил ${t}`)).toBeTruthy();
    await act(async () => { await f('/lore/slice/fail'); });
    expect(screen.getByText(/сервер не ответил/)).toBeTruthy();
    // Не-LORE запросы свежесть не трогают.
    await act(async () => { await f('/fonts/x.woff2'); });
    expect(calls).toHaveLength(3);
    expect(screen.getByText(/сервер не ответил/)).toBeTruthy();
  });
});
