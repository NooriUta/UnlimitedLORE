// ── /bench transport layer ────────────────────────────────────────────────────
// Same-origin in dev: the vite proxy forwards /bench to lore-backend (:9100), which
// reads rag-vs-parse files (live STATUS.json, static report) and queries the
// RAGVSDL experiment mart via named slices. The browser never sees ArcadeDB
// credentials and never sends SQL.
//
// In prod / Shell-MF mode the proxy and the mart are absent: nginx SPA-fallback
// answers /bench/* with index.html — the content-type guard below turns that
// into MuninnUnavailableError instead of a JSON parse crash.

import type { MuninnStatus } from '../utils/muninnData';

const BENCH_BASE = '/bench';

export class MuninnUnavailableError extends Error {
  constructor() { super('bench endpoints unavailable (dev-only feature)'); }
}

export class MuninnRootMissingError extends Error {
  constructor(detail?: string) { super(detail ?? 'benchmark repo not found'); }
}

export class MartDisabledError extends Error {
  constructor() { super('experiment mart is disabled (dev-only)'); }
}

export class MartUpstreamError extends Error {
  constructor(detail?: string) { super(detail ?? 'experiment mart upstream failed'); }
}

/** Reject SPA-fallback / proxy-less responses before parsing. */
function assertJsonResponse(res: Response): void {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new MuninnUnavailableError();
}

async function parseError(res: Response): Promise<never> {
  assertJsonResponse(res);
  let code = '';
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string; detail?: string };
    code = body.error ?? '';
    detail = body.detail ?? '';
  } catch {
    // fall through to generic error
  }
  if (code === 'BENCH_ROOT_MISSING') throw new MuninnRootMissingError(detail);
  if (code === 'MART_DISABLED') throw new MartDisabledError();
  if (code === 'MART_UPSTREAM') throw new MartUpstreamError(detail);
  throw new Error(`${res.status} ${code || res.statusText}${detail ? `: ${detail}` : ''}`);
}

/**
 * Live progress of the running cell (results/STATUS.json, written by the
 * orchestrator every few seconds). May be mid-write → JSON.parse can throw
 * SyntaxError; the polling hook keeps the last good value in that case.
 */
export async function fetchMuninnStatus(signal?: AbortSignal): Promise<MuninnStatus> {
  const res = await fetch(`${BENCH_BASE}/api/status`, { signal });
  if (!res.ok) await parseError(res);
  assertJsonResponse(res);
  const text = await res.text();
  return JSON.parse(text) as MuninnStatus;
}

/** Mart slice catalog (GET /bench/mart/slices) — the whitelist a bench MCP
 *  `bench_list_slices` tool would expose. Used by the Research MCP API screen. */
export interface MartSliceDescriptor {
  id: string;
  required: string[];
  optional: string[];
}

export async function fetchMartCatalog(signal?: AbortSignal): Promise<MartSliceDescriptor[]> {
  const res = await fetch(`${BENCH_BASE}/mart/slices`, { signal });
  if (!res.ok) await parseError(res);
  assertJsonResponse(res);
  const body = (await res.json()) as { slices?: MartSliceDescriptor[] };
  return Array.isArray(body.slices) ? body.slices : [];
}

/** Execute a named mart slice (MuninnMartResource) and return its rows. */
export async function fetchMartSlice<T>(
  slice: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T[]> {
  const qs = params && Object.keys(params).length > 0
    ? '?' + new URLSearchParams(params).toString()
    : '';
  const res = await fetch(`${BENCH_BASE}/mart/slice/${encodeURIComponent(slice)}${qs}`, { signal });
  if (!res.ok) await parseError(res);
  assertJsonResponse(res);
  const body = (await res.json()) as { rows?: T[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

/** URL of a whitelisted benchmark-repo file (report iframe, links). */
export function muninnFileUrl(relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${BENCH_BASE}/files/${encoded}`;
}
