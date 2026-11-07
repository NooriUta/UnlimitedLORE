// Seiðr-kit (@seidr/kit) — общие токены, тема и элементы UI на React
// (SPRINT_UXR_S10_SEIDR_KIT, D-2026-UXR-KIT-REACT). CSS-слой подключается
// отдельно: `import '@seidr/kit/styles/seidr.css'` (или <link> в голом HTML).
export * from './tokens/prefs';
export * from './elements';
export * from './i18n';
export * from './states';
export * from './shell';
// Контракт ядра (типы, без кода) — и отсюда; хуки вида — `@seidr/kit/core`.
export type * from './core/contract';
// MD/HTML-элементы (TipTapField, MartProse, SandboxedHtmlFrame, S4-00d) — НЕ
// отсюда, а отдельной точкой входа `@seidr/kit/content`: они тянут TipTap,
// mermaid и bpmn-js, и экрану без MD-полей платить за них незачем.
export { matchHotkey, parseHotkey, type HotkeySpec, type KeyLike } from './resilience/hotkeys';
export { createSafeStorage, type SafeStorage } from './resilience/safeStorage';
export { StorageBanner } from './resilience/StorageBanner';
export { ErrorBoundary } from './resilience/ErrorBoundary';
export { pushUrlState, readUrlState, type UrlWindow } from './resilience/urlState';
