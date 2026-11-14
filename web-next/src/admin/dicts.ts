// «Словари» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-31 п.1 и п.3, решение
// владелицы 11.11: 1а — отдельный раздел, 3б — «Теги» вкладкой в нём).
// Паритет со старой вкладкой v1 DictsTab/TagsTab (src/components/lore/admin).
//
// Источники — те же, что у v1:
//   • срез dictionary — все записи KnowDictEntry, вместе с отключёнными;
//   • срез components — счёт использования значений area (у прочих словарей
//     сервер счёта не даёт — «н/д», а не 0);
//   • срез tags_usage — теги и сколько записей ими помечено (только чтение);
//   • запись — POST /lore/dict/entry (partial-safe: null-поле не трогается).
//
// Справочники правит только человек. MCP dict_set для агентов требует
// human_approval (решение 09.11), а UI ходит от имени человека с его JWT —
// сервер проверяет admin (requireAdmin), заголовок согласования здесь не нужен
// и не шлётся: подставить «согласие» от имени человека UI не вправе.
import type { DiffRow } from '@seidr/kit';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import { loreFetch } from '../auth/session';

export interface DictRow {
  dict_type: string;
  code: string;
  label_ru: string | null;
  label_en: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number | null;
  is_active: boolean;
  is_extensible: boolean;
  /** WK-01: вид статьи — только у словаря с набором видов (DICT_KINDS); null — не задан. */
  kind: string | null;
}

/** То, что правится в форме: код (только у нового), метки, вид, порядок, активность. */
export interface DictDraft {
  code: string;
  label_ru: string | null;
  label_en: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number | null;
  is_active: boolean;
  /** WK-01: вид (tech | service у product); null — не задан и не шлётся (сервер: null = не трогать). */
  kind?: string | null;
}

/**
 * WK-01: наборы видов по словарям — зеркало LoreDictResource.KINDS. Вид продукта ИТ / не ИТ.
 * Снять заданный вид запись не умеет (null = «не трогать»), поэтому форма его не предлагает.
 */
export const DICT_KINDS: Record<string, readonly string[]> = { product: ['tech', 'service'] };

export function dictKinds(dictType: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(DICT_KINDS, dictType) ? DICT_KINDS[dictType] : null;
}

export interface TagRow { tag_id: string; uses: number }

/**
 * Канон-словари (ADR-LORE-010): значения зашиты в статусы всего корпуса.
 * Тот же список, что у v1 (DictsTab.CANON_TYPES).
 */
export const CANON_DICT_TYPES = ['adr_status', 'sprint_status', 'task_status', 'priority'] as const;

export function isCanonDict(t: string): boolean {
  return (CANON_DICT_TYPES as readonly string[]).includes(t);
}

/** Токены темы для цвета значения (v1 AL-42); прочее — «расширенный» CSS. */
export const DICT_COLOR_TOKENS = ['var(--acc)', 'var(--suc)', 'var(--inf)', 'var(--wrn)', 'var(--dng)', 'var(--t2)'] as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseDictRows(rows: readonly unknown[]): DictRow[] {
  return rows.map(obj).filter(r => typeof r.dict_type === 'string' && typeof r.code === 'string').map(r => ({
    dict_type: r.dict_type as string,
    code: r.code as string,
    label_ru: strOrNull(r.label_ru),
    label_en: strOrNull(r.label_en),
    color: strOrNull(r.color),
    icon: strOrNull(r.icon),
    sort_order: numOrNull(r.sort_order),
    // Слайс маскирует NULL через ifnull(is_active, true); не пришло вовсе — тоже «активно».
    is_active: r.is_active !== false,
    is_extensible: r.is_extensible === true,
    kind: strOrNull(r.kind),
  }));
}

export function dictTypes(rows: readonly DictRow[]): { type: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.dict_type, (m.get(r.dict_type) ?? 0) + 1);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, n]) => ({ type, n }));
}

/** Использование area: компоненты прочитаны — счёт; нет — причина. */
export type AreaUsage = { state: 'ok'; counts: Record<string, number> } | { state: 'unknown'; reason: string };

export function areaUsageOf(components: readonly unknown[], truncated: boolean): AreaUsage {
  // Обрезанная выдача недосчитает — это «не смогли посчитать», а не меньшее число.
  if (truncated) return { state: 'unknown', reason: 'components: truncated' };
  const counts: Record<string, number> = {};
  for (const c of components.map(obj)) {
    const a = c.area;
    if (typeof a === 'string' && a !== '') counts[a] = (counts[a] ?? 0) + 1;
  }
  return { state: 'ok', counts };
}

/** Клетка «использований»: число · счёта для этого словаря нет · не смогли посчитать. */
export type UsageCell = { kind: 'n'; n: number } | { kind: 'na' } | { kind: 'unknown'; reason: string };

export function usageOf(dictType: string, code: string, usage: AreaUsage): UsageCell {
  if (dictType !== 'area') return { kind: 'na' };
  if (usage.state === 'unknown') return { kind: 'unknown', reason: usage.reason };
  return { kind: 'n', n: usage.counts[code] ?? 0 };
}

