// Паспорт машины и мастер «Новая машина» (SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT).
// Прототип docs/prototypes/ap-machine-passport.html (ветка feat/ap-machine-passport-proto), «да» владельца 25.11.
//
// Здесь — только данные и запросы; экраны — MachinePassportPage.tsx и NewMachineWizard.tsx.
// Источники:
//   • machines_graph / machine_by_id — машины графа (KnowMachine) со шлюзом, владельцем и агентами по ребру
//     USES_MACHINE; машина без шлюза — строка с пустым шлюзом (решение 3б: группа «Без шлюза»);
//   • agent_sessions?machine= — сессии на машине: блок «были сессией» (решение 2б);
//   • agent_actions?machine= — журнал действий машины (админский срез: не admin — 403, «не смогли проверить»);
//   • POST /lore/actor/machine — дверь machine_new: dry_run даёт план «было → станет», отказ MACHINE_TAKEN — 409.
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import { loreFetch } from '../auth/session';
import type { Machine } from './machines';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);
const first = (v: unknown): string | null => (Array.isArray(v) ? str(v.find(x => str(x) !== null)) : str(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null) : str(v) ? [String(v)] : []);

/**
 * Адрес паспорта машины в админке — свой, им можно поделиться (решение 1: «по машинам только админку»).
 * Только для экранов админки: общие поверхности в админку не ведут (сторож nav/noAdminLinks.test.ts), поэтому
 * recordHref('machine') вне админки — null, как у типа без раздела.
 */
export const MACHINE_OPEN_PARAM = 'adm-macl-open';
export function machinePassportHref(id: string): string {
  return `/?mod=admin&sec=adm-machines&${MACHINE_OPEN_PARAM}=${encodeURIComponent(id)}`;
}

/** Машина графа (KnowMachine) со шлюзом и агентами по ребру. */
export interface GraphMachine {
  machine_id: string;
  gateway: string | null;
  gateway_name: string | null;
  harness: string | null;
  owner: string | null;
  owner_name: string | null;
  last_seen_at: string | null;
  first_seen_at: string | null;
  /** Агенты по ребру USES_MACHINE (actor_id), шлюз — среди них, если ребро у него есть. */
  agent_ids: string[];
  agent_clients: string[];
}

export function parseGraphMachine(r: Readonly<Record<string, unknown>>): GraphMachine | null {
  const id = str(r.machine_id);
  if (!id) return null;
  return {
    machine_id: id,
    gateway: first(r.gateway),
    gateway_name: first(r.gateway_name),
    harness: first(r.harness),
    owner: first(r.owner),
    owner_name: first(r.owner_name),
    last_seen_at: str(r.last_seen_at),
    first_seen_at: str(r.first_seen_at),
    agent_ids: strs(r.agent_ids),
    agent_clients: strs(r.agent_clients),
  };
}

export function parseGraphMachines(rows: ReadonlyArray<Record<string, unknown>>): GraphMachine[] {
  return rows.map(parseGraphMachine).filter((m): m is GraphMachine => m !== null);
}

