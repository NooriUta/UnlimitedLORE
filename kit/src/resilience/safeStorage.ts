// Хранилище браузера с откатом в память (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f).
// localStorage бросает в приватном режиме, в песочнице iframe, при квоте и
// даже на сам доступ к window.localStorage. Вместо падения — Map в памяти и
// флаг persistent=false, по которому StorageBanner честно говорит, что
// отметки не переживут перезагрузку. Молчаливой подмены нет.

export interface SafeStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** false — работаем в памяти, после перезагрузки всё пропадёт. */
  readonly persistent: boolean;
  /** Оповещение о смене persistent; возвращает отписку. */
  subscribe(listener: () => void): () => void;
}

const PROBE = '__seidr_probe__';

function defaultBacking(): Storage | null | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

export function createSafeStorage(
  getBacking: () => Storage | null | undefined = defaultBacking,
): SafeStorage {
  const memory = new Map<string, string>();
  const listeners = new Set<() => void>();
  let backing: Storage | null = null;

  try {
    const b = getBacking();
    if (b) {
      b.setItem(PROBE, '1');
      b.removeItem(PROBE);
      backing = b;
    }
  } catch {
    backing = null;
  }

  const degrade = () => {
    if (!backing) return;
    backing = null;
    listeners.forEach((l) => l());
  };

  return {
    get(key) {
      if (memory.has(key)) return memory.get(key)!;
      if (!backing) return null;
      try {
        return backing.getItem(key);
      } catch {
        degrade();
        return null;
      }
    },
    set(key, value) {
      if (backing) {
        try {
          backing.setItem(key, value);
          return;
        } catch {
          degrade();
        }
      }
      memory.set(key, value);
    },
    remove(key) {
      memory.delete(key);
      if (!backing) return;
      try {
        backing.removeItem(key);
      } catch {
        degrade();
      }
    },
    get persistent() {
      return backing !== null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
