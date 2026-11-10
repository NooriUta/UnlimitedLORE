// Доступ в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-10, S7B-12).
//
// Сервер (LoreAccessResource) уже на проде; здесь только чтение и разбор:
//   • GET /lore/admin/access?kc_sub&project&realm_role — почему человек видит /
//     не видит проект: итог, роль в проекте и цепочка рассуждения сервера;
//   • GET /lore/admin/access?project — кто видит проект;
//   • GET /lore/admin/access/agents?client_id&agent_scope — проекты агента
//     (наследует от владельца: читает все его проекты, пишет — по D4);
//   • GET /lore/admin/access/agents?kc_sub — агенты человека и «видят N».
// Ответ без обязательного поля — сбой, а не «не видит» и не ноль: итог
// доступа, выдуманный по пропуску, хуже честной ошибки.
import { getJson, type FetchOptions } from './actions';

export interface AccessExplain {
  project: string;
  realm_role: string | null;
  project_role: string | null;
  scope_enforced: boolean;
  sees: boolean;
  can_write: boolean;
  agent_profiles: string[];
  chain: string[];
}

export interface WhoSeesPerson { kc_sub: string; name: string; role: string | null; can_write: boolean }
export interface WhoSees {
  project: string;
  scope_enforced: boolean;
  people: WhoSeesPerson[];
  bypass_realm_roles: string[];
  note: string | null;
}

export interface AgentProjects {
  client_id: string;
  owner_kc_sub: string | null;
  visible: string[];
  writable: string[];
  inherited_from: string | null;
  reason: string | null;
}

export interface PersonAgents {
  agents: Array<{ actor_id: string; name: string | null; client_id: string | null }>;
  visible_projects: number;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null) : []);

/** Сервер прислал не то — бросаем: экран нарисует ошибку, а не «пусто». */
function malformed(what: string): never {
  throw new Error(`malformed answer: ${what}`);
}

export function parseExplain(raw: unknown): AccessExplain {
  const b = obj(raw);
  if (typeof b.sees !== 'boolean') malformed('sees');
  return {
    project: str(b.project) ?? '',
    realm_role: str(b.realm_role),
    project_role: str(b.project_role),
    scope_enforced: b.scope_enforced === true,
    sees: b.sees,
    can_write: b.can_write === true,
    agent_profiles: strs(b.agent_profiles),
    chain: strs(b.chain),
  };
}

export function parseWhoSees(raw: unknown): WhoSees {
  const b = obj(raw);
  if (!Array.isArray(b.people)) malformed('people');
  return {
    project: str(b.project) ?? '',
    scope_enforced: b.scope_enforced === true,
    people: b.people.map(obj).map(p => ({
      kc_sub: str(p.kc_sub) ?? '',
      name: str(p.display_name) ?? str(p.kc_sub) ?? '',
      role: str(p.role),
      can_write: p.can_write === true,
    })).filter(p => p.kc_sub !== ''),
    bypass_realm_roles: strs(b.bypass_realm_roles),
    note: str(b.note),
  };
}

export function parseAgentProjects(raw: unknown): AgentProjects {
  const b = obj(raw);
  if (!Array.isArray(b.visible)) malformed('visible');
  return {
    client_id: str(b.client_id) ?? '',
    owner_kc_sub: str(b.owner_kc_sub),
    visible: strs(b.visible).sort(),
    writable: strs(b.writable).sort(),
    inherited_from: str(b.inherited_from),
    reason: str(b.reason),
  };
}

export function parsePersonAgents(raw: unknown): PersonAgents {
  const b = obj(raw);
  if (!Array.isArray(b.agents) || typeof b.visible_projects !== 'number') malformed('agents/visible_projects');
  return {
    agents: b.agents.map(obj).map(a => ({ actor_id: str(a.actor_id) ?? '', name: str(a.name), client_id: str(a.client_id) }))
      .filter(a => a.actor_id !== ''),
    visible_projects: b.visible_projects,
  };
}

const qs = (p: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')).toString();

export async function fetchExplain(
  q: { kc_sub: string; project: string; realm_role?: string | null }, opts: FetchOptions = {},
): Promise<AccessExplain> {
  return parseExplain(await getJson(`/lore/admin/access?${qs(q)}`, opts));
}

export async function fetchWhoSees(project: string, opts: FetchOptions = {}): Promise<WhoSees> {
  return parseWhoSees(await getJson(`/lore/admin/access?${qs({ project })}`, opts));
}

export async function fetchAgentProjects(
  clientId: string, agentScope: string | null, opts: FetchOptions = {},
): Promise<AgentProjects> {
  return parseAgentProjects(await getJson(`/lore/admin/access/agents?${qs({ client_id: clientId, agent_scope: agentScope })}`, opts));
}

export async function fetchPersonAgents(kcSub: string, opts: FetchOptions = {}): Promise<PersonAgents> {
  return parsePersonAgents(await getJson(`/lore/admin/access/agents?${qs({ kc_sub: kcSub })}`, opts));
}
