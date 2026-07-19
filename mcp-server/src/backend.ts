// Thin HTTP client for the UnlimitedLORE backend (:9100). The MCP server proxies
// this backend — it never talks to ArcadeDB directly, reusing the backend's
// named-slice composition + whitelisting. Writes carry either a bearer token
// (A2, once LORE_MCP_CLIENT_ID/SECRET are set) or the legacy X-Seer-Role header.

const BASE = (process.env.LORE_BACKEND_URL ?? 'http://localhost:9100').replace(/\/$/, '');
const ROLE = process.env.LORE_SEER_ROLE ?? 'admin';

// ADR-LORE-017: optional session-default "active project" — same place as LORE_BACKEND_URL/
// LORE_SEER_ROLE (one MCP server process = one client session/checkout). Read by query_slice
// (loreRead.ts) to default Tier-1 slices' `project` param when the caller omits it, and to
// warn (not block) when an explicit `project` differs from this default.
export const ACTIVE_PROJECT = process.env.LORE_ACTIVE_PROJECT || undefined;

// A2: client_credentials against the omilore realm's lore-mcp service account.
// Feature-gated on both env vars being set — until the realm is imported and
// these are configured, writeAuthHeaders() falls through to the X-Seer-Role
// header exactly as before. See docs/AUTH_OMILORE.md.
const OIDC_ISSUER    = process.env.LORE_OIDC_ISSUER;
const MCP_CLIENT_ID  = process.env.LORE_MCP_CLIENT_ID;
const MCP_CLIENT_SECRET = process.env.LORE_MCP_CLIENT_SECRET;
const OIDC_CONFIGURED = Boolean(OIDC_ISSUER && MCP_CLIENT_ID && MCP_CLIENT_SECRET);

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** Bearer token for the lore-mcp service account, cached until near expiry
 * (60s safety margin so a request never races a just-expired token). */
async function serviceAccountToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.accessToken;
  const res = await fetch(`${OIDC_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: MCP_CLIENT_ID as string,
      client_secret: MCP_CLIENT_SECRET as string,
    }),
  });
  if (!res.ok) throw new Error(`OIDC token request → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: body.access_token, expiresAt: now + (body.expires_in - 60) * 1000 };
  return cachedToken.accessToken;
}

async function writeAuthHeaders(): Promise<Record<string, string>> {
  if (!OIDC_CONFIGURED) return { 'X-Seer-Role': ROLE };
  return { Authorization: `Bearer ${await serviceAccountToken()}` };
}

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

/** POST a LORE write endpoint, authenticated per writeAuthHeaders() (see A2 above). */
export async function lorePost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await writeAuthHeaders()) },
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
  extraFields?: Record<string, string>,
): Promise<unknown> {
  const bytes = Buffer.from(base64Data, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType ?? 'application/octet-stream' }), filename);
  for (const [k, v] of Object.entries(extraFields ?? {})) form.append(k, v);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(await writeAuthHeaders()) },
    body: form,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

export const BACKEND_URL = BASE;
