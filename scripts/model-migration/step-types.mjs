// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Свои типы шага связей — один список.
// Шаг связей (transfer-edges.mjs) заводит в приёмнике, кроме связей карты, свои типы: модель сессий, репозитории
// и организация, решение → веха, ответственный вопроса. Список собран из тех же констант, которыми эти шаги
// заводят типы, и из него же — ownTypes() переноса: повторный перенос с --reset пересоздаёт их, а не отказывает
// «чужими типами» (найдено 20.11.2026 на пробе MDL-08: ANSWERABLE_BY выпал из списка).
import { SESSION_EDGES } from './session-model.mjs';
import { REPO_TYPES } from './repos.mjs';
import { OWNER_EDGE } from './question-owner.mjs';
import { MILESTONE_EDGE } from './decision-milestones.mjs';
import { TRACK_TYPES } from './tracks.mjs';

// MDL-13 «треки б»: трек спринта — вершина KnowTrack и ребро ON_TRACK.
export const EDGE_STEP_TYPES = [...SESSION_EDGES, ...REPO_TYPES, MILESTONE_EDGE, OWNER_EDGE, ...TRACK_TYPES];
