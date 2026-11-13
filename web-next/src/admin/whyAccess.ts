// «Почему не видит / 403» для АГЕНТА и ИНСТРУМЕНТА MCP (SPRINT_UXR_S7B_ADMIN/S7B-21, UC-3).
//
// Цепочка — та, по которой решает сервер (AL-68, ADR-LORE-036-D4,
// ProjectRbacService.agentAllowedInProject):
//   1. учётка — client_id клиента KC;
//   2. агент — KnowActor kind=agent с этим client_id;
//   3. владелец — ребро OWNED_BY (нет — «осиротевший», проекты не наследуются);
//   4. роль владельца в проекте — есть любая → агент проект ЧИТАЕТ;
//   5. делегирует ли эта роль профиль агента (матрица D4) → агент ПИШЕТ.
// Каждый шаг берёт исход из ответа сервера (/lore/admin/access/agents —
// owner/visible/writable; /lore/admin/access?kc_sub=владелец — роль и профили
// роли), клиент правил доступа не повторяет. Инструмент (семейство или путь
// записи) объясняет сервер: GET /lore/admin/access/tool — решение
// AgentScopeFilter.decide, того же метода, что отказывает на проде
// (AgentToolExplain). Не ответил — «не смогли проверить», а не «разрешено».
import type { ChainOutcome, ChainStep, ChainStop } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import type { AccessExplain, AgentProjects } from './access';
import { momentMs } from './moment';

/** Ответ сервера или причина, почему его нет: «нет прав» и «сбой» — разные исходы шага. */
export type Got<T> = { ok: true; data: T } | { ok: false; forbidden: boolean; reason: string };

export interface AgentRef {
  actor_id: string;
  name: string | null;
  client_id: string | null;
  /** Профиль агента (agent_scope): по нему сверяется делегирование D4. */
  agent_role: string | null;
}

export interface WhyInput {
  agent: AgentRef | null;
  project: string;
  /** Инструмент MCP или семейство записи; null — вопрос про агента целиком. */
  tool: string | null;
  /** GET /lore/admin/access/agents?client_id&agent_scope. */
  access: Got<AgentProjects>;
  /** GET /lore/admin/access?kc_sub=владелец&project; null — не спрашивали (владельца нет). */
  owner: Got<AccessExplain> | null;
  /** GET /lore/admin/access/tool?agent_scope&family|path; null/нет — инструмент не спрашивали. */
  toolExplain?: Got<ToolExplain> | null;
}

/** Ответ сервера «почему 403 на инструменте» (AgentToolExplain). */
export interface ToolExplain {
  verdict: 'allowed' | 'denied' | 'unlisted' | 'no_profile' | string;
  profile: string | null;
  path: string | null;
  family: string | null;
  /** Что закрыто: семейство или подпуть. */
  what?: string;
  why: string | null;
  allowed_profiles: string[];
  human_only: boolean;
  /** change_profile | human | project_role. */
  fix?: string;
}

export function parseToolExplain(raw: unknown): ToolExplain {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return {
    verdict: s(o.verdict) ?? 'unknown',
    profile: s(o.profile),
    path: s(o.path),
    family: s(o.family),
    ...(s(o.what) ? { what: s(o.what)! } : {}),
    why: s(o.why),
    allowed_profiles: Array.isArray(o.allowed_profiles) ? o.allowed_profiles.map(String) : [],
    human_only: o.human_only === true,
    ...(s(o.fix) ? { fix: s(o.fix)! } : {}),
  };
}

/** Инструмент из поля/журнала: путь записи (lore/…) — как путь, иначе — семейство. */
export function toolQuery(tool: string): { family?: string; path?: string } {
  const t = tool.trim();
  return /^\/?lore\//.test(t) ? { path: t } : { family: t };
}

export async function fetchToolExplain(
  q: { agent_scope: string; family?: string; path?: string }, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ToolExplain> {
  const params = new URLSearchParams({ agent_scope: q.agent_scope });
  if (q.family) params.set('family', q.family);
  if (q.path) params.set('path', q.path);
  const res = await (opts.fetchImpl ?? loreFetch)('/lore/admin/access/tool?' + params.toString(), { signal: opts.signal, headers: { Accept: 'application/json' } });
  let body: Record<string, unknown> | null = null;
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* не-JSON — статус скажет сам */ }
  if (!res.ok || body === null) {
    throw new LoreHttpError(res.status, String(body?.error ?? (body === null ? 'NON_JSON' : '')), String(body?.detail ?? ''));
  }
  return parseToolExplain(body);
}

