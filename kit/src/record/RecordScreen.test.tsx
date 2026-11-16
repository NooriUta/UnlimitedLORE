// @vitest-environment jsdom
// Рамка экрана записи (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 4: экран «список + паспорт»
// в kit). Пункты 4–5 чек-листа «до»: полоса над записью есть в ЛЮБОМ состоянии (MP2-09/10 — раньше
// паспорт прыгал между загрузкой, сбоем и чтением); «записи нет» (404) — ответ, а не сбой.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { RecordScreen } from './RecordScreen';

const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);
const bar = { tools: <button type="button">⤢</button> };

describe('RecordScreen', () => {
  it('полоса на месте во всех состояниях', () => {
    for (const state of [{ kind: 'loading' }, { kind: 'notFound', id: 'X-1' }, { kind: 'error', error: new Error('503') }, { kind: 'ready' }] as const) {
      const { unmount } = wrap(<RecordScreen bar={bar} state={state}><p>тело</p></RecordScreen>);
      expect(screen.getByTestId('kit-rec-bar'), state.kind).toBeTruthy();
      expect(screen.getByRole('button', { name: '⤢' })).toBeTruthy();
      unmount();
    }
  });

  it('загрузка — скелет, тела нет', () => {
    wrap(<RecordScreen bar={bar} state={{ kind: 'loading' }}><p>тело</p></RecordScreen>);
    expect(screen.queryByText('тело')).toBeNull();
    expect(document.querySelector('[aria-busy="true"], .sk-skel')).toBeTruthy();
  });

  it('записи нет — ответ словами с кодом, а не «не загрузилось»', () => {
    wrap(<RecordScreen bar={bar} state={{ kind: 'notFound', id: 'X-1' }} />);
    expect(document.body.textContent).toContain('X-1');
    expect(document.body.textContent).toMatch(/не найдена/);
    expect(screen.queryByRole('button', { name: /Повторить/ })).toBeNull();
  });

  it('сбой — причина и «Повторить»', () => {
    const retry = vi.fn();
    wrap(<RecordScreen bar={bar} state={{ kind: 'error', error: new Error('сервер 503'), onRetry: retry }} />);
    expect(document.body.textContent).toContain('сервер 503');
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(retry).toHaveBeenCalled();
  });

  it('готово — тело под полосой', () => {
    wrap(<RecordScreen bar={bar} state={{ kind: 'ready' }}><p>тело</p></RecordScreen>);
    expect(screen.getByText('тело')).toBeTruthy();
  });
});
