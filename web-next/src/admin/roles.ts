// Роли человека в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-03 · S7B-05 · S7B-09).
//
// Источники:
//   • срез role_matrix — люди и их роли по проектам; ячейка несёт СОСТОЯНИЕ
//     (cells[].state checked|unavailable|forbidden, sources_asked — какие
//     источники опрошены, LoreRoleMatrix). Сборка сервера без cells — роли по
//     позиции, но «проверено» мы тогда не утверждаем;
//   • POST /lore/user/role/batch (LoreUserResource.setUserRoleBatch) — дифф
//     (dry_run), применение пачкой (batch_id, items, undo, undo_until) и отмена
//     пачки (changes=undo, undo_of=batch_id).
//
// Здесь — модель без React: что рисовать и что отправлять.
import type { BatchItemFail, BatchResult, DiffCheck, DiffRow, MatrixCellState, MatrixChange } from '@seidr/kit';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import { loreFetch } from '../auth/session';

/** Роли в проекте — тот же закрытый список, что у v1 (src/components/lore/admin/adminHelpers.ts). */
export const PROJECT_ROLES = ['owner', 'architect', 'pm', 'developer', 'business-analyst', 'marketer', 'tester', 'reader'] as const;

export type CellState = 'checked' | 'unavailable' | 'forbidden';

export interface RoleCell {
  project: string;
  role: string | null;
  state: CellState;
  /** Откуда знание (graph | kc | forgejo); null — сервер не сказал. */
  source: string | null;
}

/**
 * Ячейка на человека целиком (project «*», S7B-11): Keycloak — realm-роли,
 * Forgejo — «не смогли» с причиной. Это не роль проекта и не правится как она.
 */
export interface PersonCell {
  source: string | null;
  role: string | null;
  state: CellState;
  reason: string | null;
}

export interface PersonRoles {
  kc_sub: string;
  name: string;
  cells: RoleCell[];
  personCells: PersonCell[];
  /** Состояние строки целиком: unknown — сервер его не назвал (старая сборка). */
  state: CellState | 'unknown';
}

