// Варианты цели связи для выбора с поиском (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
// Владелица 11.11.2026: «где значения задаются рёбрами — dropdown, а не
// корректировка текста». kit рисует выбор (hooks.relationOptions, #1253), а здесь
// — откуда брать варианты: по типу цели связи (schema.relations[].target_type)
// свой срез. Карта согласована с серверной сессией 50109daa 11.11.2026.
// Закрытые спринты не предлагаются. Источника нет или срез не прочитался —
// ошибка словами: kit покажет причину и «Повторить», а не свободный ввод.
import type { LoreRelation } from './loreRecordContract';

interface Source { slice: string; id: string; title?: string; open?: (row: Record<string, unknown>) => boolean }

const CLOSED = /DONE|CANCELLED/i;
const SOURCES: Record<string, Source> = {
  component: { slice: 'components', id: 'component_id', title: 'full_name' },
  project: { slice: 'git_projects', id: 'slug', title: 'short_title' },
  sprint: { slice: 'sprints', id: 'sprint_id', title: 'name', open: r => !CLOSED.test(String(r.status_raw ?? '')) },
  use_case: { slice: 'use_cases', id: 'uc_id', title: 'title' },
  tag: { slice: 'tags_usage', id: 'tag_id' },
  adr: { slice: 'adrs', id: 'adr_id', title: 'name' },
  spec: { slice: 'specs', id: 'spec_id', title: 'title' },
  // Решение владелицы 19.11.2026: связи организации — продукты и люди (проекты — выше).
  product: { slice: 'products', id: 'code', title: 'label_ru' },
  user: { slice: 'users', id: 'kc_sub', title: 'display_name' },
  // MDL-13: концы «зависит от» — открытые задачи и вехи (спринты — выше).
  task: { slice: 'open_tasks', id: 'task_uid', title: 'title' },
  milestone: { slice: 'milestones', id: 'milestone_id', title: 'label' },
  // MDL-13 «треки б»: трек спринта — ребро ON_TRACK к записи трека; варианты — срез треков {code, title}.
  track: { slice: 'track_options', id: 'code', title: 'title' },
  // AP-PASSPORT-EDIT (волна 1): ценность фичи и профиль клиента — привязка существующих боли, выгоды, работы,
  // роли и фичи (сценария) из вкладок «Ценность» и «Профиль клиента».
  pain: { slice: 'pains', id: 'pain_id', title: 'title' },
  gain: { slice: 'gains', id: 'gain_id', title: 'title' },
  job: { slice: 'jobs', id: 'job_id', title: 'title' },
  actor: { slice: 'actors', id: 'actor_id', title: 'name' },
  feature: { slice: 'use_cases', id: 'uc_id', title: 'title' },
};

type SliceFn = (name: string, params?: Record<string, string>) => Promise<{ rows?: Record<string, unknown>[] } | null | undefined>;
export interface RelationOptionsQuery { type: string; id: string; rel: string; dir: 'out' | 'in'; query: string }

export function relationOptionsHook(relations: readonly Pick<LoreRelation, 'rel' | 'dir' | 'target_type' | 'target_types' | 'label'>[], slice: SliceFn) {
  return async ({ id, rel, dir, query }: RelationOptionsQuery) => {
    const r = relations.find(x => x.rel === rel && x.dir === dir);
    // MDL-13: связь к нескольким типам (target_type any) — список типов из модели (target_types), источник у каждого свой.
    const types = r?.target_types?.length ? r.target_types : r?.target_type ? [r.target_type] : [];
    const srcs: [string, Source][] = [];
    for (const t of types) if (SOURCES[t]) srcs.push([t, SOURCES[t]]);
    if (!srcs.length) throw new Error(`для связи «${r?.label ?? rel}» нет источника вариантов`);
    const q = query.trim().toLocaleLowerCase();
    const out: { id: string; title: string; type: string }[] = [];
    for (const [type, src] of srcs) {
      const body = await slice(src.slice, undefined);
      for (const row of body?.rows ?? []) {
        if (src.open && !src.open(row)) continue;
        const code = String(row[src.id] ?? '');
        const title = src.title ? String(row[src.title] ?? '') : '';
        out.push({ id: code, title: title || code, type });
      }
    }
    return out.filter(o => o.id !== '' && o.id !== id && (!q || o.id.toLocaleLowerCase().includes(q) || o.title.toLocaleLowerCase().includes(q)));
  };
}
