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
import '@fontsource/manrope/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/unbounded/800.css';
import '@seidr/kit/styles/seidr.css';
import { Suspense } from 'react';
import { ErrorBoundary, Pill, Skeleton, useKitLang, type SafeStorage, type UrlWindow } from '@seidr/kit';
import './App.css';
import { legacyHashHref, legacyPassportHref } from './nav/loreRoutes';
import { adminAxisHref, legacyAdminHref } from './admin/adminModule';
import { createLiveS2Client } from './api/liveS2';
import { v2Auth } from './auth/session';
import { ProjectScope } from './scope/ProjectScope';
import { AccountMenu } from './settings/AccountMenu';
import { SectionPalette } from './palette/SectionPalette';
import { OutsideShell } from './pages/OutsideShell';
import type { ListScreenId } from './lists/screens';
import { V2Shell } from './shell/V2Shell';
import { lazyChunk, StaleChunkBanner } from './shell/staleChunk';
import type { V2Section } from './shell/v2Config';
import { storage as appStorage } from './storage/safe';

// Витрина тянет MD/HTML-элементы (TipTap, mermaid, bpmn-js — мегабайты):
// отдельный чанк, чтобы оболочка v2 за них не платила.
const KitPage = lazyChunk(() => import('./pages/KitPage'));
// Демо паспортов на реальных объектах (S4-33) — свой чанк: MartProse, граф.
const PassportDemo = lazyChunk(() => import('./pages/PassportDemo'));
// Новости v2 (SPRINT_UXR_S7A_NEWS/S7A-02) — свой чанк: лента, матрица, сгорание.
const NewsPage = lazyChunk(() => import('./news/NewsPage'));
// Чтение задачи (S5-04) — тоже MD-чтение (MartProse, KaTeX, mermaid): свой чанк.
// Админка v2 (SPRINT_UXR_S7B_ADMIN/S7B-01) — модуль оболочки ?mod=admin
// (V2Shell, admin/adminModule.ts). Прежняя страница /admin?adm=… переписывается
// в модуль, чтобы старые ссылки (журнал, чат) открывали то же самое.

// Личное пользователя (/lore/me/*, контракт S2) — боевой сервер
// (SPRINT_UXR_S5_RECORD_TASKS/S5-14). Прежняя заглушка держала настройки в
// браузере, и владелица, работая с телефона, своих настроек там не видела:
// браузерное хранилище с устройства на устройство не ездит.
//
// Отката в браузер НЕТ намеренно. Сервер ответил «не опознан» или не ответил —
// экран настроек честно скажет об этом; молчаливый откат к локальной копии
// выглядел бы как «настройки сохранены», а на другом устройстве их бы не было.
// Тема первого экрана от этого не зависит: её ставит main.tsx из cookie
// seer-prefs ещё до запроса, а ответ сервера её потом уточняет.
const meClient = createLiveS2Client();

export type Route = 'kit' | 'passport' | 'news' | 'admin' | 'home' | ListScreenId;

const LIST_ROUTES: Record<string, ListScreenId> = { '/sprints': 'sprints', '/adrs': 'adrs' };
/**
 * Старый адрес экрана списка (S4-04) → раздел оболочки (S4-01).
 *
 * Карта ПОЛНАЯ по экранам намеренно: у каждого экрана списка есть свой раздел
 * оболочки, и `Record` держит это равенство — добавив экран и забыв раздел,
 * сборка не пройдёт (S4-V2-SECTIONS).
 */
const LIST_SECTION: Record<ListScreenId, V2Section> = {
  sprints: 'sprint', adrs: 'adr', tasks: 'task',
  decisions: 'decision', specs: 'spec', docs: 'doc', questions: 'question', milestones: 'milestone',
  releases: 'release', components: 'component', tech: 'tech', features: 'feature',
  projects: 'project',
  products: 'product', actors: 'actor', pains: 'pain', gains: 'gain', jobs: 'job',
};

/**
 * Путь без хвостового «/»: /kit и /kit/ — одна страница; /news — новости v2
 * (S7A-02). Паспорт записи — в query (?section=…&passport=…), как у v1: из
 * списков S4 запись открывается по URL. S5-04: ?section=tasks&passport=SPRINT/CODE — задача.
 */
