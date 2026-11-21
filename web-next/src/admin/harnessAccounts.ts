// «Гирлянда» учёток MCP одного harness (SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH, 1.18.2).
//
// Сервер (LoreKcResource + HarnessAccounts):
//   GET  /lore/kc/harness → {harness:[{code, main, suffix}]} — из модели, без Keycloak;
//   GET  /lore/kc/harness/{h}/accounts → {harness, main, kc:{state, reason?}, infisical, nodes:[…]} —
//        узел: role, level, is_main, client_id, secret_key, issuable, refusal (словами сервера),
//        account: {state: issued|absent|unknown, reason?, enabled, secret_created_at, rotated_at, switched};
//   POST /lore/kc/agent-client {profile, harness} — выпуск; ответ несёт secret (один раз) и infisical_*;
//   POST /lore/kc/agent-client/{id}/enable|disable — включить/выключить; смена секрета — RotateDanger (kc.ts).
//
// Честные состояния: KC не настроен / недоступен (unknown) ≠ учётки нет (absent) ≠ дерево пусто.
// Секрет живёт только в ответе выпуска и в kit SecretOnce.
import { loreFetch } from '../auth/session';
import { LoreHttpError } from '../api/loreSlice';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export interface HarnessRef { code: string; main: string | null; suffix: string }

export type KcState = 'checked' | 'not_configured' | 'unavailable';

export interface Switched { seen: boolean | null; at: string | null; reason: string | null }

export type Account =
  | { state: 'issued'; enabled: boolean; secretCreatedAt: string | null; rotatedAt: string | null; oldSecretActive: boolean | null; switched: Switched }
  | { state: 'absent' }
  | { state: 'unknown'; reason: string | null };

export interface AccountNode {
  role: string;
  level: number;
  isMain: boolean;
  clientId: string;
  secretKey: string;
  issuable: boolean;
  refusal: string | null;
  about: string | null;
  account: Account;
}

export interface HarnessAccountsData {
  harness: string;
  main: string | null;
  kc: { state: KcState; reason: string | null };
  infisical: 'configured' | 'not_configured' | null;
  nodes: AccountNode[];
}

function parseAccount(v: unknown): Account {
  const a = (v ?? {}) as Record<string, unknown>;
  if (a.state === 'absent') return { state: 'absent' };
  if (a.state === 'issued') {
    const s = (a.switched ?? {}) as Record<string, unknown>;
    return {
      state: 'issued',
      enabled: a.enabled === true,
      secretCreatedAt: str(a.secret_created_at),
      rotatedAt: str(a.rotated_at),
      oldSecretActive: typeof a.old_secret_active === 'boolean' ? a.old_secret_active : null,
      switched: { seen: typeof s.seen === 'boolean' ? s.seen : null, at: str(s.at), reason: str(s.reason) },
    };
  }
  // Незнакомое состояние — «не смогли проверить», а не «нет учётки».
  return { state: 'unknown', reason: str(a.reason) };
}

export function parseHarnessAccounts(raw: unknown): HarnessAccountsData {
  const b = (raw ?? {}) as Record<string, unknown>;
  const kc = (b.kc ?? {}) as Record<string, unknown>;
  const kcState: KcState = kc.state === 'checked' || kc.state === 'not_configured' ? kc.state : 'unavailable';
  const nodes = (Array.isArray(b.nodes) ? b.nodes : []).map(n => (n ?? {}) as Record<string, unknown>)
    .filter(n => str(n.role) !== null && str(n.client_id) !== null)
    .map(n => ({
      role: String(n.role),
      level: typeof n.level === 'number' ? n.level : 0,
      isMain: n.is_main === true,
      clientId: String(n.client_id),
      secretKey: str(n.secret_key) ?? '',
      issuable: n.issuable === true,
      refusal: str(n.refusal),
      about: str(n.about),
      account: parseAccount(n.account),
    }));
  return {
    harness: str(b.harness) ?? '',
    main: str(b.main),
    kc: { state: kcState, reason: str(kc.reason) },
    infisical: b.infisical === 'configured' || b.infisical === 'not_configured' ? b.infisical : null,
    nodes,
  };
}

export function parseHarnessList(raw: unknown): HarnessRef[] {
  const b = (raw ?? {}) as Record<string, unknown>;
  return (Array.isArray(b.harness) ? b.harness : []).map(h => (h ?? {}) as Record<string, unknown>)
    .filter(h => str(h.code) !== null)
    .map(h => ({ code: String(h.code), main: str(h.main), suffix: typeof h.suffix === 'string' ? h.suffix : '' }));
}

/** Итог записи в Infisical из ответа выпуска / смены секрета; null — сервер не сказал. */
export interface InfisicalOutcome { written: boolean; state: string; reason: string | null }

export function parseInfisical(raw: unknown): InfisicalOutcome | null {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (typeof b.infisical_written !== 'boolean') return null;
  return { written: b.infisical_written, state: str(b.infisical_state) ?? (b.infisical_written ? 'written' : 'failed'), reason: str(b.infisical_reason) };
}

export interface Issued { clientId: string; secret: string | null; secretKey: string | null; infisical: InfisicalOutcome | null }

export function parseIssuedAccount(raw: unknown): Issued {
  const b = (raw ?? {}) as Record<string, unknown>;
  const clientId = str(b.clientId);
  if (!clientId) throw new Error('malformed answer: clientId');
  return { clientId, secret: str(b.secret), secretKey: str(b.secret_key), infisical: parseInfisical(b) };
}

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

function httpError(status: number, body: unknown): LoreHttpError {
  const b = (body ?? null) as Record<string, unknown> | null;
  return new LoreHttpError(status, String(b?.error ?? (b === null ? 'NON_JSON' : '')), String(b?.detail ?? ''));
}

async function getJson(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  const body = await readJson(res);
  if (!res.ok || body === null) throw httpError(res.status, body);
  return body;
}

async function postJson(url: string, req: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(req),
  });
  const body = await readJson(res);
  if (!res.ok || body === null) throw httpError(res.status, body);
  return body;
}

export async function fetchHarnessList(signal?: AbortSignal, fetchImpl: typeof fetch = loreFetch): Promise<HarnessRef[]> {
  return parseHarnessList(await getJson('/lore/kc/harness', fetchImpl, signal));
}

export async function fetchHarnessAccounts(harness: string, signal?: AbortSignal, fetchImpl: typeof fetch = loreFetch): Promise<HarnessAccountsData> {
  return parseHarnessAccounts(await getJson(`/lore/kc/harness/${encodeURIComponent(harness)}/accounts`, fetchImpl, signal));
}

export async function issueHarnessAccount(role: string, harness: string, fetchImpl: typeof fetch = loreFetch): Promise<Issued> {
  return parseIssuedAccount(await postJson('/lore/kc/agent-client', { profile: role, harness }, fetchImpl));
}

export async function setAccountEnabled(clientId: string, on: boolean, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  await postJson(`/lore/kc/agent-client/${encodeURIComponent(clientId)}/${on ? 'enable' : 'disable'}`, {}, fetchImpl);
}
