// Загрузчик модели LORE (SPRINT_UXR_S10_SEIDR_KIT/K-MODEL-LOADER), ADR-LORE-048.
//
// Что здесь закреплено решениями:
//   • модель обязательна как ФОРМА, но не наш сервер
//     (D-2026-LORE-MODEL-PLUGGABLE-SOURCE): загрузчик принимает добытчика, а
//     не адрес. Витрина /kit, прототипы и работа без сборки (K-13) дают ту же
//     модель файлом — тогда «настоящий» и «демонстрационный» путь не
//     расходятся;
//   • сторож «данные не пробивают поведение» применяется к любому источнику:
//     файл проверяется так же, как ответ сервера, иначе демонстрационный путь
//     станет лазейкой;
//   • версия лежит ВНУТРИ документа: у файла нет ни ETag, ни заголовков, а
//     знать, какая модель перед нами, нужно всегда;
//   • «раздела нет» (missing) и «раздел пуст» — разные ответы;
//   • кеш виден: устаревшую модель берём в работу, но говорим, что она
//     устаревшая, и почему.
import { assertDataOnly } from './dataOnly';

/** Формат, который понимает этот загрузчик. */
export const MODEL_FORMAT = 'model/0';

export interface LoreModelDoc {
  format: string;
  version: string;
  /** Документ неполон — часть разделов ещё не описана. */
  partial: boolean;
  /** Названия отсутствующих РАЗДЕЛОВ (не типов). */
  missing: string[];
  /** Типы, статусы которых описаны. Пусто — не описан никто. */
  statusesKnown: string[];
  statuses: Record<string, unknown>;
  dictionaries: Record<string, unknown>;
  /** Текст для человека. Машиночитаемы флаги у статей, а не эти строки. */
  warnings: string[];
}

export type SectionState = 'present' | 'empty' | 'missing';

export interface ModelStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const CACHE_KEY = 'kit.model.doc';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Документ → модель. Бросает с причиной: негодная модель должна падать
 * заметно, а не превращаться в пустую.
 */
export function parseModel(raw: unknown): LoreModelDoc {
  const doc = obj(raw);
  const format = str(doc.format);
  if (!format) throw new Error('модель: нет поля format — непонятно, что это за документ');
  if (format !== MODEL_FORMAT) {
    throw new Error(`модель: формат «${format}» этот загрузчик не понимает, ожидается «${MODEL_FORMAT}»`);
  }
  const version = str(doc.version);
  if (!version) throw new Error('модель: нет поля version — без версии не работают ни кеш, ни скос версий');

  // Сторож применяется к любому источнику, включая файл рядом с прототипом.
  assertDataOnly(raw, 'модель');

  return {
    format,
    version,
    partial: doc.partial === true,
    missing: list(doc.missing),
    statusesKnown: list(doc.statuses_known),
    statuses: obj(doc.statuses),
    dictionaries: obj(doc.dictionaries),
    warnings: list(doc.warnings),
  };
}

/**
 * Состояние разделов. «Нет раздела» и «раздел пуст» различаются: первое
 * значит «ещё не описано», второе — «описано, и там ничего».
 */
export function modelSections(m: LoreModelDoc): Record<string, SectionState> {
  const of = (name: string, value: Record<string, unknown>): SectionState => {
    if (m.missing.includes(name)) return 'missing';
    return Object.keys(value).length > 0 ? 'present' : 'empty';
  };
  return {
    types: of('types', {}),
    surfaces: of('surfaces', {}),
    statuses: of('statuses', m.statuses),
    dictionaries: of('dictionaries', m.dictionaries),
  };
}

export function writeCachedModel(store: ModelStore, model: LoreModelDoc): void {
  store.set(CACHE_KEY, JSON.stringify(model));
}

/** Кеш; битый — как будто его нет: работать без кеша можно, падать нельзя. */
export function readCachedModel(store: ModelStore): LoreModelDoc | undefined {
  const raw = store.get(CACHE_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<LoreModelDoc>;
    if (!parsed || typeof parsed.version !== 'string' || !parsed.version) return undefined;
    return {
      format: str(parsed.format) || MODEL_FORMAT,
      version: parsed.version,
      partial: parsed.partial === true,
      missing: list(parsed.missing),
      statusesKnown: list(parsed.statusesKnown),
      statuses: obj(parsed.statuses),
      dictionaries: obj(parsed.dictionaries),
      warnings: list(parsed.warnings),
    };
  } catch {
    return undefined;
  }
}

/** Откуда брать документ. Адреса и токены — забота приложения, не kit. */
export type ModelFetcher = (signal?: AbortSignal) => Promise<unknown>;

export interface ModelResult {
  /** ok — свежая; stale — из кеша, источник не ответил; error — нечего показать. */
  state: 'ok' | 'stale' | 'error';
  model?: LoreModelDoc;
  /** Причина, по которой источник не ответил. У stale она тоже есть. */
  error?: unknown;
}

export interface LoadModelOptions {
  store?: ModelStore;
  signal?: AbortSignal;
}

/**
 * Загрузить модель. Источник не ответил, но кеш есть — отдаём кеш и прямо
 * говорим, что он устаревший и почему. Молчащего кеша не бывает: иначе
 * человек работает по старой модели и не знает об этом.
 */
export async function loadModel(fetchModel: ModelFetcher, opts: LoadModelOptions = {}): Promise<ModelResult> {
  try {
    const model = parseModel(await fetchModel(opts.signal));
    if (opts.store) writeCachedModel(opts.store, model);
    return { state: 'ok', model };
  } catch (error) {
    const cached = opts.store ? readCachedModel(opts.store) : undefined;
    if (cached) return { state: 'stale', model: cached, error };
    return { state: 'error', error };
  }
}
