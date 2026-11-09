// Модель палитры Ctrl+K и поиска «/» (SPRINT_UXR_S10_SEIDR_KIT/K-07).
// Чистые функции без React: ищут по KitData.records и config.palette.commands
// (контракт ядра, kit/src/core/contract.ts). Без запроса — недавние.
//
// Поиск — по загруженным данным: если сервер обрезал выдачу (meta.truncated),
// палитра говорит это словами, а не делает вид, что искала по всему.
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import type { SafeStorage } from '../resilience/safeStorage';

/** all — Ctrl+K: записи и команды; records — «/»: только записи. */
export type PaletteMode = 'all' | 'records';

export interface PaletteRecordItem {
  type: 'record';
  id: string;
  title: string;
  kind: string;
  kindTitle: string;
  icon: string | undefined;
  status: string;
  /** remote — найдена сервером (S4-14), среди загруженных её нет. */
  origin?: 'remote' | 'recent-only';
}

export interface PaletteCommandItem {
  type: 'command';
  id: string;
  title: string;
}

/** Действие над целью палитры — записью или выделением (S4-14). */
export interface PaletteActionItem {
  type: 'action';
  id: string;
  title: string;
  hotkey?: string;
}

export type PaletteItem = PaletteRecordItem | PaletteCommandItem | PaletteActionItem;

export interface PaletteResult {
  /** recent — пустой запрос (недавние); results — выдача по запросу. */
  section: 'recent' | 'results';
  items: PaletteItem[];
  /** Сколько найдено до обрезки limit. */
  total: number;
  /**
   * Команды при пустом запросе — отдельной группой под недавними
   * (находка P1 аудита 08.11: «содержимое палитры — "Недавних пока нет": ни
   * команд, ни разделов»). Открытая палитра без истории обязана что-то
   * предлагать, иначе она выглядит сломанной. В выдаче по запросу команды
   * идут вместе с остальным — там важен вес, а не группа.
   */
  commands?: PaletteItem[];
}

/** Ключ элемента в списке недавних и в DOM: «record:T-1», «command:new-task». */
export type RecentKey = `${PaletteItem['type']}:${string}`;

export function itemKey(item: Pick<PaletteItem, 'type' | 'id'>): RecentKey {
  return `${item.type}:${item.id}`;
}

/** Регистр, ё→е и пробелы не влияют на поиск. */
export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Вес совпадения: каждое слово запроса обязано найтись в коде или заголовке
 * (И, а не ИЛИ), иначе 0. Код важнее заголовка, начало важнее середины.
 */
function score(tokens: string[], id: string, title: string): number {
  const nid = normalizeQuery(id);
  const ntitle = normalizeQuery(title);
  const full = tokens.join(' ');
  let s = 0;
  if (nid === full) s += 1000;
  else if (nid.startsWith(full)) s += 500;
  if (ntitle === full) s += 400;
  else if (ntitle.startsWith(full)) s += 200;
  for (const t of tokens) {
    if (nid.startsWith(t)) s += 30;
    else if (nid.includes(t)) s += 20;
    else if (ntitle.startsWith(t) || ntitle.includes(` ${t}`)) s += 15;
    else if (ntitle.includes(t)) s += 10;
    else return 0;
  }
  return s;
}

function recordItem(r: KitData['records'][number], config: KitConfig): PaletteRecordItem {
  const kind = config.kinds[r.kind];
  return { type: 'record', id: r.id, title: r.title, kind: r.kind, kindTitle: kind?.title ?? r.kind, icon: kind?.icon, status: r.status };
}

// ── цель: запись или выделение (S4-14) ────────────────────────────────────

/**
 * Над чем работает Ctrl+K: открытая запись или выделение списка (S4-10).
 * null — цели нет, палитра показывает только записи и общие команды.
 */
export type PaletteTarget =
  | { type: 'record'; record: KitRecord }
  | { type: 'selection'; ids: readonly string[] };

/**
 * Команда над целью. В отличие от config.palette.commands (контракт ядра,
 * run(ctx)), получает id цели: одной записи или всего выделения по порядку.
 * Promise — палитра ждёт (aria-busy), отказ показывает причиной.
 */
export interface PaletteAction {
  id: string;
  title: string;
  /** record — только над записью; selection — только над выделением; any — над обеими. */
  scope: 'record' | 'selection' | 'any';
  /** Клавиша того же действия в списке (слой клавиатуры, S4-11) — для подсказки Kbd. */
  hotkey?: string;
  run: (ids: string[], ctx: KitCtx) => void | Promise<void>;
}

export function targetIds(target: PaletteTarget | null | undefined): string[] {
  if (!target) return [];
  return target.type === 'record' ? [target.record.id] : [...target.ids];
}

/** Действия, применимые к цели. Пустое выделение — не цель: действовать не над чем. */
export function actionsFor(target: PaletteTarget | null | undefined, actions: readonly PaletteAction[]): PaletteAction[] {
  if (!target || targetIds(target).length === 0) return [];
  const want = target.type === 'record' ? 'record' : 'selection';
  return actions.filter(a => a.scope === 'any' || a.scope === want);
}

/** «Mod+Shift+C» → ['Ctrl','Shift','C'] для Kbd. */
export function hotkeyKeys(spec: string): string[] {
  return spec.split('+').map(p => p.trim()).filter(Boolean).map(p => {
    const l = p.toLowerCase();
    if (l === 'mod' || l === 'ctrl' || l === 'cmd' || l === 'meta') return 'Ctrl';
    if (l === 'shift') return 'Shift';
    if (l === 'alt' || l === 'option') return 'Alt';
    return p.length === 1 ? p.toUpperCase() : p;
  });
}