/** Что можно исправить прямо из цепочки. */
export type WhyFix =
  | { kind: 'owner'; actor_id: string; client_id: string; agent: string }
  | { kind: 'role'; owner_kc_sub: string; project: string; current: string | null; need: 'see' | 'delegate' }
  /** Профиль агента не пишет в инструмент: выпустить учётку открытого профиля (мастер «агент человеку»). */
  | { kind: 'profile'; owner_kc_sub: string | null; profiles: string[]; tool: string; current: string | null }
  /** Человеческое семейство: агентом не исправить — делает человек. */
  | { kind: 'human'; tool: string };

export type WhyVerdict = 'writes' | 'reads' | 'none' | 'unknown' | 'toolUnknown' | 'toolDenied';

export interface WhyResult {
  verdict: WhyVerdict;
  steps: ChainStep[];
  decidedBy?: string;
  stopped?: ChainStop;
  fix: WhyFix | null;
  /** Проектный скоуп выключен — читают все вошедшие (сервер сказал scope_enforced=false). */
  scopeOff: boolean;
}

type Tr = (key: string, vars?: Record<string, string | number>) => string;

const unknownOf = (g: { forbidden: boolean; reason: string }): ChainOutcome =>
  g.forbidden ? { state: 'forbidden', reason: g.reason } : { state: 'unverified', reason: g.reason };

/** Чистая функция: ответы сервера → шаги, решающий шаг, итог и предложенная правка. */
export function agentChain(i: WhyInput, tr: Tr): WhyResult {
  const steps: ChainStep[] = [];
  const step = (id: string, outcome: ChainOutcome) => steps.push({ id, title: tr(`admin.why.step.${id}`), outcome });
  const toolAsked = i.tool !== null && i.tool.trim() !== '';
  const done = (r: Omit<WhyResult, 'steps' | 'scopeOff'>, scopeOff = false): WhyResult => ({ ...r, steps, scopeOff });
  const stop = (notRun: number, reason: string): ChainStop => ({ notRun, reason });
  // Инструмент: решение сервера (AgentScopeFilter.decide). Не ответил — «не смогли».
  let toolOpen = false;
  if (toolAsked) {
    const tool = i.tool!.trim();
    const te = i.toolExplain;
    if (!te || !te.ok) {
      step('tool', te && !te.ok ? unknownOf(te) : { state: 'unverified', reason: tr('admin.why.toolNoServer', { tool }) });
    } else if (te.data.verdict === 'denied') {
      const d = te.data;
      const what = d.what ?? d.family ?? tool;
      step('tool', { state: 'denied', detail: tr('admin.why.toolDenied', { what, why: d.why ?? '—' }) });
      const owner = i.access.ok ? i.access.data.owner_kc_sub : null;
      return done({
        verdict: 'toolDenied', decidedBy: 'tool', stopped: stop(5, tr('admin.why.stopTool')),
        fix: d.human_only || d.allowed_profiles.length === 0
          ? { kind: 'human', tool: what }
          : { kind: 'profile', owner_kc_sub: owner, profiles: d.allowed_profiles, tool: what, current: i.agent?.agent_role ?? null },
      });
    } else if (te.data.verdict === 'allowed' || te.data.verdict === 'unlisted') {
      toolOpen = true;
      step('tool', { state: 'confirmed', detail: te.data.why ?? tr('admin.why.toolAllowed', { profile: te.data.profile ?? '—' }) });
    } else {
      step('tool', { state: 'unverified', reason: te.data.why ?? tr('admin.why.toolNoServer', { tool }) });
    }
  }
  const toolV = (v: WhyVerdict): WhyVerdict => (toolAsked && !toolOpen ? 'toolUnknown' : v);

  const a = i.agent;
  if (!a || !a.client_id) {
    step('account', { state: 'denied', detail: tr('admin.why.noClient') });
    return done({ verdict: 'none', decidedBy: 'account', stopped: stop(4, tr('admin.why.stopNoEntry')), fix: null });
  }
  step('account', { state: 'confirmed', detail: a.client_id });
  step('agent', { state: 'confirmed', detail: a.name ?? a.actor_id });

  if (!i.access.ok) {
    step('owner', unknownOf(i.access));
    return done({ verdict: 'unknown', stopped: stop(2, tr('admin.why.stopNoAnswer')), fix: null });
  }
  const acc = i.access.data;
  if (!acc.owner_kc_sub) {
    step('owner', { state: 'denied', detail: acc.reason ?? tr('admin.why.noOwner') });
    return done({
      verdict: 'none', decidedBy: 'owner', stopped: stop(2, tr('admin.why.stopNoOwner')),
      fix: { kind: 'owner', actor_id: a.actor_id, client_id: a.client_id, agent: a.name ?? a.actor_id },
    });
  }
  step('owner', { state: 'confirmed', detail: acc.owner_kc_sub });

  const ex = i.owner && i.owner.ok ? i.owner.data : null;
  const role = ex?.project_role ?? null;
  const scopeOff = ex !== null && !ex.scope_enforced;
  // Видимость — по ответу сервера (visible), роль — подробность из объяснения по владельцу.
  if (!acc.visible.includes(i.project)) {
    step('role', { state: 'denied', detail: tr('admin.why.ownerNoRole', { project: i.project }) });
    return done({
      verdict: 'none', decidedBy: 'role', stopped: stop(1, tr('admin.why.stopNoRole')),
      fix: { kind: 'role', owner_kc_sub: acc.owner_kc_sub, project: i.project, current: null, need: 'see' },
    }, scopeOff);
  }
  step('role', { state: 'confirmed', detail: role ? tr('admin.why.ownerRole', { role }) : tr('admin.why.ownerRoleUnknown') });

  if (!a.agent_role) {
    step('delegate', { state: 'unverified', reason: tr('admin.why.noProfile') });
    return done({ verdict: toolAsked ? 'toolUnknown' : 'reads', fix: null }, scopeOff);
  }
  if (acc.writable.includes(i.project)) {
    step('delegate', { state: 'confirmed', detail: tr('admin.why.delegates', { role: role ?? '—', profile: a.agent_role }) });
    return done({ verdict: toolV('writes'), decidedBy: 'delegate', fix: null }, scopeOff);
  }
  const profiles = ex?.agent_profiles.length ? ex.agent_profiles.join(', ') : '—';
  step('delegate', { state: 'denied', detail: tr('admin.why.notDelegates', { role: role ?? '—', profile: a.agent_role, profiles }) });
  return done({
    verdict: 'reads', decidedBy: 'delegate',
    fix: { kind: 'role', owner_kc_sub: acc.owner_kc_sub, project: i.project, current: role, need: 'delegate' },
  }, scopeOff);
}

