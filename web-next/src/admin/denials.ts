// Последние отказы доступа (SPRINT_UXR_S7B_ADMIN/S7B-31 п.4, решение 4а; v1 AL-45,
// DS-LINK-2): из старой вкладки v1 «Настройки» — в «Журнал» отдельным блоком.
//
// GET /lore/kc/denials — снимок кольцевого буфера 401/403/409 по /lore/* из
// памяти процесса: живёт до рестарта, это НЕ аудит. Долговременный журнал —
// /lore/admin/actions (выше на том же экране).
import { getJson, type FetchOptions } from './actions';

export interface Denial {
  ts: string;
  method: string;
  path: string;
  status: number | null;
  error: string;
  role: string;
}

export interface DenialsData {
  rows: Denial[];
  /** Происхождение данных — словами сервера; null — не назвал. */
  source: string | null;
}

/** Сколько отказов показываем (как v1): буфер новейшие-первыми. */
export const DENIALS_SHOWN = 30;

type Obj = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseDenials(raw: unknown): DenialsData {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Obj;
  // Нет массива — ответ не тот, а не «отказов не было».
  if (!Array.isArray(b.denials)) throw new Error('malformed answer: denials');
  const rows = b.denials.map(d => {
    const o = (d && typeof d === 'object' ? d : {}) as Obj;
    return {
      ts: s(o.ts), method: s(o.method), path: s(o.path),
      status: typeof o.status === 'number' ? o.status : null,
      error: s(o.error), role: s(o.role),
    };
  });
  return { rows, source: typeof b.source === 'string' && b.source.trim() ? b.source : null };
}

export async function fetchDenials(opts: FetchOptions = {}): Promise<DenialsData> {
  return parseDenials(await getJson('/lore/kc/denials', opts));
}
