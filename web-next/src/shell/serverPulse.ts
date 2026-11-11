// Свежесть для строки состояния (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21, ответ
// владелицы 7а): когда сервер LORE ответил в последний раз и не отказал ли.
//
// Источник — сами запросы к /lore/*: обёртка над fetch запоминает время ответа
// по заголовку Date сервера (часы браузера — только если заголовка нет).
// «Ещё не спрашивали», «ответил в …» и «не ответил в …» — три разных состояния:
// сбой не выдаётся за свежесть, отсутствие запросов — за сбой.

export interface PulseState {
  /** Время последнего успешного ответа (мс). */
  okAt?: number;
  /** Время последнего отказа: сеть, 5xx (мс). */
  failAt?: number;
}

export interface ServerPulse {
  get(): PulseState;
  subscribe(fn: () => void): () => void;
  /** Обёртка над fetch: учитывает только запросы к /lore/. */
  wrap(base: typeof fetch): typeof fetch;
}

const urlOf = (input: unknown): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? '';

const isLore = (u: string) => {
  try { return new URL(u, 'http://x').pathname.startsWith('/lore/'); } catch { return false; }
};

export function createServerPulse(): ServerPulse {
  let state: PulseState = {};
  const subs = new Set<() => void>();
  const set = (patch: PulseState) => { state = { ...state, ...patch }; subs.forEach(f => f()); };
  return {
    get: () => state,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    wrap(base) {
      return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const u = urlOf(input);
        if (!isLore(u)) return base(input, init);
        try {
          const res = await base(input, init);
          if (res.status >= 500) set({ failAt: Date.now() });
          else {
            const d = Date.parse(res.headers.get('date') ?? '');
            set({ okAt: Number.isNaN(d) ? Date.now() : d });
          }
          return res;
        } catch (e) {
          // Прерванный запрос (уход со страницы) — не сбой сервера.
          if (!(e instanceof DOMException && e.name === 'AbortError')) set({ failAt: Date.now() });
          throw e;
        }
      }) as typeof fetch;
    },
  };
}

/** Один на приложение; ставится в main.tsx поверх глобального fetch. */
export const serverPulse = createServerPulse();

let installed = false;
export function installServerPulse(win: { fetch: typeof fetch } = globalThis): void {
  if (installed) return;
  installed = true;
  win.fetch = serverPulse.wrap(win.fetch.bind(win));
}
