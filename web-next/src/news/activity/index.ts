// Вкладка «Активность» паспортов (SPRINT_UXR_S7A_NEWS/S7A-06): лента
// GET /lore/news/v2 по своей записи. Перенесено из kit (`@seidr/kit/activity`)
// в приложение по K-14 (SPRINT_UXR_S7B_ADMIN/S7B-27).
export * from './newsV2';
export * from './activityModel';
export * from './activitySource';
export * from './ActivityTab';
export { NEWS_V2_FIXTURE } from './newsV2.fixture';
export { ACTIVITY_RU, ACTIVITY_EN, activityT, activityLabel, type ActivityKey } from './locale';
