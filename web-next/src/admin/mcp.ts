// Раздел MCP админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-07).
//
// MCP-сервер работает у агента на машине; LORE видит только его вызовы. Поэтому
// «здоровье» здесь НАБЛЮДЁННОЕ, и единица — ПРОФИЛЬ агента (caller = agent_scope:
// full, pm, …), а не сессия: сессии одного клиента KC неразличимы (решение
// владелицы 10.11 — экран про профили, различение сессий — отдельной работой).
//
// Источники (LoreSlices, PR #961):
//   • mcp_connections → {caller, calls, last_seen — ISO-строкой из TIMESERIES (PU-04)};
//   • mcp_failures    → {caller, failures, last_failure} — записи агента с кодом ≥ 400.
//
// Различаем, что легко выдать друг за друга:
//   • live — вызов был недавно;
//   • stale — молчит дольше порога: «не видели», а не «здоров»;
//   • unseen — сбои есть, а вызовов не видели вовсе (calls null, не 0);
//   • сбои не прочитались — failures null у всех, а не 0.
import { fetchSlice } from '../api/loreSlice';
import { momentMs } from './moment';

/** Порог «давно молчит» — сутки. */
export const MCP_STALE_MS = 24 * 3_600_000;

export type McpHealth = 'live' | 'stale' | 'unseen';

export interface McpProfile {
  caller: string;
  /** null — вызовов этого профиля не видели (он есть только в сбоях). */
  calls: number | null;
  lastSeen: number | null;
  /** null — срез сбоев не прочитан: про сбои ничего не утверждаем. */
  failures: number | null;
  lastFailure: number | null;
  health: McpHealth;
}

export interface McpData {
  profiles: McpProfile[];
  /** Срез сбоев не прочитался — текст причины; подключения при этом видны. */
  failError: string | null;
  truncated: boolean;
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

type Row = Record<string, unknown>;

export function mergeMcp(conn: readonly Row[], fail: readonly Row[] | null, now: number): McpProfile[] {
  const m = new Map<string, McpProfile>();
  for (const r of conn) {
    const caller = str(r.caller);
    if (!caller) continue;
    const lastSeen = momentMs(r.last_seen);
    m.set(caller, {
      caller,
      calls: num(r.calls),
      lastSeen,
      failures: fail === null ? null : 0,
      lastFailure: null,
      health: lastSeen === null ? 'unseen' : now - lastSeen > MCP_STALE_MS ? 'stale' : 'live',
    });
  }
  for (const r of fail ?? []) {
    const caller = str(r.caller);
    if (!caller) continue;
    const p = m.get(caller) ?? {
      caller, calls: null, lastSeen: null, failures: 0, lastFailure: null, health: 'unseen' as const,
    };
    p.failures = num(r.failures);
    p.lastFailure = momentMs(r.last_failure);
    m.set(caller, p);
  }
  return [...m.values()].sort((a, b) =>
    (b.lastSeen ?? -1) - (a.lastSeen ?? -1)
    || (b.lastFailure ?? -1) - (a.lastFailure ?? -1)
    || a.caller.localeCompare(b.caller));
}

/** Молчащий — это stale и unseen: оба «не видели». */
export const isSilent = (p: McpProfile): boolean => p.health !== 'live';

export async function fetchMcp(now: number, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<McpData> {
  // Сбои читаются рядом и НЕ роняют экран: без них подключения видны.
  const [conn, fail] = await Promise.all([
    fetchSlice<Row>('mcp_connections', {}, { signal, fetchImpl }),
    fetchSlice<Row>('mcp_failures', {}, { signal, fetchImpl }).then(
      b => ({ ok: true as const, body: b }),
      (e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }),
    ),
  ]);
  return {
    profiles: mergeMcp(conn.rows, fail.ok ? fail.body.rows : null, now),
    failError: fail.ok ? null : fail.reason,
    truncated: conn.truncated === true || (fail.ok && fail.body.truncated === true),
  };
}

/** Отбор «только с отказами» (?adm-mcp-f=failures) — с ним Главная ведёт сюда из карточки отказов. */
export const MCP_ONLY_FAILURES = 'failures';

/**
 * Отказ записи агента — ОДНО событие из тех, что считает mcp_failures (S7B-30):
 * срез mcp_failure_rows, то же условие (AgentActionLog, ось agent, код ≥ 400), построчно.
 */
export interface McpFailureRow {
  /** epoch millis или null — отметки нет. */
  ts: number | null;
  family: string | null;
  entity_id: string | null;
  caller: string | null;
  status: number | null;
  /** V86: клиент и машина вызова (отметки — machineMark); null — сервер старше V86. */
  client: string | null;
  machine: string | null;
}

export interface McpFailureRowsData {
  rows: McpFailureRow[];
  /** Сервер обрезал выдачу пределом (LIMIT 500): отказов больше, чем строк. */
  truncated: boolean;
}

/** Момент — одно правило на админку (moment.ts, PU-04). */
const when = momentMs;

export function parseFailureRows(rows: readonly Row[]): McpFailureRow[] {
  return rows.map(r => ({
    ts: when(r.ts),
    family: str(r.family),
    entity_id: str(r.entity_id),
    caller: str(r.caller),
    status: num(r.status),
    client: str(r.client),
    machine: str(r.machine),
  }));
}

export async function fetchMcpFailureRows(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<McpFailureRowsData> {
  const b = await fetchSlice<Row>('mcp_failure_rows', {}, { signal, fetchImpl });
  return { rows: parseFailureRows(b.rows), truncated: b.truncated === true };
}
