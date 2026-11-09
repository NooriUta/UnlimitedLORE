// Источник данных экрана новостей v2 (SPRINT_UXR_S7A_NEWS/S7A-02).
// Живой GET /lore/news/v2 — с 09.11.2026 (владелица: «новости всё ещё к серверной
// части не подключены»). Запросы идут через loreFetch — с токеном входа: без
// него стенд с включённым входом отвечает 401, и лента выглядела бы сломанной.
// Фикстура осталась только для локальных прогонов Playwright (VITE_NEWS_FIXTURE=true):
// там нет ни сервера, ни входа, а проверяется раскладка, а не числа.
import { NEWS_FIXTURE, fixtureNewsSource, httpNewsSource, type NewsSource } from '@seidr/kit';
import { loreFetch } from '../auth/session';

export const NEWS_LIVE = import.meta.env.VITE_NEWS_FIXTURE !== 'true';

export function pickNewsSource(live: boolean, fetchImpl?: typeof fetch): NewsSource {
  return live ? httpNewsSource({ base: '/lore', fetch: fetchImpl ?? loreFetch }) : fixtureNewsSource(NEWS_FIXTURE);
}

export const newsSource: NewsSource = pickNewsSource(NEWS_LIVE);
