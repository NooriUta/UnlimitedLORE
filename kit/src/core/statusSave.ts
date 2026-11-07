// Хуки сохранения (SPRINT_UXR_S10_SEIDR_KIT/K-05). По умолчанию правки ложатся
// в localStorage (через createSafeStorage фазы A: при недоступном хранилище —
// память и persistent=false, StorageBanner говорит об этом честно). Приложение
// с сервером подменяет сохранение своим hooks.onSave — тогда локальное не
// трогается. Любое сохранение — Promise: отказ = откат в UI (useStatusChange).
import { createSafeStorage, type SafeStorage } from '../resilience/safeStorage';
import type { KitHooks, KitRecord } from './contract';

export type KitChange = Parameters<NonNullable<KitHooks['onSave']>>[0];
export type KitSaveFn = (change: KitChange) => Promise<void>;

export const LOCAL_SAVE_KEY = 'seidr.kit.edits';

type Overrides = Record<string, Record<string, unknown>>;

export interface LocalSave {
  save: KitSaveFn;
  /** Накопленные правки: {id: {field: value}}. */
  read(): Overrides;
  /** Наложить правки на записи (status — в поле записи, прочее — в fields). */
  apply(records: KitRecord[]): KitRecord[];
  clear(): void;
  /** false — правки живут в памяти и не переживут перезагрузку. */
  readonly persistent: boolean;
  readonly storage: SafeStorage;
}

export interface LocalSaveOptions {
  key?: string;
  storage?: SafeStorage;
  getBacking?: () => Storage | null | undefined;
}

export function createLocalSave(opts: LocalSaveOptions = {}): LocalSave {
  const key = opts.key ?? LOCAL_SAVE_KEY;
  const storage = opts.storage ?? createSafeStorage(opts.getBacking);

  const read = (): Overrides => {
    const raw = storage.get(key);
    if (!raw) return {};
    try {
      const v: unknown = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Overrides) : {};
    } catch {
      return {};
    }
  };

  return {
    async save(change) {
      const all = read();
      all[change.id] = { ...all[change.id], [change.field]: change.to };
      storage.set(key, JSON.stringify(all));
    },
    read,
    apply(records) {
      const all = read();
      return records.map((r) => {
        const o = all[r.id];
        if (!o) return r;
        const { status, ...rest } = o;
        return {
          ...r,
          ...(status !== undefined ? { status: String(status) } : {}),
          fields: { ...r.fields, ...rest },
        };
      });
    },
    clear() {
      storage.remove(key);
    },
    get persistent() {
      return storage.persistent;
    },
    storage,
  };
}

let defaultLocal: LocalSave | null = null;

/** Общее локальное сохранение по умолчанию (создаётся при первом обращении). */
export function defaultLocalSave(): LocalSave {
  defaultLocal ??= createLocalSave();
  return defaultLocal;
}

/** API (hooks.onSave), если приложение его дало; иначе — локальное. */
export function resolveSave(hooks?: KitHooks, local: LocalSave = defaultLocalSave()): KitSaveFn {
  return hooks?.onSave ?? local.save;
}
