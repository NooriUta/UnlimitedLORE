// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f, шаг 3: ошибка на экран, а не белый лист.
// Ловятся и ошибки рендера (error boundary), и то, что React не видит:
// window.onerror и необработанные промисы (обработчики событий, таймеры).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

function Boom(): React.ReactNode {
  throw new Error('слайс не ответил');
}

describe('ErrorBoundary: ошибка на экран вместо белого листа', () => {
  it('ошибка рендера — экран ошибки с текстом и кнопкой «Повторить»', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = mount(<ErrorBoundary lang="ru"><Boom /></ErrorBoundary>);
    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('слайс не ответил');
    expect(alert!.textContent).toContain('Повторить');
  });

  it('window error (вне рендера) — тоже на экран', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = mount(<ErrorBoundary lang="ru"><p>ок</p></ErrorBoundary>);
    expect(el.textContent).toContain('ок');
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'обработчик упал', error: new Error('обработчик упал') }));
    });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('обработчик упал');
  });

  it('необработанный промис — тоже на экран', () => {
    const el = mount(<ErrorBoundary lang="en"><p>ok</p></ErrorBoundary>);
    act(() => {
      const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
      ev.reason = new Error('fetch failed');
      window.dispatchEvent(ev);
    });
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('fetch failed');
    expect(alert?.textContent).toContain('Retry');
  });

  it('«Повторить» сбрасывает ошибку и снова рендерит детей', () => {
    const el = mount(<ErrorBoundary lang="ru"><p>живой</p></ErrorBoundary>);
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'сбой', error: new Error('сбой') }));
    });
    const retry = el.querySelector('button');
    expect(retry).not.toBeNull();
    act(() => retry!.click());
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).toContain('живой');
  });

  it('шум ResizeObserver не считается падением', () => {
    const el = mount(<ErrorBoundary lang="ru"><p>живой</p></ErrorBoundary>);
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
    });
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