export interface RolesData {
  people: PersonRoles[];
  /** Все проекты, где у кого-нибудь есть роль, — колонки матрицы. */
  projects: string[];
  /** Какие источники опрошены; пусто — сервер не сказал, и «роли нет» не утверждаем. */
  sourcesAsked: string[];
  truncated: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const STATES: readonly CellState[] = ['checked', 'unavailable', 'forbidden'];
const stateOf = (v: unknown): CellState | null => (STATES.includes(v as CellState) ? (v as CellState) : null);

export function parseRoleMatrix(body: unknown): RolesData {
  const b = (body ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const people: PersonRoles[] = [];
  const projects = new Set<string>();
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const kc = str(r.kc_sub);
    if (!kc) continue;
    let cells: RoleCell[];
    const personCells: PersonCell[] = [];
    if (Array.isArray(r.cells)) {
      cells = r.cells.filter(c => {
        const o = (c ?? {}) as Record<string, unknown>;
        if (o.project !== '*') return true;
        personCells.push({
          source: str(o.source),
          role: str(o.role),
          state: stateOf(o.state) ?? 'unavailable',
          reason: str(o.reason),
        });
        return false;
      }).map(c => {
        const o = (c ?? {}) as Record<string, unknown>;
        return {
          project: String(o.project ?? ''),
          role: str(o.role),
          // Неизвестное состояние — не «проверено».
          state: stateOf(o.state) ?? 'unavailable',
          source: str(o.source),
        };
      }).filter(c => c.project !== '');
    } else {
      const ps = Array.isArray(r.projects) ? r.projects.map(String) : [];
      const rs = Array.isArray(r.roles) ? r.roles : [];
      cells = ps.map((p, i) => ({ project: p, role: str(rs[i]), state: 'unavailable' as const, source: null }));
    }
    cells.sort((a, c) => a.project.localeCompare(c.project));
    cells.forEach(c => projects.add(c.project));
    people.push({ kc_sub: kc, name: str(r.display_name) ?? kc, cells, personCells, state: stateOf(r.state) ?? 'unknown' });
  }
  return {
    people,
    projects: [...projects].sort((a, c) => a.localeCompare(c)),
    sourcesAsked: Array.isArray(b.sources_asked) ? b.sources_asked.map(String) : [],
    truncated: b.truncated === true,
  };
}

/** Источники ячеек на человека — колонки блока «вне графа» (S7B-11). */
export const PERSON_SOURCES = ['kc', 'forgejo'] as const;

/**
 * Ячейка на человека → состояние kit Matrix (S7B-11).
 *   • checked + роль — значение; checked без роли — «значения нет»
 *     (сервер спросил и услышал «нет», например человека нет в KC);
 *   • unavailable и источник НЕ в sources_asked — `unasked`: его не спрашивали,
 *     чинить нечего (Forgejo: «нет связи с пользователем Forgejo»);
 *   • unavailable и источник спрашивали — «не смогли проверить» с причиной;
 *   • forbidden — «нет прав»;
 *   • ячейки нет — не спрашивали (если источник не опрошен) или не смогли.
 */
export function personSourceCell(pc: PersonCell | undefined, sourcesAsked: readonly string[], source?: string): MatrixCellState {
  const src = pc?.source ?? source ?? null;
  const asked = src !== null && sourcesAsked.includes(src);
  if (!pc) return asked ? { state: 'unverified' } : { state: 'unasked' };
  if (pc.state === 'forbidden') return { state: 'forbidden', reason: pc.reason ?? undefined };
  if (pc.state === 'unavailable') {
    return asked ? { state: 'unverified', reason: pc.reason ?? undefined } : { state: 'unasked', reason: pc.reason ?? undefined };
  }
  return pc.role ? { state: 'value', value: pc.role } : { state: 'none' };
}

export async function fetchRoleMatrix(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<RolesData> {
  const body = await fetchSlice<Record<string, unknown>>('role_matrix', { limit: '1000' }, { signal, fetchImpl });
  return parseRoleMatrix(body);
}

export interface RoleGroup { role: string; projects: string[] }

/** Группы по роли: больше назначений — выше; при равенстве — по имени роли. */
export function groupByRole(cells: readonly RoleCell[]): RoleGroup[] {
  const m = new Map<string, string[]>();
  for (const c of cells) {
    const k = c.role ?? '';
    m.set(k, [...(m.get(k) ?? []), c.project]);
  }
  return [...m].map(([role, projects]) => ({ role, projects }))
    .sort((a, b) => b.projects.length - a.projects.length || a.role.localeCompare(b.role));
}

export function filterProjects(cells: readonly RoleCell[], q: string): RoleCell[] {
  const s = q.trim().toLowerCase();
  return s === '' ? [...cells] : cells.filter(c => c.project.toLowerCase().includes(s));
}

export interface RoleChange { project: string; role?: string; action?: 'remove' }
export type BatchOp = { kind: 'set'; role: string } | { kind: 'remove' };

export function buildChanges(projects: readonly string[], op: BatchOp): RoleChange[] {
  return projects.map(p => (op.kind === 'remove' ? { project: p, action: 'remove' as const } : { project: p, role: op.role }));
}

export interface PlanRow {
  project: string;
  before: string | null;
  after: string | null;
  kind: 'grant' | 'update' | 'remove' | 'unchanged' | string;
  check: { state: CellState | null; source: string | null };
}

export function parsePlan(body: unknown): PlanRow[] {
  const b = (body ?? {}) as Record<string, unknown>;
  return (Array.isArray(b.plan) ? b.plan : []).map(raw => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const ch = (o.check ?? null) as Record<string, unknown> | null;
    return {
      project: String(o.project ?? ''),
      before: str(o.before),
      after: str(o.after),
      kind: String(o.kind ?? ''),
      check: { state: ch ? stateOf(ch.state) : null, source: ch ? str(ch.source) : null },
    };
  });
}

/**
 * Строки плана → строки kit DiffPreview. У kit три вида (add/remove/same):
 * смена роли (update) — «добавится новая роль», а прежняя — в подробности
 * «было: …». Проверку строки берём у сервера; не прислал — «не проверено».
 */
export function planToDiff(plan: readonly PlanRow[], words: { before: string; none: string }): DiffRow[] {
  return plan.map(p => {
    const check: DiffCheck = p.check.state === 'checked'
      ? { state: 'checked' }
      : p.check.state === 'forbidden'
        ? { state: 'forbidden', reason: p.check.source ?? undefined }
        : { state: 'unverified', reason: p.check.source ?? undefined };
    const kind = p.kind === 'remove' ? 'remove' : p.kind === 'unchanged' ? 'same' : 'add';
    const role = kind === 'remove' ? p.before : p.after;
    return {
      id: p.project,
      kind,
      text: `${p.project} · ${role ?? '—'}`,
      detail: p.kind === 'update' || p.kind === 'grant' ? `${words.before}: ${p.before ?? words.none}` : undefined,
      check,
    };
  });
}

export interface ApplyAnswer {
  batch: BatchResult;
  /** Обратный пакет — им и отменяют пачку (undo_of=batch.id). */
  undo: RoleChange[];
}

export function parseApply(body: unknown): ApplyAnswer {
  const b = (body ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(b.items) ? b.items : []).map(r => (r ?? {}) as Record<string, unknown>);
  // «Уже так» не считается ни применённым, ни отказом — это не изменение.
  const changing = items.filter(i => i.result !== 'unchanged');
  const failed: BatchItemFail[] = changing.filter(i => i.result !== 'applied').map(i => {
    const e = (i.error ?? null) as Record<string, unknown> | null;
    const reason = e
      ? [str(e.error), str(e.detail)].filter(Boolean).join(': ')
      : i.status !== undefined ? `HTTP ${String(i.status)}` : '';
    const project = String(i.project ?? '');
    return { id: project, text: project, reason };
  });
  const until = str(b.undo_until);
  const undo = (Array.isArray(b.undo) ? b.undo : []).map(u => {
    const o = (u ?? {}) as Record<string, unknown>;
    return o.action === 'remove'
      ? { project: String(o.project), action: 'remove' as const }
      : { project: String(o.project), role: String(o.role) };
  });
  return {
    batch: {
      id: str(b.batch_id) ?? '',
      applied: changing.filter(i => i.result === 'applied').length,
      total: changing.length,
      failed,
      undoUntil: until === null || until === 'null' ? null : until,
    },
    undo,
  };
}

export interface BatchRequest {
  kc_sub: string;
  display_name?: string;
  changes: readonly RoleChange[];
  dry_run?: boolean;
  undo_of?: string;
}

export async function postRoleBatch(req: BatchRequest, fetchImpl: typeof fetch = loreFetch): Promise<unknown> {
  const res = await fetchImpl('/lore/user/role/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(req),
  });
  let body: Record<string, unknown> | null = null;
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* не-JSON — статус скажет сам */ }
  if (!res.ok || body === null) {
    throw new LoreHttpError(res.status, String(body?.error ?? (body === null ? 'NON_JSON' : '')), String(body?.detail ?? ''));
  }
  return body;
}

