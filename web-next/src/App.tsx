// LORE v2 — оболочка нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01).
// v1 (корневой src/) заморожен и отсюда не импортируется.
// Токены, тема и общие элементы — из Seiðr-kit (kit/, D-2026-UXR-KIT-REACT,
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a, S4-00b): своей копии web-next не держит.
// /kit — витрина kit (S4-00d); маршрут — путь URL, без роутера.
// Экраны списков (S4-04) — разделы оболочки (?sec=sprint|adr); старые адреса
// /sprints и /adrs ведут туда же.
// Устойчивость (ошибка на экран, плашка хранилища) — S4-00f.
// Корень — оболочка v2 на KitShell (S4-01): приложения наверху, меню по смыслу,
// drawer на телефоне; раздел — в URL (?mod=…&sec=…). Плашку хранилища рисует
// сама оболочка (StorageBanner kit) — по тому же хранилищу storage/safe.
// Личные настройки — под аватаром в шапке (S4-02, слот account KitShell).
// Выбор нескольких проектов — правый край шапки (S4-03, слот topEnd), выбор в URL (?proj=).
// Палитра поиска и команд (S4-14) — там же, кнопками «Поиск»/«Команды».
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/unbounded/800.css';
import '@seidr/kit/styles/seidr.css';
import { lazy, Suspense } from 'react';
import { ErrorBoundary, Pill, Skeleton, resolvePrefs, useKitLang, type SafeStorage, type UrlWindow } from '@seidr/kit';
import './App.css';
import { createLocalS2Client } from './api/me';
import { ProjectScope } from './scope/ProjectScope';
import { AccountMenu } from './settings/AccountMenu';
import { LorePalette } from './palette/LorePalette';
import type { ListScreenId } from './lists/screens';
import { V2Shell } from './shell/V2Shell';
import type { V2Section } from './shell/v2Config';
import { storage as appStorage } from './storage/safe';
import { themeSource } from './storage/themeSource';

// Витрина тянет MD/HTML-элементы (TipTap, mermaid, bpmn-js — мегабайты):
// отдельный чанк, чтобы оболочка v2 за них не платила.
const KitPage = lazy(() => import('./pages/KitPage'));
// Новости v2 (SPRINT_UXR_S7A_NEWS/S7A-02) — свой чанк: лента, матрица, сгорание.
const NewsPage = lazy(() => import('./news/NewsPage'));

// Личное пользователя (/lore/me/*, контракт S2) — до S2-04 на заглушке с
// хранением в браузере (S4-02). Первый раз — с темой, выбранной в v1/seer-prefs.
const initialTheme = resolvePrefs(themeSource());
const meClient = createLocalS2Client(appStorage, {
  seed: { palette: initialTheme.palette, mode: initialTheme.mode, density: initialTheme.density },
});

export type Route = 'kit' | 'news' | 'home' | ListScreenId;

const LIST_ROUTES: Record<string, ListScreenId> = { '/sprints': 'sprints', '/adrs': 'adrs' };
/** Старый адрес экрана списка (S4-04) → раздел оболочки (S4-01). */
const LIST_SECTION: Record<ListScreenId, V2Section> = { sprints: 'sprint', adrs: 'adr' };

/** Путь без хвостового «/»: /kit и /kit/ — одна страница. */
export function routeOf(path: string): Route {
  const p = path.replace(/\/+$/, '');
  if (p === '/kit') return 'kit';
  if (p === '/news') return 'news';
  return LIST_ROUTES[p] ?? 'home';
}

/** /sprints → /?sec=sprint (замена записи истории, без перезагрузки): экран
 *  списка живёт в разделе оболочки, отдельной страницы у него нет. */
function redirectListRoute(route: ListScreenId, w: UrlWindow | undefined) {
  if (!w || new URLSearchParams(w.location.search).has('sec')) return;
  const params = new URLSearchParams(w.location.search);
  params.set('sec', LIST_SECTION[route]);
  w.history.replaceState(null, '', `/?${params.toString()}${w.location.hash}`);
}

export interface AppProps {
  path?: string;
  /** Окно для URL-состояния оболочки (тесты); по умолчанию window. */
  win?: UrlWindow;
  /** Хранилище оболочки (тесты); по умолчанию storage/safe. */
  storage?: SafeStorage;
  /** Принудительно узкий/широкий режим (тесты); по умолчанию — по ширине экрана. */
  narrow?: boolean;
}

export default function App({ path, win, storage = appStorage, narrow }: AppProps = {}) {
  const lang = useKitLang();
  const current = path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  const route = routeOf(current);
  if (route === 'kit') return <Suspense fallback={<Skeleton />}><KitPage /></Suspense>;
  if (route === 'news') {
    return (
      <ErrorBoundary lang="ru">
        <Suspense fallback={<Skeleton lines={8} />}><NewsPage /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'sprints' || route === 'adrs') redirectListRoute(route, win ?? (typeof window === 'undefined' ? undefined : window));
  return (
    <ErrorBoundary lang={lang}>
      <div data-lore-app="v2" className="v2-app">
        {/* Метка версии — ID-пилюля kit в шапке: v2 нельзя спутать с v1. */}
        <V2Shell storage={storage} win={win} narrow={narrow} brandTag={<Pill variant="id">v2</Pill>}
          topEnd={(
            <>
              <ProjectScope />
              {/* S4-14: «/» — поиск через слайс search, Ctrl+K — команды над записью/выделением.
                  Экраны списков передадут сюда свои ctx, target (выделение S4-10) и действия. */}
              <LorePalette storage={storage} trigger />
            </>
          )}
          account={<AccountMenu client={meClient} lang={lang} />}
        />
      </div>
    </ErrorBoundary>
  );
}