/** Проверка кода нового типа (v1 RM-P11, dictTypeInput.ts): ключ данных — с клавиатуры. */
export type NewDictTypeCheck =
  | { kind: 'empty' }
  | { kind: 'bad' }
  | { kind: 'exists'; code: string }
  | { kind: 'new'; code: string };

const TYPE_CODE = /^[a-z][a-z0-9_]*$/;

export function checkNewDictType(raw: string, existing: readonly string[]): NewDictTypeCheck {
  const code = raw.trim();
  if (!code) return { kind: 'empty' };
  if (!TYPE_CODE.test(code)) return { kind: 'bad' };
  return existing.includes(code) ? { kind: 'exists', code } : { kind: 'new', code };
}

const FIELDS = ['code', 'label_ru', 'label_en', 'color', 'icon', 'sort_order', 'is_active', 'kind'] as const;
type Field = (typeof FIELDS)[number];

const shown = (f: Field, v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (f === 'is_active') return v ? 'true' : 'false';
  return String(v);
};

/**
 * «Было → станет» по полям — вход kit DiffPreview. Прежнее значение читано
 * срезом, поэтому каждая строка «проверена». Нового значения нет — снятие,
 * прежнего не было — добавление (kit не терпит «было (пусто) → стало X»).
 */
export function dictEntryDiff(before: DictRow | null, after: DictDraft, dictType?: string): DiffRow[] {
  const withKind = dictKinds(dictType ?? before?.dict_type ?? '') !== null;
  return FIELDS.filter(f => f !== 'kind' || withKind).map(f => {
    const from = before ? shown(f, before[f]) : null;
    const to = shown(f, f === 'code' ? after.code.trim() : after[f]);
    const base = { id: f, text: f, check: { state: 'checked' as const } };
    if (from === to) return { ...base, kind: 'same' as const, detail: to ?? '' };
    if (from === null) return { ...base, kind: 'add' as const, detail: to ?? '' };
    if (to === null) return { ...base, kind: 'remove' as const, detail: from };
    return { ...base, kind: 'change' as const, from, to };
  });
}

/** Подтверждение словом: канон-словарь — всегда; деактивация значения — всегда. */
export function needsDictConfirm(dictType: string, before: DictRow | null, after: DictDraft): boolean {
  return isCanonDict(dictType) || (before !== null && before.is_active && !after.is_active);
}

/** Тело POST /lore/dict/entry — контракт v1: пустое → null (поле не трогается). */
export function dictEntryBody(dictType: string, d: DictDraft): Record<string, unknown> {
  const s = (v: string | null) => (v && v.trim() !== '' ? v : null);
  return {
    dict_type: dictType,
    code: d.code.trim(),
    label_ru: d.label_ru ?? null,
    label_en: s(d.label_en),
    color: s(d.color),
    icon: s(d.icon),
    sort_order: d.sort_order ?? null,
    is_active: d.is_active,
    is_extensible: null,
    // WK-01: вид — только у словаря с видами (у прочих ключа нет: контракт v1 тот же);
    // не задан — null, сервер его не трогает.
    ...(dictKinds(dictType) ? { kind: d.kind && dictKinds(dictType)!.includes(d.kind) ? d.kind : null } : {}),
  };
}

export interface DictsData {
  rows: DictRow[];
  truncated: boolean;
  usage: AreaUsage;
}

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);

/** Словарь и счёт area. Сбой компонентов НЕ роняет экран — гасит только счёт. */
export async function fetchDicts(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<DictsData> {
  const [dict, usage] = await Promise.all([
    fetchSlice<unknown>('dictionary', { limit: '1000' }, { signal, fetchImpl }),
    fetchSlice<unknown>('components', { limit: '1000' }, { signal, fetchImpl }).then(
      b => areaUsageOf(b.rows, b.truncated === true),
      (e: unknown): AreaUsage => {
        if (signal?.aborted) throw e;
        return { state: 'unknown', reason: reasonOf(e) };
      },
    ),
  ]);
  return { rows: parseDictRows(dict.rows), truncated: dict.truncated === true, usage };
}

export async function fetchTags(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<{ rows: TagRow[]; truncated: boolean }> {
  const b = await fetchSlice<unknown>('tags_usage', {}, { signal, fetchImpl });
  const rows = b.rows.map(obj)
    .filter(r => typeof r.tag_id === 'string')
    .map(r => ({ tag_id: r.tag_id as string, uses: numOrNull(r.uses) ?? 0 }));
  return { rows, truncated: b.truncated === true };
}

/** Запись значения. Ответ сервера — исход (updated/created/unchanged), если назван. */
export async function saveDictEntry(body: Record<string, unknown>, fetchImpl: typeof fetch = loreFetch): Promise<{ outcome: string | null }> {
  const res = await fetchImpl('/lore/dict/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let b: Obj | null = null;
  try { b = obj(await res.json()); } catch { b = null; }
  if (!res.ok || b === null) throw new LoreHttpError(res.status, String(b?.error ?? (b === null ? 'NON_JSON' : '')), String(b?.detail ?? ''));
  return { outcome: typeof b.outcome === 'string' ? b.outcome : null };
}
