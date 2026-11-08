// Модель вкладки «История» записи (SPRINT_UXR_S5_RECORD_TASKS/S5-11).
//
// Формы повторяют контракт S2 «история SCD2» (SPEC-LORE-UXR-S2-CONTRACTS,
// GET /lore/history, web-next/src/api/contracts/s2.ts → HistoryResponse):
// версии новейшей первой, у каждой — снимок полей и автор (человек / агент /
// unknown — старые версии без авторства честно unknown). Контракт ядра
// (core/contract.ts) не трогаем: история — отдельный необязательный источник
// записи, его приносит экран (RecordView.history).
//
// Возврат версии — НЕ «откат» SCD2: это новая версия с полями старой, которую
// пишет существующий write-API приложения (onRestore). Поэтому план возврата —
// только поля, которые этот API умеет писать (restorable), и только отличные
// от текущей версии.

export type KitHistoryAuthor =
  | { kind: 'human'; kc_sub: string; display_name: string | null }
  | { kind: 'agent'; client_id: string; actor_id: string | null; session_id: string | null; owner_kc_sub: string | null }
  | { kind: 'unknown' };

export interface KitHistoryVersion {
  state_uid: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_open: boolean;
  status: string | null;
  /** Снимок полей версии без служебных (@rid, valid_*, state_uid). */
  fields: Record<string, unknown>;
  /** Поля, отличные от предыдущей (более старой) версии; у первой — все. */
  changed: string[];
  author: KitHistoryAuthor;
}

export interface KitHistoryPage { limit: number | null; offset: number; total: number; has_more: boolean }

export interface KitHistory {
  /** not_tracked — у типа нет цепочки SCD2: «история не ведётся», а не «правок не было». */
  tracking: 'scd2' | 'not_tracked';
  /** Новейшая первой. */
  versions: KitHistoryVersion[];
  /** Аномалии цепочки от сервера (multiple_open_versions…) — показываются как есть. */
  anomalies: string[];
  page: KitHistoryPage | null;
  /** Предупреждения источника (уже словами) — показываются как есть. */
  warnings: string[];
}

export interface KitFieldDiff {
  field: string;
  from: unknown;
  to: unknown;
  change: 'added' | 'removed' | 'changed';
}

export interface KitRestoreRequest {
  record_id: string;
  /** Версия, поля которой возвращаются. */
  version: KitHistoryVersion;
  /** Что запишется: from — текущее значение, to — значение из версии. */
  changes: KitFieldDiff[];
}

const isEmpty = (v: unknown) => v === null || v === undefined;
const norm = (v: unknown) => JSON.stringify(isEmpty(v) ? null : v);

/** Пополевая разница older → newer; пусто (null/undefined/нет ключа) — одно значение. По алфавиту. */
export function diffVersions(older: Record<string, unknown> | null, newer: Record<string, unknown>): KitFieldDiff[] {
  const prev = older ?? {};
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(newer)])].sort();
  const out: KitFieldDiff[] = [];
  for (const field of keys) {
    const from = isEmpty(prev[field]) ? null : prev[field];
    const to = isEmpty(newer[field]) ? null : newer[field];
    if (norm(from) === norm(to)) continue;
    out.push({ field, from, to, change: from === null ? 'added' : to === null ? 'removed' : 'changed' });
  }
  return out;
}

export type KitAuthorView =
  | { kind: 'human'; name: string }
  | { kind: 'agent'; name: string; owner: string | null }
  | { kind: 'unknown'; name: null };

/** Автор словами: человек — имя (иначе kc_sub), агент — client_id и владелец. */
export function historyAuthor(a: KitHistoryAuthor): KitAuthorView {
  if (a.kind === 'human') return { kind: 'human', name: a.display_name || a.kc_sub };
  if (a.kind === 'agent') return { kind: 'agent', name: a.client_id, owner: a.owner_kc_sub };
  return { kind: 'unknown', name: null };
}

/** Устойчивый ключ версии: state_uid, без него — valid_from и позиция в списке. */
export function versionKey(v: KitHistoryVersion, index: number): string {
  return v.state_uid ?? `${v.valid_from ?? 'none'}#${index}`;
}

/** Текущая версия: открытая, а если открытой нет (аномалия) — новейшая. */
export function currentVersion(versions: readonly KitHistoryVersion[]): KitHistoryVersion | undefined {
  return versions.find(v => v.is_open) ?? versions[0];
}

/** С чем сравнивать по умолчанию: со следующей более старой версией; у первой — null. */
export function compareBase(versions: readonly KitHistoryVersion[], key: string): string | null {
  const i = versions.findIndex((v, idx) => versionKey(v, idx) === key);
  if (i < 0 || i + 1 >= versions.length) return null;
  return versionKey(versions[i + 1], i + 1);
}

/** План возврата target как новой версии поверх current: только restorable и только отличные. */
export function restoreChanges(
  target: KitHistoryVersion,
  current: KitHistoryVersion,
  restorable: readonly string[],
): KitFieldDiff[] {
  const pick = (f: Record<string, unknown>) => Object.fromEntries(restorable.map(k => [k, f[k]]));
  return diffVersions(pick(current.fields), pick(target.fields));
}
