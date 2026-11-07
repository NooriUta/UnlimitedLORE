// Вкладка «Активность» паспортов (SPRINT_UXR_S7A_NEWS/S7A-06): лента
// GET /lore/news/v2 по своей записи. Точка входа — `@seidr/kit/activity`.
export * from './newsV2';
export * from './activityModel';
export * from './activitySource';
export * from './ActivityTab';
export { NEWS_V2_FIXTURE } from './newsV2.fixture';
export { ACTIVITY_RU, ACTIVITY_EN, activityT, activityLabel, type ActivityKey } from './locale';
