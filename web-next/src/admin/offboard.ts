// UC-4 «Отключить человека» (SPRINT_UXR_S7B_ADMIN/S7B-20, прототип
// docs/prototypes/s7b-admin-v6.html, раздел UC-4). Модель без React.
//
// Инвентаризация «за человеком числится» собирается из того, что сервер уже
// отдаёт — новых вызовов нет:
//   • роли в проектах — срез role_matrix (roles.ts);
//   • агенты — срез agent_owners по владельцу (agents.ts), их учётки в KC —
//     GET /lore/kc/agents (enabled);
//   • учётка KC и её realm-роли — GET /lore/kc/users, какие роли снимаются
//     мостом — GET /lore/kc/realm-roles (grantable);
//   • машины — срез machine_acl с фильтром kc_sub (владеет / допущен).
//
// «Последний админ» считается здесь ТЕМИ ЖЕ правилами, что у сервера, чтобы
// кнопка была заблокирована с объяснением ещё до диффа:
//   • последний owner проекта — LoreUserResource.removalBlockedBecause (AL-100):
//     owner'ов проекта ≤ 1. Пробный прогон пачки (dry_run) этой проверки не
//     делает — сервер откажет только при применении, поэтому считаем заранее;
//   • последний admin realm'а — KcBridge.isLastAdminRemoval (AL-35): включённых
//     носителей admin/super-admin ≤ 1 и это он, снимается именно admin.
// Сервер остаётся последним словом: его отказ при применении всё равно покажет
// DangerBatch / KcDanger.
import type { DiffRow } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import type { AgentRow } from './agents';
import { parseMachineAcl, personMachines, type AccessRequest, type Machine } from './machines';
import type { RealmRoleOption } from './kc';
import type { CellState, RoleChange, RolesData } from './roles';
import type { KcUser } from './wizards';

// ── роли в проектах ───────────────────────────────────────────────────────

export interface OffRoleItem {
  project: string;
  role: string | null;
  state: CellState;
  /** Человек — единственный owner проекта: снятие сервер откажет (AL-100). */
  lastOwner: boolean;
}

export function offRoleItems(data: RolesData, kcSub: string): OffRoleItem[] {
  const person = data.people.find(p => p.kc_sub === kcSub);
  if (!person) return [];
  const owners = (project: string) =>
    data.people.filter(p => p.cells.some(c => c.project === project && c.role === 'owner')).length;
  return person.cells.map(c => ({
    project: c.project,
    role: c.role,
    state: c.state,
    // Срез обрезан — других owner'ов могли не дочитать: «последний» не утверждаем, решит сервер.
    lastOwner: c.role === 'owner' && !data.truncated && owners(c.project) <= 1,
  }));
}

/** Пачка «снять всё»: по строке на каждый проект человека. */
export function removeAllChanges(items: readonly OffRoleItem[]): RoleChange[] {
  return items.map(i => ({ project: i.project, action: 'remove' as const }));
}

// ── учётка Keycloak ───────────────────────────────────────────────────────

/** Сервер (KcBridge.ADMIN_ROLES) считает администрирующими эти две роли. */
export const ADMIN_REALM_ROLES: readonly string[] = ['admin', 'super-admin'];
/** super-admin мостом не выдаётся и не снимается (D11) — только руками в KC. */
const OUT_OF_BRIDGE = 'super-admin';

/**
 * Учётка человека в KC. kc_sub в графе — sub токена, то есть id пользователя
 * KC; у старых записей kc_sub бывает логином — тогда по логину. Имя из графа —
 * последняя попытка (display_name часто и есть логин).
 */
export function findKcAccount(users: readonly KcUser[], kcSub: string, name: string): KcUser | null {
  const low = (s: string) => s.trim().toLowerCase();
  return users.find(u => u.id === kcSub)
    ?? users.find(u => low(u.username) === low(kcSub))
    ?? users.find(u => low(u.username) === low(name))
    ?? null;
}

export function enabledAdminHolders(users: readonly KcUser[]): KcUser[] {
  return users.filter(u => u.enabled && u.roles.some(r => ADMIN_REALM_ROLES.includes(r)));
}

/** Снятие admin у этого человека оставит LORE без администратора (AL-35). */
export function isLastRealmAdmin(users: readonly KcUser[], user: KcUser): boolean {
  if (!user.roles.includes('admin')) return false;
  const holders = enabledAdminHolders(users);
  return holders.length <= 1 && holders.some(h => h.id === user.id);
}

export interface RealmItem {
  role: string;
  /** Снимается только руками в Keycloak (D11). */
  outOfBridge: boolean;
  /** Последний носитель admin — снятие заблокировано (AL-35). */
  lastAdmin: boolean;
}

/**
 * Realm-роли человека, которые имеют смысл для LORE: те, что мост знает
 * (realm-roles), плюс super-admin. Служебные роли KC (default-roles-*,
 * offline_access…) мост не отдаёт — снимать их при отключении не нужно.
 */