// ── отказы 403 за сутки ──────────────────────────────────────────────────

/** Момент «сутки назад» в виде, который принимает типизированный параметр since (ISO UTC). */
export function since24h(now: number): string {
  return `${new Date(now - 24 * 3600 * 1000).toISOString().slice(0, 19)}Z`;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Отказы 403 за сутки: сумма по срезу mcp_failures (since + code) и у скольких профилей. */
export async function fetch403Day(now: number, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<{ n: number; profiles: number }> {
  const b = await fetchSlice<Row>('mcp_failures', { since: since24h(now), code: '403' }, { signal, fetchImpl });
  let n = 0;
  let profiles = 0;
  for (const r of b.rows) {
    const f = num(r.failures);
    if (f && f > 0) { n += f; profiles += 1; }
  }
  return { n, profiles };
}

/** Строки тех же отказов — откуда начинать вопрос «почему». */
export async function fetch403Rows(now: number, signal?: AbortSignal, fetchImpl?: typeof fetch) {
  const b = await fetchSlice<Row>('mcp_failure_rows', { since: since24h(now), code: '403' }, { signal, fetchImpl });
  return b.rows.map(r => ({
    ts: momentMs(r.ts),
    family: typeof r.family === 'string' && r.family !== '' ? r.family : null,
    entity_id: typeof r.entity_id === 'string' && r.entity_id !== '' ? r.entity_id : null,
    caller: typeof r.caller === 'string' && r.caller !== '' ? r.caller : null,
  }));
}

// ── привязка владельца агенту ────────────────────────────────────────────

export interface OwnerBindAnswer { linked: boolean; hint: string | null }

/**
 * POST /lore/actor/owner: ставит владельца (старое ребро сносится сервером).
 * owner_linked=false — сервер сам говорит, что человека нет в графе: это не успех.
 */
export async function bindAgentOwner(
  req: { actor_id: string; client_id: string; kc_sub: string }, fetchImpl: typeof fetch = loreFetch,
): Promise<OwnerBindAnswer> {
  const res = await fetchImpl('/lore/actor/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(req),
  });
  let body: Row | null = null;
  try { body = (await res.json()) as Row; } catch { /* не-JSON — статус скажет сам */ }
  if (!res.ok || body === null) {
    throw new LoreHttpError(res.status, String(body?.error ?? (body === null ? 'NON_JSON' : '')), String(body?.detail ?? ''));
  }
  return { linked: body.owner_linked === true, hint: typeof body.hint === 'string' ? body.hint : null };
}
