// «Доступ к машинам» в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-ACL-3).
//
// Прототип docs/prototypes/s7b-acl3-machine-access-v3.html (владелица: «ок давай
// пока такой интерфейс»). Здесь — только данные и запросы; экран собран из
// блоков kit (MachinesScreen.tsx).
//
// Источники (сервер — S7B-ACL-1/2, #1225):
//   • срез machine_acl — строка на машину miniLORE (актор client_id
//     minilore-link-*): владелец и допущенные параллельными массивами grant_*;
//   • role_matrix + agent_owners (participation) — проекты владельца и harness;
//   • POST /lore/user/machine-access — grant | revoke, dry_run даёт план
//     «было → станет» (он и есть DiffPreview).
//
// Проекты, harness и право записи машины срез отдаёт сам (серверные долги
// ACL-3): поля projects, harnesses, can_write. Клиентская сборка ниже —
// запасной путь, когда полей нет (старый сервер или источник не прочитался):
//   • проекты машины — у машины своего списка нет. Агент видит проекты
//     владельца (SPEC-RBAC-OMILORE-AGENTS §10.6), поэтому «проекты машины» =
//     проекты, где у владельца есть роль, плюс проекты уже выданных допусков
//     (чтобы ни один допуск не выпал из группировки);
//   • harness машины — из agent_owners: harness самого актора-машины и агентов,
//     чья машина — эта.
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import { loreFetch } from '../auth/session';
import type { KitRecord, MatrixCellState } from '@seidr/kit';
import { fetchAgents, type AgentRow } from './agents';
import { buildParticipation, type Participation } from './participation';

export const MACHINE_CLIENT_PREFIX = 'minilore-link-';

export type MachineRole = 'viewer' | 'actor';

export interface MachineGrant {
  kc_sub: string;
  name: string;
  role: string;
  projects: string[];
  /** Пусто — все harness. */
  harnesses: string[];
  by: string | null;
  at: string | null;
}

export interface Machine {
  machine_id: string;
  client_id: string;
  actor_id: string;
  name: string | null;
  owner_kc_sub: string | null;
  owner_name: string | null;
  harness: string[];
  projects: string[];
  grants: MachineGrant[];
  /** Проекты машины от сервера (срез); null — поля нет, собирает клиент. */
  server_projects: string[] | null;
  /** Harness машины от сервера (срез); null — поля нет, собирает клиент. */
  server_harness: string[] | null;
  /** Может ли смотрящий выдавать допуски: от сервера; null — сервер не смог вычислить; undefined — поля нет. */
  can_write: boolean | null | undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);
const strs = (v: unknown): string[] => arr(v).map(str).filter((x): x is string => x !== null);
const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

/** Имя машины для запроса: client_id без префикса (так его считает сервер, clientIdOf). */
export function machineIdOf(clientId: string, fallback: string | null = null): string {
  return clientId.startsWith(MACHINE_CLIENT_PREFIX) ? clientId.slice(MACHINE_CLIENT_PREFIX.length) : (fallback ?? clientId);
}

/** Строки machine_acl → машины; допуски — по позиции параллельных массивов. */
export function parseMachineAcl(rows: ReadonlyArray<Record<string, unknown>>): Machine[] {
  return rows.map(r => {
    const client = str(r.client_id) ?? '';
    const subs = arr(r.grant_kc_subs);
    const names = arr(r.grant_display_names);
    const roles = arr(r.grant_roles);
    const projects = arr(r.grant_projects);
    const harn = arr(r.grant_harnesses);
    const by = arr(r.grant_granted_by);
    const at = arr(r.grant_granted_at);
    const grants: MachineGrant[] = subs.map((s, i) => ({
      kc_sub: String(s ?? ''),
      name: str(names[i]) ?? String(s ?? ''),
      role: str(roles[i]) ?? '',
      projects: strs(projects[i]),
      harnesses: strs(harn[i]),
      by: str(by[i]),
      at: str(at[i]),
    })).filter(g => g.kc_sub !== '');
    const owner = strs(r.owner_kc_sub)[0] ?? null;
    return {
      machine_id: machineIdOf(client, str(r.machine_id)),
      client_id: client,
      actor_id: str(r.actor_id) ?? '',
      name: str(r.name),
      owner_kc_sub: owner,
      owner_name: strs(r.owner_display_name)[0] ?? owner,
      harness: [],
      projects: uniq(grants.flatMap(g => g.projects)).sort(),
      grants,
      server_projects: Array.isArray(r.projects) ? strs(r.projects) : null,
      server_harness: Array.isArray(r.harnesses) ? strs(r.harnesses) : null,
      can_write: !('can_write' in r) ? undefined : typeof r.can_write === 'boolean' ? r.can_write : null,
    };
  }).filter(m => m.client_id !== '');
}

