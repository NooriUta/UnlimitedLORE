// Хранилище браузера LORE v2 (SPRINT_UXR_S3_V2_INFRA/S3-08).
//
// v1 (корневой src/, сервис lore-app) живёт на том же ориджине и пишет в
// localStorage ключи без префикса (lore-palette, lore-mode, lore-theme, …).
// v1 заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN), поэтому разводимся со стороны
// v2: все его ключи — только `lore.v2.*`, а общая с v1 лишь cookie платформы
// `seer-prefs` (палитра/режим, тот же формат, что в src/theme/prefs.ts).
//
// Правило: к localStorage/sessionStorage/document.cookie в web-next/src
// обращается только этот каталог — гард в storage.test.ts.

export const V2_PREFIX = 'lore.v2.';
export const SHARED_PREFS_COOKIE = 'seer-prefs';

/** Ключи с префиксом другой версии или без имени — ошибка программиста, не данные. */
export function v2Key(name: string): string {
  if (!name || /^lore[.-]/.test(name)) {
    throw new Error(`v2Key: имя "${name}" должно быть коротким, без префикса lore.* / lore-*`);
  }
  return V2_PREFIX + name;
}

function browserStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export interface V2Storage {
  get(name: string): string | null;
  set(name: string, value: string): void;
  remove(name: string): void;
  getJson<T>(name: string): T | null;
  setJson(name: string, value: unknown): void;
}

/**
 * Обёртка над Storage с префиксом lore.v2.*. Недоступное хранилище (приватный
 * режим, квота, запрет) не роняет UI: чтение = null, запись — no-op.
 */
export function createV2Storage(storage: Storage | null = browserStorage()): V2Storage {
  const get = (name: string): string | null => {
    const key = v2Key(name);
    try { return storage?.getItem(key) ?? null; } catch { return null; }
  };
  const set = (name: string, value: string): void => {
    const key = v2Key(name);
    try { storage?.setItem(key, value); } catch { /* хранилище недоступно */ }
  };
  return {
    get,
    set,
    remove(name) {
      const key = v2Key(name);
      try { storage?.removeItem(key); } catch { /* хранилище недоступно */ }
    },
    getJson<T>(name: string): T | null {
      const raw = get(name);
      if (raw == null) return null;
      try { return JSON.parse(raw) as T; } catch { return null; }
    },
    setJson(name, value) { set(name, JSON.stringify(value)); },
  };
}

/** Сброс состояния v2 (например, при выходе): только lore.v2.*, v1 не трогается. */
export function clearV2(storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    const own: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(V2_PREFIX)) own.push(k);
    }
    own.forEach(k => storage.removeItem(k));
  } catch { /* хранилище недоступно */ }
}

// ── Общая cookie платформы seer-prefs ───────────────────────────────────────

export interface SharedPrefs { theme?: string; palette?: string }

export interface CookieJar { read(): string; write(cookie: string): void }

const documentJar: CookieJar = {
  read: () => (typeof document === 'undefined' ? '' : document.cookie),
  write: c => { if (typeof document !== 'undefined') document.cookie = c; },
};

export function readSharedPrefs(jar: CookieJar = documentJar): SharedPrefs {
  const m = jar.read().match(new RegExp(`(?:^|; )${SHARED_PREFS_COOKIE}=([^;]*)`));
  if (!m) return {};
  try { return JSON.parse(decodeURIComponent(m[1])) as SharedPrefs; }
  catch { return {}; }
}

/** Пишет патчем поверх прежнего — так же, как v1, чтобы обе версии видели одно. */
export function writeSharedPrefs(
  patch: SharedPrefs,
  jar: CookieJar = documentJar,
  hostname: string = typeof location === 'undefined' ? '' : location.hostname,
): void {
  const next = { ...readSharedPrefs(jar), ...patch };
  const h = hostname;
  // Домен не ставим для localhost и голых IP — браузер отвергнет такую cookie
  // целиком (та же проверка, что в v1 и в теме входа).
  const domain = (!h || h === 'localhost' || !h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h))
    ? '' : '; Domain=.' + h.split('.').slice(-3).join('.');
  jar.write(`${SHARED_PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}`
    + '; Path=/; Max-Age=31536000; SameSite=Lax' + domain);
}
