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
import { ErrorBoundary, Pill, Skeleton, StorageBanner } from '@seidr/kit';
import './App.css';
import { PersonalSettings } from './settings/PersonalSettings';
import { storage } from './storage/safe';

// Витрина тянет MD/HTML-элементы (TipTap, mermaid, bpmn-js — мегабайты):
// отдельный чанк, чтобы оболочка v2 за них не платила.
const KitPage = lazy(() => import('./pages/KitPage'));
// Демо kit на фикстурах (SPRINT_UXR_S10_SEIDR_KIT/K-03): /kit/demo/lore, /kit/demo/datawanderers.
const KitDemoPage = lazy(() => import('./pages/KitDemoPage'));

export type Route = 'kit' | 'kit-demo-lore' | 'kit-demo-datawanderers' | 'home';

/** Путь без хвостового «/»: /kit и /kit/ — одна страница. */
export function routeOf(path: string): Route {
  const p = path.replace(/\/+$/, '');
  if (p === '/kit') return 'kit';
  if (p === '/kit/demo/lore') return 'kit-demo-lore';
  if (p === '/kit/demo/datawanderers') return 'kit-demo-datawanderers';
  return 'home';
}

export default function App({ path }: { path?: string } = {}) {
  const current = path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  const route = routeOf(current);
  if (route === 'kit') return <Suspense fallback={<Skeleton />}><KitPage /></Suspense>;
  if (route === 'kit-demo-lore' || route === 'kit-demo-datawanderers') {
    return (
      <ErrorBoundary lang="ru">
        <Suspense fallback={<Skeleton />}><KitDemoPage which={route === 'kit-demo-lore' ? 'lore' : 'datawanderers'} /></Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary lang="ru">
      <StorageBanner storage={storage} lang="ru" />
      <main data-lore-app="v2" className="shell">
        <h1 className="shell-title">LORE</h1>
        <Pill variant="id">v2</Pill>
        <a className="shell-link" href="/kit">Seiðr-kit</a>
      </main>
      {/* S3-07: личные настройки — переход v2 → v1 по флагу «новая навигация». */}
      <PersonalSettings />
    </ErrorBoundary>
  );
}