const actionItem = (a: PaletteAction): PaletteActionItem => ({ type: 'action', id: a.id, title: a.title, hotkey: a.hotkey });

// ── серверный поиск (S4-14) ───────────────────────────────────────────────

export interface PaletteRemoteResult {
  /** Найденное сервером — в форме записи контракта (status может быть пустым). */
  records: KitRecord[];
  /** true — сервер мог отдать не всё (потолок выдачи); палитра говорит это словами. */
  partial?: boolean;
}

/** Поиск на сервере; отказ — Error с причиной, палитра покажет её как есть. */
export type PaletteRemoteSearch = (query: string, signal: AbortSignal) => Promise<PaletteRemoteResult>;

/** Серверные записи, которых нет в локальной выдаче, — в порядке сервера. */
export function mergeRemote(local: readonly PaletteItem[], remote: readonly KitRecord[], config: KitConfig): PaletteRecordItem[] {
  const seen = new Set(local.filter(i => i.type === 'record').map(i => i.id));
  const out: PaletteRecordItem[] = [];
  for (const r of remote) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ ...recordItem(r, config), origin: 'remote' });
  }
  return out;
}

export interface SearchInput {
  query: string;
  data: KitData;
  config: KitConfig;
  mode: PaletteMode;
  /** Ключи недавних, свежие первыми (RecentList.list()). */
  recent: readonly string[];
  limit?: number;
  /** Действия над целью (уже отфильтрованные actionsFor); только в режиме all. */
  actions?: readonly PaletteAction[];
}

export function searchPalette({ query, data, config, mode, recent, limit = 30, actions = [] }: SearchInput): PaletteResult {
  const commands = mode === 'all' ? (config.palette?.commands ?? []) : [];
  const acts = mode === 'all' ? actions : [];
  const q = normalizeQuery(query);

  if (!q) {
    const byId = new Map(data.records.map(r => [r.id, r]));
    const cmdById = new Map(commands.map(c => [c.id, c]));
    // Действия над целью — первыми: ради них Ctrl+K и открыт над выделением.
    const items: PaletteItem[] = acts.map(actionItem);
    for (const key of recent) {
      const sep = key.indexOf(':');
      const type = key.slice(0, sep);
      const id = key.slice(sep + 1);
      if (type === 'record' && byId.has(id)) items.push(recordItem(byId.get(id)!, config));
      // Запись в недавних есть, а в выгрузке экрана её нет — показываем код и
      // помечаем, что о ней известно только это. Прежде такой пункт молча
      // пропадал, и палитра выглядела пустой, хотя человек точно открывал
      // записи (находка P1 аудита 08.11, вторая половина).
      else if (type === 'record' && id) {
        items.push({
          type: 'record', id, title: id, kind: '', kindTitle: '', icon: undefined, status: '',
          origin: 'recent-only',
        });
      }
      else if (type === 'command' && cmdById.has(id)) items.push({ type: 'command', id, title: cmdById.get(id)!.title });
    }
    // Команды, которых ещё нет в недавних: показываем, что палитра умеет.
    const shownIds = new Set(items.filter(i => i.type === 'command').map(i => i.id));
    const rest: PaletteItem[] = commands
      .filter(c => !shownIds.has(c.id))
      .map(c => ({ type: 'command' as const, id: c.id, title: c.title }));
    return {
      section: 'recent',
      items: items.slice(0, limit),
      total: items.length,
      commands: rest.slice(0, limit),
    };
  }

  const tokens = q.split(' ');
  const scored: { item: PaletteItem; s: number; i: number }[] = [];
  const base = data.records.length + commands.length;
  acts.forEach((a, i) => {
    const s = score(tokens, a.id, a.title);
    if (s > 0) scored.push({ item: actionItem(a), s, i: base + i });
  });
  data.records.forEach((r, i) => {
    const s = score(tokens, r.id, r.title);
    if (s > 0) scored.push({ item: recordItem(r, config), s, i });
  });
  commands.forEach((c, i) => {
    const s = score(tokens, c.id, c.title);
    if (s > 0) scored.push({ item: { type: 'command', id: c.id, title: c.title }, s, i: data.records.length + i });
  });
  // Детерминированно: вес по убыванию, при равенстве — порядок данных.
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return { section: 'results', items: scored.slice(0, limit).map(x => x.item), total: scored.length };
}

// ── недавние ──────────────────────────────────────────────────────────────

export interface RecentList {
  /** Ключи «type:id», свежие первыми. */
  list(): RecentKey[];
  push(item: Pick<PaletteItem, 'type' | 'id'>): void;
}

export const RECENT_STORAGE_KEY = 'seidr.kit.palette.recent';

/**
 * Недавние поверх SafeStorage (S4-00f): если localStorage недоступен, список
 * живёт в памяти, а честную плашку рисует StorageBanner того же хранилища.
 */
export function createRecentList(storage: SafeStorage, opts: { key?: string; max?: number } = {}): RecentList {
  const key = opts.key ?? RECENT_STORAGE_KEY;
  const max = opts.max ?? 8;
  const read = (): RecentKey[] => {
    try {
      const raw = JSON.parse(storage.get(key) ?? '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((x): x is RecentKey => typeof x === 'string' && /^(record|command):./.test(x));
    } catch {
      return [];
    }
  };
  return {
    list: read,
    push(item) {
      const k = itemKey(item);
      const next = [k, ...read().filter(x => x !== k)].slice(0, max);
      storage.set(key, JSON.stringify(next));
    },
  };
}
