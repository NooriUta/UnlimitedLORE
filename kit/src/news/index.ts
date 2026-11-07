// Новости v2 (SPRINT_UXR_S7A_NEWS/S7A-02, S7A-06): лента, разрезы, метрики —
// общий компонент kit. Экран новостей web-next и вкладка «Активность»
// паспортов (S5) вставляют одно и то же: NewsFeed / NewsActivity.
export * from './types';
export * from './model';
export * from './source';
export * from './i18n';
export { NewsFeed, NewsActivity, NEWS_SECTIONS_ALL, type NewsFeedProps } from './NewsFeed';
export type { NewsSection } from './NewsPanels';
export { NEWS_FIXTURE } from './fixture';
