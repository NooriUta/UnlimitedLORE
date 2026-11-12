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
  project: { slice: 'git_projects', id: 'slug', title: 'name' },
  sprint: { slice: 'sprints', id: 'sprint_id', title: 'name', open: r => !CLOSED.test(String(r.status_raw ?? '')) },
  use_case: { slice: 'use_cases', id: 'uc_id', title: 'title' },
  tag: { slice: 'tags_usage', id: 'tag_id' },
  adr: { slice: 'adrs', id: 'adr_id', title: 'name' },
  spec: { slice: 'specs', id: 'spec_id', title: 'title' },
};

type SliceFn = (name: string, params?: Record<string, string>) => Promise<{ rows?: Record<string, unknown>[] } | null | undefined>;
export interface RelationOptionsQuery { type: string; id: string; rel: string; dir: 'out' | 'in'; query: string }

export function relationOptionsHook(relations: readonly Pick<LoreRelation, 'rel' | 'dir' | 'target_type' | 'label'>[], slice: SliceFn) {
  return async ({ id, rel, dir, query }: RelationOptionsQuery) => {
    const r = relations.find(x => x.rel === rel && x.dir === dir);
    const src = r?.target_type ? SOURCES[r.target_type] : undefined;
    if (!src) throw new Error(`для связи «${r?.label ?? rel}» нет источника вариантов`);
    const body = await slice(src.slice, undefined);
    const q = query.trim().toLocaleLowerCase();
    return (body?.rows ?? [])
      .filter(row => (src.open ? src.open(row) : true))
      .map(row => {
        const code = String(row[src.id] ?? '');
        const title = src.title ? String(row[src.title] ?? '') : '';
        return { id: code, title: title || code, type: r!.target_type };
      })
      .filter(o => o.id !== '' && o.id !== id && (!q || o.id.toLocaleLowerCase().includes(q) || o.title.toLocaleLowerCase().includes(q)));
  };
}