// ── S7B-11: общая матрица «все проекты × все люди» ──────────────────────────

/** Назначений ролей в проектах (ячейки на человека «*» — KC/Forgejo — не в счёт). */
export function countAssignments(data: RolesData): number {
  return data.people.reduce((n, p) => n + p.cells.filter(c => c.role !== null).length, 0);
}

/**
 * Ячейка «проект × человек». «Роли нет» утверждаем, только если строка
 * человека проверена И сервер назвал опрошенные источники — иначе «не смогли
 * проверить»: по дыркам в матрице раздают доступы.
 */
export function projectPersonCell(data: RolesData, project: string, kcSub: string, notAsked?: string): MatrixCellState {
  const person = data.people.find(p => p.kc_sub === kcSub);
  if (!person) return { state: 'unverified', reason: notAsked };
  const c = person.cells.find(x => x.project === project);
  const noneIsKnown = person.state === 'checked' && data.sourcesAsked.length > 0;
  if (!c) return noneIsKnown ? { state: 'none' } : { state: 'unverified', reason: notAsked };
  if (c.state === 'forbidden') return { state: 'forbidden', reason: c.source ?? undefined };
  if (c.state === 'unavailable') return { state: 'unverified', reason: c.source ?? notAsked };
  return c.role ? { state: 'value', value: c.role } : { state: 'none' };
}

export interface PersonChanges { kc_sub: string; changes: RoleChange[] }

/**
 * Предложение матрицы (строка — проект, колонка — человек) → пачки по людям.
 * Пачка у сервера — на одного человека (POST /lore/user/role/batch {kc_sub}),
 * поэтому правка проекта сразу у нескольких — несколько пачек; порядок — как
 * в предложении.
 */
export function splitByPerson(changes: readonly MatrixChange[]): PersonChanges[] {
  const out: PersonChanges[] = [];
  for (const ch of changes) {
    let g = out.find(x => x.kc_sub === ch.col);
    if (!g) { g = { kc_sub: ch.col, changes: [] }; out.push(g); }
    g.changes.push(ch.value === null ? { project: ch.row, action: 'remove' } : { project: ch.row, role: ch.value });
  }
  return out;
}

// ── S7B-04: карточка роли ──────────────────────────────────────────────────

/** Что даёт роль в проекте — то же правило, что у сервера (LoreAccessExplain): reader только читает. */
export function roleCanWrite(role: string): boolean {
  return role !== 'reader';
}

export interface RoleHolder { kc_sub: string; name: string; projects: string[] }

export function roleHolders(data: RolesData, role: string): RoleHolder[] {
  return data.people
    .map(p => ({ kc_sub: p.kc_sub, name: p.name, projects: p.cells.filter(c => c.role === role).map(c => c.project) }))
    .filter(h => h.projects.length > 0)
    .sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name));
}

export interface RoleSummary { role: string; people: number; assignments: number }

/** Роли, которые у кого-нибудь есть: больше назначений — выше. */
export function roleSummary(data: RolesData): RoleSummary[] {
  const m = new Map<string, { people: Set<string>; n: number }>();
  for (const p of data.people) {
    for (const c of p.cells) {
      if (c.role === null) continue;
      const e = m.get(c.role) ?? { people: new Set<string>(), n: 0 };
      e.people.add(p.kc_sub);
      e.n += 1;
      m.set(c.role, e);
    }
  }
  return [...m].map(([role, e]) => ({ role, people: e.people.size, assignments: e.n }))
    .sort((a, b) => b.assignments - a.assignments || a.role.localeCompare(b.role));
}
