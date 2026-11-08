// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f, шаг 4: состояние в URL с фолбэком на «#».
// history.pushState бросает в песочнице (iframe без allow-same-origin),
// на file:// и при частых вызовах (Safari/Chrome режут лимитом) — выбор
// вкладки не должен теряться и не должен ронять приложение.
import { describe, expect, it } from 'vitest';
import { pushUrlState, readUrlState, urlStateHref, type UrlWindow } from './urlState';

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

// SPRINT_UXR_S10_SEIDR_KIT/K-06: снятие параметра в режиме «#» обязано
// перекрыть query — иначе старое значение из ?tab=… «воскресает» при чтении.
describe('K-06 · состояние в «#»: снятие параметра', () => {
  it('pushState бросает, параметр есть в query — после снятия readUrlState его не видит', () => {
    const { w } = fakeWindow({ throwOnPush: true, search: '?section=admin&tab=rules' });
    expect(pushUrlState({ tab: null }, { win: w })).toBe('hash');
    expect(readUrlState(w).get('tab')).toBeNull();
    expect(readUrlState(w).get('section')).toBe('admin');
  });

  it('следующая запись в «#» после снятия держит и новое, и снятое', () => {
    const { w } = fakeWindow({ throwOnPush: true, search: '?tab=rules' });
    pushUrlState({ tab: null }, { win: w });
    pushUrlState({ sel: 'K-06' }, { win: w });
    const p = readUrlState(w);
    expect(p.get('tab')).toBeNull();
    expect(p.get('sel')).toBe('K-06');
  });
});

// ── адрес строкой и снятие якоря (находки P1 аудита 08.11.2026) ───────────────
// «Пункты — кнопки, 0 <a href>»: чтобы пункт стал ссылкой, адрес нужно знать до
// перехода — urlStateHref. «Кнопка "← Спринты" док закрывает, но в адресе
// остаются place=bottom#SPRINT_…»: оставшийся якорь не косметика — по такому
// адресу запись откроется снова.
describe('адрес строкой и якорь', () => {
  it('положительный контроль: адрес ссылки совпадает с тем, что запишет переход', () => {
    const { w, pushed } = fakeWindow({ search: '?sec=sprint' });
    const href = urlStateHref(w, { sec: 'adr' });
    pushUrlState({ sec: 'adr' }, { win: w });
    expect(pushed).toEqual([href]);
  });

  it('якорь сохраняется по умолчанию — «#top» это закладка на месте в тексте', () => {
    const { w } = fakeWindow({ search: '?sec=sprint', hash: '#top' });
    expect(urlStateHref(w, { sec: 'adr' })).toBe('/lore?sec=adr#top');
  });

  it('anchor: null снимает якорь — мусор после выхода из дока', () => {
    const { w } = fakeWindow({ search: '?open=S-1&place=bottom', hash: '#S-1/S4-01' });
    expect(urlStateHref(w, { open: null, place: null }, { anchor: null })).toBe('/lore');
  });

  it('переход тоже умеет снимать якорь', () => {
    const { w, pushed } = fakeWindow({ search: '?open=S-1&place=bottom', hash: '#S-1' });
    pushUrlState({ open: null, place: null }, { win: w, anchor: null });
    expect(pushed).toEqual(['/lore']);
  });

  it('параметры из «#» уже слиты в query — второй раз якорем не приклеиваются', () => {
    const { w } = fakeWindow({ search: '', hash: '#sec=adr' });
    expect(urlStateHref(w, { tab: 'x' })).toBe('/lore?sec=adr&tab=x');
  });
});