export function routeOf(path: string, search = ''): Route {
  const p = path.replace(/\/+$/, '');
  if (p === '/kit') return 'kit';
  if (p === '/kit/passport') return 'passport';
  if (p === '/news') return 'news';
  if (p === '/admin') return 'admin';
  // Старые адреса паспорта (?section=tasks|sprints&passport=…) — не отдельные
  // страницы, а оболочка: App переписывает их в раздел с записью (legacyPassportHref).
  void search;
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
  /** Query (паспорта S5); по умолчанию — из win/window. */
  search?: string;
  /** Окно для URL-состояния оболочки (тесты); по умолчанию window. */
  win?: UrlWindow;
  /** Хранилище оболочки (тесты); по умолчанию storage/safe. */
  storage?: SafeStorage;
  /** Принудительно узкий/широкий режим (тесты); по умолчанию — по ширине экрана. */
  narrow?: boolean;
}

export default function App({ path, search, win, storage = appStorage, narrow }: AppProps = {}) {
  const lang = useKitLang();
  const current = path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  const query = search ?? win?.location.search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const route = routeOf(current, query);
  // Старый адрес отдельной страницы паспорта → раздел оболочки, запись во весь экран
  // (владелица 09.11: «да, переводи задачу и спринт в оболочку»). Замена записи
  // истории без перезагрузки: оболочка ниже читает уже новый адрес.
  const w = win ?? (typeof window === 'undefined' ? undefined : window);
  // D-22: ссылка v1 якорем «#СПРИНТ/КОД» — в раздел «Задачи» с этой задачей.
  const legacy = legacyPassportHref(query) ?? legacyHashHref(query, w?.location.hash ?? '');
  if (legacy && w) w.history.replaceState(null, '', legacy);
  // S7B-01: /admin?adm=X → /?mod=admin&sec=adm-X. Уже переписанный адрес (mod
  // есть) второй раз не трогаем: иначе повторный рендер сбросил бы раздел.
  if (route === 'admin' && w && !new URLSearchParams(query).has('mod')) w.history.replaceState(null, '', legacyAdminHref(query));
  // S7B-28: «Кто где» с осью (?sec=adm-who&adm-by=projects) → раздел этой оси
  // («Проекты» или «Люди и их проекты»). Без оси в адресе — null, второй рендер не трогает.
  const axisFix = w ? adminAxisHref(w.location.search) : null;
  if (axisFix && w) w.history.replaceState(null, '', axisFix);
  // Страницы вне оболочки подписаны (S4-17, находка P0 аудита 08.11): без
  // шапки и меню LORE выглядит сломанным, и отличить витрину от поломки
  // человек не может, пока ему не сказали. Витрины — «демо вне приложения»,
  // паспорта по прямому адресу — «вне оболочки», и у каждой ссылка назад.
  if (route === 'kit') {
    return <><OutsideShell kind="demo" /><Suspense fallback={<Skeleton />}><KitPage /></Suspense></>;
  }
  if (route === 'passport') {
    return (
      <ErrorBoundary lang={lang}>
        <OutsideShell kind="demo" />
        <Suspense fallback={<Skeleton />}><PassportDemo /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'news') {
    return (
      <ErrorBoundary lang="ru">
        <StaleChunkBanner />
        <Suspense fallback={<Skeleton lines={8} />}><NewsPage /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'sprints' || route === 'adrs') redirectListRoute(route, win ?? (typeof window === 'undefined' ? undefined : window));
  return (
    <>
    {/* S4-STALE-CHUNK: вне ErrorBoundary — плашка «обновите» видна и поверх экрана ошибки. */}
    <StaleChunkBanner />
    <ErrorBoundary lang={lang}>
      <div data-lore-app="v2" className="v2-app">
        {/* Метка версии — ID-пилюля kit в шапке: v2 нельзя спутать с v1. */}
        <V2Shell storage={storage} win={win} narrow={narrow} brandTag={<Pill variant="id">v2</Pill>}
          // S4-23: охват проектов — сразу за приложениями, как в прототипе v4.
          topStart={<ProjectScope />}
          topEnd={(
            <>
              {/* S4-14: «/» — поиск через слайс search, Ctrl+K — команды над записью/выделением.
                  Команды разделов — SectionPalette: внутри оболочки она знает navigate
                  (находка P1 аудита 08.11: палитра была пуста). Экраны списков передадут
                  сюда свои ctx, target (выделение S4-10) и действия. */}
              <SectionPalette storage={storage} />
            </>
          )}
          account={(
            <AccountMenu
              client={meClient}
              lang={lang}
              name={v2Auth.getState().user?.name}
              onLogout={v2Auth.enabled ? () => { void v2Auth.logout(); } : undefined}
            />
          )}
        />
      </div>
    </ErrorBoundary>
    </>
  );
}
