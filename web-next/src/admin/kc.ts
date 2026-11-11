// Опасные действия Keycloak в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-03).
//
// Тот же путь, что у ролей проектов (DangerBatch): дифф с сервера (dry_run) →
// ввод подтверждения → применение → «Отменить» в окне → запись в журнале AO-01.
//
//   • POST /lore/kc/user/{id}/role {role, action add|remove, dry_run?, undo_of?}
//     — выдача/снятие realm-роли (LoreKcResource.setUserRole + KcDanger). Отмена —
//     обратный вызов (undo) с undo_of=op_id, пока открыто окно;
//   • POST /lore/kc/agent/{id}/rotate {dry_run?} — ротация секрета агента.
//     Отмены НЕТ: Keycloak делает старый секрет недействительным сразу, а LORE
//     его не хранит. Это не «пока не сделано» — сервер так и отвечает
//     (undoable:false + причина), и экран говорит это словами.
//
// Секрет живёт только в ответе и в kit SecretOnce: ни адреса, ни хранилища, ни
// текста ошибки здесь он не касается.
import type { BatchResult, DiffCheck, DiffRow } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { LoreHttpError } from '../api/loreSlice';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function checkOf(raw: unknown): DiffCheck {
  const c = (raw ?? null) as Record<string, unknown> | null;
  const reason = c ? str(c.source) ?? undefined : undefined;
  if (c?.state === 'checked') return { state: 'checked' };
  if (c?.state === 'forbidden') return { state: 'forbidden', reason };
  return { state: 'unverified', reason };
}

const planRows = (body: unknown): Array<Record<string, unknown>> => {
  const b = (body ?? {}) as Record<string, unknown>;
  return (Array.isArray(b.plan) ? b.plan : []).map(r => (r ?? {}) as Record<string, unknown>);
};

// ── realm-роль ────────────────────────────────────────────────────────────

export type RealmAction = 'add' | 'remove';
export interface RealmUndo { role: string; action: RealmAction }

/** План сервера → строки kit DiffPreview: grant → add, remove → remove, unchanged → same. */
export function parseRealmPlan(body: unknown): DiffRow[] {
  return planRows(body).map(o => {
    const role = String(o.role ?? '');
    const kind = o.kind === 'remove' ? 'remove' : o.kind === 'unchanged' ? 'same' : 'add';
    return { id: role, kind, text: `realm · ${role}`, check: checkOf(o.check) };
  });
}

export interface RealmApply { batch: BatchResult; undo: RealmUndo | null }

/** Применение — «пачка» из одного действия: kit BatchUndo рисует итог и окно отмены. */
export function parseRealmApply(body: unknown): RealmApply {
  const b = (body ?? {}) as Record<string, unknown>;
  const u = (b.undo ?? null) as Record<string, unknown> | null;
  const undo = u && str(u.role) && (u.action === 'add' || u.action === 'remove')
    ? { role: String(u.role), action: u.action as RealmAction }
    : null;
  const until = str(b.undo_until);
  return {
    // Обратного вызова нет — нет и окна: «Отменить» без того, чем отменять, было бы обманкой.
    batch: { id: str(b.op_id) ?? '', applied: 1, total: 1, failed: [], undoUntil: undo ? until : null },
    undo,
  };
}

export interface RealmRequest { role: string; action: RealmAction; dry_run?: boolean; undo_of?: string }

export function postRealmRole(userId: string, req: RealmRequest, fetchImpl: typeof fetch = loreFetch): Promise<unknown> {
  return postJson(`/lore/kc/user/${encodeURIComponent(userId)}/role`, req, fetchImpl);
}

export interface RealmRoleOption { name: string; grantable: boolean }

export async function fetchRealmRoles(fetchImpl: typeof fetch = loreFetch): Promise<RealmRoleOption[]> {
  const res = await fetchImpl('/lore/kc/realm-roles', { headers: { Accept: 'application/json' } });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body)) throw httpError(res.status, body);
  return body.map(r => (r ?? {}) as Record<string, unknown>)
    .filter(r => str(r.name) !== null)
    .map(r => ({ name: String(r.name), grantable: r.grantable === true }));
}

// ── ротация секрета ───────────────────────────────────────────────────────

export interface RotationPlan {
  clientId: string | null;
  rows: DiffRow[];
  /** Всегда false: сервер не сказал — обратимость не выдумываем. */
  undoable: false;
  undoReason: string | null;
}

export function parseRotationPlan(body: unknown): RotationPlan {
  const b = (body ?? {}) as Record<string, unknown>;
  const clientId = str(b.client_id);
  const rows: DiffRow[] = planRows(body).map(o => {
    const id = str(o.client_id) ?? clientId ?? '';
    return { id, kind: 'add', text: id, check: checkOf(o.check) };
  });
  return { clientId, rows, undoable: false, undoReason: str(b.undo_reason) };
}

export interface Rotation { clientId: string | null; secret: string | null; undoReason: string | null }

export function parseRotation(body: unknown): Rotation {
  const b = (body ?? {}) as Record<string, unknown>;
  return { clientId: str(b.client_id), secret: str(b.secret), undoReason: str(b.undo_reason) };
}

export function postRotate(clientId: string, dryRun: boolean, fetchImpl: typeof fetch = loreFetch): Promise<unknown> {
  return postJson(`/lore/kc/agent/${encodeURIComponent(clientId)}/rotate`, dryRun ? { dry_run: true } : {}, fetchImpl);
}

// ── общее ─────────────────────────────────────────────────────────────────

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

function httpError(status: number, body: unknown): LoreHttpError {
  const b = (body ?? null) as Record<string, unknown> | null;
  return new LoreHttpError(status, String(b?.error ?? (b === null ? 'NON_JSON' : '')), String(b?.detail ?? ''));
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
