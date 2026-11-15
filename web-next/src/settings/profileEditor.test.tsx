// @vitest-environment jsdom
// SPRINT_LORE_ADMIN_POLISH/AP-07 — профиль автора в личных настройках и в админке.
// Честные состояния: «не смогли загрузить» ≠ «аватара нет»; отказ сервера (403 на чужой
// профиль) — его словами, а не «сохранено»; аватара нет — инициалы.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileEditor, initialsOf, type ProfileRow } from './ProfileEditor';
import { resetPeopleCache } from '../people/avatars';

const row = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  kc_sub: 'sub-1', login: 'omiloreadmin', display_name: 'Алёна', avatar_url: null, found: true, ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ProfileEditor', () => {
  it('инициалы из имени, иначе из логина; ничего нет — «?»', () => {
    expect(initialsOf({ display_name: 'Алёна Фролова', login: 'x' })).toBe('АФ');
    expect(initialsOf({ display_name: null, login: 'vasilisk' })).toBe('VA');
    expect(initialsOf({ display_name: null, login: null })).toBe('?');
  });

  it('аватара нет — кружок с инициалами, логин и имя видны', async () => {
    const f = vi.fn(async () => json([row()]));
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    await screen.findByTestId('profile-editor');
    expect(f).toHaveBeenCalledWith('/lore/users?ids=sub-1');
    expect(screen.getByLabelText('Аватара нет — инициалы').textContent).toBe('АЛ');
    expect(screen.getByText('omiloreadmin')).toBeTruthy();
    expect((screen.getByLabelText('Отображаемое имя') as HTMLInputElement).value).toBe('Алёна');
  });

  // AP-07 «аватары доделать»: картинка за входом (без токена 401, препрод 1f09ded3), а <img src>
  // заголовок с токеном не шлёт. Значит, картинка берётся тем же запросом с токеном (fetchImpl) и
  // показывается из blob:, а не голым адресом — иначе аватар не виден никогда.
  it('аватар есть — картинка запросом с токеном и из blob:, а не голым адресом', async () => {
    resetPeopleCache();
    const create = vi.fn(() => 'blob:avatar-1');
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
    const f = vi.fn(async (url: string) => (url.endsWith('/avatar')
      ? new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
      : json([row({ avatar_url: '/lore/users/sub-1/avatar' })])));
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/lore/users/sub-1/avatar'));
    const img = await screen.findByRole('img') as HTMLImageElement;
    await waitFor(() => expect(img.getAttribute('src')).toBe('blob:avatar-1'));
  });

  it('картинка не отдалась (404/401) — инициалы, а не битая картинка', async () => {
    resetPeopleCache();
    const f = vi.fn(async (url: string) => (url.endsWith('/avatar')
      ? json({ error: 'NO_AVATAR' }, 404)
      : json([row({ avatar_url: '/lore/users/sub-1/avatar' })])));
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/lore/users/sub-1/avatar'));
    expect((await screen.findByLabelText('Аватара нет — инициалы')).textContent).toBe('АЛ');
  });

  it('не смогли загрузить — так и сказано, с причиной и «Повторить», а не пустой профиль', async () => {
    const f = vi.fn(async () => json({ error: 'S3_UPSTREAM', detail: 'хранилище молчит' }, 502));
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не смогли загрузить профиль');
    expect(alert.textContent).toContain('хранилище молчит');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('человека нет — честное «нет», не форма', async () => {
    const f = vi.fn(async () => json([{ ...row(), found: false, kc_sub: null }]));
    render(<ProfileEditor sub="ghost" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    expect((await screen.findByRole('status')).textContent).toContain('Человека ghost в LORE нет');
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('сохранение имени: POST JSON на /profile; ответ сервера становится профилем', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return init?.method === 'POST' ? json({ ...row({ display_name: 'Алёна Ф.' }), ok: true }) : json([row()]);
    });
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    const input = await screen.findByLabelText('Отображаемое имя');
    fireEvent.change(input, { target: { value: 'Алёна Ф.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить имя' }));
    expect((await screen.findByRole('status')).textContent).toBe('Имя сохранено');
    const post = calls.find(c => c.init?.method === 'POST')!;
    expect(post.url).toBe('/lore/users/sub-1/profile');
    expect(JSON.parse(String(post.init!.body))).toEqual({ display_name: 'Алёна Ф.' });
  });

  it('чужой профиль без права — словами сервера (403), а не «сохранено»', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => init?.method === 'POST'
      ? json({ error: 'FORBIDDEN', detail: 'чужой профиль меняет только админ' }, 403)
      : json([row()]));
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    fireEvent.change(await screen.findByLabelText('Отображаемое имя'), { target: { value: 'Другое' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить имя' }));
    expect((await screen.findByRole('alert')).textContent).toBe('чужой профиль меняет только админ');
    expect(screen.queryByText('Имя сохранено')).toBeNull();
  });

  it('имя не менялось — кнопка сохранения неактивна', async () => {
    const f = vi.fn(async () => json([row()]));
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    await screen.findByTestId('profile-editor');
    expect((screen.getByRole('button', { name: 'Сохранить имя' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('загрузка аватара: multipart на /avatar, после — картинка', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return json({ ...row({ avatar_url: '/lore/users/sub-1/avatar' }), ok: true });
      if (url.endsWith('/avatar')) return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 });
      return json([row()]);
    });
    resetPeopleCache();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:new-avatar');
    render(<ProfileEditor sub="sub-1" lang="ru" fetchImpl={f as unknown as typeof fetch} />);
    const pick = await screen.findByLabelText('Файл аватара: png, jpeg или webp до 2 МБ');
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' });
    fireEvent.change(pick, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Аватар сохранён'));
    const post = calls.find(c => c.init?.method === 'POST')!;
    expect(post.url).toBe('/lore/users/sub-1/avatar');
    expect(post.init!.body).toBeInstanceOf(FormData);
    // Новая картинка — свежим запросом с токеном (кэш сброшен), из blob:.
    await waitFor(() => expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe('blob:new-avatar'));
    expect(calls.filter(c => c.url === '/lore/users/sub-1/avatar' && !c.init?.method).length).toBeGreaterThan(0);
  });
});