/**
 * Проекты и harness машины: от сервера, если срез их отдал; иначе — из
 * участия (см. шапку файла). Участие не прочиталось — остаются проекты из
 * допусков, а не «проектов нет».
 */
export function enrichMachines(machines: readonly Machine[], participation: Participation | null, agents: readonly AgentRow[]): Machine[] {
  return machines.map(m => {
    const owner = participation?.people.find(p => p.kc_sub === m.owner_kc_sub);
    const projects = m.server_projects ?? uniq([...(owner?.projects.map(p => p.slug) ?? []), ...m.projects]).sort();
    const harness = m.server_harness ?? uniq(agents
      .filter(a => a.actor_id === m.actor_id || a.client_id === m.client_id || (a.machine_id !== null && a.machine_id === m.machine_id))
      .map(a => a.harness)
      .filter((h): h is string => h !== null)).sort();
    return { ...m, projects, harness };
  });
}

// ── записи для kit ListView ────────────────────────────────────────────────

/**
 * Машины → записи списка, запись на машину. Группа «по проекту» режется kit
 * прямо по массиву projects: машина с несколькими проектами стоит в каждой
 * своей группе, «Прочие» — без дублей (kit #1249).
 */
export function machineRecords(ms: readonly Machine[]): KitRecord[] {
  return ms.map(m => {
    const fields: Record<string, unknown> = { owner: m.owner_name ?? '', granted: m.grants.length };
    if (m.harness.length) fields.harness = m.harness;
    if (m.projects.length) fields.projects = m.projects;
    return {
      id: m.machine_id, kind: 'machine', title: m.machine_id, status: '', fields,
      search: [m.machine_id, m.client_id, m.owner_name ?? '', m.owner_kc_sub ?? '', ...m.projects, ...m.harness].join(' '),
    };
  });
}

/** Допуски машины → запись на человека; группа «по проекту» — по массиву projects. */
export function grantRecords(m: Machine): KitRecord[] {
  return m.grants.map(g => {
    const fields: Record<string, unknown> = { role: g.role };
    if (g.projects.length) fields.projects = g.projects;
    if (g.harnesses.length) fields.harness = g.harnesses;
    if (g.by) fields.by = g.by;
    if (g.at) fields.at = g.at;
    return { id: g.kc_sub, kind: 'grant', title: g.name, status: '', fields, search: `${g.name} ${g.kc_sub}` };
  });
}

// ── человек: машины, которыми владеет и к которым допущен ─────────────────

export interface PersonMachine { machine: Machine; role: 'owner' | string; projects: string[]; harnesses: string[] }

export function personMachines(ms: readonly Machine[], kcSub: string): { owned: PersonMachine[]; granted: PersonMachine[] } {
  const owned = ms.filter(m => m.owner_kc_sub === kcSub).map(m => ({ machine: m, role: 'owner', projects: m.projects, harnesses: [] }));
  const granted = ms.flatMap(m => {
    const g = m.grants.find(x => x.kc_sub === kcSub);
    return g ? [{ machine: m, role: g.role, projects: g.projects, harnesses: g.harnesses }] : [];
  });
  return { owned, granted };
}

// ── матрица проекта ───────────────────────────────────────────────────────

export type MatrixMark = 'owner' | MachineRole | null;

export interface ProjectMatrixModel {
  people: Array<{ kc_sub: string; name: string }>;
  machines: Machine[];
  /** kc_sub → machine_id → отметка. */
  mark: (kcSub: string, machineId: string) => MatrixMark;
  /** Люди проекта без доступа ни к одной машине проекта. */
  noAccess: string[];
}

