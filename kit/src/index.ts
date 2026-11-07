// Seiðr-kit — публичный вход пакета @seidr/kit (D-2026-UXR-KIT-REACT).
export { kitT, type KitKey, type KitLang } from './i18n';
export { matchHotkey, parseHotkey, type HotkeySpec, type KeyLike } from './resilience/hotkeys';
export { createSafeStorage, type SafeStorage } from './resilience/safeStorage';
export { StorageBanner } from './resilience/StorageBanner';
export { ErrorBoundary } from './resilience/ErrorBoundary';
export { pushUrlState, readUrlState, type UrlWindow } from './resilience/urlState';
