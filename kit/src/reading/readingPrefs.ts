// Настройки режима чтения Seiðr-kit (SPRINT_UXR_S5_RECORD_TASKS/S5-05):
//   • size — размер текста (Aa), ступени шкалы --fs-*;
//   • rail — правая колонка (свойства) открыта; по умолчанию выключена
//     (D-2026-UXR-RAIL-OFF);
//   • collapseMenu — меню оболочки при чтении сворачивается; по умолчанию да,
//     пользователь переопределяет (D-2026-UXR-READ-COLLAPSE).
// Хранятся в SafeStorage (localStorage с откатом в память и честной плашкой).
// Серверное хранение личных настроек (D-2026-UXR-VIEWS-SERVER) — дорожка S2:
// когда эндпоинт появится, меняется только хранилище, формат тот же.
import type { SafeStorage } from '../resilience/safeStorage';

export type ReadSize = 's' | 'm' | 'l' | 'xl';

export interface ReadingPrefs {
  size: ReadSize;
  rail: boolean;
  collapseMenu: boolean;
}

/** Ступени Aa: id → токен шкалы (значение — только в seidr.css). */
export const READ_SIZES: readonly { id: ReadSize; token: string }[] = [
  { id: 's', token: 'var(--fs-base)' },
  { id: 'm', token: 'var(--fs-md)' },
  { id: 'l', token: 'var(--fs-lg)' },
  { id: 'xl', token: 'var(--fs-touch-input)' },
];

export const DEFAULT_READING_PREFS: ReadingPrefs = { size: 'm', rail: false, collapseMenu: true };

export const readingPrefsKey = (storageKey: string) => `${storageKey}.reading`;

function isSize(v: unknown): v is ReadSize {
  return READ_SIZES.some(s => s.id === v);
}

/** Чтение по полю: битое/чужое значение поля = умолчание этого поля. */
export function readReadingPrefs(storage: SafeStorage, storageKey: string): ReadingPrefs {
  const raw = storage.get(readingPrefsKey(storageKey));
  let v: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>;
    } catch {
      v = {};
    }
  }
  return {
    size: isSize(v.size) ? v.size : DEFAULT_READING_PREFS.size,
    rail: typeof v.rail === 'boolean' ? v.rail : DEFAULT_READING_PREFS.rail,
    collapseMenu: typeof v.collapseMenu === 'boolean' ? v.collapseMenu : DEFAULT_READING_PREFS.collapseMenu,
  };
}

export function writeReadingPrefs(storage: SafeStorage, storageKey: string, prefs: ReadingPrefs): void {
  storage.set(readingPrefsKey(storageKey), JSON.stringify(prefs));
}

/** Соседняя ступень Aa; на краю шкалы — остаёмся. */
export function stepReadSize(size: ReadSize, dir: 1 | -1): ReadSize {
  const i = READ_SIZES.findIndex(s => s.id === size);
  const j = Math.min(READ_SIZES.length - 1, Math.max(0, i + dir));
  return READ_SIZES[j].id;
}
