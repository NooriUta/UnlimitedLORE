// Счётчики ленты новостей, которые владелец читает как ответ на вопрос
// «сгораем или нет»: «появилось» скопом смешивало задачи со спринтами и ADR,
// и по нему нельзя было понять, тает бэклог или растёт.
import type { LoreNewsItem } from '../../api/lore';

const w = (it: LoreNewsItem) => it.agg ?? 1;

/** «Появилось» по объектам: задачи / спринты / всё остальное (ADR, решения, спеки). */
export function createdSplit(list: LoreNewsItem[]) {
  const r = { tasks: 0, sprints: 0, other: 0 };
  for (const it of list) {
    if (it.event !== 'created') continue;
    if (it.kind === 'tasks') r.tasks += w(it);
    else if (it.kind === 'sprint') r.sprints += w(it);
    else r.other += w(it);
  }
  return r;
}

/** Сгорание задач: net = закрыто − заведено; плюс — бэклог тает. */
export function taskBurn(list: LoreNewsItem[]) {
  let closed = 0, created = 0;
  for (const it of list) {
    if (it.kind !== 'tasks') continue;
    if (it.event === 'closed') closed += w(it);
    else if (it.event === 'created') created += w(it);
  }
  return { closed, created, net: closed - created };
}
