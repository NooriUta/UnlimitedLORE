import { useSyncExternalStore } from 'react';
import { kitT, type KitLang } from '../i18n';
import type { SafeStorage } from './safeStorage';

// Честная плашка «хранилище недоступно — отметки не сохранятся»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f). Пока хранилище настоящее — не рисуется.
export function StorageBanner({ storage, lang = 'ru' }: { storage: SafeStorage; lang?: KitLang }) {
  const persistent = useSyncExternalStore(
    storage.subscribe,
    () => storage.persistent,
    () => storage.persistent,
  );
  if (persistent) return null;
  return (
    <div role="status" className="sk-banner sk-banner--warn">
      {kitT(lang, 'kit.storage.unavailable')}
    </div>
  );
}
