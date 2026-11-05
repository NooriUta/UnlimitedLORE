import { useSyncExternalStore } from 'react';

// Узкий экран (телефон) админки: ≤760px — порог прототипа admin-v2 и прежней оболочки.
// Общий хук: оболочка и вкладки должны соглашаться, телефон сейчас или нет.
const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 760px)') : null;

export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    cb => { narrowQuery?.addEventListener('change', cb); return () => narrowQuery?.removeEventListener('change', cb); },
    () => narrowQuery?.matches ?? false,
  );
}
