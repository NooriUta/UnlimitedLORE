// Удаление ТЕСТОВЫХ учёток агента и человека (SPRINT_LORE_ADMIN_POLISH/AP-01,
// решение D-2026-ONLY-TEST-PREFIXED-ACCOUNTS).
//
// Сервер:
//   POST /lore/kc/agent-client/{clientId}/delete {dry_run?} — клиент KC (сервисного
//     пользователя KC удаляет вместе с ним) + актор агента в LORE;
//   POST /lore/user/{kc_sub}/delete {dry_run?} — агенты человека, его проектные роли
//     и вершина в LORE. Пользователя Keycloak LORE не удаляет никогда.
// Глоб «только тестовые» проверяет СЕРВЕР (403 TEST_ACCOUNTS_ONLY); здесь он лишь
// решает, показывать ли кнопку: у реальных учёток её нет — только выключить.
import type { DiffRow } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { LoreHttpError } from '../api/loreSlice';

/** Тот же глоб, что на сервере (TestAccountDelete.TEST_AGENT_CLIENT). */
export const TEST_AGENT_CLIENT = /^lore-mcp-[a-z_-]+_Test[A-Za-z0-9._-]*$/;
/** Тот же глоб, что на сервере (TestAccountDelete.TEST_PERSON_LOGIN). */
export const TEST_PERSON_LOGIN = /^test[A-Za-z0-9._@-]*$/i;

export const isTestAgentClient = (clientId: string | null | undefined): boolean =>
  typeof clientId === 'string' && TEST_AGENT_CLIENT.test(clientId);
export const isTestPersonLogin = (login: string | null | undefined): boolean =>
  typeof login === 'string' && TEST_PERSON_LOGIN.test(login);

export type TestDeleteKind = 'agent' | 'person';

export function testDeleteUrl(kind: TestDeleteKind, id: string): string {
  return kind === 'agent'
    ? `/lore/kc/agent-client/${encodeURIComponent(id)}/delete`
    : `/lore/user/${encodeURIComponent(id)}/delete`;
}

export async function postTestDelete(kind: TestDeleteKind, id: string, dryRun: boolean,
  fetchImpl: typeof fetch = loreFetch): Promise<Record<string, unknown>> {
  const res = await fetchImpl(testDeleteUrl(kind, id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ dry_run: dryRun }),
  });
  let body: Record<string, unknown> | null = null;
  try { body = (await res.json()) as Record<string, unknown>; } catch { body = null; }
  if (!res.ok || body === null) {
    throw new LoreHttpError(res.status, String(body?.error ?? (body === null ? 'NON_JSON' : '')), String(body?.detail ?? ''));
  }
  return body;
}

/** Подписи строк плана — от экрана (i18n). */
export interface PlanWords {
  kcClient: (id: string) => string;
  kcAbsent: (id: string) => string;
  kcServiceUser: (name: string) => string;
  kcRoles: string;
  rolesUnread: string;
  loreActor: (id: string) => string;
  owners: (names: string) => string;
  kcUserKept: (name: string) => string;
  loreUser: (name: string) => string;
  loreRole: (role: string, project: string) => string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const checked = { state: 'checked' as const };

function edgesText(v: unknown): string {
  return Object.entries(obj(v)).map(([k, n]) => `${k} ×${s(n)}`).join(', ');
}

/** Строки плана агента: что уйдёт в Keycloak и в LORE. */
export function agentPlanRows(plan: unknown, w: PlanWords): DiffRow[] {
  const p = obj(plan);
  const k = obj(p.keycloak);
  const id = s(p.client_id);
  const rows: DiffRow[] = [];
  if (k.state === 'present') {
    rows.push({ id: `kc:${id}`, kind: 'remove', text: w.kcClient(id), detail: s(k.client_uuid), check: checked });
    const sa = obj(k.service_account_user);
    if (sa.id) rows.push({ id: `kcsa:${s(sa.id)}`, kind: 'remove', text: w.kcServiceUser(s(sa.username)), detail: s(sa.id), check: checked });
    const roles = arr(k.roles).map(s);
    rows.push(k.roles_checked === false
      ? { id: `kcroles:${id}`, kind: 'remove', text: w.kcRoles, check: { state: 'unverified', reason: s(k.roles_note) || w.rolesUnread } }
      : { id: `kcroles:${id}`, kind: 'remove', text: w.kcRoles, detail: roles.join(', ') || '—', check: checked });
  } else {
    rows.push({ id: `kc:${id}`, kind: 'same', text: w.kcAbsent(id), check: checked });
  }
  for (const a of arr(obj(p.lore).actors).map(obj)) {
    const detail = [w.owners(arr(a.owners).map(s).join(', ') || '—'), s(a.agent_role), edgesText(a.edges)].filter(Boolean).join(' · ');
    rows.push({ id: `actor:${s(a.actor_id)}`, kind: 'remove', text: w.loreActor(s(a.actor_id)), detail, check: checked });
  }
  return rows;
}

/** Строки плана человека: пользователь KC остаётся; в LORE — вершина, роли, агенты. */
export function personPlanRows(plan: unknown, w: PlanWords): DiffRow[] {
  const p = obj(plan);
  const ku = obj(p.kc_user);
  const lore = obj(p.lore);
  const rows: DiffRow[] = [
    { id: `kcuser:${s(ku.id)}`, kind: 'same', text: w.kcUserKept(s(ku.username)), detail: s(ku.note), check: checked },
  ];
  const u = lore.user ? obj(lore.user) : null;
  if (u) rows.push({ id: `user:${s(u.kc_sub)}`, kind: 'remove', text: w.loreUser(s(u.display_name) || s(u.kc_sub)), detail: edgesText(u.edges), check: checked });
  for (const r of arr(lore.project_roles).map(obj)) {
    rows.push({ id: `role:${s(r.project)}`, kind: 'remove', text: w.loreRole(s(r.role), s(r.project)), check: checked });
  }
  for (const a of arr(p.agents)) rows.push(...agentPlanRows(a, w));
  return rows;
}

/** Помехи плана человека (реальный агент, последний owner): с ними применять нельзя. */
export function planBlockers(plan: unknown): string[] {
  return arr(obj(plan).blockers).map(s).filter(Boolean);
}
