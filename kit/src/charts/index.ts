// Графики записи Seiðr-kit: burnup/burndown группы задач (SPRINT_UXR_S5_RECORD_TASKS/S5-03).
export * from './burn';
export * from './BurnChart';
export * from './BurnSpark';
// Встроенный график (SPRINT_VIZ_EMBED/EMB-L2): рамка и её чистые функции.
export * from './embedFrame';
export * from './EmbedChartFrame';
// Графики одним семейством (SPRINT_UXR_S13_KIT4/K4-CHARTS): line · scatter · bar · heat.
export * from './family';
// Рычаг рисовальщика svg | echarts (D-2026-SEIDRKIT-ECHARTS-IN-KIT); тело echarts — вход @seidr/kit/charts-echarts.
export * from './renderer';
// Мини-линия — в семействе графиков (рычаг svg | echarts действует и на неё).
export * from './spark';
