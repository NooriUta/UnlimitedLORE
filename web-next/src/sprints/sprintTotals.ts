// Итоги спринта: задач x/y, оценка Σ дн, факт Σ дн
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09, просьба владелицы 09.11.2026:
// «оценка и размер спринтов суммарно по дням и задач тоже важный элемент а его
// нет»).
//
// СЧИТАЕТ СЕРВЕР, клиент только рисует. Это не удобство, а правило, и оно
// выросло из сегодняшней находки: одно число, посчитанное в двух местах,
// расходится. В kit список статусных цветов лежал в ТРЁХ местах и уже разошёлся
// (SPRINT_UXR_S10_SEIDR_KIT/K-14); повторять это с суммами незачем. Поэтому
// срез `sprint_totals` и паспорт кормит ОДНА функция сервера
// (`LoreSprintTotals`), а здесь нет ни сложения, ни правила «что считать
// готовым».
//
// ЭТОТ МОДУЛЬ ЗАМЕНИЛ `sprintProgress.ts`, и вот чем он лучше по делу:
//   • прежний источник `tasks_of_sprints_batch` несёт `note_md` — живой замер
//     09.11 дал 3 629 607 символов (3,6 МБ) на двадцать спринтов, из которых
//     для сумм не нужен ни один символ. 500 спринтов ≈ 25 пачек ≈ 90 МБ тел;
//   • «готово» и «из скольких» считались каноном КЛИЕНТА, а теперь приходят с
//     сервера по правилу, которое он же и объявляет (`rule` в ответе);
//   • оценка и факт раньше не приходили вовсе.
//
// Правило сервера (его слова, из ответа среза): «из» — все задачи, кроме
// отменённых; «готово» — только категория finished, PARTIAL, READY FOR DEPLOY и UAT TESTING
// не готово; сумма — по заполненным значениям, `known` — сколько заполнено, при
// `known = 0` значение `null`. Ровно то же, что считал прежний клиентский
// канон, — поэтому x/y на экране не меняется.
import type { KitProgressInput, KitSumInput } from '@seidr/kit';
import type { LoreClient } from './loreClient';

/**
 * Сколько спринтов в одном запросе. Ограничение не серверное, а адресное:
 * `sprint_ids` едет в строке запроса, и длинный список её переполнит. Двадцать
 * — то же число, что было у прежнего загрузчика, проверенное на корпусе.
 */
export const TOTALS_CHUNK = 20;

/** Сколько пачек одновременно: 500 спринтов = 25 пачек, не 25 запросов разом. */
const PARALLEL = 4;

/** Форма суммы с сервера: value, known, of — и done у счёта задач. */
export interface ServerSum {
  value?: number | null;
  known?: number | null;
  of?: number | null;
  done?: number | null;
}

interface TotalsRow {
  sprint_id?: string | null;
  state?: string | null;
  tasks_total?: ServerSum | null;
  effort_days_total?: ServerSum | null;
  actual_days_total?: ServerSum | null;
}

/** Поля записи, которые догружаются этим модулем (для них ставится «…»). */
export const TOTALS_FIELDS = ['tasks', 'effort_total', 'actual_total'] as const;

/** Причины, названные словами: их увидит человек в подсказке ячейки. */
export const ABSENT_NUMBERS = 'сервер не прислал числа итогов';
export const ABSENT_ROW = 'сервер не вернул строку итогов для этого спринта';
export const UNKNOWN_STATE = 'сервер пометил итоги спринта как непосчитанные';

const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Счёт задач → форма прогресса kit. Нет чисел — «не посчитано», а не 0/0:
 * пустой спринт («задач ноль») и неотвеченный спринт — разные утверждения, и
 * первое сервер выражает числами 0/0, второе сюда просто не доходит.
 */
function progressOfRow(t: ServerSum | null | undefined, cut: boolean): KitProgressInput {
  const done = int(t?.done);
  const of = int(t?.of);
  if (done === null || of === null) return { error: ABSENT_NUMBERS };
  return cut ? { done, total: of, partial: true } : { done, total: of };
}

/** Сумма → форма ячейки суммы kit. Пропущенный охват — «не посчитано». */
export function sumOfRow(s: ServerSum | null | undefined, cut: boolean): KitSumInput {
  const known = int(s?.known);
  const of = int(s?.of);
  if (known === null || of === null) return { error: ABSENT_NUMBERS };
  return { value: num(s?.value), known, of, ...(cut ? { cut: true } : {}) };
}