export async function fetchGraphMachines(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<GraphMachine[]> {
  const body = await fetchSlice<Record<string, unknown>>('machines_graph', { limit: '1000' }, { signal, fetchImpl });
  return parseGraphMachines(body.rows);
}

/** Строка паспорта; null — машины с таким именем в графе нет (это не сбой чтения). */
export async function fetchGraphMachine(id: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<GraphMachine | null> {
  const body = await fetchSlice<Record<string, unknown>>('machine_by_id', { id }, { signal, fetchImpl });
  return body.rows.length ? parseGraphMachine(body.rows[0]) : null;
}

/**
 * Решение 3б: машины графа без шлюза — машина появилась сама по записи агента, а актора minilore-link-<имя> нет.
 * Машина, у которой шлюз есть в machine_acl, сюда не попадает, даже если срез графа её шлюза не нашёл.
 */
export function withoutGateway(graph: readonly GraphMachine[], acl: readonly Pick<Machine, 'machine_id'>[]): GraphMachine[] {
  const known = new Set(acl.map(m => m.machine_id));
  return graph.filter(g => !g.gateway && !known.has(g.machine_id));
}

/** Агенты машины по ребру, без самого шлюза (у прототипа «Агенты» шлюз не считают). */
export function edgeAgents(m: GraphMachine): string[] {
  return m.agent_ids.filter((id, i) => !(m.agent_clients[i] ?? '').startsWith('minilore-link-') && id !== m.gateway);
}

// ── «были сессией» (решение 2б) ─────────────────────────────────────────

export interface SessionRow {
  session_id: string;
  dialogue_name: string | null;
  project: string | null;
  last_activity_at: string | null;
  actor_ids: string[];
}

export function parseSessions(rows: ReadonlyArray<Record<string, unknown>>): SessionRow[] {
  return rows.flatMap(r => {
    const id = str(r.session_id);
    return id ? [{
      session_id: id, dialogue_name: str(r.dialogue_name), project: str(r.project),
      last_activity_at: str(r.last_activity_at), actor_ids: strs(r.actor_ids),
    }] : [];
  });
}

export async function fetchMachineSessions(id: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<SessionRow[]> {
  const body = await fetchSlice<Record<string, unknown>>('agent_sessions', { machine: id }, { signal, fetchImpl });
  return parseSessions(body.rows);
}

/** Агент, бывший на машине сессией, но без ребра USES_MACHINE; actor_id null — сессия без записанного агента. */
export interface SessionOnly { actor_id: string | null; session_id: string; dialogue_name: string | null; last_activity_at: string | null }

/**
 * Ребро ставит сервер только на ЗАПИСИ агента: агент, который на машине только читал, ребра не получает.
 * Строка на агента (последняя его сессия); сессия без агента — отдельной строкой «агент не записан».
 */
export function sessionOnly(sessions: readonly SessionRow[], edge: readonly string[]): SessionOnly[] {
  const bound = new Set(edge);
  const out: SessionOnly[] = [];
  const seen = new Set<string>();
  for (const s of sessions) {
    if (s.actor_ids.length === 0) {
      out.push({ actor_id: null, session_id: s.session_id, dialogue_name: s.dialogue_name, last_activity_at: s.last_activity_at });
      continue;
    }
    for (const a of s.actor_ids) {
      if (bound.has(a) || seen.has(a)) continue;
      seen.add(a);
      out.push({ actor_id: a, session_id: s.session_id, dialogue_name: s.dialogue_name, last_activity_at: s.last_activity_at });
    }
  }
  return out;
}

// ── журнал машины ────────────────────────────────────────────────────────

export interface ActionRow { ts: string | null; family: string | null; entity_id: string | null; client: string | null; status: string | null }

export const ACTIONS_LIMIT = 50;

export async function fetchMachineActions(id: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<ActionRow[]> {
  const body = await fetchSlice<Record<string, unknown>>('agent_actions', { machine: id, limit: String(ACTIONS_LIMIT) }, { signal, fetchImpl });
  return body.rows.map(r => ({
    ts: str(r.ts), family: str(r.family), entity_id: str(r.entity_id), client: str(r.client), status: str(r.status),
  }));
}

// ── дверь machine_new ────────────────────────────────────────────────────

export interface EnrollRequest { machine_id: string; kc_sub?: string | null; harness?: string | null; name?: string | null; profile?: string | null; dry_run?: boolean }

export interface EnrollSide { actor_id?: string | null; client_id?: string | null; machine_id?: string | null; owner_kc_sub?: string | null; harness?: string | null; name?: string | null }

export interface EnrollAnswer {
  machine_id: string;
  client_id: string;
  kind: 'create' | 'update' | 'unchanged' | string;
  before: EnrollSide | null;
  after: EnrollSide;
  agents_to_link: string[];
  /** Находка 3: у кого ребро уже есть; старый сервер поля не отдаёт — null («не знаем»), а не пусто. */
  agents_linked: string[] | null;
  outcome: string | null;
  owner_linked: boolean | null;
  reason: string | null;
}

export function parseEnroll(body: unknown): EnrollAnswer {
  const b = (body ?? {}) as Record<string, unknown>;
  const plan = (b.plan ?? {}) as Record<string, unknown>;
  return {
    machine_id: str(b.machine_id) ?? '',
    client_id: str(b.client_id) ?? '',
    kind: str(plan.kind) ?? '',
    before: plan.before && typeof plan.before === 'object' ? plan.before as EnrollSide : null,
    after: (plan.after && typeof plan.after === 'object' ? plan.after : {}) as EnrollSide,
    agents_to_link: strs(b.agents_to_link),
    agents_linked: Array.isArray(b.agents_linked) ? strs(b.agents_linked) : null,
    outcome: str(b.outcome),
    owner_linked: typeof b.owner_linked === 'boolean' ? b.owner_linked : null,
    reason: str(b.reason),
  };
}

export async function postEnroll(req: EnrollRequest, fetchImpl: typeof fetch = loreFetch): Promise<EnrollAnswer> {
  const payload: Record<string, unknown> = { machine_id: req.machine_id };
  if (req.kc_sub) payload.kc_sub = req.kc_sub;
  if (req.harness) payload.harness = req.harness;
  if (req.name) payload.name = req.name;
  if (req.profile) payload.profile = req.profile;
  if (req.dry_run) payload.dry_run = true;
  const res = await fetchImpl('/lore/actor/machine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* не JSON — сбой ниже */ }
  if (!res.ok || body === null) {
    const e = (body ?? {}) as { error?: string; detail?: string };
    throw new LoreHttpError(res.status, e.error ?? (body === null ? 'NON_JSON' : ''), e.detail ?? res.statusText);
  }
  return parseEnroll(body);
}

/** Строка плана «было → станет»; same — значение не меняется. */
export interface PlanRow { key: 'gateway' | 'client' | 'machine' | 'owner' | 'harness' | 'name'; before: string | null; after: string | null; same: boolean }

export function planRows(a: EnrollAnswer): PlanRow[] {
  const b = a.before;
  const row = (key: PlanRow['key'], before: string | null | undefined, after: string | null | undefined): PlanRow => ({
    key, before: before ?? null, after: after ?? null, same: b !== null && (before ?? null) === (after ?? null),
  });
  return [
    row('gateway', b?.actor_id, a.after.actor_id),
    row('client', b ? a.client_id : null, a.after.client_id ?? a.client_id),
    row('machine', b ? a.machine_id : null, a.after.machine_id ?? a.machine_id),
    row('owner', b?.owner_kc_sub, a.after.owner_kc_sub),
    row('harness', b?.harness, a.after.harness),
    row('name', b?.name, a.after.name),
  ];
}

/** Строка «агенты»: будет привязан / уже привязан (находка 3 — сверка с ребром на стороне экрана тоже). */
export interface AgentPlan { actor_id: string; state: 'link' | 'linked' }

export function agentPlan(a: EnrollAnswer, edge: readonly string[] = []): AgentPlan[] {
  const linked = new Set([...(a.agents_linked ?? []), ...edge]);
  const out: AgentPlan[] = [];
  for (const id of a.agents_to_link) out.push({ actor_id: id, state: linked.has(id) ? 'linked' : 'link' });
  for (const id of a.agents_linked ?? []) if (!a.agents_to_link.includes(id)) out.push({ actor_id: id, state: 'linked' });
  return out;
}

/** Имя машины без префикса учётки и в нижнем регистре — как канонизирует сервер (PU-18). */
export const MACHINE_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export type MachineIdProblem = 'empty' | 'chars' | 'prefix' | null;
export function machineIdProblem(raw: string): MachineIdProblem {
  const v = raw.trim();
  if (!v) return 'empty';
  if (v.toLowerCase().startsWith('minilore-link-')) return 'prefix';
  return MACHINE_ID_RE.test(v) ? null : 'chars';
}
