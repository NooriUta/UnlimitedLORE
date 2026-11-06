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
  // Знания (T19): паспорт несёт вид — «doc:<id>», «runbook:<id>», «spec:<id>».
  // Голый id здесь не открывал ничего: раздел общий на три вида записей.
  const passport = type === 'task' ? refId.split('/')[0]
    : KNOWLEDGE_KINDS.includes(type as KnowledgeKind) ? `${type}:${refId}`
    : refId;
  return `/lore?section=${encodeURIComponent(section)}&passport=${encodeURIComponent(passport)}`;
}

/** Виды записей раздела «Знания». */
export type KnowledgeKind = 'doc' | 'runbook' | 'spec';
const KNOWLEDGE_KINDS: KnowledgeKind[] = ['doc', 'runbook', 'spec'];

/** Разобранная глубокая ссылка: раздел, вид записи (только «Знания») и её id. */
export type DeepLink = { section: string; kind?: KnowledgeKind; id: string };

/**
 * Разбор глубокой ссылки — ОДИН для страницы и для теста туда-обратно.
 *
 * Находка CICDGitHub/Völva 06.11: поиск открывал раздел, но не запись у 4 типов
 * из 15 — searchHitHref отдавал passport всем, а читали его не все (решения —
 * ?dec=, спеки — ?spec=, док/ранбук — «doc:<id>»). Две независимые стороны
 * одного контракта расходились молча. Теперь пишущая сторона (searchHitHref) и
 * читающая (эта функция) проверяются вместе по всему каталогу типов.
 *
 * Старые формы читаются: ?spec= (дрилл-даун из компонентов и закладки),
 * ?kind=&art= (до T19), ?dec= (лента новостей, AH-09).
 */
export function readDeepLink(params: URLSearchParams): DeepLink | null {
  const section = params.get('section') ?? '';
  const passport = params.get('passport') ?? '';
  if (section === 'knowledge') {
    const m = /^(doc|runbook|spec):(.+)$/.exec(passport);
    if (m) return { section, kind: m[1] as KnowledgeKind, id: m[2] };
    const spec = params.get('spec');
    if (spec) return { section, kind: 'spec', id: spec };
    const kind = params.get('kind');
    const art = params.get('art');
    if ((kind === 'doc' || kind === 'runbook') && art) return { section, kind, id: art };
    return null;
  }
  if (section === 'decisions') {
    const id = params.get('dec') || passport;
    return id ? { section, id } : null;
  }
  return passport ? { section, id: passport } : null;
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