/**
 * Складывали ли НЕ ВСЁ.
 *
 * Если это не передать, обрезка занизит сумму МОЛЧА, и число будет выглядеть
 * точным — худший исход из возможных.
 *
 * **Источник — своё поле сервера `inputs_truncated`**, а не чужой `truncated`.
 * Сначала я читал `truncated`, потому что в `AidaLoreResource` тело ответа
 * собирается ДО свёртки и признак относился к СТРОКАМ ЗАДАЧ. Это работало, но
 * держалось на ПОРЯДКЕ КОДА: перенеси свёртку в SQL (GROUP BY вместо
 * постобработки) — и `truncated` стал бы про строки итогов, сменив смысл, не
 * сменив имени. По просьбе серверная сессия завела отдельное поле (#995), его
 * смысл от места свёртки не зависит, и оно держится её тестом.
 *
 * **`page.has_more` из признака УБРАН, и это исправление, а не упрощение.**
 * Страница применяется (`SlicePage.apply`) ПОСЛЕ свёртки, то есть режет строки
 * ИТОГОВ — по одной на спринт, — а не слагаемые. Считать это обрезкой сумм было
 * излишней осторожностью: суммы в отданных строках при этом полные.
 *
 * Поля нет вовсе — значит сервер старее #995 (например стенд ещё не обновлён).
 * Тогда читается прежний признак: это не догадка, а тот же сигнал, что сервер
 * тогда и давал. Считать отсутствие ключа за «не обрезано» нельзя — это было бы
 * молчаливым допущением.
 */
function wasCut(body: { inputs_truncated?: boolean; truncated?: boolean | 'unknown' }): boolean {
  if (typeof body.inputs_truncated === 'boolean') return body.inputs_truncated;
  return body.truncated === true || body.truncated === 'unknown';
}

/**
 * Итоги по спринтам. Возвращает ЗАПЛАТКИ ПОЛЕЙ (имя поля → значение), а не
 * одно значение: за один проход приходит и прогресс, и две суммы, и грузить их
 * тремя запросами было бы тремя запросами ради одной строки.
 *
 * Честность по спринтам, а не по ответу целиком: упавшая пачка помечает ТОЛЬКО
 * свои спринты, остальные остаются посчитанными. Спринт, которого сервер не
 * вернул, получает названную причину — а не тихий ноль.
 */
export async function loadSprintTotals(
  client: LoreClient,
  sprintIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const chunks: string[][] = [];
  for (let i = 0; i < sprintIds.length; i += TOTALS_CHUNK) chunks.push(sprintIds.slice(i, i + TOTALS_CHUNK));

  const fail = (ids: readonly string[], reason: string) => {
    for (const id of ids) {
      out.set(id, { tasks: { error: reason }, effort_total: { error: reason }, actual_total: { error: reason } });
    }
  };

  const runChunk = async (ids: string[]) => {
    try {
      const body = await client.slice<TotalsRow>('sprint_totals', { sprint_ids: ids.join(',') }, signal);
      const cut = wasCut(body);
      const seen = new Set<string>();
      for (const r of body.rows) {
        const id = typeof r.sprint_id === 'string' ? r.sprint_id : '';
        if (!id || !ids.includes(id)) continue;
        seen.add(id);
        // Сервер обещает `state` у каждой строки, чтобы форма была готова к
        // частичным ответам. Пока бывает только «ok», но верить надо полю, а
        // не обещанию: чужое состояние — причина словами, а не числа наугад.
        if (r.state && r.state !== 'ok') {
          out.set(id, { tasks: { error: UNKNOWN_STATE }, effort_total: { error: UNKNOWN_STATE }, actual_total: { error: UNKNOWN_STATE } });
          continue;
        }
        out.set(id, {
          tasks: progressOfRow(r.tasks_total, cut),
          effort_total: sumOfRow(r.effort_days_total, cut),
          actual_total: sumOfRow(r.actual_days_total, cut),
        });
      }
      // Строка на КАЖДЫЙ запрошенный спринт — обещание сервера. Не выполнено —
      // говорим это, а не показываем пустоту: пустота читалась бы как «ноль».
      const missing = ids.filter(id => !seen.has(id));
      if (missing.length) fail(missing, ABSENT_ROW);
    } catch (e) {
      if (signal?.aborted) throw e;
      fail(ids, errText(e));
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      await runChunk(chunks[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
  return out;
}
