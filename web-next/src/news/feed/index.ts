// Новости v2 (SPRINT_UXR_S7A_NEWS/S7A-02, S7A-06): лента, разрезы, метрики —
// экран приложения LORE (клиент GET /lore/news/v2, оси проект/спринт/веха,
// маршруты /lore?section=…). Перенесено из kit по K-14
// (SPRINT_UXR_S7B_ADMIN/S7B-27, D-2026-UXR-KIT-ABSTRACTIONS-APP-SCREENS):
// kit — абстракции, предметность — здесь. Общие механизмы (stepLimit, честные
// состояния, Pill/GameIcon) по-прежнему берутся из @seidr/kit.
export * from './types';
export * from './model';
export * from './source';
export * from './i18n';
export { NewsFeed, NewsActivity, NEWS_SECTIONS_ALL, type NewsFeedProps } from './NewsFeed';
export type { NewsSection } from './NewsPanels';
export { NEWS_FIXTURE } from './fixture';
