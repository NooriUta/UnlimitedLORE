// Навигация из «Недавнего» (жалоба с прода v1.17.9: клик по пункту меню не
// вёл никуда — URL не менялся, паспорт не открывался, порядок пунктов
// перестраивался). Разбор и порядок навигации — в recentNav.ts.
import { describe, expect, it, vi } from 'vitest';
import { createSafeStorage, type KitShellApi, type UrlWindow } from '@seidr/kit';
import { SHELL_STORAGE_KEY, openRecent, recentSectionOf } from './recentNav';

const mem = () => {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
};

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => w.history.pushState(null, '', url),
    },
  };
  return w;
}

describe('раздел записи из сохранённого адреса (recentSectionOf)', () => {
  it('адрес есть — раздел читается из него', () => {
    const st = mem();
    st.set(`${SHELL_STORAGE_KEY}.recentMeta`, JSON.stringify({
      'SPRINT_A': { title: 'Спринт А', href: '/?mod=forseti&sec=sprint&open=SPRINT_A' },
      'OMILORE': { title: 'Backoffice Platform OMILORE', href: '/?sec=component&open=OMILORE' },
    }));
    expect(recentSectionOf(st, 'SPRINT_A')).toBe('sprint');
    expect(recentSectionOf(st, 'OMILORE')).toBe('component');
  });

  it('адреса нет, раздел не раздел записей или open чужой — вести некуда, null', () => {
    const st = mem();
    st.set(`${SHELL_STORAGE_KEY}.recentMeta`, JSON.stringify({
      'X-1': { title: 'Без адреса' },
      'N-1': { title: 'Новость', href: '/?mod=forseti&sec=news&open=N-1' },
      'B-1': { title: 'Чужой open', href: '/?sec=task&open=OTHER' },
    }));
    expect(recentSectionOf(st, 'X-1')).toBeNull();
    expect(recentSectionOf(st, 'N-1')).toBeNull();
    expect(recentSectionOf(st, 'B-1')).toBeNull();
  });
});

describe('openRecent — навигация по клику из «Недавнего»', () => {
  it('раздел — через navigate оболочки, ?open= — заменой текущей записи истории', () => {
    const st = mem();
    st.set(`${SHELL_STORAGE_KEY}.recentMeta`, JSON.stringify({
      'SPRINT_A': { title: 'Спринт А', href: '/?mod=forseti&sec=sprint&open=SPRINT_A' },
    }));
    const win = fakeWin('?mod=forseti&sec=task&open=SPRINT_X%2FT-1&place=bottom');
    // Как настоящий KitShell.navigate: меняет состояние И пишет адрес
    // (kit/src/shell/KitShell.tsx) — иначе pushUrlState ниже лишь допишет
    // open к прежнему разделу, и адрес разойдётся с навигацией.
    const navigate = vi.fn((patch: { item?: string; view?: string | null }) => {
      const p = new URLSearchParams(win.location.search);
      if (patch.item != null) p.set('sec', patch.item);
      if (patch.view === null) p.delete('view');
      win.location.search = `?${p.toString()}`;
    });
    const api = { win, navigate } as unknown as KitShellApi;
    expect(openRecent(api, st, 'SPRINT_A')).toBe(true);
    expect(navigate).toHaveBeenCalledWith({ item: 'sprint', view: null });
    const p = new URLSearchParams(win.location.search);
    expect(p.get('sec')).toBe('sprint');
    expect(p.get('open')).toBe('SPRINT_A');
    // Место (place) прежней записи в адресе не осталось.
    expect(p.get('place')).toBeNull();
  });

  it('адреса записи нет — честный false: navigate не зовём, навигации нет', () => {
    const st = mem();
    st.set(`${SHELL_STORAGE_KEY}.recentMeta`, JSON.stringify({ 'GONE_1': { title: 'Без адреса' } }));
    const win = fakeWin('?mod=forseti&sec=task');
    const navigate = vi.fn();
    const api = { win, navigate } as unknown as KitShellApi;
    expect(openRecent(api, st, 'GONE_1')).toBe(false);
    expect(openRecent(api, st, 'UNKNOWN')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(win.location.search).toBe('?mod=forseti&sec=task');
  });

  it('запись этого раздела уже открыта — false без навигации: палитра зовёт api.openRecord сама, второй проход обязан быть пустым', () => {
    const st = mem();
    st.set(`${SHELL_STORAGE_KEY}.recentMeta`, JSON.stringify({
      'SPRINT_A': { title: 'Спринт А', href: '/?mod=forseti&sec=sprint&open=SPRINT_A' },
    }));
    const win = fakeWin('?mod=forseti&sec=sprint&open=SPRINT_A');
    const navigate = vi.fn();
    const api = { win, navigate } as unknown as KitShellApi;
    expect(openRecent(api, st, 'SPRINT_A')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(win.location.search).toBe('?mod=forseti&sec=sprint&open=SPRINT_A');
  });
});
