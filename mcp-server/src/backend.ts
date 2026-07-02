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
export async function muninnSlices(): Promise<unknown> {
  const res = await fetch(`${BASE}/bench/mart/slices`);
  if (!res.ok) throw new Error(`GET /bench/mart/slices → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET /bench/mart/slice/{slice} — rows for a named experiment-mart slice. */
export async function muninnSlice(
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
export async function muninnStatus(): Promise<unknown> {
  const res = await fetch(`${BASE}/bench/api/status`);
  if (!res.ok) throw new Error(`GET /bench/api/status → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET an arbitrary LORE read endpoint (not a whitelisted named slice) with query params. */
export async function loreGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await fetch(`${BASE}${path}${qs}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await detail(res)}`);
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

/** POST a base64-encoded file to a multipart LORE upload endpoint (e.g. BRAGI
 * asset uploads) — agent-driven callers have no filesystem/browser file
 * picker, so they send base64 bytes + filename instead. */
export async function loreUpload(
  path: string,
  filename: string,
  base64Data: string,
  contentType?: string,
): Promise<unknown> {
  const bytes = Buffer.from(base64Data, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType ?? 'application/octet-stream' }), filename);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'X-Seer-Role': ROLE },
    body: form,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

export const BACKEND_URL = BASE;
