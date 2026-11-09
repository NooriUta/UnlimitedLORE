// Куда ведёт строка ленты новостей в v2 (прод v1.17.7, владелица 09.11:
// «некоторые переходы странно себя ведут»; «меню не должны ни по одной ссылке
// пропадать»).
//
// kit по умолчанию строит адреса v1 (newsHref: /lore?section=…&passport=…). В v2
// таких маршрутов нет: запись открывалась без меню или не открывалась вовсе.
// Здесь — адрес раздела v2 с открытой записью, тот же, что пишет список при
// щелчке по строке: ?mod=forseti&sec=<раздел>&open=<id>.
import type { NewsEvent } from '@seidr/kit';
import type { V2Section } from '../shell/v2Config';

const SECTION_OF: Record<string, V2Section> = {
  adr: 'adr',
  decision: 'decision',
  spec: 'spec',
  question: 'question',
  sprint: 'sprint',
  task: 'task',
  release: 'release',
  milestone: 'milestone',
};

/** Код записи в списке раздела: у релиза — пара «проект#версия» (release_uid). */
function recordId(e: NewsEvent): string {
  if (e.type !== 'release' || e.el.includes('#')) return e.el;
  const p = e.projects?.[0];
  return p ? `${p}#${e.el}` : e.el;
}

export function newsHrefV2(e: NewsEvent): string | null {
  const sec = SECTION_OF[e.type];
  if (!sec || !e.el) return null;
  const q = new URLSearchParams({ mod: 'forseti', sec, open: recordId(e) });
  return `/?${q.toString()}`;
}
