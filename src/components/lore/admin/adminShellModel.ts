// AH-05 (прототип admin-v2, одобрен 04.11.2026): чистая логика оболочки админки.
// Вынесено из LoreAdminPanel ради vitest (adminShellModel.test.ts).
// Общее правило: «не смогли проверить» (unk) ≠ «пусто» (none) ≠ «всё хорошо».
// Тексты здесь не живут — модель отдаёт коды, оболочка переводит их через t().

import type { KcState } from '../kc-state';
import type { Preflight, Tab } from './types';
import { ALL_TABS, NAV_GROUPS } from './adminTabs';

// ── «где я» (телефон) ───────────────────────────────────────────────────────
export interface WhereAmI { tab: Tab; title: string; group: string; groupKey: string; color: string; pos: number; total: number }

export function whereAmI(tab: Tab): WhereAmI {
  const g = NAV_GROUPS.find(x => x.tabs.some(([k]) => k === tab)) ?? NAV_GROUPS[0];
  const title = g.tabs.find(([k]) => k === tab)?.[1] ?? tab;
  return { tab, title, group: g.label, groupKey: g.key, color: g.rail, pos: ALL_TABS.indexOf(tab) + 1, total: ALL_TABS.length };
}

export const whereAmILine = (w: WhereAmI) => `${w.group} › ${w.title} · ${w.pos}/${w.total}`;

// ── счётчики навигации ──────────────────────────────────────────────────────
export type CounterWhy = 'kc403' | 'kc503' | 'kcErr' | 'srcErr' | 'preflight';
export type NavCounter =
  | { kind: 'none' }                                           // нечего показать (загрузка или честный 0 слайса)
  | { kind: 'n'; n: number; kcAccounts?: number | null }        // число (у «Агентов» — ещё учётки KC; null = неизвестно)
  | { kind: 'unk'; why: CounterWhy; detail?: string }          // «?» — не смогли проверить
  | { kind: 'bad'; n: number };                                // красный — N проблем

/** Учётки KC: ответ KC (в т.ч. пустой) — число; 403/503/сеть — «?» со своей причиной. */
export function kcCounter(s: KcState<unknown>): NavCounter {
  switch (s.k) {
    case 'ok': return { kind: 'n', n: s.rows.length };
    case 'forbidden': return { kind: 'unk', why: 'kc403' };
    case 'off': return { kind: 'unk', why: 'kc503', detail: s.detail };
    case 'error': return { kind: 'unk', why: 'kcErr', detail: s.detail };
    default: return { kind: 'none' };
  }
}

/** Слайс: сбой — «?» (раньше счётчик просто пропадал, как при нуле — SH-04). */
export function sliceCounter(n: number, err: string | undefined, loaded: boolean): NavCounter {
  if (err) return { kind: 'unk', why: 'srcErr', detail: err };
  if (!loaded || n === 0) return { kind: 'none' };
  return { kind: 'n', n };
}

/**
 * SH-05: «Агенты» считают агентов ГРАФА (agent_owners) — то же, что первая таблица
 * вкладки; учётки Keycloak уходят в подпись. Граф от KC не зависит: при 403/503
 * число агентов остаётся, а учётки становятся неизвестными (null), не нулём.
 */
export function agentsCounter(graphN: number, err: string | undefined, loaded: boolean, kc: KcState<unknown>): NavCounter {
  const c = sliceCounter(graphN, err, loaded);
  if (c.kind !== 'n') return c;
  return { ...c, kcAccounts: kc.k === 'ok' ? kc.rows.length : null };
}

/** Проверки готовности к включению auth — ровно те, что в чек-листе «Настроек». */
export function readiness(pf: Preflight) {
  return { admins: pf.admin_count > 0, kc: pf.kc_configured && pf.kc_reachable, scope: pf.agent_scope_enforced };
}

export function readinessCounter(pf: Preflight | null): NavCounter {
  if (!pf) return { kind: 'unk', why: 'preflight' };
  const failed = Object.values(readiness(pf)).filter(ok => !ok).length;
  return failed ? { kind: 'bad', n: failed } : { kind: 'none' };
}

// ── полоса состояния системы ────────────────────────────────────────────────
export type ChipTone = 'suc' | 'wrn' | 'dng' | 'mute';
export interface SysChip { id: 'auth' | 'kc' | 'scope' | 'role'; tone: ChipTone; state: string; detail?: string }

export function systemChips({ authEnabled, preflight, users, role }: {
  authEnabled: boolean; preflight: Preflight | null; users: KcState<unknown>; role: string;
}): SysChip[] {
  const auth: SysChip = authEnabled ? { id: 'auth', tone: 'suc', state: 'on' } : { id: 'auth', tone: 'wrn', state: 'off' };

  let kc: SysChip;
  if (users.k === 'forbidden') kc = { id: 'kc', tone: 'dng', state: '403' };
  else if (preflight) {
    kc = !preflight.kc_configured ? { id: 'kc', tone: 'dng', state: 'off' }
      : !preflight.kc_reachable ? { id: 'kc', tone: 'dng', state: 'down', detail: preflight.kc_error }
      : { id: 'kc', tone: 'suc', state: 'ok' };
  } else if (users.k === 'off') kc = { id: 'kc', tone: 'dng', state: 'off', detail: users.detail };
  else if (users.k === 'error') kc = { id: 'kc', tone: 'dng', state: 'down', detail: users.detail };
  else kc = { id: 'kc', tone: 'wrn', state: 'unknown' };

  // preflight === null — состояние защиты НЕИЗВЕСТНО, не «защищено» (как NotEnforcedNotice).
  const scope: SysChip = !preflight ? { id: 'scope', tone: 'wrn', state: 'unknown' }
    : preflight.agent_scope_enforced ? { id: 'scope', tone: 'suc', state: 'on' }
    : { id: 'scope', tone: 'dng', state: 'off' };

  return [auth, kc, scope, { id: 'role', tone: 'mute', state: role }];
}
