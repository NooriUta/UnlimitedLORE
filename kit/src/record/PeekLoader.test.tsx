// @vitest-environment jsdom
// Карточка Peek с загрузкой (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 5: «peek — по конфигу
// приложения»). Раньше цикл «загрузка → карточка или отказ → Повторить» жил в web-next (LorePeek).
// Что грузить — решает приложение (функция load); kit держит состояние и честные ответы.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { PeekLoader } from './PeekLoader';
import type { PeekState } from './PeekCard';

const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);
const OK: PeekState = { state: 'ok', data: { kind: 'Задача', id: 'T-1', title: 'Задача один', props: [], section: null, href: '#T-1' } };

describe('PeekLoader', () => {
  it('сначала «грузится», потом карточка', async () => {
    let done: (s: PeekState) => void = () => {};
    const load = vi.fn(() => new Promise<PeekState>(r => { done = r; }));
    wrap(<PeekLoader id="T-1" load={load} />);
    expect(document.body.textContent).toContain('T-1');
    await act(async () => { done(OK); });
    expect(screen.getByText('Задача один')).toBeTruthy();
  });

  it('сбой — причина и «Повторить» грузит заново', async () => {
    const load = vi.fn<() => Promise<PeekState>>()
      .mockResolvedValueOnce({ state: 'error', reason: 'сервер 503' })
      .mockResolvedValueOnce(OK);
    wrap(<PeekLoader id="T-1" load={load} />);
    expect(await screen.findByText(/сервер 503/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByText('Задача один')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('загрузчик бросил — это сбой со словами, а не вечная загрузка', async () => {
    wrap(<PeekLoader id="T-1" load={() => Promise.reject(new Error('нет сети'))} />);
    expect(await screen.findByText(/нет сети/)).toBeTruthy();
  });

  it('сменился id — грузит новую запись', async () => {
    const load = vi.fn(async () => OK);
    const { rerender } = wrap(<PeekLoader id="T-1" load={load} />);
    await screen.findByText('Задача один');
    rerender(<KitLangProvider lang="ru"><PeekLoader id="T-2" load={load} /></KitLangProvider>);
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
  });
});
