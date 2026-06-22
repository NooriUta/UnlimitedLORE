// Thin HTTP client for the UnlimitedLORE backend (:9100). The MCP server proxies
// this backend — it never talks to ArcadeDB directly, reusing the backend's
// named-slice composition + whitelisting. Writes carry the X-Seer-Role header.

const BASE = (process.env.LORE_BACKEND_URL ?? 'http://localhost:9100').replace(/\/$/, '');
const ROLE = process.env.LORE_SEER_ROLE ?? 'admin';

async function detail(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return '';
  }
}

/** GET /lore/slices — catalog of named slices with their required/optional params. */
export async function loreSlices(): Promise<unknown> {
  const res = await fetch(`${BASE}/lore/slices`);
  if (!res.ok) throw new Error(`GET /lore/slices → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET /lore/slice/{slice} — rows for a named read slice. */
export async function loreSlice(
  slice: string,
  params?: Record<string, string>,
): Promise<unknown[]> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await fetch(`${BASE}/lore/slice/${encodeURIComponent(slice)}${qs}`);
  if (!res.ok) throw new Error(`GET /lore/slice/${slice} → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as { rows?: unknown[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

/** GET /bench/mart/slices — catalog of RAGVSDL experiment-mart slices. */
export async function benchSlices(): Promise<unknown> {
  const res = await fetch(`${BASE}/bench/mart/slices`);
  if (!res.ok) throw new Error(`GET /bench/mart/slices → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET /bench/mart/slice/{slice} — rows for a named experiment-mart slice. */
export async function benchSlice(
  slice: string,
  params?: Record<string, string>,
): Promise<unknown[]> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await fetch(`${BASE}/bench/mart/slice/${encodeURIComponent(slice)}${qs}`);
  if (!res.ok) throw new Error(`GET /bench/mart/slice/${slice} → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as { rows?: unknown[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

/** GET /bench/api/status — live STATUS.json of the running experiment cell. */
export async function benchStatus(): Promise<unknown> {
  const res = await fetch(`${BASE}/bench/api/status`);
  if (!res.ok) throw new Error(`GET /bench/api/status → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** POST a LORE write endpoint with the admin role header. */
export async function lorePost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': ROLE },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

export const BACKEND_URL = BASE;
