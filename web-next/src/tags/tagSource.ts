// Источник тегов для «#тег» в MD-полях записи (SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE). Тег с полями
// ставится только типам-владельцам связи по модели (edge_free_fields.TAGGED_WITH.owners: ADR и решение) —
// у задачи TAGGED_WITH ведёт к компоненту. Запись без ID (ещё не сохранена) — host null: окно скажет словами.
import type { TipTapTagSource } from '@seidr/kit/content';
import { applyTag, fetchTagSuggest, type TagApiOptions } from './tagApi';

/** Типы, которым положены поля тега (сервер выводит их из модели, /lore/model edge_free_fields). */
export const TAG_OWNER_TYPES: readonly string[] = ['adr', 'decision'];

export function loreTagSource(host: { type: string; id: string | null | undefined }, o: TagApiOptions = {}): TipTapTagSource | undefined {
  if (!TAG_OWNER_TYPES.includes(host.type)) return undefined;
  const id = host.id ? host.id : null;
  return {
    host: id,
    search: q => fetchTagSuggest(q, o),
    async apply(tag, fields) {
      if (!id) return { ok: false, reason: 'запись не сохранена' };
      try {
        await applyTag({ type: host.type, id, tag, fields }, o);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
