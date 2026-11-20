// Клиент тегов со свободными полями (SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE): сервер — LoreTagResource.
//   GET  /lore/tag/suggest?q=        — подсказка «#тег»: теги, сколько записей, какие ключи полей на рёбрах;
//   GET  /lore/tag/entities?tag=&type= — сущности по тегу: строки, колонки (ключи рёбер), фасеты;
//   POST /lore/tag/apply             — поставить/снять тег, patch полей (null снимает поле, истории нет).
// Отказ — ошибка со статусом и причиной (LoreApiError): 502 не выглядит пустым списком.
import { LoreApiError } from '../api/loreClient';
import { v2Auth } from '../auth/session';
import type { TagSuggestion } from '@seidr/kit/content';

export interface TagApiOptions { fetchImpl?: typeof fetch; signal?: AbortSignal; base?: string }

export interface TagFacet { values: { value: string; count: number }[]; empty: number; nonempty: number; total: number; truncated?: boolean }
export interface TagRow {
  type: string; id: string; title?: string | null;
  fields: Record<string, string>;
  tagged_at?: string | null; tagged_by?: string | null; changed_at?: string | null; changed_by?: string | null;
}
export interface TagTable {
  tag: string;
  state: 'ok' | 'empty';
  total: number;
  types: Record<string, number>;
  columns: { key: string; filled: number }[];
  facets: Record<string, TagFacet>;
  rows: TagRow[];
}

const baseOf = (o: TagApiOptions) => o.base ?? (typeof location === 'undefined' ? 'http://localhost' : location.origin);

async function call<T>(path: string, o: TagApiOptions, init: RequestInit = {}, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, baseOf(o));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await v2Auth.wrapFetch(o.fetchImpl)(url.toString(), {
    ...init, signal: o.signal, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  if (!res.ok) {
    let code = '', detail = '';
    if (isJson) { try { const b = (await res.json()) as { error?: string; detail?: string }; code = b.error ?? ''; detail = b.detail ?? ''; } catch { /* статус остаётся */ } }
    throw new LoreApiError(res.status, code || 'HTTP', detail);
  }
  if (!isJson) throw new LoreApiError(res.status, 'NON_JSON', 'ответ не JSON');
  return (await res.json()) as T;
}

export async function fetchTagSuggest(q: string, o: TagApiOptions = {}): Promise<TagSuggestion[]> {
  const b = await call<{ tags?: { tag_id: string; uses?: number; keys?: string[] }[] }>('/lore/tag/suggest', o, {}, q ? { q } : {});
  return (b.tags ?? []).map(x => ({ tag: x.tag_id, uses: Number(x.uses ?? 0), keys: x.keys ?? [] }));
}

export async function fetchTagEntities(tag: string, type: string | null, o: TagApiOptions = {}): Promise<TagTable> {
  const b = await call<Partial<TagTable>>('/lore/tag/entities', o, {}, { tag, ...(type ? { type } : {}) });
  return {
    tag: b.tag ?? tag, state: b.state === 'empty' ? 'empty' : 'ok', total: Number(b.total ?? 0),
    types: b.types ?? {}, columns: b.columns ?? [], facets: b.facets ?? {},
    rows: (b.rows ?? []).map(r => ({ ...r, fields: r.fields ?? {} })),
  };
}

export interface TagApply { type: string; id: string; tag: string; fields: Record<string, string | null>; action?: 'add' | 'remove' }

export async function applyTag(a: TagApply, o: TagApiOptions = {}): Promise<{ ok: boolean; action?: string }> {
  return call('/lore/tag/apply', o, {
    method: 'POST',
    body: JSON.stringify({ type: a.type, id: a.id, tag_id: a.tag, fields: a.fields, action: a.action ?? 'add' }),
  });
}
