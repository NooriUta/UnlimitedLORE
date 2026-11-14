// S4-18 (решение владелицы 14.11.2026): защита от случайной смены статуса.
//
//  • По умолчанию смена применяется сразу (статус «в 2 касания», п. 27 не ломается), а рядом
//    8 секунд висит «Вернуть» с видимым остатком: человек видит, успеет ли. Отмена — новый
//    обратный переход (SCD2-версия), а не стирание истории.
//  • Личная настройка «подтверждать смену статуса» — сначала вопрос «A → B?», без «Сменить»
//    ничего не пишется.
//  • Перетаскивание на доске (если появится) меняет статус ВСЕГДА через подтверждение — kit
//    своей доской статус сейчас не меняет, правило закреплено здесь для будущего пути.
import { useCallback, useEffect, useState } from 'react';
import { kitT, useKitLang } from '../i18n';

/** Окно отмены по умолчанию, мс (K2-BATCH-UNDO, S4-18). */
export const STATUS_UNDO_MS = 8000;

/** Окно отмены с видимым остатком: start() — открыть, left — целые секунды (0 — закрыто). */
export function useUndoWindow(ms: number = STATUS_UNDO_MS, now: () => number = () => Date.now()) {
  const [until, setUntil] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (until === null) return;
    // Раз в 250 мс: секунда на экране не прыгает через одну (как в BatchUndo).
    const id = setInterval(() => {
      if (now() >= until) setUntil(null);
      tick(x => x + 1);
    }, 250);
    return () => clearInterval(id);
  }, [until, now]);
  const left = until === null ? 0 : Math.max(0, Math.ceil((until - now()) / 1000));
  const start = useCallback(() => setUntil(now() + ms), [ms, now]);
  const clear = useCallback(() => setUntil(null), []);
  return { left, start, clear };
}

/** Вопрос перед сменой статуса (настройка «подтверждать»): «Сменить статус «A» → «B»?». */
export function StatusConfirm({ from, to, onConfirm, onCancel }: { from: string; to: string; onConfirm: () => void; onCancel: () => void }) {
  const lang = useKitLang();
  const ask = kitT(lang, 'kit.status.confirmAsk', { from, to });
  return (
    <span className="sk-statusask" role="group" aria-label={ask}>
      <span className="sk-statusask__q">{ask}</span>
      <button type="button" className="sk-btn sk-btn--primary" onClick={onConfirm}>{kitT(lang, 'kit.status.confirmYes')}</button>
      <button type="button" className="sk-btn" onClick={onCancel}>{kitT(lang, 'kit.status.confirmNo')}</button>
    </span>
  );
}
