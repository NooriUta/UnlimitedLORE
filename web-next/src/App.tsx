// LORE v2 — оболочка нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01).
// Навигация и экраны v2 приходят своими задачами UXR; v1 (корневой src/)
// заморожен и отсюда не импортируется.
// Токены, тема и общие элементы — из Seiðr-kit (kit/, D-2026-UXR-KIT-REACT,
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a, S4-00b): своей копии web-next не держит.
// /kit — витрина kit (S4-00d); маршрут — путь URL, без роутера.
// /sprints, /adrs — экраны списков на движке списка kit (S4-04).
// Устойчивость (ошибка на экран, плашка хранилища) — S4-00f.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/unbounded/800.css';
import '@seidr/kit/styles/seidr.css';
import { lazy, Suspense } from 'react';
import { ErrorBoundary, Pill, Skeleton, StorageBanner } from '@seidr/kit';
import './App.css';
import { useAppT } from './i18n';
import { ListScreen } from './pages/ListScreen';
import type { ListScreenId } from './lists/screens';
import { PersonalSettings } from './settings/PersonalSettings';
import { storage } from './storage/safe';

// Витрина тянет MD/HTML-элементы (TipTap, mermaid, bpmn-js — мегабайты):
// отдельный чанк, чтобы оболочка v2 за них не платила.
const KitPage = lazy(() => import('./pages/KitPage'));

export type Route = 'kit' | 'home' | ListScreenId;

const LIST_ROUTES: Record<string, ListScreenId> = { '/sprints': 'sprints', '/adrs': 'adrs' };

/** Путь без хвостового «/»: /kit и /kit/ — одна страница. */
export function routeOf(path: string): Route {
  const p = path.replace(/\/+$/, '');
  if (p === '/kit') return 'kit';
  return LIST_ROUTES[p] ?? 'home';
}

/** Разделы v2 (пока — экраны списков); текущий помечен aria-current. */
function ShellNav({ current }: { current: Route }) {
  const t = useAppT();
  const link = (href: string, route: Route, text: string) => (
    <a href={href} aria-current={current === route ? 'page' : undefined}>{text}</a>
  );
  return (
    <nav className="shell-nav" aria-label={t('lists.nav')}>
      {link('/sprints', 'sprints', t('lists.sprints.title'))}
      {link('/adrs', 'adrs', t('lists.adrs.title'))}
      <a className="shell-link" href="/kit">Seiðr-kit</a>
    </nav>
  );
}

export default function App({ path }: { path?: string } = {}) {
  const current = path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  const route = routeOf(current);
  if (route === 'kit') return <Suspense fallback={<Skeleton />}><KitPage /></Suspense>;
  if (route === 'home') {
    return (
      <ErrorBoundary lang="ru">
        <StorageBanner storage={storage} lang="ru" />
        <main data-lore-app="v2" className="shell">
          <h1 className="shell-title">LORE</h1>
          <Pill variant="id">v2</Pill>
          <ShellNav current={route} />
        </main>
        {/* S3-07: личные настройки — переход v2 → v1 по флагу «новая навигация». */}
        <PersonalSettings />
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary lang="ru">
      <StorageBanner storage={storage} lang="ru" />
      <header data-lore-app="v2" className="shell">
        <a className="shell-title" href="/">LORE</a>
        <Pill variant="id">v2</Pill>
        <ShellNav current={route} />
      </header>
      <main><ListScreen key={route} screen={route} /></main>
      <PersonalSettings />
    </ErrorBoundary>
  );
}
