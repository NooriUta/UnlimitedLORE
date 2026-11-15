// @vitest-environment jsdom
// AP-07 «аватары доделать» (владелица 15.11.2026, SPRINT_LORE_ADMIN_POLISH/AP-07): в шапке оболочки —
// СВОЙ аватар, а не только инициалы. Картинка — запросом с токеном (people/avatars.ts), из blob:.
// Имя в меню — отображаемое имя профиля, если оно задано; нет — имя из входа, как раньше.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createSafeStorage } from '@seidr/kit';
import { createLocalS2Client } from '../api/me';
import type { CookieJar } from '../storage/storage';
import { resetPeopleCache } from '../people/avatars';
import { AccountMenu } from './AccountMenu';

const mem = () => {
  const m = new Map<string, string>();
  return () => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }) as unknown as Storage;
};
const jar = (): CookieJar => { let c = ''; return { read: () => c, write: (x: string) => { c = x.split(';')[0]; } }; };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const palettes = async () => ({ options: [], default: null, fromModel: false, notes: [] });

beforeEach(() => { resetPeopleCache(); });

describe('AccountMenu: свой аватар в шапке', () => {
  it('у профиля есть аватар — в кнопке картинка из blob:, запрос с токеном (fetchImpl)', async () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:me');
    const f = vi.fn(async (url: string) => (url.endsWith('/avatar')
      ? new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
      : json([{ kc_sub: 's1', login: 'omiloreadmin', display_name: 'Алёна', avatar_url: '/lore/users/s1/avatar', found: true }])));
    const { container } = render(<AccountMenu client={createLocalS2Client(createSafeStorage(mem()))} root={document.createElement('div')}
      lang="ru" jar={jar()} name="omiloreadmin" sub="s1" fetchImpl={f as unknown as typeof fetch} loadPalettes={palettes} />);
    await waitFor(() => expect(container.querySelector('button.sk-avatar img')?.getAttribute('src')).toBe('blob:me'));
    expect(f).toHaveBeenCalledWith('/lore/users/s1/avatar');
    // Имя профиля главнее логина из входа.
    expect(container.querySelector('button.sk-avatar')!.getAttribute('aria-label')).toContain('Алёна');
  });

  it('аватара нет — инициалы из имени входа (положительный контроль)', async () => {
    const f = vi.fn(async () => json([{ kc_sub: 's1', login: 'omiloreadmin', display_name: null, avatar_url: null, found: true }]));
    const { container } = render(<AccountMenu client={createLocalS2Client(createSafeStorage(mem()))} root={document.createElement('div')}
      lang="ru" jar={jar()} name="omiloreadmin" sub="s1" fetchImpl={f as unknown as typeof fetch} loadPalettes={palettes} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(container.querySelector('button.sk-avatar img')).toBeNull();
    expect(container.querySelector('button.sk-avatar')!.textContent).toBe('O');
  });
});
