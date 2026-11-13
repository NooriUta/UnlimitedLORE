// «Привести в порядок» — ссылки на объекты LORE в MD (SPRINT_UXR_POLISH_UAT_1113/PU-20).
//
// Сервер (LoreTidyResource): GET /lore/admin/tidy — последний результат проверки;
// POST /lore/admin/tidy/recheck — «Перепроверить всё»; GET /lore/admin/tidy/record?type=&id= —
// «Перепроверить» одну запись. Здесь — разбор ответа и пересчёт плана по галочкам правил:
// сервер отдаёт наборы правил по записям (signatures), поэтому число записей считается точно,
// а не долей от правок.
import { LoreHttpError } from '../api/loreSlice';
import { loreFetch } from '../auth/session';
import { getJson, type FetchOptions } from './actions';

/** Правила автопочинки — порядок строк в таблице; ключи совпадают с MdRefRules.RULES. */
export const TIDY_RULES = ['shape', 'typed', 'wrong_type', 'wiki', 'escaped', 'lore_url',
  'lone_own_sprint', 'lone_ctx', 'lone_unique_ctx', 'lone_unique'] as const;
export type TidyRule = (typeof TIDY_RULES)[number];

/** Группы ручного списка — порядок кнопок. */
export const TIDY_KINDS = ['ambiguous_code', 'no_record', 'backtick', 'broken', 'unknown', 'lore_url',
  'diverged', 'not_writable'] as const;
export type TidyKind = (typeof TIDY_KINDS)[number];

export interface TidySample { type: string; id: string; field: string; old: string; new: string }
export interface TidyRuleStat { edits: number; records: number; enabled: boolean; isDefault: boolean; samples: TidySample[] }
export interface TidyIssue { kind: string; id: string; field: string; snippet: string; suggest: string[] }
export interface TidyRow { type: string; id: string; places: number; byKind: Record<string, number>; issues: TidyIssue[] }

export interface TidyCheck {
  checkedAt: string | null;
  tookMs: number | null;
  scanned: { records: number; fields: number };
  auto: { edits: number; records: number; rules: Record<string, TidyRuleStat>; signatures: Record<string, number> };
  manual: { records: number; places: number; groups: Record<string, { records: number; places: number }>; rows: TidyRow[]; dismissed: TidyDismissed[] };
}

/** Отметка «не ссылка»: вид мест записи скрыт из счётчика, текст не менялся. */
export interface TidyDismissed { type: string; id: string; kind: string; places: number }

/** Виды мест, которые можно отметить «не ссылка» (как MdRefDismissals.KINDS на сервере). */
export const DISMISSABLE: readonly string[] = ['no_record', 'backtick', 'unknown'];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function parseTidy(raw: unknown): TidyCheck {
  const r = obj(raw);
  const auto = obj(r.auto);
  const rules: Record<string, TidyRuleStat> = {};
  for (const [k, v] of Object.entries(obj(auto.rules))) {
    const o = obj(v);
    rules[k] = {
      edits: num(o.edits), records: num(o.records), enabled: o.enabled === true, isDefault: o.default === true,
      samples: arr(o.samples).map(s => { const x = obj(s); return { type: str(x.type), id: str(x.id), field: str(x.field), old: str(x.old), new: str(x.new) }; }),
    };
  }
  const signatures: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(auto.signatures))) signatures[k] = num(v);
  const manual = obj(r.manual);
  const groups: Record<string, { records: number; places: number }> = {};
  for (const [k, v] of Object.entries(obj(manual.groups))) groups[k] = { records: num(obj(v).records), places: num(obj(v).places) };
  const rows: TidyRow[] = arr(manual.rows).map(x => {
    const o = obj(x);
    const byKind: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(o.by_kind))) byKind[k] = num(v);
    return {
      type: str(o.type), id: str(o.id), places: num(o.places), byKind,
      issues: arr(o.issues).map(i => { const y = obj(i); return { kind: str(y.kind), id: str(y.id), field: str(y.field), snippet: str(y.snippet), suggest: arr(y.suggest).map(str) }; }),
    };
  });
  const scanned = obj(r.scanned);
  return {
    checkedAt: typeof r.checked_at === 'string' ? r.checked_at : null,
    tookMs: typeof r.took_ms === 'number' ? r.took_ms : null,
    scanned: { records: num(scanned.records), fields: num(scanned.fields) },
    auto: { edits: num(auto.edits), records: num(auto.records), rules, signatures },
    manual: {
      records: num(manual.records), places: num(manual.places), groups, rows,
      dismissed: arr(manual.dismissed).map(x => { const o = obj(x); return { type: str(o.type), id: str(o.id), kind: str(o.kind), places: num(o.places) }; }),
    },
  };
}

/** Включённые по умолчанию правила — как решил сервер. */
export function defaultRules(c: TidyCheck): Set<string> {
  return new Set(Object.entries(c.auto.rules).filter(([, v]) => v.isDefault).map(([k]) => k));
}

/**
 * План при выбранных галочках: правки — сумма по включённым правилам; записи — по наборам правил
 * записей (запись в пачке, если хоть одно её правило включено). Без приближений.
 */
export function planFor(c: TidyCheck, enabled: ReadonlySet<string>): { edits: number; records: number } {
  let edits = 0;
  for (const [k, v] of Object.entries(c.auto.rules)) if (enabled.has(k)) edits += v.edits;
  let records = 0;
  for (const [sig, n] of Object.entries(c.auto.signatures)) if (sig.split(',').some(k => enabled.has(k))) records += n;
  return { edits, records };
}

