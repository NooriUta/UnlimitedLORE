// Мастера админки UC-1 / UC-2 / UC-7 (SPRINT_UXR_S7B_ADMIN/S7B-17, прототип
// docs/prototypes/s7b-admin-v6.html). Здесь — данные и обращения к серверу;
// экраны собраны из готовых элементов kit (Steps · SecretOnce · DiffPreview ·
// BatchUndo) в WizardsScreen.tsx.
//
// Сервер у всех трёх мастеров уже есть, мастер только собирает шаги:
//   • учётка человека — GET /lore/kc/users, заведение — POST /lore/kc/user
//     (без пароля: LORE паролей не хранит, пароль — «осталось руками»);
//   • проекты «как у похожего» — срез role_matrix; применение — пачка
//     POST /lore/user/role/batch тем же DangerBatch, что у «Ролей»;
//   • учётка агента — POST /lore/kc/agent-client {profile, machine}: клиент
//     KC lore-mcp-<профиль>_<машина> по шаблону профиля, секрет — один раз;
//   • агент в графе — POST /lore/actor (kind agent) и POST /lore/actor/owner
//     (владелец, профиль, машина): без владельца агенту не от кого наследовать
//     проекты (AL-68).
//
// Секрет здесь не хранится и никуда не пишется: он живёт в ответе сервера и в
// kit SecretOnce. В .mcp.json и в команде он — ссылка на переменную окружения.
import { loreFetch } from '../auth/session';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import type { AgentRow } from './agents';
import type { RoleChange, RolesData } from './roles';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

// ── учётка человека в Keycloak ───────────────────────────────────────────

export interface KcUser { id: string; username: string; email: string | null; enabled: boolean; roles: string[] }

/** Ответ GET /lore/kc/users. Не массив — сбой, а не «никого нет». */
export function parseKcUsers(raw: unknown): KcUser[] {
  if (!Array.isArray(raw)) throw new Error('malformed answer: users');
  return raw.map(u => (u ?? {}) as Record<string, unknown>)
    .filter(u => str(u.id) && str(u.username))
    .map(u => ({
      id: String(u.id),
      username: String(u.username),
      email: str(u.email),
      enabled: u.enabled !== false,
      roles: Array.isArray(u.roles) ? u.roles.map(String) : [],
    }));
}

/**
 * Поиск по логину или почте без учёта регистра.
 * undefined — искать нечего (пусто); null — искали и не нашли.
 */
export function findKcUser(users: readonly KcUser[], q: string): KcUser | null | undefined {
  const s = q.trim().toLowerCase();
  if (s === '') return undefined;
  return users.find(u => u.username.toLowerCase() === s || (u.email ?? '').toLowerCase() === s) ?? null;
}

/** Логин из почты: часть до @. Логин без @ — сам запрос. */
export function loginOf(q: string): string {
  const s = q.trim();
  const at = s.indexOf('@');
  return (at > 0 ? s.slice(0, at) : s).toLowerCase();
}

export async function fetchKcUsers(fetchImpl: typeof fetch = loreFetch): Promise<KcUser[]> {
  return parseKcUsers(await getJson('/lore/kc/users', fetchImpl));
}

export async function createKcUser(username: string, email: string | null, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  await postJson('/lore/kc/user', { username, email }, fetchImpl);
}

// ── проекты «как у похожего» ─────────────────────────────────────────────

/**
 * Пачка ролей «как у похожего»: его ПРОВЕРЕННЫЕ роли в проектах, кроме снятых
 * галочек; роль проекта можно сменить. Непроверенная ячейка в пачку не идёт —
 * копировать то, чего сервер не подтвердил, значит раздать догадку.
 */
export function likeChanges(
  data: RolesData,
  likeSub: string,
  excluded: ReadonlySet<string>,
  override: Readonly<Record<string, string>>,
): RoleChange[] {
  const p = data.people.find(x => x.kc_sub === likeSub);
  if (!p) return [];
  return p.cells
    .filter(c => c.state === 'checked' && c.role && !excluded.has(c.project))
    .map(c => ({ project: c.project, role: override[c.project] ?? (c.role as string) }))
    .sort((a, b) => a.project.localeCompare(b.project));
}

// ── агент: профиль, машина, учётка ───────────────────────────────────────

const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TEMPLATE = /^lore-mcp-([A-Za-z0-9][A-Za-z0-9.-]{0,63})$/;

/**
 * Профили агента — шаблоны lore-mcp-<профиль> среди клиентов KC. Машинные
 * клиенты (lore-mcp-<профиль>_<машина>) и чужие клиенты — не профили.
 */
