// Агенты в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-15, S7B-16).
//
// Владелица 09.11.2026: «мне данные по harness нужны уже вчера». Harness (в чём
// работает агент: Claude Code, Kimi Code, DSH…) раньше был утоплен в имени
// «Claude Code (full)»; сервер (d8097ab4, миграция V75) завёл поле из ЗАКРЫТОГО
// реестра и заполнил его по имени только там, где подошло ровно одно правило.
//
// Здесь только чтение и одна правка:
//   • срез agent_owners → строки агентов с harness и машиной;
//   • реестр допустимых harness — с сервера (harness_registry), своей копии
//     у клиента нет: новый harness появляется без перевыпуска;
//   • правка harness — POST /lore/actor/owner (только админ).
// «Не указан» и «не привязана» — честные состояния, а не пустые клетки.
import { loreFetch } from '../auth/session';
import { fetchSlice, LoreHttpError, type SliceBody } from '../api/loreSlice';

export interface AgentRow {
  actor_id: string;
  name: string | null;
  client_id: string | null;
  agent_role: string | null;
  machine_id: string | null;
  session_id: string | null;
  /** Код из реестра или null — сервер не знает (не угадываем). */
  harness: string | null;
  /** Первый владелец — для правки (сервер ждёт один kc_sub). */
  owner_kc_sub: string | null;
  /** Все владельцы (OWNED_BY может быть несколько). */
  owner_kc_subs: string[];
  owner_display_name: string | null;
}

export interface AgentsData {
  rows: AgentRow[];
  /** Реестр с сервера; null — сервер его не прислал (старый сервер): правка недоступна. */
  registry: string[] | null;
  /** Строк больше, чем пришло (метаданные полноты среза). */
  truncated: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
/**
 * Владелец в agent_owners приходит МАССИВОМ (ребро OWNED_BY может быть не одно):
 * ["omiloreadmin"]. Строкой его ждать нельзя — иначе у каждого агента выходило
 * «владелец не указан», хотя он есть. Несколько владельцев — через запятую.
 */
const list = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(str).filter((x): x is string => x !== null);

export function parseAgents(body: SliceBody<Record<string, unknown>> & { harness_registry?: unknown }): AgentsData {
  const rows = (Array.isArray(body.rows) ? body.rows : []).map(r => ({
    actor_id: String(r.actor_id ?? ''),
    name: str(r.name),
    client_id: str(r.client_id),
    agent_role: str(r.agent_role),
    machine_id: str(r.machine_id),
    session_id: str(r.session_id),
    harness: str(r.harness),
    owner_kc_sub: list(r.owner_kc_sub)[0] ?? null,
    owner_kc_subs: list(r.owner_kc_sub),
    owner_display_name: list(r.owner_display_name).join(', ') || null,
  })).filter(r => r.actor_id !== '');
  const reg = body.harness_registry;
  const registry = Array.isArray(reg) && reg.every(x => typeof x === 'string') ? (reg as string[]) : null;
  return { rows, registry, truncated: body.truncated === true };
}

export async function fetchAgents(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<AgentsData> {
  const body = await fetchSlice<Record<string, unknown>>('agent_owners', { limit: '1000' }, { signal, fetchImpl });
  return parseAgents(body as SliceBody<Record<string, unknown>> & { harness_registry?: unknown });
}

/** Ключ «не указан» в разбивке и фильтре — отдельное значение, а не пропуск. */
export const HARNESS_NONE = '(none)';

/** Разбивка по harness: сколько агентов каждого; «не указан» — отдельной строкой. */
export function harnessCounts(rows: AgentRow[], registry: string[] | null): Array<{ key: string; n: number }> {
  const m = new Map<string, number>();
  for (const k of registry ?? []) m.set(k, 0);
  for (const r of rows) {
    const k = r.harness ?? HARNESS_NONE;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([key, n]) => ({ key, n })).filter(x => x.n > 0 || x.key !== HARNESS_NONE);
}

export function filterAgents(rows: AgentRow[], harness: string | null): AgentRow[] {
  if (harness === null) return rows;
  return rows.filter(r => (r.harness ?? HARNESS_NONE) === harness);
}

/**
 * Правка harness агента. Пустая строка — сброс в null (так договорено с
 * сервером). Вне реестра сервер отвечает 400 со списком — отдаём как ошибку.
 */
export async function setAgentHarness(
  row: Pick<AgentRow, 'actor_id' | 'client_id' | 'owner_kc_sub'>,
  harness: string | null,
  fetchImpl: typeof fetch = loreFetch,
): Promise<void> {
  const res = await fetchImpl('/lore/actor/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ actor_id: row.actor_id, client_id: row.client_id, kc_sub: row.owner_kc_sub, harness: harness ?? '' }),
  });
  if (!res.ok) {
    let code = '';
    let detail = '';
    try {
      const b = (await res.json()) as { error?: string; detail?: string };
      code = b.error ?? '';
      detail = b.detail ?? '';
    } catch {
      // не-JSON — статус скажет сам
    }
    throw new LoreHttpError(res.status, code, detail);
  }
}
