// LORE v2 — оболочка нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01).
// v1 (корневой src/) заморожен и отсюда не импортируется.
// Токены, тема и общие элементы — из Seiðr-kit (kit/, D-2026-UXR-KIT-REACT,
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a, S4-00b): своей копии web-next не держит.
// /kit — витрина kit (S4-00d); маршрут — путь URL, без роутера.
// Устойчивость (ошибка на экран, плашка хранилища) — S4-00f.
// Корень — оболочка v2 на KitShell (S4-01): приложения наверху, меню по смыслу,
// drawer на телефоне; раздел — в URL (?mod=…&sec=…). Плашку хранилища рисует
// сама оболочка (StorageBanner kit) — по тому же хранилищу storage/safe.
// Личные настройки — под аватаром в шапке (S4-02, слот account KitShell).
// Выбор нескольких проектов — правый край шапки (S4-03, слот topEnd), выбор в URL (?proj=).
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
import { V2Shell } from './shell/V2Shell';
import { storage as appStorage } from './storage/safe';
import { themeSource } from './storage/themeSource';

// Витрина тянет MD/HTML-элементы (TipTap, mermaid, bpmn-js — мегабайты):
// отдельный чанк, чтобы оболочка v2 за них не платила.
const KitPage = lazy(() => import('./pages/KitPage'));

// Личное пользователя (/lore/me/*, контракт S2) — до S2-04 на заглушке с
// хранением в браузере (S4-02). Первый раз — с темой, выбранной в v1/seer-prefs.
const initialTheme = resolvePrefs(themeSource());
const meClient = createLocalS2Client(appStorage, {
  seed: { palette: initialTheme.palette, mode: initialTheme.mode, density: initialTheme.density },
});

/** Путь без хвостового «/»: /kit и /kit/ — одна страница. */
export function routeOf(path: string): 'kit' | 'home' {
  return path.replace(/\/+$/, '') === '/kit' ? 'kit' : 'home';
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
  if (routeOf(current) === 'kit') return <Suspense fallback={<Skeleton />}><KitPage /></Suspense>;
  return (
    <ErrorBoundary lang={lang}>
      <div data-lore-app="v2" className="v2-app">
        {/* Метка версии — ID-пилюля kit в шапке: v2 нельзя спутать с v1. */}
        <V2Shell storage={storage} win={win} narrow={narrow} brandTag={<Pill variant="id">v2</Pill>}
          topEnd={<ProjectScope />}
          account={<AccountMenu client={meClient} lang={lang} />}
        />
      </div>
    </ErrorBoundary>
  );
}
