// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-06: сквозная инфраструктура оболочки —
//   useUrlParam  — выбор живёт в URL, при отказе pushState — в «#»;
//   useHotkeys   — клавиши по e.code (русская раскладка), без перехвата набора;
//   installErrorScreen — window.onerror на экран для голого mount (бандл K-08),
//                        где React-границы ещё нет или она сама не поднялась.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useUrlParam } from './useUrlParam';
import { useHotkeys } from './useHotkeys';
import { installErrorScreen, showErrorScreen } from './errorScreen';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

function TabProbe() {
  const [tab, setTab] = useUrlParam('tab');
  return (
    <div>
      <output>{tab ?? '—'}</output>
      <button type="button" onClick={() => setTab('links')}>links</button>
      <button type="button" onClick={() => setTab(null)}>clear</button>
    </div>
  );
}

describe('useUrlParam: состояние вкладки в URL', () => {
  it('читает из query и пишет через pushState', () => {
    window.history.replaceState(null, '', '/kit?tab=overview');
    render(<TabProbe />);
    expect(screen.getByRole('status').textContent).toBe('overview');
    act(() => screen.getByText('links').click());
    expect(window.location.search).toBe('?tab=links');
    expect(screen.getByRole('status').textContent).toBe('links');
  });

  it('pushState бросает — значение уходит в «#», экран обновляется, без исключения', () => {
    window.history.replaceState(null, '', '/kit?tab=overview');
    vi.spyOn(window.history, 'pushState').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    render(<TabProbe />);
    act(() => screen.getByText('links').click());
    expect(window.location.hash).toContain('tab=links');
    expect(screen.getByRole('status').textContent).toBe('links');
    act(() => screen.getByText('clear').click());
    expect(screen.getByRole('status').textContent).toBe('—');
  });

  it('«Назад» браузера (popstate) — экран следует за URL', () => {
    window.history.replaceState(null, '', '/kit?tab=a');
    render(<TabProbe />);
    act(() => {
      window.history.replaceState(null, '', '/kit?tab=b');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('status').textContent).toBe('b');
  });
});

function Keys({ onK, onOne }: { onK: () => void; onOne: () => void }) {
  useHotkeys({ 'Mod+K': onK, '1': onOne });
  return <input aria-label="поле" />;
}

const press = (target: EventTarget, init: KeyboardEventInit) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });

describe('useHotkeys: по e.code, набор не перехватывается', () => {
  it('Ctrl+K в русской раскладке (e.key = «л») срабатывает и гасит действие браузера', () => {
    const onK = vi.fn();
    render(<Keys onK={onK} onOne={() => {}} />);
    const ev = new KeyboardEvent('keydown', { key: 'л', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(ev); });
    expect(onK).toHaveBeenCalledOnce();
    expect(ev.defaultPrevented).toBe(true);
  });

  it('«1» в поле ввода — это набор, не клавиша; вне поля — клавиша', () => {
    const onOne = vi.fn();
    render(<Keys onK={() => {}} onOne={onOne} />);
    press(screen.getByLabelText('поле'), { key: '1', code: 'Digit1' });
    expect(onOne).not.toHaveBeenCalled();
    press(document.body, { key: '1', code: 'Numpad1' });
    expect(onOne).toHaveBeenCalledOnce();
  });

  it('Mod+K работает и из поля ввода (палитра открывается откуда угодно)', () => {
    const onK = vi.fn();
    render(<Keys onK={onK} onOne={() => {}} />);
    press(screen.getByLabelText('поле'), { key: 'k', code: 'KeyK', metaKey: true });
    expect(onK).toHaveBeenCalledOnce();
  });

  it('после размонтирования слушатель снят', () => {
    const onK = vi.fn();
    const { unmount } = render(<Keys onK={onK} onOne={() => {}} />);
    unmount();
    press(document.body, { code: 'KeyK', ctrlKey: true });
    expect(onK).not.toHaveBeenCalled();
  });
});

describe('installErrorScreen: window.onerror на экран без React', () => {
  it('ошибка вне React — role=alert с текстом в контейнере, повтор не плодит узлы', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const off = installErrorScreen(el, { lang: 'ru' });
    window.dispatchEvent(new ErrorEvent('error', { message: 'конфиг кривой', error: new Error('конфиг кривой') }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'второй', error: new Error('второй') }));
    const alerts = el.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);
    expect(alerts[0].textContent).toContain('Что-то сломалось');
    expect(alerts[0].textContent).toContain('второй');
    off();
    el.remove();
  });

  it('необработанный промис — тоже на экран; ResizeObserver-шум — нет', () => {
    const el = document.createElement('div');
    const off = installErrorScreen(el, { lang: 'en' });
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }));
    expect(el.querySelector('[role="alert"]')).toBeNull();
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
    ev.reason = new Error('fetch failed');
    window.dispatchEvent(ev);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('fetch failed');
    off();
  });

  it('текст ошибки — как текст, не как HTML; после снятия слушателей молчит', () => {
    const el = document.createElement('div');
    showErrorScreen(el, new Error('<img src=x onerror=alert(1)>'), 'ru');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x');
    const el2 = document.createElement('div');
    installErrorScreen(el2)();
    window.dispatchEvent(new ErrorEvent('error', { message: 'x', error: new Error('x') }));
    expect(el2.childElementCount).toBe(0);
  });
});
