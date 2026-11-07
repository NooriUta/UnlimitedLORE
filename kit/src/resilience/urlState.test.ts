// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f, шаг 4: состояние в URL с фолбэком на «#».
// history.pushState бросает в песочнице (iframe без allow-same-origin),
// на file:// и при частых вызовах (Safari/Chrome режут лимитом) — выбор
// вкладки не должен теряться и не должен ронять приложение.
import { describe, expect, it } from 'vitest';
import { pushUrlState, readUrlState, type UrlWindow } from './urlState';

function fakeWindow(opts: { throwOnPush?: boolean; search?: string; hash?: string } = {}) {
  const pushed: string[] = [];
  const w: UrlWindow = {
    location: { pathname: '/lore', search: opts.search ?? '', hash: opts.hash ?? '' },
    history: {
      pushState: (_s: unknown, _t: string, url?: string | URL | null) => {
        if (opts.throwOnPush) throw new DOMException('denied', 'SecurityError');
        const u = new URL(String(url), 'http://x');
        w.location.search = u.search;
        w.location.hash = u.hash;
        pushed.push(String(url));
      },
      replaceState: (_s: unknown, _t: string, url?: string | URL | null) => {
        if (opts.throwOnPush) throw new DOMException('denied', 'SecurityError');
        const u = new URL(String(url), 'http://x');
        w.location.search = u.search;
        pushed.push(String(url));
      },
    },
  };
  return { w, pushed };
}

describe('состояние в URL', () => {
  it('обычный путь — history.pushState c query', () => {
    const { w, pushed } = fakeWindow({ search: '?section=admin' });
    expect(pushUrlState({ tab: 'rules' }, { win: w })).toBe('history');
    expect(pushed).toEqual(['/lore?section=admin&tab=rules']);
    expect(readUrlState(w).get('tab')).toBe('rules');
  });

  it('pushState бросает — состояние уходит в «#», без исключения', () => {
    const { w } = fakeWindow({ throwOnPush: true, search: '?section=admin' });
    let mode: string | undefined;
    expect(() => { mode = pushUrlState({ tab: 'rules' }, { win: w }); }).not.toThrow();
    expect(mode).toBe('hash');
    expect(w.location.hash).toBe('#section=admin&tab=rules');
  });

  it('чтение: значения из «#» перекрывают query (после фолбэка они свежее)', () => {
    const { w } = fakeWindow({ search: '?tab=old&section=admin', hash: '#tab=new' });
    const p = readUrlState(w);
    expect(p.get('tab')).toBe('new');
    expect(p.get('section')).toBe('admin');
  });

  it('null снимает параметр; якорь без «=» (#top) параметром не считается', () => {
    const { w, pushed } = fakeWindow({ search: '?tab=x&sel=1', hash: '#top' });
    pushUrlState({ sel: null }, { win: w });
    expect(pushed[0]).toBe('/lore?tab=x#top');
    expect([...readUrlState(fakeWindow({ hash: '#top' }).w).keys()]).toEqual([]);
  });
});
