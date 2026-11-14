// «Задачи x/y» вехи в списке (SPRINT_UXR_POLISH_UAT_1113/PU-27) — как у
// спринтов (S4-09).
//
// Свой подсчёт задач здесь не заводится: «готово» и «из скольких» считает
// сервер по спринту (срез sprint_totals, LoreSprintTotals — та же функция, что
// у паспорта спринта). Веха — набор спринтов, и её x/y — СУММА этих чисел по
// её спринтам (ребро TARGETS_MILESTONE, direct_sprint_ids строки вехи). Правило
// «что готово» остаётся одним — серверным.
//
// Честность: если итоги хоть одного спринта вехи не пришли, у вехи — причина
// словами, а не заниженная сумма (она выглядела бы точной). Веха без спринтов —
// проверенный ноль 0/0.
import type { KitProgressInput, KitRecord } from '@seidr/kit';
import { loadSprintTotals } from '../sprints/sprintTotals';
import type { LoreClient } from '../sprints/loreClient';

/** Поле записи, которое догружается (для него ставится «…»). */
export const MILESTONE_TOTALS_FIELDS = ['tasks'] as const;

const sprintsOf = (r: KitRecord | undefined): string[] => {
  const v = r?.fields.sprints;
  const list = Array.isArray(v) ? v : [];
  return [...new Set(list.filter((x): x is string => typeof x === 'string' && x !== ''))];
};

export async function loadMilestoneTotals(
  client: LoreClient,
  ids: readonly string[],
  signal: AbortSignal,
  records: readonly KitRecord[] = [],
): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map(records.map(r => [r.id, r]));
  const sprintsOfMs = new Map(ids.map(id => [id, sprintsOf(byId.get(id))]));
  const all = [...new Set([...sprintsOfMs.values()].flat())];
  const per = all.length ? await loadSprintTotals(client, all, signal) : new Map<string, Record<string, unknown>>();

  const out = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    let done = 0;
    let total = 0;
    let partial = false;
    let error: string | null = null;
    for (const s of sprintsOfMs.get(id) ?? []) {
      const p = per.get(s)?.tasks as KitProgressInput | undefined;
      if (!p || !('done' in p)) {
        error = `${s}: ${(p && 'error' in p && p.error) || 'нет итогов'}`;
        break;
      }
      done += p.done;
      total += p.total;
      if (p.partial) partial = true;
    }
    out.set(id, { tasks: error ? { error } : partial ? { done, total, partial: true } : { done, total } });
  }
  return out;
}