export function templateProfiles(clients: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of clients) {
    const id = str(((raw ?? {}) as Record<string, unknown>).clientId);
    const m = id ? TEMPLATE.exec(id) : null;
    if (m) out.add(m[1]);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Имя клиента — то же правило, что у сервера (LoreKcAgentClient.clientId). */
export function agentClientIdOf(profile: string, machine: string): string {
  return `lore-mcp-${profile}_${machine}`;
}

export type MachineProblem = 'empty' | 'chars';

/** Что не так с именем машины; null — годится. */
export function machineProblem(name: string): MachineProblem | null {
  const s = name.trim();
  if (s === '') return 'empty';
  return PART.test(s) ? null : 'chars';
}

/**
 * Машина занята агентом ДРУГОГО владельца — его имя; своя или свободная — null.
 * Две машины одного человека с одним именем — это одна машина.
 */
export function machineTakenBy(rows: readonly AgentRow[], machine: string, meSub: string | null): string | null {
  const m = machine.trim();
  if (!m) return null;
  const other = rows.find(r => r.machine_id === m && r.owner_kc_subs.length > 0 && !r.owner_kc_subs.includes(meSub ?? ''));
  return other ? (other.owner_display_name ?? other.owner_kc_subs.join(', ')) : null;
}

export async function fetchKcClients(fetchImpl: typeof fetch = loreFetch): Promise<unknown[]> {
  const b = await getJson('/lore/kc/agents', fetchImpl);
  if (!Array.isArray(b)) throw new Error('malformed answer: agents');
  return b;
}

export interface IssuedAgent { clientId: string; secret: string | null; rolesCopied: string[]; rolesNote: string | null }

export function parseIssued(raw: unknown): IssuedAgent {
  const b = (raw ?? {}) as Record<string, unknown>;
  const clientId = str(b.clientId);
  if (!clientId) throw new Error('malformed answer: clientId');
  return {
    clientId,
    secret: str(b.secret),
    rolesCopied: Array.isArray(b.roles_copied) ? b.roles_copied.map(String) : [],
    rolesNote: str(b.roles_note),
  };
}

export interface IssueRequest { profile: string; machine: string; ownerSub: string; harness?: string | null }

/**
 * Учётка агента целиком: клиент KC с секретом → актор-агент в графе →
 * владелец, профиль и машина. Учётка KC без актора — сирота, которой не от
 * кого наследовать проекты; поэтому сбой привязки возвращается вместе с уже
 * выданным секретом, а не теряет его.
 */
export async function issueAgent(req: IssueRequest, fetchImpl: typeof fetch = loreFetch): Promise<{ agent: IssuedAgent; linkError: string | null }> {
  const agent = parseIssued(await postJson('/lore/kc/agent-client', { profile: req.profile, machine: req.machine }, fetchImpl));
  try {
    await postJson('/lore/actor', { actor_id: agent.clientId, name: agent.clientId, kind: 'agent' }, fetchImpl);
    const owner: Record<string, unknown> = {
      actor_id: agent.clientId, client_id: agent.clientId, kc_sub: req.ownerSub,
      agent_role: req.profile, machine_id: req.machine,
    };
    if (req.harness) owner.harness = req.harness;
    await postJson('/lore/actor/owner', owner, fetchImpl);
    return { agent, linkError: null };
  } catch (e) {
    return { agent, linkError: reasonOf(e) };
  }
}

// ── S4-AGENT-CLIENT-PICK: привязать готовую учётку KC к человеку ──────────

const MACHINE_CLIENT = /^lore-mcp-[A-Za-z0-9][A-Za-z0-9.-]{0,63}_([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

/** Учётка KC без агента в графе — что из неё можно привязать. */
export interface OrphanBindOption {
  clientId: string;
  /** Профили из оси клиента (agent-full → full). Пусто — оси нет, привязка запрещена (как в v1). */
  profiles: string[];
  /** Машина из имени lore-mcp-<профиль>_<машина>; null — имя не машинное. */
  machine: string | null;
}

/**
 * Сироты KC (GET /lore/kc/agent-orphans) + ось из GET /lore/kc/agents. Ось
 * машинного клиента сервер собирает и из ролей его сервисной учётки (#1062):
 * у lore-mcp-full_<машина> своих ролей нет. Клиента нет в ответе — оси не
 * знаем, и привязки нет: агент без профиля не наследует ничего.
 */
export function orphanBindOptions(
  orphans: readonly { clientId: string }[],
  kcClients: readonly unknown[],
): OrphanBindOption[] {
  const scopeOf = new Map<string, string[]>();
  for (const raw of kcClients) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const id = str(c.clientId);
    if (!id) continue;
    const scope = Array.isArray(c.agent_scope) ? c.agent_scope.map(String) : [];
    scopeOf.set(id, scope.filter(s => s.startsWith('agent-') && s.length > 6).map(s => s.slice(6)));
  }
  return orphans.map(o => ({
    clientId: o.clientId,
    profiles: [...new Set(scopeOf.get(o.clientId) ?? [])],
    machine: MACHINE_CLIENT.exec(o.clientId)?.[1] ?? null,
  }));
}

export interface BindRequest { clientId: string; ownerSub: string; profile: string; machine: string | null }

/** Агент для готовой учётки: актор kind=agent (actor_id = client_id, как у мастера) → владелец, профиль, машина. */
export async function bindKcClient(req: BindRequest, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  await postJson('/lore/actor', { actor_id: req.clientId, name: req.clientId, kind: 'agent' }, fetchImpl);
  const owner: Record<string, unknown> = {
    actor_id: req.clientId, client_id: req.clientId, kc_sub: req.ownerSub, agent_role: req.profile,
  };
  if (req.machine) owner.machine_id = req.machine;
  await postJson('/lore/actor/owner', owner, fetchImpl);
}

// ── конфиг MCP ────────────────────────────────────────────────────────────

export interface McpEnv { backend: string; issuer: string; clientId: string; machine: string }

/** Путь к собранному MCP-серверу на машине — его знает только тот, кто клонировал. */
export const MCP_ENTRY = '<путь к UnlimitedLORE>/mcp-server/dist/index.js';
export const SECRET_REF = '${LORE_MCP_CLIENT_SECRET}';

function envOf(c: McpEnv): Record<string, string> {
  return {
    LORE_BACKEND_URL: c.backend,
    LORE_OIDC_ISSUER: c.issuer,
    LORE_MCP_CLIENT_ID: c.clientId,
    LORE_MCP_CLIENT_SECRET: SECRET_REF,
    LORE_MACHINE_ID: c.machine,
  };
}

/** .mcp.json — stdio-сервер aida-lore, как в репозитории; секрет — переменной окружения. */
export function mcpJsonText(c: McpEnv): string {
  return JSON.stringify({ mcpServers: { 'aida-lore': { command: 'node', args: [MCP_ENTRY], env: envOf(c) } } }, null, 2);
}

/** Та же настройка одной командой claude mcp add. */
export function mcpAddCommand(c: McpEnv): string {
  const env = Object.entries(envOf(c)).map(([k, v]) => `-e ${k}=${k === 'LORE_MCP_CLIENT_SECRET' ? '"$LORE_MCP_CLIENT_SECRET"' : v}`);
  return ['claude mcp add aida-lore --scope user', ...env, '--', 'node', `"${MCP_ENTRY}"`].join(' ');
}

/** Адрес бэкенда для MCP — прямой маршрут Traefik …/_backend того же хоста. */
export function backendOf(origin: string): string {
  return `${origin.replace(/\/$/, '')}/_backend`;
}

// ── проверка «заработало» ─────────────────────────────────────────────────

export type FirstCall = { kind: 'waiting' } | { kind: 'seen'; how: 'session' | 'write'; at: string | null };

/**
 * Что видно с новой машины после старта мастера:
 *   • сессия агента (agent_sessions) с этим machine_id и активностью позже старта;
 *   • запись агента: у актора с этим client_id есть эта машина (machine_id /
 *     USES_MACHINE ставит сервер на ЗАПИСИ).
 * Чтения агента по одному клиенту сервер не различает — тишина значит «ещё не
 * видно», а не «не работает».
 */
export function firstCallOf(
  src: { sessions: readonly Record<string, unknown>[]; owners: readonly Record<string, unknown>[] },
  q: { clientId: string; machine: string; since: number },
): FirstCall {
  const s = src.sessions.find(r => str(r.machine_id) === q.machine
    && Date.parse(String(r.last_activity_at ?? r.started_at ?? '')) >= q.since);
  if (s) return { kind: 'seen', how: 'session', at: str(s.last_activity_at) ?? str(s.started_at) };
  const o = src.owners.find(r => str(r.client_id) === q.clientId);
  if (o) {
    const machines = Array.isArray(o.machines) ? o.machines.map(String) : [];
    if (machines.includes(q.machine)) return { kind: 'seen', how: 'write', at: null };
  }
  return { kind: 'waiting' };
}

export async function fetchFirstCall(
  q: { clientId: string; machine: string; since: number },
  fetchImpl: typeof fetch = loreFetch,
): Promise<FirstCall> {
  const [sessions, owners] = await Promise.all([
    fetchSlice<Record<string, unknown>>('agent_sessions', {}, { fetchImpl }),
    fetchSlice<Record<string, unknown>>('agent_owners', { limit: '1000' }, { fetchImpl }),
  ]);
  return firstCallOf({ sessions: sessions.rows, owners: owners.rows }, q);
}

// ── HTTP ──────────────────────────────────────────────────────────────────

export const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);

async function readBody(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

function httpError(status: number, body: unknown): LoreHttpError {
  const b = (body ?? {}) as Record<string, unknown>;
  return new LoreHttpError(status, String(b.error ?? (body === null ? 'NON_JSON' : '')), String(b.detail ?? ''));
}

async function getJson(path: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(path, { headers: { Accept: 'application/json' } });
  const body = await readBody(res);
  if (!res.ok || body === null) throw httpError(res.status, body);
  return body;
}

async function postJson(path: string, payload: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readBody(res);
  if (!res.ok || body === null) throw httpError(res.status, body);
  return body;
}
