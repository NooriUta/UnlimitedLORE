// «Перенос на новую модель» — раздел админки (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02).
//
// Сервер (LoreMigrationResource): GET /lore/admin/migration — отчёт последнего прогона конвейера;
// POST /lore/admin/migration/decisions — правило переноса (человек super-admin, подтверждение своим логином);
// POST /lore/admin/migration/decisions/undo — отмена последнего правила; POST /lore/admin/migration/run —
// «Перепроверить» / «Пробный перенос» (пока 501: запуск с сервера не подключён). Здесь — разбор ответа и вызовы.
import { LoreHttpError } from '../api/loreSlice';
import { loreFetch } from '../auth/session';
import { getJson, type FetchOptions } from './actions';

export type MigState = 'no_run' | 'source_unavailable' | 'verify_failed' | 'ready' | 'unknown';
const STATES: readonly MigState[] = ['no_run', 'source_unavailable', 'verify_failed', 'ready'];

export const MIG_STAGES = ['read', 'calc', 'merge', 'write', 'verify'] as const;
export type MigStageKey = (typeof MIG_STAGES)[number];
export interface MigStage { key: MigStageKey; state: string; n: number | null }

/** Действия правила — как ACTIONS в decisions.mjs. add_code в этом окне не предлагается: ему нужны подписи на всех языках. */
export const MIG_ACTIONS = ['map_to', 'to_note', 'drop', 'defer'] as const;
export type MigAction = (typeof MIG_ACTIONS)[number];

export interface MigRef { type: string; id: string }
export interface MigRowDecision { id: string; action: string; to: string | null }
export interface MigRow { type: string; field: string; value: string | null; n: number; refs: MigRef[]; decision: MigRowDecision | null }
export interface MigGroup { kind: 'reject' | 'held'; why: string; n: number; rest: number; rows: MigRow[] }
export interface MigLast { id: string; at: string; by: string }

export interface MigAnswer {
  state: MigState;
  reason: string | null;
  login: string | null;
  at: string | null;
  source: string | null;
  target: string | null;
  unread: string[];
  stages: MigStage[];
  groups: MigGroup[];
  waiting: number;
  heldWaiting: number;
  last: MigLast | null;
  undoUntil: string | null;
  accepted: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseMigration(raw: unknown): MigAnswer {
  const r = obj(raw);
  const state = STATES.includes(r.state as MigState) ? (r.state as MigState) : 'unknown';
  const stages: MigStage[] = arr(r.stages).map(obj)
    .filter(s => (MIG_STAGES as readonly string[]).includes(str(s.key)))
    .map(s => ({ key: str(s.key) as MigStageKey, state: str(s.state), n: typeof s.n === 'number' ? s.n : null }));
  const groups: MigGroup[] = arr(r.groups).map(obj).map(g => ({
    kind: g.kind === 'held' ? 'held' : 'reject',
    why: str(g.why), n: num(g.n), rest: num(g.rest),
    rows: arr(g.rows).map(obj).map(x => {
      const d = obj(x.decision);
      return {
        type: str(x.type), field: str(x.field), value: x.value == null ? null : str(x.value), n: num(x.n),
        refs: arr(x.refs).map(obj).map(f => ({ type: str(f.type), id: str(f.id) })).filter(f => f.type && f.id),
        decision: d.id ? { id: str(d.id), action: str(d.action), to: strOrNull(d.to) } : null,
      };
    }),
  }));
  const last = obj(r.last);
  const ld = obj(last.decision);
  return {
    state, reason: strOrNull(r.reason), login: strOrNull(r.login), at: strOrNull(r.at), source: strOrNull(r.source),
    target: strOrNull(r.target), unread: arr(r.unread).map(str), stages, groups,
    waiting: num(r.waiting), heldWaiting: num(r.held_waiting),
    last: ld.id ? { id: str(ld.id), at: str(last.at), by: str(last.by) } : null,
    undoUntil: strOrNull(r.undo_until), accepted: strOrNull(r.accepted),
  };
}

export async function fetchMigration(opts: FetchOptions = {}): Promise<MigAnswer> {
  return parseMigration(await getJson('/lore/admin/migration', opts));
}

async function postBody(url: string, body: unknown, opts: FetchOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? loreFetch;
  const res = await doFetch(url, {
    method: 'POST', signal: opts.signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!(res.headers.get('Content-Type') ?? '').includes('json')) throw new LoreHttpError(res.status, 'NON_JSON', res.statusText);
  const b = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) throw new LoreHttpError(res.status, b?.error ?? '', b?.detail ?? '');
  return b;
}

/** Правило по значению строки; логин — слово подтверждения (сервер сверит со входом). */
export async function decide(row: MigRow, action: MigAction, to: string, login: string, opts: FetchOptions = {}): Promise<MigAnswer> {
  const scope = { type: row.type, field: row.field, value: row.value ?? '' };
  const body = action === 'map_to' ? { scope, action, to: to.trim(), confirm_login: login } : { scope, action, confirm_login: login };
  return parseMigration(await postBody('/lore/admin/migration/decisions', body, opts));
}

export async function undoLast(login: string, opts: FetchOptions = {}): Promise<MigAnswer> {
  return parseMigration(await postBody('/lore/admin/migration/decisions/undo', { confirm_login: login }, opts));
}

/** Запуск конвейера с сервера. Пока не подключён: 501 RUN_NOT_CONNECTED — это ответ, а не сбой. */
export async function runPipeline(what: 'recheck' | 'trial', opts: FetchOptions = {}): Promise<{ started: boolean; reason: string }> {
  try {
    await postBody('/lore/admin/migration/run', { what }, opts);
    return { started: true, reason: '' };
  } catch (e) {
    if (e instanceof LoreHttpError && e.status === 501) return { started: false, reason: e.detail || e.message };
    throw e;
  }
}
