// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00e (попутно): TipTapField под StrictMode.
// main.tsx web-next оборачивает приложение в StrictMode — React там монтирует
// эффекты дважды, и эффект синхронизации value успевал позвать getText() у уже
// уничтоженного редактора («Cannot read properties of null (reading 'nodes')»).
// В тестах web-next это всплывало необработанной ошибкой и роняло прогон
// кодом 1 при зелёных тестах.
import { StrictMode, Suspense, lazy } from 'react';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TipTapField } from './index';

describe('TipTapField · StrictMode', () => {
  it('двойной монтаж эффектов не трогает уничтоженный редактор', async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    try {
      const { container, rerender } = render(<StrictMode><TipTapField value="**a**" onChange={() => {}} ariaLabel="S" /></StrictMode>);
      await waitFor(() => expect(container.querySelector('.ProseMirror strong')).toBeTruthy());
      rerender(<StrictMode><TipTapField value="**b**" onChange={() => {}} ariaLabel="S" /></StrictMode>);
      await waitFor(() => expect(container.querySelector('.ProseMirror')?.textContent).toBe('b'));
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
  });

  it('ленивый чанк за Suspense (как /kit в web-next): показ и снятие без ошибок', async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    try {
      const Lazy = lazy(async () => ({ default: () => <TipTapField value="**a**" onChange={() => {}} ariaLabel="L" /> }));
      const { container, unmount } = render(<Suspense fallback={<p>…</p>}><Lazy /></Suspense>);
      await waitFor(() => expect(container.querySelector('.sk-md')).toBeTruthy());
      unmount();
      // Отложенные эффекты/таймеры редактора отрабатывают после снятия.
      await new Promise(r => setTimeout(r, 50));
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
  });
});