export function projectMatrix(ms: readonly Machine[], participation: Participation, project: string): ProjectMatrixModel {
  const team = participation.projects.find(p => p.slug === project)?.members.map(m => ({ kc_sub: m.kc_sub, name: m.name })) ?? [];
  const machines = ms.filter(m => m.projects.includes(project));
  const mark = (kc: string, mid: string): MatrixMark => {
    const m = machines.find(x => x.machine_id === mid);
    if (!m) return null;
    if (m.owner_kc_sub === kc) return 'owner';
    const g = m.grants.find(x => x.kc_sub === kc && x.projects.includes(project));
    return g ? (g.role === 'actor' ? 'actor' : 'viewer') : null;
  };
  const noAccess = team.filter(p => !machines.some(m => mark(p.kc_sub, m.machine_id) !== null)).map(p => p.kc_sub);
  return { people: team, machines, mark, noAccess };
}

/** Отметка → ячейка kit Matrix; подписи даёт экран. */
export function matrixCell(mark: MatrixMark, ownerWord: string): MatrixCellState {
  if (mark === null) return { state: 'none' };
  return { state: 'value', value: mark === 'owner' ? ownerWord : mark };
}

// ── запросы ───────────────────────────────────────────────────────────────

export interface AccessRequest {
  machine_id: string;
  kc_sub: string;
  display_name?: string;
  action: 'grant' | 'revoke';
  role?: string;
  projects?: string[];
  harnesses?: string[];
}

export interface PlanView { role: string; projects: string[]; harnesses: string[] }
export interface AccessPlan { kind: 'grant' | 'update' | 'revoke' | 'unchanged' | string; before: PlanView | null; after: PlanView | null }

const view = (v: unknown): PlanView | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { role: str(o.role) ?? '', projects: strs(o.projects), harnesses: strs(o.harnesses) };
};

export function parsePlan(body: unknown): AccessPlan {
  const p = (body as { plan?: Record<string, unknown> } | null)?.plan ?? {};
  return { kind: str(p.kind) ?? 'unknown', before: view(p.before), after: view(p.after) };
}

export async function postMachineAccess(req: AccessRequest & { dry_run?: boolean }, fetchImpl: typeof fetch = loreFetch): Promise<unknown> {
  const res = await fetchImpl('/lore/user/machine-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(req),
  });
  let body: Record<string, unknown> | null = null;
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* не-JSON — статус скажет сам */ }
  if (!res.ok || body === null) {
    throw new LoreHttpError(res.status, String(body?.error ?? (body === null ? 'NON_JSON' : '')), String(body?.detail ?? body?.message ?? ''));
  }
  return body;
}

/** Выдать / изменить: одна и та же форма для всех выбранных. */
export function grantRequests(m: Machine, who: ReadonlyArray<{ kc_sub: string; name: string }>, role: string, projects: readonly string[], harnesses: readonly string[]): AccessRequest[] {
  return who.filter(w => w.kc_sub !== m.owner_kc_sub).map(w => ({
    machine_id: m.machine_id, kc_sub: w.kc_sub, display_name: w.name, action: 'grant', role, projects: [...projects], harnesses: [...harnesses],
  }));
}

/**
 * «Снять» у строк «человек × проект»: снимается ПРОЕКТ из допуска. Ушёл
 * последний проект — допуск снимается целиком (revoke): допуск без проектов
 * сервер не примет.
 */
export function removeProjectsRequests(m: Machine, pairs: ReadonlyArray<[string, string]>): AccessRequest[] {
  const drop = new Map<string, Set<string>>();
  for (const [kc, p] of pairs) {
    const s = drop.get(kc) ?? new Set<string>();
    s.add(p);
    drop.set(kc, s);
  }
  return [...drop].flatMap(([kc, ps]) => {
    const g = m.grants.find(x => x.kc_sub === kc);
    if (!g) return [];
    const left = g.projects.filter(p => !ps.has(p));
    return [left.length
      ? { machine_id: m.machine_id, kc_sub: kc, display_name: g.name, action: 'grant' as const, role: g.role, projects: left, harnesses: g.harnesses }
      : { machine_id: m.machine_id, kc_sub: kc, action: 'revoke' as const }];
  });
}

