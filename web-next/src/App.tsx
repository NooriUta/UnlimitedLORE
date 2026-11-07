// LORE v2 — оболочка нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01).
// Пока только каркас: каталог, сборка и образ. Навигация и экраны v2 приходят
// своими задачами UXR; v1 (корневой src/) заморожен и отсюда не импортируется.
// Токены, тема и общие элементы — из Seiðr-kit (kit/, D-2026-UXR-KIT-REACT,
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a, S4-00b): своей копии web-next не держит.
// /kit — витрина kit (S4-00d); маршрут — путь URL, без роутера: экран один.
// Устойчивость (ошибка на экран, плашка хранилища) — S4-00f.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/unbounded/800.css';
import '@seidr/kit/styles/seidr.css';
import { lazy, Suspense } from 'react';
import { ErrorBoundary, Pill, Skeleton, StorageBanner, resolvePrefs, useKitLang } from '@seidr/kit';
import './App.css';
import { createLocalS2Client } from './api/me';
import { AccountMenu } from './settings/AccountMenu';
import { storage } from './storage/safe';
import { themeSource } from './storage/themeSource';

// Витрина тянет MD/HTML-элементы (TipTap, mermaid, bpmn-js — мегабайты):
// отдельный чанк, чтобы оболочка v2 за них не платила.
const KitPage = lazy(() => import('./pages/KitPage'));

// Личное пользователя (/lore/me/*, контракт S2) — до S2-04 на заглушке с
// хранением в браузере (S4-02). Первый раз — с темой, выбранной в v1/seer-prefs.
const initialTheme = resolvePrefs(themeSource());
const meClient = createLocalS2Client(storage, {
  seed: { palette: initialTheme.palette, mode: initialTheme.mode, density: initialTheme.density },
});

/** Путь без хвостового «/»: /kit и /kit/ — одна страница. */
export function routeOf(path: string): 'kit' | 'home' {
  return path.replace(/\/+$/, '') === '/kit' ? 'kit' : 'home';
}

export default function App({ path }: { path?: string } = {}) {
  const lang = useKitLang();
  const current = path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  if (routeOf(current) === 'kit') return <Suspense fallback={<Skeleton />}><KitPage /></Suspense>;
  return (
    <ErrorBoundary lang="ru">
      <StorageBanner storage={storage} lang="ru" />
      <main data-lore-app="v2" className="shell">
        <h1 className="shell-title">LORE</h1>
        <Pill variant="id">v2</Pill>
        <a className="shell-link" href="/kit">Seiðr-kit</a>
        {/* S4-02: личные настройки (и флаг «новая навигация», S3-07) — под аватаром. */}
        <div className="shell-account"><AccountMenu client={meClient} lang={lang} /></div>
      </main>
    </ErrorBoundary>
  );
}
