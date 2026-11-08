// Строки слайсов LORE → записи kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Чистые функции: экран отдаёт сюда тело слайса и получает KitData, по meta
// которого kit честно пишет «Показано N из M» / «обрезано» / «всего неизвестно».
import type { KitData, KitRecord } from '@seidr/kit';
import type { SliceBody } from '../api/loreClient';
import { planStatusOf } from '../sprints/taskStatus';

type Row = Record<string, unknown>;

/** «📋 PLANNED» → «planned», «READY FOR DEPLOY» → «ready_for_deploy». */
export function normStatus(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/[^a-z_ ]+/g, ' ').trim().replace(/\s+/g, '_');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/** Список (рёбра графа) → одна строка для фильтра и группировки; пустой — ''. */
const joined = (v: unknown): string =>
  Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && x !== '').map(String).join(', ') : str(v);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Строка слайса sprints → запись kit. */
export function sprintRecord(row: Row): KitRecord {
  const id = str(row.sprint_id);
  const updated = str(row.valid_from) || str(row.created_date);
  return {
    id,
    kind: 'sprint',
    title: str(row.name) || id,
    // Только словарём (planStatusOf): наивная склейка давала «вне словаря: in_progress» (08.11).
    status: planStatusOf(typeof row.status_raw === 'string' ? row.status_raw : null),
    fields: {
      project: joined(row.git_projects),
      components: joined(row.components),
      release: joined(row.release_ids),
      milestone: joined(row.milestone_ids),
      priority: num(row.priority),
      planned_start: str(row.planned_start_date),
      planned_end: str(row.planned_end_date),
      done_date: str(row.done_date),
    },
    ...(updated ? { updated_at: updated } : {}),
  };
}

/** Строка слайса adrs → запись kit. */
export function adrRecord(row: Row): KitRecord {
  const id = str(row.adr_id);
  const created = str(row.date_created);
  return {
    id,
    kind: 'adr',
    title: str(row.name) || id,
    status: normStatus(row.status),
    fields: {
      component: str(row.component),
      components: joined(row.components),
      project: joined(row.git_projects),
      tags: joined(row.tags),
      decisions: num(row.decision_count),
    },
    ...(created ? { updated_at: created } : {}),
  };
}

/**
 * Тело слайса → KitData. Полнота (S1):
 *  - truncated:true — потолок сервера: итог неизвестен (page.total — число уже
 *    обрезанных строк, «из N» по нему соврало бы);
 *  - page.has_more — страница: итог = page.total;
 *  - truncated:"unknown" — проверить нечем: обрезано без итога;
 *  - иначе — полная выдача, итог = число строк.
 */
export function sliceToKitData<R>(body: SliceBody<R>, map: (row: R) => KitRecord, generatedAt: string): KitData {
  const records = body.rows.map(map);
  const meta: KitData['meta'] = { generated_at: generatedAt, returned: records.length };
  if (body.truncated === true || body.truncated === 'unknown') {
    meta.truncated = true;
  } else if (body.page?.has_more) {
    meta.truncated = true;
    meta.total = body.page.total;
  } else {
    meta.truncated = false;
    meta.total = records.length;
  }
  if (body.scope?.applied) meta.scope = body.scope.note ?? 'project';
  return { records, edges: [], journal: [], meta };
}

/** Предупреждения сервера для показа над списком — без дублей, в порядке появления. */
export function sliceWarnings(body: SliceBody<unknown>): string[] {
  const out: string[] = [];
  const add = (w: string | undefined) => { if (w && !out.includes(w)) out.push(w); };
  (body.warnings ?? []).forEach(add);
  if (body.truncated !== undefined && body.truncated !== false) add(body.hint);
  add(body.page?.warning);
  add(body.scope?.note);
  add(body.outside_scope?.reason);
  return out;
}
