// Источник тегов для «#тег» в MD-полях записи (SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE). Тег с полями
// ставится только типам-владельцам связи по модели (edge_free_fields.TAGGED_WITH.owners: ADR и решение) —
// у задачи TAGGED_WITH ведёт к компоненту. Запись без ID (ещё не сохранена) — host null: окно скажет словами.
// Шаг «г»: чип тега читает поля своего ребра (срез «сущности по тегу», строка этой записи) и правит их тем же
// POST /lore/tag/apply — null снимает поле, action remove снимает тег.
import type { TagApplyResult, TipTapTagSource } from '@seidr/kit/content';
import { applyTag, fetchTagEntities, fetchTagSuggest, type TagApiOptions, type TagApply } from './tagApi';

/** Типы, которым положены поля тега (сервер выводит их из модели, /lore/model edge_free_fields). */
export const TAG_OWNER_TYPES: readonly string[] = ['adr', 'decision'];

export function loreTagSource(host: { type: string; id: string | null | undefined }, o: TagApiOptions = {}): TipTapTagSource | undefined {
  if (!TAG_OWNER_TYPES.includes(host.type)) return undefined;
  const id = host.id ? host.id : null;
  const write = async (a: Omit<TagApply, 'type' | 'id'>): Promise<TagApplyResult> => {
    if (!id) return { ok: false, reason: 'запись не сохранена' };
    try {
      const r = await applyTag({ type: host.type, id, ...a }, o) as { fields?: Record<string, string> };
      // Поля после записи нужны чипу только при правке; у снятого тега полей нет.
      return r.fields && a.action !== 'remove' ? { ok: true, fields: r.fields } : { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    host: id,
    search: q => fetchTagSuggest(q, o),
    apply: (tag, fields) => write({ tag, fields }),
    remove: tag => write({ tag, fields: {}, action: 'remove' }),
    async fields(tag) {
      if (!id) return null;
      const t = await fetchTagEntities(tag, host.type, o);
      const row = t.rows.find(r => r.id === id);
      return row ? { fields: row.fields, tagged_at: row.tagged_at, tagged_by: row.tagged_by, changed_at: row.changed_at, changed_by: row.changed_by } : null;
    },
  };
}