/** Сменить роль у выбранных людей, проекты и harness — как были. */
export function roleRequests(m: Machine, kcSubs: readonly string[], role: string): AccessRequest[] {
  return uniq(kcSubs).flatMap(kc => {
    const g = m.grants.find(x => x.kc_sub === kc);
    return g ? [{ machine_id: m.machine_id, kc_sub: kc, display_name: g.name, action: 'grant' as const, role, projects: g.projects, harnesses: g.harnesses }] : [];
  });
}

/** Снять допуски выбранных людей целиком. */
export function revokeRequests(m: Machine, kcSubs: readonly string[]): AccessRequest[] {
  return uniq(kcSubs).filter(kc => m.grants.some(g => g.kc_sub === kc))
    .map(kc => ({ machine_id: m.machine_id, kc_sub: kc, action: 'revoke' as const }));
}

/**
 * Обратная операция по плану: «было» пусто — снять, иначе вернуть «было».
 * Отмена пачки идёт сервером (undo_of, postMachineAccessBatch); эта функция —
 * для расчёта ожидаемого «было» в тестах и на старом сервере.
 */
export function inverseRequest(req: AccessRequest, plan: AccessPlan): AccessRequest {
  if (!plan.before) return { machine_id: req.machine_id, kc_sub: req.kc_sub, action: 'revoke' };
  return {
    machine_id: req.machine_id, kc_sub: req.kc_sub, display_name: req.display_name, action: 'grant',
    role: plan.before.role, projects: plan.before.projects, harnesses: plan.before.harnesses,
  };
}

// ── пачка допусков (сервер: items + batch_id + undo_of) ───────────────────

export type AccessItem = Omit<AccessRequest, 'machine_id'>;

export interface BatchItemResult { kc_sub: string; result: string; status: number | null; reason: string | null }

export interface MachineBatch {
  batch_id: string | null;
  machine_id: string;
  items: BatchItemResult[];
  /** Обратная пачка от сервера — её шлют с undo_of. */
  undo: AccessItem[];
  /** Конец окна отмены, мс; null — сервер не назвал. */
  undo_until: number | null;
  applied: number;
  failed: number;
}

const itemOf = (v: unknown): AccessItem | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const kc = str(o.kc_sub);
  if (!kc) return null;
  const action = o.action === 'revoke' ? 'revoke' : 'grant';
  const out: AccessItem = { kc_sub: kc, action };
  if (str(o.display_name)) out.display_name = str(o.display_name)!;
  if (action === 'grant') {
    out.role = str(o.role) ?? '';
    out.projects = strs(o.projects);
    out.harnesses = strs(o.harnesses);
  }
  return out;
};

export function parseBatch(body: unknown, machineId: string): MachineBatch {
  const b = (body ?? {}) as Record<string, unknown>;
  const items = arr(b.items).map(v => {
    const o = (v ?? {}) as Record<string, unknown>;
    const err = o.error as Record<string, unknown> | undefined;
    return {
      kc_sub: String(o.kc_sub ?? ''), result: str(o.result) ?? 'unknown',
      status: typeof o.status === 'number' ? o.status : null,
      reason: err ? String(err.detail ?? err.message ?? err.error ?? '') : null,
    };
  });
  const until = str(b.undo_until) ? Date.parse(String(b.undo_until)) : NaN;
  return {
    batch_id: str(b.batch_id), machine_id: str(b.machine_id) ?? machineId, items,
    undo: arr(b.undo).map(itemOf).filter((x): x is AccessItem => x !== null),
    undo_until: Number.isFinite(until) ? until : null,
    applied: typeof b.applied === 'number' ? b.applied : items.filter(i => i.result === 'applied').length,
    failed: typeof b.failed === 'number' ? b.failed : items.filter(i => i.result === 'failed').length,
  };
}

/** Пачка запросов → по пачке на машину (сервер принимает пачку к одной машине). */
export function batchesByMachine(reqs: readonly AccessRequest[]): Array<{ machine_id: string; items: AccessItem[] }> {
  const by = new Map<string, AccessItem[]>();
  for (const { machine_id, ...item } of reqs) {
    const list = by.get(machine_id) ?? [];
    list.push(item);
    by.set(machine_id, list);
  }
  return [...by].map(([machine_id, items]) => ({ machine_id, items }));
}

