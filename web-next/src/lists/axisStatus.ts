// Статусы НЕплановых осей: решения, спеки, вопросы, фичи
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// Повод — сторож `statusCanon.test.ts`. Я сначала читал статус решения наивной
// склейкой слов (`normStatus`), и сторож это поймал. Он оказался прав по сути,
// хотя писался про другую ось: `shared/lore-statuses.json` объявляет словарь НА
// КАЖДУЮ ось — `planStatuses`, `adrStatuses`, `specStatuses`,
// `decisionStatuses`, — и склейка обходила их все одинаково.
//
// Почему нельзя было взять `planStatusOf`: это словарь ПЛАНА (todo · active ·
// done · blocked…). Статус решения «accepted» в нём отсутствует, и решение
// целиком ушло бы «вне словаря». Ось у каждого типа своя — отсюда отдельный
// канон, а не один на всех.
//
// Правило чтения одно для всех осей: значение ВНЕ своей оси становится
// `unknown`, а не подгоняется под похожий код. Так грязь в данных видна на
// экране, а не замазана. Замер корпуса 09.11 показывает, что это не теория:
// у 778 решений есть 2 строки `rejected` и одна «🚫 CANCELLED» (статус ЗАДАЧИ в
// поле статуса решения) — ни того, ни другого в объявленном словаре нет.
//
// Образ v2 не видит shared/ (web-next/Dockerfile копирует файлы поимённо),
// поэтому здесь копия словарей, а расхождение с shared ловит тест
// `axisStatus.test.ts` — тем же приёмом, что `sprints.test.tsx` для оси плана.

/** `decisionStatuses` из shared/lore-statuses.json. */
export const DECISION_STATUSES = ['proposed', 'accepted', 'deferred', 'superseded', 'fixed', 'done'] as const;

/** `specStatuses` из shared/lore-statuses.json. */
export const SPEC_STATUSES = ['proposed', 'accepted', 'deprecated', 'superseded'] as const;

/**
 * Статусы вопросов. В shared их НЕТ — ось объявлена на сервере, выражением
 * `status_rank` среза вопросов (open 0 · deferred 1 · closed 2 · dropped 3,
 * неизвестный — 4). Пробел в shared записан в задаче: словарь должен быть там,
 * где и остальные, иначе клиент и сервер разойдутся молча.
 */
export const QUESTION_STATUSES = ['open', 'deferred', 'closed', 'dropped'] as const;

/**
 * Статусы фич. В shared их тоже нет; перечень снят замером корпуса (`features`:
 * shipped · active · in_rework и пусто). Это НЕ ось задач: у фичи не бывает ни
 * «заблокирована», ни «к выкатке».
 */
export const FEATURE_STATUSES = ['active', 'in_rework', 'shipped'] as const;

/**
 * Значение оси → её код, иначе `unknown`.
 *
 * Регистр и пробелы вокруг не значат ничего (в корпусе встречается и то и
 * другое), а вот ПОХОЖЕСТЬ не значит ничего тем более: ни маркеров, ни
 * сопоставления по началу слова здесь нет намеренно. Эти оси приходят готовыми
 * кодами, и «почти совпало» — это чужой статус, а не свой.
 */
export function axisStatusOf(raw: unknown, axis: readonly string[]): string {
  if (typeof raw !== 'string') return 'unknown';
  const code = raw.trim().toLowerCase();
  if (!code) return 'unknown';
  return axis.includes(code) ? code : 'unknown';
}

export const decisionStatusOf = (raw: unknown): string => axisStatusOf(raw, DECISION_STATUSES);
export const specStatusOf = (raw: unknown): string => axisStatusOf(raw, SPEC_STATUSES);
export const questionStatusOf = (raw: unknown): string => axisStatusOf(raw, QUESTION_STATUSES);
export const featureStatusOf = (raw: unknown): string => axisStatusOf(raw, FEATURE_STATUSES);
