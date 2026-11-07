// Источник данных экрана новостей v2 (SPRINT_UXR_S7A_NEWS/S7A-02).
// GET /lore/news/v2 подготовлен на сервере (feature/s7a-news-server-prep,
// f525c294), но сливается после S2 (решение владелицы 07.11.2026). До выкатки
// экран работает на фикстуре по контракту — и честно помечает её на экране.
// Переход на живой API — ОДНА строка: NEWS_LIVE = true.
import { NEWS_FIXTURE, fixtureNewsSource, httpNewsSource, type NewsSource } from '@seidr/kit';

export const NEWS_LIVE = false;

export function pickNewsSource(live: boolean, fetchImpl?: typeof fetch): NewsSource {
  return live ? httpNewsSource({ base: '/lore', fetch: fetchImpl }) : fixtureNewsSource(NEWS_FIXTURE);
}

export const newsSource: NewsSource = pickNewsSource(NEWS_LIVE);
