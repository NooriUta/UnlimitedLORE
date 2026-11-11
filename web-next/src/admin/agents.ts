// Агенты в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-15, S7B-16).
//
// Владелица 09.11.2026: «мне данные по harness нужны уже вчера». Harness (в чём
// работает агент: Claude Code, Kimi Code, DSH…) раньше был утоплен в имени
// «Claude Code (full)»; сервер (d8097ab4, миграция V75) завёл поле из ЗАКРЫТОГО
// реестра и заполнил его по имени только там, где подошло ровно одно правило.
//
// Здесь только чтение и одна правка:
//   • срез agent_owners → строки агентов с harness и машиной;
//   • реестр допустимых harness — справочник `harness` (срез dictionary,
//     dict_type=harness), как у agent_role; своей копии у клиента нет: новый
//     harness заводится в справочнике и появляется без перевыпуска. В выборе —
//     только is_active, по sort_order. Справочник пуст (на базе не прошла
//     миграция) или не прочитался — правки нет, причина сказана словами;
//   • правка harness — POST /lore/actor/owner (только админ).
// «Не указан» и «не привязана» — честные состояния, а не пустые клетки.
import { loreFetch } from '../auth/session';
import { fetchSlice, LoreHttpError, type SliceBody } from '../api/loreSlice';
import { getJson } from './actions';

export interface AgentRow {
  actor_id: string;
  name: string | null;
  client_id: string | null;
  agent_role: string | null;
  machine_id: string | null;
  session_id: string | null;
  /** Код из реестра или null — сервер не знает (не угадываем). */
  harness: string | null;
  /** Первый владелец — для правки (сервер ждёт один kc_sub). */
  owner_kc_sub: string | null;
  /** Все владельцы (OWNED_BY может быть несколько). */
  owner_kc_subs: string[];
  owner_display_name: string | null;
}

