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
import { SprintPassport, SPRINT_TABS, type SprintTab } from './sprint/SprintPassport';

// Витрина тянет MD/HTML-элементы (TipTap, mermaid, bpmn-js — мегабайты):
// отдельный чанк, чтобы оболочка v2 за них не платила.
const KitPage = lazy(() => import('./pages/KitPage'));

// Чтение задачи (S5-04) — тоже MD-чтение (MartProse, KaTeX, mermaid): свой чанк.
const TaskReadPage = lazy(() => import('./tasks/TaskReadPage'));

/**
 * Путь без хвостового «/»: /kit и /kit/ — одна страница. Паспорт записи —
 * в query (?section=…&passport=…), как у v1: из списков S4 запись
 * открывается по URL. S5-04: ?section=tasks&passport=SPRINT/CODE — задача.
 */
export function routeOf(path: string, search = ''): 'kit' | 'task' | 'home' {
  if (path.replace(/\/+$/, '') === '/kit') return 'kit';
  const q = new URLSearchParams(search);
  if (q.get('section') === 'tasks' && q.get('passport')) return 'task';
  return 'home';
}

/**
 * Паспорт спринта по URL (S5-02): ?section=sprints&passport=ID[&tab=…].
 * Паспорта открываются из списков S4 тем же адресом. Неизвестная вкладка —
 * «Задачи» (первая и по умолчанию: задачи спринта видны за 2 клика).
 */
export function sprintPassportOf(search: string): { sprintId: string; tab: SprintTab } | null {
  const p = new URLSearchParams(search);
  const id = p.get('passport')?.trim();
  if (p.get('section') !== 'sprints' || !id) return null;
  const tab = (SPRINT_TABS as readonly string[]).includes(p.get('tab') ?? '') ? (p.get('tab') as SprintTab) : 'tasks';
  return { sprintId: id, tab };
}

export default function App({ path, search }: { path?: string; search?: string } = {}) {
  const current = path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  const query = search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const route = routeOf(current, query);
  if (route === 'kit') return <Suspense fallback={<Skeleton />}><KitPage /></Suspense>;
  if (route === 'task') {
    return (
      <ErrorBoundary lang="ru">
        <StorageBanner storage={storage} lang="ru" />
        <Suspense fallback={<Skeleton />}><TaskReadPage /></Suspense>
      </ErrorBoundary>
    );
  }
  const passport = sprintPassportOf(query);
  if (passport) {
    return (
      <ErrorBoundary lang="ru">
        <StorageBanner storage={storage} lang="ru" />
        <main data-lore-app="v2">
          <SprintPassport sprintId={passport.sprintId} tab={passport.tab} />
        </main>
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