/** Строки группы: запись, у которой есть места этого вида; порядок сервера (по числу мест). */
export function rowsOfKind(c: TidyCheck, kind: string): TidyRow[] {
  return c.manual.rows.filter(r => (r.byKind[kind] ?? 0) > 0);
}

/** Вершина → тип записи LORE для recordHref; null — открыть в v2 негде. */
const LORE_TYPE: Readonly<Record<string, string>> = {
  KnowTask: 'task', KnowSprint: 'sprint', KnowADR: 'adr', KnowDecision: 'decision', KnowSpec: 'spec',
  KnowQuestion: 'question', KnowRelease: 'release', KnowMilestone: 'milestone', KnowUseCase: 'feature',
};
export function loreTypeOf(vertexType: string): string | null {
  return Object.prototype.hasOwnProperty.call(LORE_TYPE, vertexType) ? LORE_TYPE[vertexType] : null;
}

export async function fetchTidy(opts: FetchOptions = {}): Promise<TidyCheck> {
  return parseTidy(await getJson('/lore/admin/tidy', opts));
}

async function postJson(url: string, opts: FetchOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? loreFetch;
  const res = await doFetch(url, { method: 'POST', signal: opts.signal, headers: { Accept: 'application/json' } });
  if (!(res.headers.get('Content-Type') ?? '').includes('json')) throw new LoreHttpError(res.status, 'NON_JSON', res.statusText);
  const body = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) throw new LoreHttpError(res.status, body?.error ?? '', body?.detail ?? '');
  return body;
}

/** «Перепроверить всё»: сервер перечитывает корпус. */
export async function recheckAll(opts: FetchOptions = {}): Promise<TidyCheck> {
  return parseTidy(await postJson('/lore/admin/tidy/recheck', opts));
}

/** «Перепроверить» одну запись: новый результат целиком (счётчики) и осталась ли строка. */
export async function recheckRecord(type: string, id: string, opts: FetchOptions = {}): Promise<{ check: TidyCheck; clean: boolean; found: boolean }> {
  const raw = obj(await getJson(`/lore/admin/tidy/record?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, opts));
  const rec = obj(raw.record);
  return { check: parseTidy(raw), clean: rec.row == null, found: rec.found === true };
}

// ───────────────────────────── применение пачкой ─────────────────────────────

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

export interface TidyDiffRow { type: string; id: string; field: string; rules: string[]; before: string; after: string }

/** Пробный прогон: план без записи и логин, которым подтверждают (null — вызывающий не человек). */
export interface TidyPlan { login: string | null; records: number; fields: number; edits: number; rules: string[]; diff: TidyDiffRow[] }

export interface TidyApplyAnswer {
  batchId: string; applied: number; failed: number; undoUntil: string | null;
  failures: { id: string; text: string; reason: string }[];
}

export async function planApply(rules: readonly string[], opts: FetchOptions = {}): Promise<TidyPlan> {
  const o = obj(await postBody('/lore/admin/tidy/apply', { rules, dry_run: true }, opts));
  return {
    login: typeof o.login === 'string' && o.login ? o.login : null,
    records: num(o.records), fields: num(o.fields), edits: num(o.edits), rules: arr(o.rules).map(str),
    diff: arr(o.diff).map(x => { const d = obj(x); return { type: str(d.type), id: str(d.id), field: str(d.field), rules: arr(d.rules).map(str), before: str(d.before), after: str(d.after) }; }),
  };
}

function parseApplyAnswer(raw: unknown): TidyApplyAnswer {
  const o = obj(raw);
  const failures = arr(o.items).map(obj).filter(i => i.result === 'failed').map(i => {
    const err = obj(i.error);
    return { id: `${str(i.type)}|${str(i.id)}|${str(i.field)}`, text: `${str(i.id)} · ${str(i.field)}`, reason: str(err.detail || err.error || i.status) };
  });
  return { batchId: str(o.batch_id), applied: num(o.applied ?? o.restored), failed: num(o.failed), undoUntil: typeof o.undo_until === 'string' ? o.undo_until : null, failures };
}

/** Применить пачку: правила и логин — слово подтверждения (сервер сверит со входом). */
export async function applyBatch(rules: readonly string[], login: string, opts: FetchOptions = {}): Promise<TidyApplyAnswer> {
  return parseApplyAnswer(await postBody('/lore/admin/tidy/apply', { rules, confirm_login: login }, opts));
}

/** Отменить пачку (15 минут): возвращаются только тексты, которые после пачки никто не правил. */
export async function undoBatch(batchId: string, login: string, opts: FetchOptions = {}): Promise<{ restored: number; changedAfter: number; failed: number }> {
  const o = obj(await postBody('/lore/admin/tidy/apply', { undo_of: batchId, confirm_login: login }, opts));
  return { restored: num(o.restored), changedAfter: num(o.changed_after), failed: num(o.failed) };
}

/** «Не ссылка» — отметить вид мест записи (или снять отметку); ответ — новый результат проверки, если он был. */
export async function dismissKind(type: string, id: string, kind: string, action: 'add' | 'remove', opts: FetchOptions = {}): Promise<TidyCheck | null> {
  const o = obj(await postBody('/lore/admin/tidy/dismiss', { type, id, kind, action }, opts));
  return o.manual ? parseTidy(o) : null;
}