export interface AgentsData {
  rows: AgentRow[];
  /** Активные коды справочника по sort_order; null — справочник пуст или не прочитан: правки нет. */
  registry: string[] | null;
  /** Почему правки нет: справочник пуст / не прочитан (текст ошибки). null — всё в порядке. */
  registryProblem: { kind: 'empty' } | { kind: 'error'; reason: string } | null;
  /** Подписи кодов из справочника (в том числе неактивных); кода нет — показываем сам код. */
  labels: Record<string, string>;
  /** Строк больше, чем пришло (метаданные полноты среза). */
  truncated: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
/**
 * Владелец в agent_owners приходит МАССИВОМ (ребро OWNED_BY может быть не одно):
 * ["omiloreadmin"]. Строкой его ждать нельзя — иначе у каждого агента выходило
 * «владелец не указан», хотя он есть. Несколько владельцев — через запятую.
 */
const list = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(str).filter((x): x is string => x !== null);

export interface HarnessDictRow { code: string; label: string; active: boolean; sort: number }

/** Строки справочника harness: код, подпись на языке, активность, порядок. */
export function parseHarnessDict(rows: Array<Record<string, unknown>>, lang: 'ru' | 'en' = 'ru'): HarnessDictRow[] {
  return rows.map(r => ({
    code: String(r.code ?? ''),
    label: str(lang === 'en' ? r.label_en : r.label_ru) ?? str(r.label_ru) ?? String(r.code ?? ''),
    // is_active не пришёл — считаем активным: так справочник отдаёт значения по умолчанию.
    active: r.is_active !== false,
    sort: typeof r.sort_order === 'number' ? r.sort_order : 0,
  })).filter(d => d.code !== '');
}

export function parseAgents(body: SliceBody<Record<string, unknown>>, dict?: HarnessDictRow[] | { error: string }): AgentsData {
  const rows = (Array.isArray(body.rows) ? body.rows : []).map(r => ({
    actor_id: String(r.actor_id ?? ''),
    name: str(r.name),
    client_id: str(r.client_id),
    agent_role: str(r.agent_role),
    machine_id: str(r.machine_id),
    session_id: str(r.session_id),
    harness: str(r.harness),
    owner_kc_sub: list(r.owner_kc_sub)[0] ?? null,
    owner_kc_subs: list(r.owner_kc_sub),
    owner_display_name: list(r.owner_display_name).join(', ') || null,
  })).filter(r => r.actor_id !== '');
  let registry: string[] | null = null;
  let registryProblem: AgentsData['registryProblem'] = null;
  const labels: Record<string, string> = {};
  if (dict === undefined) registryProblem = { kind: 'empty' };
  else if ('error' in dict) registryProblem = { kind: 'error', reason: dict.error };
  else {
    for (const d of dict) labels[d.code] = d.label;
    const active = dict.filter(d => d.active).sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
    if (active.length) registry = active.map(d => d.code); else registryProblem = { kind: 'empty' };
  }
  return { rows, registry, registryProblem, labels, truncated: body.truncated === true };
}

export async function fetchAgents(signal?: AbortSignal, fetchImpl?: typeof fetch, lang: 'ru' | 'en' = 'ru'): Promise<AgentsData> {
  // Справочник читается рядом и НЕ роняет экран: без него агенты видны, нет только правки.
  const [body, dict] = await Promise.all([
    fetchSlice<Record<string, unknown>>('agent_owners', { limit: '1000' }, { signal, fetchImpl }),
    fetchSlice<Record<string, unknown>>('dictionary', { dict_type: 'harness' }, { signal, fetchImpl }).then(
      b => parseHarnessDict(b.rows, lang),
      (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
    ),
  ]);
  return parseAgents(body, dict);
}

/** Код стоит у актора, но в активном справочнике его нет — рисуем как есть с пометкой. */
export function offRegistry(harness: string | null, registry: string[] | null): boolean {
  return harness !== null && registry !== null && !registry.includes(harness);
}

/** Ключ «не указан» в разбивке и фильтре — отдельное значение, а не пропуск. */
export const HARNESS_NONE = '(none)';

/** Разбивка по harness: сколько агентов каждого; «не указан» — отдельной строкой. */
export function harnessCounts(rows: AgentRow[], registry: string[] | null): Array<{ key: string; n: number }> {
  const m = new Map<string, number>();
  for (const k of registry ?? []) m.set(k, 0);
  for (const r of rows) {
    const k = r.harness ?? HARNESS_NONE;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([key, n]) => ({ key, n })).filter(x => x.n > 0 || x.key !== HARNESS_NONE);
}

export function filterAgents(rows: AgentRow[], harness: string | null): AgentRow[] {
  if (harness === null) return rows;
  return rows.filter(r => (r.harness ?? HARNESS_NONE) === harness);
}

/**
 * Правка harness агента. Пустая строка — сброс в null (так договорено с
 * сервером). Вне реестра сервер отвечает 400 со списком — отдаём как ошибку.
 */
export async function setAgentHarness(
  row: Pick<AgentRow, 'actor_id' | 'client_id' | 'owner_kc_sub'>,
  harness: string | null,
  fetchImpl: typeof fetch = loreFetch,
): Promise<void> {
  await postActorOwner({ actor_id: row.actor_id, client_id: row.client_id, kc_sub: row.owner_kc_sub, harness: harness ?? '' }, fetchImpl);
}

/**
 * Привязка машины (S7B-16, сервер #1031): machine_id в POST /lore/actor/owner.
 * null — отвязать (уходит ""); harness в теле нет — сервер его не трогает.
 * Две машины с одним именем — 400 со словами сервера: отдаём как ошибку.
 */
export async function setAgentMachine(
  row: Pick<AgentRow, 'actor_id' | 'client_id' | 'owner_kc_sub'>,
  machineId: string | null,
  fetchImpl: typeof fetch = loreFetch,
): Promise<void> {
  const id = (machineId ?? '').trim();
  await postActorOwner({ actor_id: row.actor_id, client_id: row.client_id, kc_sub: row.owner_kc_sub, machine_id: id }, fetchImpl);
}

// ── S7B-16: находки детектора осиротевших агентов ─────────────────────────

/** Клиент Keycloak с сервисной учёткой, у которого нет агента в графе. */
export interface KcOrphan { clientId: string; id: string | null; enabled: boolean | null }

/**
 * Ответ GET /lore/kc/agent-orphans ({orphans:[{clientId,id,enabled}]}). Нет
 * массива orphans — сбой, а не «сирот нет»: пустота должна быть ответом KC.
 */
export function parseAgentOrphans(raw: unknown): KcOrphan[] {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(b.orphans)) throw new Error('malformed answer: orphans');
  return b.orphans.map(o => (o && typeof o === 'object' ? o : {}) as Record<string, unknown>)
    .map(o => ({ clientId: str(o.clientId) ?? '', id: str(o.id), enabled: typeof o.enabled === 'boolean' ? o.enabled : null }))
    .filter(o => o.clientId !== '');
}

export async function fetchAgentOrphans(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<KcOrphan[]> {
  return parseAgentOrphans(await getJson('/lore/kc/agent-orphans', { signal, fetchImpl }));
}

/** Сироты графа: агент без владельца (OWNED_BY нет) — проекты ему наследовать не от кого. */
export function graphOrphans(rows: readonly AgentRow[]): AgentRow[] {
  return rows.filter(r => r.owner_kc_subs.length === 0);
}

// ── S7B-04: почему агент видит проекты ─────────────────────────────────────

export type AgentWhy =
  | { kind: 'inherits'; owner: string; scope: string | null }
  | { kind: 'noowner' }
  | { kind: 'noclient' };

/**
 * Цепочка сервера (AL-68, D4): учётка (client_id) → агент → владелец → его
 * проекты; пишет агент там, где роль владельца делегирует его профиль.
 * Нет client_id — в цепочку не войти; нет владельца — наследовать не от кого.
 */
export function agentWhy(row: AgentRow): AgentWhy {
  if (!row.client_id) return { kind: 'noclient' };
  if (row.owner_kc_subs.length === 0) return { kind: 'noowner' };
  return { kind: 'inherits', owner: row.owner_display_name ?? row.owner_kc_subs.join(', '), scope: row.agent_role };
}

async function postActorOwner(body: Record<string, unknown>, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  const res = await fetchImpl('/lore/actor/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = '';
    let detail = '';
    try {
      const b = (await res.json()) as { error?: string; detail?: string };
      code = b.error ?? '';
      detail = b.detail ?? '';
    } catch {
      // не-JSON — статус скажет сам
    }
    throw new LoreHttpError(res.status, code, detail);
  }
}
