// «Состояние данных» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Блок отвечает на три вопроса: что проверено, что не смогли проверить, что
// обрезано. Это продолжение правила, на котором держится весь интерфейс:
// «не смогли проверить» ≠ «пусто». Молча потерянный блок неотличим от
// пустого, и человек делает выводы по неполным данным, не зная об этом.
//
// Источник — meta ответа. Когда бэкенд начнёт отдавать `sources` (состояние
// по каждому блоку), он станет главным; пока его нет, состояние выводится из
// `errors` и `truncated`, и мы не притворяемся, что знаем больше.
import type { KitMeta } from '../core/contract';

export interface FailedBlock { block: string; reason: string }

export interface DataState {
  /** Блоки, про которые точно известно, что они прочитаны. */
  checked: string[];
  /** Блоки, которые не прочитались, с причиной. */
  failed: FailedBlock[];
  /** Блоки, выдача которых обрезана. */
  truncatedBlocks: string[];
  /** Обрезана выдача целиком: сколько показано и, если известно, из скольких. */
  truncated?: { returned?: number; total?: number };
  /** Есть ли что сказать вообще. Нет — блок не показываем. */
  hasAnything: boolean;
}

/** Состояние блока, как его отдаёт сервер. */
interface SourceRow { block?: unknown; state?: unknown; reason?: unknown }

/**
 * Откуда берём сводку. Бэкенд заводит `meta.data_state` (договорённость с
 * серверной сессией 08.11.2026: ok / error с причиной / truncated); `sources`
 * принимаем как прежнее имя, чтобы переход не ломал ничего на полпути.
 */
function rows(meta: KitMeta): SourceRow[] {
  const m = meta as unknown as { data_state?: unknown; sources?: unknown };
  const v = Array.isArray(m.data_state) ? m.data_state : m.sources;
  return Array.isArray(v) ? (v as SourceRow[]) : [];
}

/**
 * Разбор meta в состояние данных.
 *
 * Незнакомое состояние блока НЕ пропускается молча: оно попадает в «не
 * смогли проверить» вместе с самим значением. Пропустить его значило бы
 * показать блок исправным, ничего о нём не зная.
 */
export function dataStateOf(meta: KitMeta): DataState {
  const checked: string[] = [];
  const failed: FailedBlock[] = [];
  const truncatedBlocks: string[] = [];
  const seen = new Set<string>();

  for (const r of rows(meta)) {
    const block = typeof r.block === 'string' ? r.block : '';
    if (!block) continue;
    const state = typeof r.state === 'string' ? r.state : '';
    const reason = typeof r.reason === 'string' ? r.reason : '';
    if (state === 'ok') { checked.push(block); continue; }
    if (state === 'truncated') { truncatedBlocks.push(block); continue; }
    // Сервер называет сбой «error», прежнее имя было «failed» — принимаем оба.
    if (state === 'error' || state === 'failed') {
      failed.push({ block, reason: reason || 'причина не названа' });
      seen.add(block);
      continue;
    }
    failed.push({ block, reason: reason || `состояние «${state}» неизвестно` });
    seen.add(block);
  }

  for (const e of meta.errors ?? []) {
    if (seen.has(e.block)) continue; // Уже сказано через sources — не задваиваем.
    failed.push({ block: e.block, reason: e.reason });
    seen.add(e.block);
  }

  // Флагу сервера верим: если он сказал «обрезано», арифметика его не отменяет.
  let truncated: DataState['truncated'];
  if (meta.truncated) {
    truncated = {};
    if (typeof meta.returned === 'number') truncated.returned = meta.returned;
    if (typeof meta.total === 'number') truncated.total = meta.total;
  }

  return {
    checked,
    failed,
    truncatedBlocks,
    truncated,
    hasAnything: failed.length > 0 || truncatedBlocks.length > 0 || truncated !== undefined,
  };
}