/** Пачка допусков к одной машине; undo_of — отмена пачки batch_id (тело — её undo). */
export async function postMachineAccessBatch(
  req: { machine_id: string; items: readonly AccessItem[]; dry_run?: boolean; undo_of?: string },
  fetchImpl: typeof fetch = loreFetch,
): Promise<MachineBatch> {
  const body = await postMachineAccess(req as unknown as AccessRequest, fetchImpl);
  return parseBatch(body, req.machine_id);
}

/**
 * Может ли смотрящий писать допуски этой машины. Сервер отдаёт это полем
 * can_write среза (то же правило, что проверка записи). Поля нет (старый
 * сервер) — владелец да, иначе спрашиваем сервер: dry_run «снять» ничего не
 * пишет. 403 — только чтение; сбой — «не смогли проверить», не «нельзя».
 */
export type WriteRight = { state: 'yes' } | { state: 'no'; reason: string } | { state: 'unknown'; reason: string };

/** Право из среза; null — поля can_write нет, нужна проба (probeWrite). */
export function sliceWriteRight(m: Machine, noReason: string, unknownReason = noReason): WriteRight | null {
  if (m.can_write === undefined) return null;
  if (m.can_write === true) return { state: 'yes' };
  if (m.can_write === false) return { state: 'no', reason: noReason };
  return { state: 'unknown', reason: unknownReason };
}

export async function probeWrite(m: Machine, meSub: string | null, fetchImpl?: typeof fetch): Promise<WriteRight> {
  if (meSub && m.owner_kc_sub === meSub) return { state: 'yes' };
  const probeSub = m.grants[0]?.kc_sub ?? meSub ?? 'probe';
  try {
    await postMachineAccess({ machine_id: m.machine_id, kc_sub: probeSub, action: 'revoke', dry_run: true }, fetchImpl);
    return { state: 'yes' };
  } catch (e) {
    const reason = e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);
    if (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)) return { state: 'no', reason };
    return { state: 'unknown', reason };
  }
}

export async function fetchMachineAcl(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<{ machines: Machine[]; truncated: boolean }> {
  const body = await fetchSlice<Record<string, unknown>>('machine_acl', { limit: '1000' }, { signal, fetchImpl });
  return { machines: parseMachineAcl(body.rows), truncated: body.truncated === true };
}

// ── загрузка экрана ──────────────────────────────────────────────────────

export interface MachinesData {
  machines: Machine[];
  /** Участие (проекты людей); null — не прочиталось, причина в participationError. */
  participation: Participation | null;
  participationError: string | null;
  /** Подписи harness из справочника; кода нет — сам код. */
  harnessLabels: Record<string, string>;
  /** S7B-22: код harness → официальный логотип из справочника (только у кого он есть). */
  harnessLogos: Record<string, string>;
  /** Активные коды harness; null — справочник не прочитан. */
  harnessRegistry: string[] | null;
  truncated: boolean;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * machine_acl обязателен: без него экрана нет (403 — «нет прав», сбой —
 * «не смогли»). Участие и агенты — мягко: без них машины видны, а чего не
 * хватает, сказано словами.
 */
export async function fetchMachinesData(signal?: AbortSignal, fetchImpl?: typeof fetch, lang: 'ru' | 'en' = 'ru'): Promise<MachinesData> {
  const [acl, agents, matrix] = await Promise.all([
    fetchMachineAcl(signal, fetchImpl),
    fetchAgents(signal, fetchImpl, lang).then(d => d, (e: unknown) => ({ error: msg(e) })),
    fetchSlice<Record<string, unknown>>('role_matrix', { limit: '1000' }, { signal, fetchImpl }).then(b => b, (e: unknown) => ({ error: msg(e) })),
  ]);
  const agentRows = 'error' in agents ? [] : agents.rows;
  const participation = 'error' in matrix ? null : buildParticipation(matrix.rows, agentRows, matrix.truncated === true);
  const participationError = 'error' in matrix ? String(matrix.error) : 'error' in agents ? String(agents.error) : null;
  return {
    machines: enrichMachines(acl.machines, participation, agentRows),
    participation,
    participationError,
    harnessLabels: 'error' in agents ? {} : agents.labels,
    harnessLogos: 'error' in agents ? {} : agents.logos,
    harnessRegistry: 'error' in agents ? null : agents.registry,
    truncated: acl.truncated,
  };
}
