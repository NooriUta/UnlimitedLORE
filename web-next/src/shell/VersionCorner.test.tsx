// @vitest-environment jsdom
// Метка версии доходит до угла экрана (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Формы текста проверяет `version.test.ts`; здесь — что метка ПОКАЗАНА, что
// она в оболочке (иначе это снова «написано и никуда не подключено»), и что
// нажатие копирует метку вместе с причинами: версию спрашивают, чтобы её
// переслать, и «не проверено» без причины в переписке бесполезно.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { VersionCorner } from './VersionCorner';

beforeAll(() => { registerGameIcons(gameIcons); });

const net = (body: unknown, status = 200) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

const show = (props: Parameters<typeof VersionCorner>[0] = {}) =>
  render(<KitLangProvider lang="ru"><VersionCorner {...props} /></KitLangProvider>);

describe('S4-30 · метка версии в правом нижнем углу', () => {
  it('положительный контроль: версия спрошена у сервера и показана', async () => {
    show({ fetchImpl: net({ commit: '339f15b0aaaa', built_at: 'x', schema_version: 42, release: 'v1.17.7' }), front: '339f15b0aaaa' });
    expect(await screen.findByText('v1.17.7 · 339f15b0')).toBeTruthy();
  });

  it('пока не ответили — в углу ничего: пустой угол честнее придуманной версии', () => {
    const { container } = show({ state: { kind: 'loading' } });
    expect(container.querySelector('.v2-version')).toBeNull();
  });

  it('сервер молчит — «не проверено» видно, а не пусто', async () => {
    const http = (async () => { throw new Error('сеть недоступна'); }) as unknown as typeof fetch;
    show({ fetchImpl: http, front: '' });
    expect(await screen.findByText('сервер: не проверено')).toBeTruthy();
  });

  it('нажатие копирует метку вместе с причиной', async () => {
    const writeText = vi.fn(async (_s: string) => {});
    show({
      state: { kind: 'failed', reason: 'HTTP 503' },
      front: '',
      clipboard: { writeText },
    });
    screen.getByRole('button').click();
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('не проверено');
    expect(copied).toContain('503');
    expect(copied).toContain('коммит фронта в сборке не помечен');
    expect(await screen.findByText('скопировано')).toBeTruthy();
  });

  it('буфер недоступен (нет https, запрет политики) — сказано, а не проглочено', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied'); });
    show({ state: { kind: 'ok', server: { release: 'v1.17.7', commit: 'abc12345', builtAt: '', schema: null } }, front: 'abc12345', clipboard: { writeText } });
    screen.getByRole('button').click();
    expect(await screen.findByText(/скопировать не удалось/)).toBeTruthy();
  });

  it('MP2-04: подпись метки вне кнопки — тап по тексту не перехватывается копией', () => {
    const { container } = show({ state: { kind: 'ok', server: { release: 'v1.17.7', commit: 'abc12345', builtAt: '', schema: null } }, front: 'abc12345' });
    const txt = container.querySelector('.v2-version__text');
    const btn = container.querySelector('.v2-version__btn');
    expect(txt?.textContent).toContain('v1.17.7');
    expect(btn?.textContent).not.toContain('v1.17.7');
  });

  it('метка подключена к оболочке v2 — иначе её нет на экране', () => {
    const src = readFileSync(`${process.cwd()}/src/shell/V2Shell.tsx`, 'utf8');
    expect(src).toContain('VersionCorner');
  });

  it('у метки есть правило в своём слое — иначе угол не правый нижний', () => {
    const css = readFileSync(`${process.cwd()}/src/App.css`, 'utf8');
    expect(css).toMatch(/\.v2-version\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.v2-version\s*\{[^}]*right:/);
    expect(css).toMatch(/\.v2-version\s*\{[^}]*bottom:/);
    // Размеры и цвета — токенами (STYLE-01): сырой px в шрифте валит гейт.
    expect(css).toMatch(/\.v2-version__btn\s*\{[^}]*var\(--fs-2xs\)/);
  });
});
