// Модель палитры Ctrl+K и поиска «/» (SPRINT_UXR_S10_SEIDR_KIT/K-07).
// Чистые функции без React: ищут по KitData.records и config.palette.commands
// (контракт ядра, kit/src/core/contract.ts). Без запроса — недавние.
//
// Поиск — по загруженным данным: если сервер обрезал выдачу (meta.truncated),
// палитра говорит это словами, а не делает вид, что искала по всему.
import type { KitConfig, KitData } from '../core/contract';
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
}

export interface PaletteCommandItem {
  type: 'command';
  id: string;
  title: string;
}

export type PaletteItem = PaletteRecordItem | PaletteCommandItem;

export interface PaletteResult {
  /** recent — пустой запрос (недавние); results — выдача по запросу. */
  section: 'recent' | 'results';
  items: PaletteItem[];
  /** Сколько найдено до обрезки limit. */
  total: number;
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

export interface SearchInput {
  query: string;
  data: KitData;
  config: KitConfig;
  mode: PaletteMode;
  /** Ключи недавних, свежие первыми (RecentList.list()). */
  recent: readonly string[];
  limit?: number;
}

export function searchPalette({ query, data, config, mode, recent, limit = 30 }: SearchInput): PaletteResult {
  const commands = mode === 'all' ? (config.palette?.commands ?? []) : [];
  const q = normalizeQuery(query);

  if (!q) {
    const byId = new Map(data.records.map(r => [r.id, r]));
    const cmdById = new Map(commands.map(c => [c.id, c]));
    const items: PaletteItem[] = [];
    for (const key of recent) {
      const sep = key.indexOf(':');
      const type = key.slice(0, sep);
      const id = key.slice(sep + 1);
      if (type === 'record' && byId.has(id)) items.push(recordItem(byId.get(id)!, config));
      else if (type === 'command' && cmdById.has(id)) items.push({ type: 'command', id, title: cmdById.get(id)!.title });
    }
    return { section: 'recent', items: items.slice(0, limit), total: items.length };
  }

  const tokens = q.split(' ');
  const scored: { item: PaletteItem; s: number; i: number }[] = [];
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
