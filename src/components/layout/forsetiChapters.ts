// Главы Storyline пространства Forseti — общий словарь для шапки (AppShell
// рендерит их как модули активного пространства, эталон Seiðr: SPACE → модули)
// и для страницы (LorePage рендерит подвкладки активной главы + контент).
// Активность выводится из URL (?section=…), а не хранится в сторе.

export type Section =
  | 'plan' | 'sprints' | 'adrs' | 'decisions' | 'openQuestions' | 'releases' | 'milestones' | 'admin'
  | 'knowledge' | 'components' | 'qg' | 'tech' | 'search'
  | 'evolution' | 'timeline' | 'analytics' | 'mcp'
  // Продуктовый слой (ADR-LORE-022/032) — глава «Зачем».
  | 'actors' | 'vpProfile' | 'vpCanvas' | 'features' | 'userStories';

export interface Chapter {
  id: string;
  n: string;
  /** game-icons slug — модуль в шапке рисуется иконкой (эталон Seiðr) */
  icon: string;
  /** i18n-ключ имени главы; `name` — fallback, если перевода нет */
  nameKey: string;
  name: string;
  /** i18n-ключ подписи главы; `q` — fallback */
  qKey: string;
  q: string;
  color: string;
  /** порядок разделов = порядок подвкладок; первый — маршрут главы по умолчанию */
  sections: Section[];
}

export const CHAPTERS: Chapter[] = [
  { id: 'value', n: '01', icon: 'bullseye',       nameKey: 'lore.chapters.value.name', name: 'Зачем',      qKey: 'lore.chapters.value.q', q: 'ценность',             color: 'var(--g-value)', sections: ['actors', 'vpProfile', 'vpCanvas', 'features', 'userStories'] },
  { id: 'do',    n: '02', icon: 'sprint',         nameKey: 'lore.chapters.do.name',    name: 'Как делаем', qKey: 'lore.chapters.do.q',    q: 'план · спринты',       color: 'var(--g-do)',    sections: ['milestones', 'plan', 'sprints', 'releases'] },
  // 'search' в главах НЕ значится (ADR-LORE-033 D16): вход в поиск один — лупа
  // в шапке. Маршрут ?section=search живёт и рендерится, но подвкладкой не
  // выводится, поэтому и в перечне разделов главы ему места нет: LorePage
  // рисует подвкладки по этому списку и ищет каждую в SECTIONS — раздела там
  // больше нет, и обращение к icon отсутствующей записи роняло страницу.
  { id: 'know',  n: '03', icon: 'scroll-quill',   nameKey: 'lore.chapters.know.name',  name: 'Что решили', qKey: 'lore.chapters.know.q',  q: 'решения · знания',     color: 'var(--g-know)',  sections: ['adrs', 'decisions', 'openQuestions', 'knowledge'] },
  { id: 'tech',  n: '04', icon: 'gears',          nameKey: 'lore.chapters.tech.name',  name: 'Основа',     qKey: 'lore.chapters.tech.q',  q: 'компоненты · MCP',     color: 'var(--g-tech)',  sections: ['components', 'tech', 'mcp'] },
  { id: 'ctrl',  n: '05', icon: 'checkered-flag', nameKey: 'lore.chapters.ctrl.name',  name: 'Контроль',   qKey: 'lore.chapters.ctrl.q',  q: 'качество · аналитика', color: 'var(--g-ctrl)',  sections: ['analytics', 'qg', 'timeline', 'evolution'] },
];

export const chapterOf = (s: Section): Chapter =>
  CHAPTERS.find(c => c.sections.includes(s)) ?? CHAPTERS[0];
