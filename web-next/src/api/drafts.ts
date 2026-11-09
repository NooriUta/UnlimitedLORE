// Черновики правки на сервере (SPRINT_UXR_S5_RECORD_TASKS/S5-09).
//
// Серверная часть влита (PR #940), контракт передан серверной сессией:
//   GET  /lore/me/drafts?ref_type=&ref_id=  → {drafts:[{ref_type, ref_id,
//        field, body_md, base_version, saved_at}]}, свежие сверху;
//   POST /lore/me/drafts {ref_type, ref_id, field, body_md, base_version?}
//        — один черновик на поле, повторный POST его обновляет;
//   POST /lore/me/drafts/delete {ref_type, ref_id, field?} — без field
//        удаляются все черновики записи.
//
// Честные состояния:
//   • пустой список значит «черновиков нет» — и только это;
//   • 401 NO_IDENTITY значит «вызывающий не опознан», а НЕ «черновиков нет»:
//     поэтому ошибка не глотается, а доходит до поля, и оно пишет «черновик
//     не прочитан» вместо тишины;
//   • base_version — версия записи на момент начала правки. Разошлась с
//     текущей — запись с тех пор изменили; это вход для слияния (S5-08),
//     поэтому черновик помечается `stale`, а не накладывается молча.
import type { MdDraftSlot } from '@seidr/kit/content';
import { loreFetch } from '../auth/session';

export interface DraftRow {
  ref_type: string;
  ref_id: string;
  field: string;
  body_md: string;
  base_version: number | null;
  saved_at: string;
}

export interface DraftsApi {
  list: (ref: { type: string; id: string }) => Promise<DraftRow[]>;
  save: (row: { type: string; id: string; field: string; bodyMd: string; baseVersion?: number | null }) => Promise<void>;
  remove: (ref: { type: string; id: string; field?: string }) => Promise<void>;
}

async function body(res: Response): Promise<Record<string, unknown>> {
  try {
    const v = (await res.json()) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fail(res: Response, b: Record<string, unknown>): never {
  const code = typeof b.error === 'string' ? b.error : `HTTP ${res.status}`;
  const detail = typeof b.detail === 'string' ? b.detail : '';
  throw new Error(detail ? `${code}: ${detail}` : code);
}

export function createDraftsApi(fetchImpl: typeof fetch = loreFetch): DraftsApi {
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetchImpl(path, init);
    const b = await body(res);
    if (!res.ok) fail(res, b);
    return b;
  };
  const post = (path: string, payload: unknown) => call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    async list(ref) {
      const q = `?ref_type=${encodeURIComponent(ref.type)}&ref_id=${encodeURIComponent(ref.id)}`;
      const b = await call(`/lore/me/drafts${q}`);
      const rows = Array.isArray(b.drafts) ? b.drafts : [];
      return rows.map(r => {
        const row = r as Record<string, unknown>;
        return {
          ref_type: String(row.ref_type ?? ''),
          ref_id: String(row.ref_id ?? ''),
          field: String(row.field ?? ''),
          body_md: typeof row.body_md === 'string' ? row.body_md : '',
          base_version: typeof row.base_version === 'number' ? row.base_version : null,
          saved_at: String(row.saved_at ?? ''),
        };
      });
    },

    async save(row) {
      await post('/lore/me/drafts', {
        ref_type: row.type, ref_id: row.id, field: row.field, body_md: row.bodyMd,
        ...(row.baseVersion == null ? {} : { base_version: row.baseVersion }),
      });
    },

    async remove(ref) {
      await post('/lore/me/drafts/delete', {
        ref_type: ref.type, ref_id: ref.id, ...(ref.field ? { field: ref.field } : {}),
      });
    },
  };
}

export interface DraftSlotOptions {
  api: DraftsApi;
  type: string;
  id: string;
  field: string;
  /** Версия записи сейчас (record.version из lore.record/1); null — неизвестна. */
  version: number | null;
}

/**
 * Слот черновика для MD-поля kit. kit про API не знает — получает три
 * действия, и этот переходник их даёт.
 *
 * `stale` ставится, когда черновик писали поверх ДРУГОЙ версии записи: текст
 * не выбрасывается и не накладывается молча — поле честно скажет, что запись
 * с тех пор изменили. Версия неизвестна (ни у записи, ни у черновика) — не
 * выдумываем расхождение: нет данных, нет пометки.
 */
export function draftSlot({ api, type, id, field, version }: DraftSlotOptions): MdDraftSlot {
  return {
    async load() {
      const rows = await api.list({ type, id });
      const row = rows.find(r => r.field === field);
      if (!row) return null;
      const stale = row.base_version != null && version != null && row.base_version !== version;
      return { text: row.body_md, savedAt: row.saved_at, stale };
    },
    save: text => api.save({ type, id, field, bodyMd: text, baseVersion: version }),
    remove: () => api.remove({ type, id, field }),
  };
}
