// Устаревший чанк после выкатки (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STALE-CHUNK).
//
// Вкладка, открытая на прежней сборке, при переходе в ленивый раздел просит
// чанк со старым хэшем (ListPassport-BmWsPbZz.js). После выкатки его на сервере
// нет — ленивый импорт падает «Failed to fetch dynamically imported module».
// Лечится только загрузкой новой index.html, то есть перезагрузкой.
//
// Правило:
//  · первая такая ошибка — ОДНА автоматическая перезагрузка, метка времени
//    в sessionStorage (через безопасную обёртку storage/safe);
//  · повтор в течение STALE_WINDOW_MS после перезагрузки — не перезагружать
//    (петля), а показать плашку «Вышла новая версия LORE — обновите страницу»;
//  · хранилище недоступно — метка не переживёт перезагрузку, значит и
//    перезагружать вслепую нельзя: сразу плашка.
//
// Ловим двумя путями, потому что ни один не покрывает всё:
//  · window 'vite:preloadError' — Vite шлёт его из обёртки __vitePreload;
//  · обёртка импорта в lazyChunk — для импортов без той обёртки и чтобы
//    раздел не падал на экран ошибки, а ждал перезагрузки или звал обновиться.
// Это приложение, а не kit: граница K-14.
import { lazy as reactLazy, useSyncExternalStore, type ComponentType, type LazyExoticComponent } from 'react';
import type { SafeStorage } from '@seidr/kit';
import { useAppT } from '../i18n';
import { sessionStore } from '../storage/safe';

export const STALE_RELOAD_KEY = 'lore-v2.stale-chunk.reloaded-at';
/** Окно, в котором повторная ошибка считается «перезагрузка не помогла». */
export const STALE_WINDOW_MS = 60_000;

const STALE_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (?:CSS )?chunk [\w-]+ failed|ChunkLoadError/i;

/** Ошибка «модуля/чанка нет на сервере» (тексты Chromium, WebKit, Firefox и Vite). */
export function isStaleChunkError(err: unknown): boolean {
  if (err == null) return false;
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return STALE_RE.test(msg);
}

export type StaleOutcome = 'reload' | 'banner';

export interface StaleChunkDeps {
  storage: SafeStorage;
  now: () => number;
  reload: () => void;
}

type AnyComponent = ComponentType<any>;

export interface StaleChunkGuard {
  /** Обработать ошибку устаревшего чанка: перезагрузить или поднять плашку. */
  handle(err?: unknown): StaleOutcome;
  /** true — перезагрузка не помогла или невозможна, нужна плашка. */
  readonly stale: boolean;
  subscribe(listener: () => void): () => void;
  /** Ручная перезагрузка по кнопке плашки (без защиты — её жмёт человек). */
  reloadNow(): void;
  /** Слушать window 'vite:preloadError'; возвращает отписку. */
  install(win: Window): () => void;
  /** Обёртка фабрики импорта: устаревший чанк не роняет раздел. */
  wrap<T extends AnyComponent>(factory: () => Promise<{ default: T }>): () => Promise<{ default: T }>;
  /** React.lazy поверх wrap. */
  lazy<T extends AnyComponent>(factory: () => Promise<{ default: T }>): LazyExoticComponent<T>;
}

const never = <T,>() => new Promise<T>(() => {});

export function createStaleChunkGuard(deps: StaleChunkDeps): StaleChunkGuard {
  let state: 'idle' | 'reloading' | 'stale' = 'idle';
  // Подмена раздела, чей чанк не загрузился: «вышла новая версия — обновите».
  const Notice = () => <StaleNoticeBody onReload={() => guard.reloadNow()} />;
  const listeners = new Set<() => void>();
  const toStale = (): StaleOutcome => {
    if (state !== 'stale') {
      state = 'stale';
      listeners.forEach((l) => l());
    }
    return 'banner';
  };

  const guard: StaleChunkGuard = {
    handle() {
      if (state === 'reloading') return 'reload';
      if (state === 'stale') return 'banner';
      const { storage } = deps;
      // Хранилище в памяти — метка не переживёт перезагрузку: петля. Не рискуем.
      if (!storage.persistent) return toStale();
      const last = Number(storage.get(STALE_RELOAD_KEY));
      const now = deps.now();
      if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < STALE_WINDOW_MS) return toStale();
      storage.set(STALE_RELOAD_KEY, String(now));
      // Запись могла уронить хранилище в память (квота, запрет) — тот же случай.
      if (!storage.persistent || storage.get(STALE_RELOAD_KEY) !== String(now)) return toStale();
      state = 'reloading';
      deps.reload();
      return 'reload';
    },
    get stale() {
      return state === 'stale';
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reloadNow() {
      deps.reload();
    },
    install(win) {
      const onPreloadError = (e: Event) => {
        const payload = (e as Event & { payload?: unknown }).payload;
        if (payload !== undefined && !isStaleChunkError(payload)) return;
        // Погашенная ошибка у Vite значит «импорт вернёт undefined»: гасим её
        // только когда сейчас перезагрузимся. На плашке — пусть летит дальше,
        // wrap() нарисует в разделе «обновите страницу».
        if (guard.handle(payload) === 'reload') e.preventDefault();
      };
      win.addEventListener('vite:preloadError', onPreloadError);
      return () => win.removeEventListener('vite:preloadError', onPreloadError);
    },
    wrap<T extends AnyComponent>(factory: () => Promise<{ default: T }>) {
      return () => factory().then(
        (mod) => {
          // Vite погасил ошибку (мы перезагружаемся) и вернул undefined — ждём.
          if (mod == null) return state === 'reloading' ? never<{ default: T }>() : { default: Notice as unknown as T };
          return mod;
        },
        (err: unknown) => {
          if (!isStaleChunkError(err)) throw err;
          if (guard.handle(err) === 'reload') return never<{ default: T }>();
          return { default: Notice as unknown as T };
        },
      );
    },
    lazy(factory) {
      return reactLazy(guard.wrap(factory));
    },
  };
  return guard;
}

/** Охрана приложения: метка — в sessionStorage вкладки, перезагрузка — настоящая. */
export const staleChunk = createStaleChunkGuard({
  storage: sessionStore,
  now: () => Date.now(),
  reload: () => { globalThis.location?.reload(); },
});

/** React.lazy для разделов v2: устаревший чанк → перезагрузка или «обновите страницу». */
export function lazyChunk<T extends AnyComponent>(factory: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return staleChunk.lazy(factory);
}

function StaleNoticeBody({ onReload }: { onReload: () => void }) {
  const t = useAppT();
  return (
    <div role="alert" className="sk-banner sk-banner--warn v2-stale-chunk">
      <span>{t('stale.banner')}</span>{' '}
      <button type="button" className="sk-btn" onClick={onReload}>{t('stale.reload')}</button>
    </div>
  );
}

/** Плашка над оболочкой: пока сборка свежая — ничего не рисует. */
export function StaleChunkBanner({ guard = staleChunk }: { guard?: StaleChunkGuard }) {
  const stale = useSyncExternalStore(guard.subscribe, () => guard.stale, () => guard.stale);
  if (!stale) return null;
  return <StaleNoticeBody onReload={() => guard.reloadNow()} />;
}
