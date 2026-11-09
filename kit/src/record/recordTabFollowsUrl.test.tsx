// @vitest-environment jsdom
// Вкладка записи следует за адресом, а не только пишет в него
// (аудит 09.11, находки D-21 и D-24 · SPRINT_UXR_S4_UI_SHELL_LISTS/S4-28).
//
// `useRecordTab` писал вкладку в `?tab=`, но читал адрес ОДИН РАЗ, при первом
// показе. Следствия — две находки аудита:
//
//   • **D-24:** «Back/Forward не управляют доком». Нажали «назад» — адрес
//     вернулся к прежней вкладке, а на экране осталась текущая. Состояние и
//     адрес расходятся молча, и это хуже, чем если бы вкладка в адресе не
//     жила вовсе: ссылка обещает одно, экран показывает другое.
//   • **D-21** («вкладки не живут в URL») — вторая половина: сам потребитель,
//     паспорт v2, хук не использовал и держал вкладку местным состоянием. Это
//     исправлено на стороне приложения.
//
// Хук обещает в своей шапке «состояние живёт в URL». Обещание выполняется
// только если за адресом следить: «назад», «вперёд» и правка адреса руками.
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRecordTab } from './useRecordTab';
import type { UrlWindow } from '../resilience/urlState';

/** Окно с настоящими слушателями: popstate и hashchange надо проверить. */
function fakeWin(search = '') {
  const listeners = new Map<string, Set<() => void>>();
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
      replaceState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
    },
    addEventListener: (type: string, cb: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: () => void) => { listeners.get(type)?.delete(cb); },
  };
  function apply(url: string) {
    const s = url.includes('?') ? url.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
    w.location.search = s;
  }
  /** «Назад»: браузер меняет адрес и шлёт popstate. */
  const back = (toSearch: string) => {
    w.location.search = toSearch;
    for (const cb of listeners.get('popstate') ?? []) cb();
  };
  const hashChange = (toHash: string) => {
    w.location.hash = toHash;
    for (const cb of listeners.get('hashchange') ?? []) cb();
  };
  return { win: w as unknown as UrlWindow, back, hashChange, listeners };
}

describe('D-21/D-24 · вкладка записи и адрес не расходятся', () => {
  it('положительный контроль: вкладка из адреса берётся при первом показе', () => {
    const { win } = fakeWin('?tab=history');
    const { result } = renderHook(() => useRecordTab('overview', win));
    expect(result.current[0]).toBe('history');
  });

  it('выбор вкладки пишется в адрес — ссылкой можно поделиться', () => {
    const { win } = fakeWin();
    const { result } = renderHook(() => useRecordTab('overview', win));
    act(() => { result.current[1]('links'); });
    expect(win.location.search).toContain('tab=links');
  });

  it('«назад» возвращает прежнюю вкладку НА ЭКРАНЕ, а не только в адресе', () => {
    const { win, back } = fakeWin('?tab=overview');
    const { result } = renderHook(() => useRecordTab('overview', win));
    act(() => { result.current[1]('graph'); });
    expect(result.current[0]).toBe('graph');
    act(() => { back('?tab=overview'); });
    expect(result.current[0]).toBe('overview');
  });

  it('«вперёд» работает так же: это тот же popstate', () => {
    const { win, back } = fakeWin('?tab=overview');
    const { result } = renderHook(() => useRecordTab('overview', win));
    act(() => { back('?tab=journal'); });
    expect(result.current[0]).toBe('journal');
  });

  it('параметр убрали из адреса руками — возвращаемся к умолчанию, а не застываем', () => {
    const { win, back } = fakeWin('?tab=links');
    const { result } = renderHook(() => useRecordTab('overview', win));
    expect(result.current[0]).toBe('links');
    act(() => { back(''); });
    expect(result.current[0]).toBe('overview');
  });

  it('фолбэк в «#» тоже отслеживается: там, где pushState запрещён, живёт hash', () => {
    const { win, hashChange } = fakeWin();
    const { result } = renderHook(() => useRecordTab('overview', win));
    act(() => { hashChange('#tab=props'); });
    expect(result.current[0]).toBe('props');
  });

  it('слушатели снимаются при размонтировании — иначе они копятся на каждой записи', () => {
    const { win, listeners } = fakeWin();
    const { unmount } = renderHook(() => useRecordTab('overview', win));
    expect(listeners.get('popstate')?.size).toBe(1);
    unmount();
    expect(listeners.get('popstate')?.size).toBe(0);
  });
});