export function realmItems(user: KcUser, known: readonly RealmRoleOption[], users: readonly KcUser[]): RealmItem[] {
  const names = new Set(known.map(r => r.name));
  return user.roles
    .filter(r => names.has(r) || r === OUT_OF_BRIDGE)
    .map(role => {
      const outOfBridge = role === OUT_OF_BRIDGE || known.some(k => k.name === role && !k.grantable);
      return { role, outOfBridge, lastAdmin: role === 'admin' && isLastRealmAdmin(users, user) };
    });
}

// ── агенты ────────────────────────────────────────────────────────────────

export interface KcClientState { clientId: string; enabled: boolean | null }

/** Ответ GET /lore/kc/agents → состояние учёток. Не массив — сбой, а не «агентов нет». */
export function parseKcClients(raw: unknown): KcClientState[] {
  if (!Array.isArray(raw)) throw new Error('malformed answer: agents');
  return raw.map(c => (c ?? {}) as Record<string, unknown>)
    .filter(c => typeof c.clientId === 'string' && c.clientId !== '')
    .map(c => ({ clientId: String(c.clientId), enabled: typeof c.enabled === 'boolean' ? c.enabled : null }));
}

export interface AgentWords {
  /** У агента нет client_id — отключать в KC нечего. */
  noClient: string;
  /** Учётки с таким clientId в KC нет. */
  absent: string;
  /** KC не прочитался. */
  failed: (reason: string) => string;
}

/**
 * Строки диффа «отключить учётки агентов». Проверено — только то, что KC
 * подтвердил: включена → снимется, уже выключена → «уже так». Остальное —
 * «не проверено» с причиной, и в применение kit DiffPreview его не пустит.
 */
export function agentDiffRows(
  agents: readonly AgentRow[],
  clients: readonly KcClientState[] | { error: string },
  words: AgentWords,
): DiffRow[] {
  return agents.map(a => {
    const label = a.name ?? a.actor_id;
    if (!a.client_id) {
      return { id: a.actor_id, kind: 'remove' as const, text: label, check: { state: 'unverified' as const, reason: words.noClient } };
    }
    const text = `${label} · ${a.client_id}`;
    if (!Array.isArray(clients)) {
      return { id: a.client_id, kind: 'remove' as const, text, check: { state: 'unverified' as const, reason: words.failed((clients as { error: string }).error) } };
    }
    const c = clients.find(x => x.clientId === a.client_id);
    if (!c || c.enabled === null) {
      return { id: a.client_id, kind: 'remove' as const, text, check: { state: 'unverified' as const, reason: words.absent } };
    }
    return { id: a.client_id, kind: c.enabled ? 'remove' as const : 'same' as const, text, check: { state: 'checked' as const } };
  });
}

// ── допуски к машинам (S7B-ACL-1) ─────────────────────────────────────────
//
// Машины человека — срез machine_acl с фильтром kc_sub: строки, где он
// владелец или допущен. Допуск снимается запросом revoke
// (POST /lore/user/machine-access); владение запросом не снимается — машину
// передают или убирают в «Агентах», поэтому оно уходит в «осталось руками».

export interface OffMachineGrant { machine: Machine; role: string; projects: string[] }
export interface OffMachines { owned: Machine[]; granted: OffMachineGrant[] }

export function offMachineItems(ms: readonly Machine[], kcSub: string): OffMachines {
  const { owned, granted } = personMachines(ms, kcSub);
  return {
    owned: owned.map(o => o.machine),
    granted: granted.map(g => ({ machine: g.machine, role: g.role, projects: g.projects })),
  };
}

export function revokeMachineRequests(items: OffMachines, kcSub: string): AccessRequest[] {
  return items.granted.map(g => ({ machine_id: g.machine.machine_id, kc_sub: kcSub, action: 'revoke' as const }));
}

/** Срез machine_acl по человеку (фильтр kc_sub: владелец или допущен). */
export async function fetchPersonMachineAcl(kcSub: string, fetchImpl?: typeof fetch): Promise<Machine[]> {
  const body = await fetchSlice<Record<string, unknown>>('machine_acl', { kc_sub: kcSub, limit: '1000' }, { fetchImpl });
  return parseMachineAcl(body.rows);
}

/** POST /lore/kc/agent-client/{clientId}/disable — отмены у сервера нет. */
export async function disableAgentClient(clientId: string, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  const res = await fetchImpl(`/lore/kc/agent-client/${encodeURIComponent(clientId)}/disable`, {
    method: 'POST', headers: { Accept: 'application/json' },
  });
  let body: Record<string, unknown> | null = null;
  try { body = (await res.json()) as Record<string, unknown>; } catch { body = null; }
  if (!res.ok || body === null) {
    throw new LoreHttpError(res.status, String(body?.error ?? (body === null ? 'NON_JSON' : '')), String(body?.detail ?? ''));
  }
}
