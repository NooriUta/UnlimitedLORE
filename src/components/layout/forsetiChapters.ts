// Главы Storyline пространства Forseti — общий словарь для шапки (AppShell
// рендерит их как модули активного пространства, эталон Seiðr: SPACE → модули)
// и для страницы (LorePage рендерит подвкладки активной главы + контент).
// Активность выводится из URL (?section=…), а не хранится в сторе.

export type Section =
  | 'plan' | 'sprints' | 'adrs' | 'decisions' | 'openQuestions' | 'releases' | 'milestones' | 'admin'
  | 'knowledge' | 'components' | 'qg' | 'tech'
  | 'evolution' | 'timeline' | 'analytics' | 'mcp'
  // Продуктовый слой (ADR-LORE-022/032) — глава «Зачем».
  | 'actors' | 'vpProfile' | 'vpCanvas' | 'features' | 'userStories';

export interface Chapter {
  id: string;
  n: string;
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
  { id: 'value', n: '01', nameKey: 'lore.chapters.value.name', name: 'Зачем',      qKey: 'lore.chapters.value.q', q: 'ценность',             color: 'var(--g-value)', sections: ['actors', 'vpProfile', 'vpCanvas', 'features', 'userStories'] },
  { id: 'do',    n: '02', nameKey: 'lore.chapters.do.name',    name: 'Как делаем', qKey: 'lore.chapters.do.q',    q: 'план · спринты',       color: 'var(--g-do)',    sections: ['milestones', 'plan', 'sprints', 'releases'] },
  { id: 'know',  n: '03', nameKey: 'lore.chapters.know.name',  name: 'Что решили', qKey: 'lore.chapters.know.q',  q: 'решения · знания',     color: 'var(--g-know)',  sections: ['adrs', 'decisions', 'openQuestions', 'knowledge'] },
  { id: 'tech',  n: '04', nameKey: 'lore.chapters.tech.name',  name: 'Основа',     qKey: 'lore.chapters.tech.q',  q: 'компоненты · MCP',     color: 'var(--g-tech)',  sections: ['components', 'tech', 'mcp'] },
  { id: 'ctrl',  n: '05', nameKey: 'lore.chapters.ctrl.name',  name: 'Контроль',   qKey: 'lore.chapters.ctrl.q',  q: 'качество · аналитика', color: 'var(--g-ctrl)',  sections: ['analytics', 'qg', 'timeline', 'evolution'] },
];

export const chapterOf = (s: Section): Chapter =>
  CHAPTERS.find(c => c.sections.includes(s)) ?? CHAPTERS[0];
