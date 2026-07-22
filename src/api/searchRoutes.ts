// SRCH-08: ЕДИНАЯ карта «тип хита → куда вести и как называть».
//
// До этого модуля карт было три, и расходились они по существу, а не по стилю:
// палитра шапки вела `decision` в раздел без паспорта, `task` — в список
// спринтов без указания какого, `spec` — через `&spec=` вместо `&passport=`,
// а экран поиска для тех же типов открывал паспорт. Один и тот же результат
// приводил в разные места в зависимости от того, откуда искали, — и это не
// ловилось ничем, потому что обе ветки «работали».
//
// Здесь один источник правды. Добавляя тип в поиск, правишь одно место;
// забыв — получаешь падение теста, а не тихий уход в дефолтный раздел.

/** Разделы LORE, куда ведут результаты поиска. */
export const TYPE_SECTION: Record<string, string> = {
  adr: 'adrs',
  decision: 'decisions',
  question: 'openQuestions',
  spec: 'knowledge',
  doc: 'knowledge',
  runbook: 'knowledge',
  sprint: 'sprints',
  task: 'sprints',
  quality_gate: 'qg',
  // Продуктовый слой. `feature` остаётся отдельным ключом, хотя тип после
  // PL-28 один: поиск больше его не отдаёт, но старые ссылки и закладки —
  // отдают, и вести их в никуда было бы регрессом.
  feature: 'features',
  use_case: 'userStories',
  actor: 'actors',
  // Работы, боли и ожидания живут одним реестром — профилем ценности.
  pain: 'vpProfile',
  gain: 'vpProfile',
  job: 'vpProfile',
};

/** Человекочитаемые подписи типов. Ключи те же, что в TYPE_SECTION. */
export const TYPE_LABEL_RU: Record<string, string> = {
  adr: 'ADR',
  decision: 'решение',
  question: 'вопрос',
  spec: 'спека',
  doc: 'док',
  runbook: 'ранбук',
  sprint: 'спринт',
  task: 'задача',
  quality_gate: 'QG',
  feature: 'фича',
  use_case: 'US',
  actor: 'клиент',
  pain: 'боль',
  gain: 'ожидание',
  job: 'работа',
};

/**
 * Ссылка на сущность из результата поиска.
 *
 * У задачи глубокой ссылки нет — её паспорт живёт внутри спринта, поэтому
 * ведём в паспорт спринта (первый сегмент `task_uid`). Раньше палитра вместо
 * этого открывала общий список спринтов: формально «раздел тот», фактически
 * пользователь оставался искать задачу глазами.
 *
 * Неизвестный тип ведёт в спринты, а не на план-борд: план-борд не входит в
 * разделы с фильтром, параметр запроса там никем не читается — переход
 * выглядел как «поиск ничего не сделал».
 */
export function searchHitHref(type: string, refId: string): string {
  const section = TYPE_SECTION[type] ?? 'sprints';
  const passport = type === 'task' ? refId.split('/')[0] : refId;
  return `/lore?section=${encodeURIComponent(section)}&passport=${encodeURIComponent(passport)}`;
}

/** Ссылка на экран поиска с уже набранным запросом (Enter в палитре). */
export function searchScreenHref(q: string): string {
  const query = q.trim();
  return query ? `/lore?section=search&q=${encodeURIComponent(query)}` : '/lore?section=search';
}

/** Подпись типа; неизвестный показывается как есть, а не пустотой. */
export function typeLabel(type: string): string {
  return TYPE_LABEL_RU[type] ?? type;
}

/**
 * SRCH-09: цвет чипа типа (прототип `search-facets-srch05.html`, `.tag--*`).
 *
 * Когда все чипы одного цвета, тип читается только текстом — то есть в списке
 * из полусотни хитов не читается вовсе. Цвет здесь несёт смысл, а не украшает:
 * он группирует выдачу по роду записи быстрее, чем чтение подписи.
 *
 * Семейства окрашены совместно, потому что и в корпусе они одно: решения идут
 * за ADR, всё знание (спека/док/ранбук) — одним цветом, задача за спринтом,
 * продуктовый слой — своей парой. Неизвестный тип получает нейтральный
 * акцент, а не случайный цвет: выдумывать различие там, где его нет, хуже,
 * чем его не показать.
 */
const TYPE_HUE: Record<string, string> = {
  adr: 'var(--acc)',
  decision: 'var(--acc)',
  question: 'var(--wrn)',
  spec: 'var(--inf, #4f9cf0)',
  doc: 'var(--inf, #4f9cf0)',
  runbook: 'var(--inf, #4f9cf0)',
  sprint: 'var(--ok, #4caf72)',
  task: 'var(--ok, #4caf72)',
  quality_gate: 'var(--danger, #e05252)',
  feature: 'var(--vp, #a071d6)',
  use_case: 'var(--vp, #a071d6)',
  actor: 'var(--vp, #a071d6)',
  pain: 'var(--vp, #a071d6)',
  gain: 'var(--vp, #a071d6)',
  job: 'var(--vp, #a071d6)',
};

export function typeHue(type: string): string {
  return TYPE_HUE[type] ?? 'var(--acc)';
}
