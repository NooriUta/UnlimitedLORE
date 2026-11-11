// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STALE-CHUNK: вкладка, открытая до выкатки,
// просит чанк прежней сборки (ListPassport-BmWsPbZz.js) — его на сервере уже
// нет, ленивый импорт падает «Failed to fetch dynamically imported module».
// Лечение: одна автоматическая перезагрузка; повтор в течение минуты или
// сбой хранилища — не перезагружать вслепую, а показать плашку с кнопкой.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen } from '@testing-library/react';
import { createSafeStorage, KitLangProvider } from '@seidr/kit';
import { Suspense } from 'react';
import {
  createStaleChunkGuard, isStaleChunkError, STALE_RELOAD_KEY, STALE_WINDOW_MS,
  StaleChunkBanner,
} from './staleChunk';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf8');

function memoryBacking(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

function preloadEvent(message = 'Failed to fetch dynamically imported module: https://x/assets/ListPassport-BmWsPbZz.js') {
  const e = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
  e.payload = new TypeError(message);
  return e;
}

function setup(opts: { backing?: () => Storage | null; now?: number } = {}) {
  const backing = memoryBacking();
  const storage = createSafeStorage(opts.backing ?? (() => backing));
  let now = opts.now ?? 1_000_000;
  const reload = vi.fn();
  const guard = createStaleChunkGuard({ storage, now: () => now, reload });
  return { guard, storage, reload, backing, tick: (ms: number) => { now += ms; } };
}

describe('S4-STALE-CHUNK · распознавание ошибки устаревшего чанка', () => {
  it('ловит сообщения браузеров о несгруженном модуле и CSS, но не любую ошибку', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('S4-STALE-CHUNK · vite:preloadError → одна перезагрузка, потом плашка', () => {
  it('первая ошибка — reload один раз, метка времени в sessionStorage, ошибка погашена', () => {
    const { guard, reload, backing } = setup();
    const off = guard.install(window);
    const e = preloadEvent();
    window.dispatchEvent(e);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(backing.getItem(STALE_RELOAD_KEY)).toBe('1000000');
    expect(guard.stale).toBe(false);
    // Дубль той же ошибки до перезагрузки (Vite шлёт событие на каждый чанк) — без второго reload.
    window.dispatchEvent(preloadEvent());
    expect(reload).toHaveBeenCalledTimes(1);
    off();
  });

  it('повтор в пределах окна (после перезагрузки) — не reload, а плашка; ошибка не погашена', () => {
    const { storage, reload } = setup();
    storage.set(STALE_RELOAD_KEY, String(1_000_000 - 5_000));
    const guard = createStaleChunkGuard({ storage, now: () => 1_000_000, reload });
    const off = guard.install(window);
    const e = preloadEvent();
    window.dispatchEvent(e);
    expect(reload).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    expect(guard.stale).toBe(true);
    off();
  });

  it('прошлая перезагрузка старше окна — снова одна перезагрузка', () => {
    const { storage, reload } = setup();
    storage.set(STALE_RELOAD_KEY, String(1_000_000 - STALE_WINDOW_MS - 1));
    const guard = createStaleChunkGuard({ storage, now: () => 1_000_000, reload });
    const off = guard.install(window);
    window.dispatchEvent(preloadEvent());
    expect(reload).toHaveBeenCalledTimes(1);
    off();
  });

  it('хранилище недоступно (бросает) — не перезагружать вслепую, плашка', () => {
    const { guard, reload } = setup({ backing: () => { throw new Error('SecurityError'); } });
    const off = guard.install(window);
    window.dispatchEvent(preloadEvent());
    expect(reload).not.toHaveBeenCalled();
    expect(guard.stale).toBe(true);
    off();
  });

  it('хранилище отказало на записи метки — тоже плашка, не reload', () => {
    const backing = memoryBacking();
    let broken = false;
    const flaky: Storage = { ...backing, setItem: (k, v) => { if (broken) throw new Error('QuotaExceeded'); backing.setItem(k, v); }, getItem: backing.getItem, removeItem: backing.removeItem };
    const storage = createSafeStorage(() => flaky);
    broken = true;
    const reload = vi.fn();
    const guard = createStaleChunkGuard({ storage, now: () => 1, reload });
    expect(guard.handle(new TypeError('Failed to fetch dynamically imported module: x'))).toBe('banner');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('S4-STALE-CHUNK · ленивые разделы (React.lazy) доходят до обработчика', () => {
  it('упавший импорт без события Vite — тоже одна перезагрузка, раздел ждёт, а не падает', async () => {
    const { guard, reload } = setup();
    const loader = guard.wrap(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://x/a.js')));
    let settled = false;
    void loader().then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
  });

  it('событие Vite погашено перезагрузкой → импорт вернул undefined — раздел ждёт, не падает', async () => {
    const { guard } = setup();
    guard.handle(new TypeError('Failed to fetch dynamically imported module: x'));
    const loader = guard.wrap(() => Promise.resolve(undefined as unknown as { default: () => null }));
    let settled = false;
    void loader().then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
  });

  it('повтор в окне — раздел рисует «обновите страницу» вместо экрана ошибки', async () => {
    const { storage, reload } = setup();
    storage.set(STALE_RELOAD_KEY, String(999_999));
    const guard = createStaleChunkGuard({ storage, now: () => 1_000_000, reload });
    const Lazy = guard.lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: x')));
    await act(async () => {
      render(<KitLangProvider lang="ru"><Suspense fallback={null}><Lazy /></Suspense></KitLangProvider>);
    });
    expect(await screen.findByText(/Вышла новая версия LORE/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('чужая ошибка импорта не глотается — уходит дальше как есть', async () => {
    const { guard, reload } = setup();
    const loader = guard.wrap(() => Promise.reject(new Error('boom')));
    await expect(loader()).rejects.toThrow('boom');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('S4-STALE-CHUNK · плашка', () => {
  it('пока сборка свежая — не рисуется; после отказа — текст и кнопка, кнопка перезагружает', async () => {
    const { storage, reload } = setup();
    storage.set(STALE_RELOAD_KEY, String(999_999));
    const guard = createStaleChunkGuard({ storage, now: () => 1_000_000, reload });
    const { container } = render(<KitLangProvider lang="ru"><StaleChunkBanner guard={guard} /></KitLangProvider>);
    expect(container.textContent).toBe('');
    act(() => { guard.handle(new TypeError('Failed to fetch dynamically imported module: x')); });
    expect(screen.getByText(/Вышла новая версия LORE/)).toBeTruthy();
    act(() => { screen.getByRole('button', { name: 'Обновить страницу' }).click(); });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('S4-STALE-CHUNK · подключение', () => {
  it('main.tsx ставит обработчик до рендера; App рисует плашку вне ErrorBoundary', () => {
    expect(read('../main.tsx')).toMatch(/staleChunk\.install\(window\)/);
    expect(read('../App.tsx')).toMatch(/<StaleChunkBanner/);
  });

  it('ленивые разделы грузятся через lazyChunk, а не голый React.lazy', () => {
    for (const f of ['../App.tsx', '../pages/ListScreen.tsx', 'V2Shell.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/\blazy\(\s*\(\)\s*=>\s*import\(/);
      expect(src, f).toMatch(/lazyChunk\(\(\) => import\(/);
    }
  });

  it('метка перезагрузки — в sessionStorage через безопасную обёртку storage/safe', () => {
    expect(read('../storage/safe.ts')).toMatch(/createSafeStorage\(\(\) => globalThis\.sessionStorage\)/);
    expect(read('staleChunk.tsx')).toMatch(/from '\.\.\/storage\/safe'/);
  });
});
