// Пачка как объект: окно отмены с видимым остатком (SPRINT_UXR_S10_SEIDR_KIT_2/K2-BATCH-UNDO).
//
// В kit уже была отмена ОДНОГО перехода статуса (`core/useStatusChange.ts`).
// Здесь другой объект: операция с идентификатором, которой отменяют СРАЗУ ВСЮ
// пачку. Отмена по одному означает, что после ошибки надо вспомнить, что
// именно применилось, и снять по очереди — то есть отмены фактически нет.
//
// Четыре решения:
//
//  1. **Остаток виден цифрой.** Без неё человек не знает, успеет ли, и жмёт
//     наугад. Тикаем раз в 250 мс: секунда на экране не должна «прыгать» на
//     две, а чаще — незачем.
//  2. **Окно закрылось — кнопки нет, но след есть.** Неработающая кнопка — ложь
//     («нажми, ничего не будет»), а исчезновение блока целиком скрыло бы, что
//     операция вообще была.
//  3. **Исходов ТРИ, а не два:** применилось всё · применилось частично ·
//     не применилось ничего. Молчаливое «успешно» на половине пачки — худший
//     исход из возможных, поэтому `applied`/`total` печатаются числами, а
//     отказавшиеся строки — со своими причинами.
//  4. **Срок не выдумывается.** `undoUntil` может прийти числом, строкой ISO,
//     `null` (отмену не предлагали) или мусором. «Отмену не предлагали»,
//     «окно закрылось» и «срок не поняли» — три РАЗНЫХ утверждения: первое про
//     операцию, второе про время, третье про ответ.
//
// Сама операция приходит от приложения (сервер её и считает) — элемент ничего
// не применяет и не отменяет, он показывает и зовёт `onUndo`. Границу K-14
// держит: что за изменения, знает приложение.
import { useEffect, useState } from 'react';
import { kitT, type KitLang } from '../i18n';

/** Строка, которая не применилась, и почему. */
export interface BatchItemFail { id: string; text: string; reason: string }

export interface BatchResult {
  /** Идентификатор операции — им и отменяют. */
  id: string;
  /** Сколько применилось и сколько просили. */
  applied: number;
  total: number;
  /** Что не применилось и почему. */
  failed?: readonly BatchItemFail[];
  /**
   * Когда закрывается окно отмены: мс, строка ISO или `null` — отмены не
   * предлагали. Мусор тоже возможен, и он называется мусором.
   */
  undoUntil?: string | number | null;
}

export interface BatchUndoProps {
  batch: BatchResult;
  onUndo?: (id: string) => void;
  /** Идёт отмена: кнопка занята. */
  undoing?: boolean;
  /** Отмена прошла. */
  undone?: boolean;
  /** Отмена не удалась — текст отказа от приложения (сервер знает причину). */
  undoError?: string | null;
  /** Часы (тесты); по умолчанию — часы браузера. */
  now?: () => number;
  lang?: KitLang;
}

/** Срок в мс; не поняли — undefined, не предлагали — null. */
function until(v: BatchResult['undoUntil']): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

export function BatchUndo({ batch, onUndo, undoing, undone, undoError, now, lang = 'ru' }: BatchUndoProps) {
  const clock = now ?? (() => Date.now());
  const deadline = until(batch.undoUntil);
  const [, setBeat] = useState(0);

  // Тик только пока он нужен: закрытое окно не надо перерисовывать вечно.
  const open = deadline !== null && deadline !== undefined && deadline > clock();
  useEffect(() => {
    if (!open || undone) return;
    const t = setInterval(() => setBeat(b => b + 1), 250);
    return () => clearInterval(t);
  }, [open, undone, deadline]);

  const left = deadline !== null && deadline !== undefined
    ? Math.max(0, Math.ceil((deadline - clock()) / 1000))
    : 0;

  const outcome = batch.applied >= batch.total && batch.total > 0
    ? 'applied'
    : batch.applied === 0
      ? 'none'
      : 'partial';

  const failed = batch.failed ?? [];

  return (
    <section className="sk-batch" data-testid="kit-batch" data-outcome={outcome} aria-label={kitT(lang, 'kit.batch.label')}>
      <p className="sk-batch__summary" data-testid="kit-batch-summary">
        {kitT(lang, `kit.batch.summary.${outcome}` as 'kit.batch.summary.applied', { applied: batch.applied, total: batch.total })}
      </p>

      {failed.length > 0 && (
        <ul className="sk-batch__failed" data-testid="kit-batch-failed">
          {failed.map(f => (
            <li key={f.id} className="sk-batch__fail">
              <span className="sk-batch__fail-text">{f.text}</span>
              <span className="sk-batch__fail-reason">{f.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {undone
        ? <p className="sk-batch__undone" data-testid="kit-batch-undone">{kitT(lang, 'kit.batch.undone')}</p>
        : deadline === null
          ? <p className="sk-batch__noundo" data-testid="kit-batch-noundo">{kitT(lang, 'kit.batch.noUndo')}</p>
          : deadline === undefined
            ? <p className="sk-batch__badtime" data-testid="kit-batch-badtime">{kitT(lang, 'kit.batch.badTime')}</p>
            : left > 0
              ? (
                <button
                  type="button"
                  className="sk-batch__undo"
                  data-testid="kit-batch-undo"
                  aria-disabled={undoing ? true : undefined}
                  onClick={() => { if (!undoing) onUndo?.(batch.id); }}
                >
                  {kitT(lang, 'kit.batch.undo', { s: left })}
                </button>
              )
              : <p className="sk-batch__expired" data-testid="kit-batch-expired">{kitT(lang, 'kit.batch.expired')}</p>}

      {undoError && (
        <p className="sk-batch__undofail" role="alert" data-testid="kit-batch-undofail">{undoError}</p>
      )}
    </section>
  );
}
