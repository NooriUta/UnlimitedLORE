// «Что изменится» перед применением (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DIFF).
//
// Зачем элемент вообще: одно нажатие меняет сразу несколько записей в
// нескольких местах. Без предпросмотра человек узнаёт, что именно он сделал,
// только из журнала — то есть после.
//
// **Главное требование и причина, по которой элемент дорогой: у КАЖДОЙ строки
// своё состояние проверки.** Строки собираются по внешним системам, где
// «такого нет» сплошь неотличимо от «не смогли спросить» и от «нет прав
// посмотреть». Дифф, который рисует эти три случая одинаково, вреднее
// отсутствия диффа: по нему раздают права. Поэтому:
//
//  • `checked` — проверено, строку можно применять;
//  • `unverified` — не смогли проверить, причина названа;
//  • `forbidden` — смотреть не дали, причина названа.
//
// Непроверенная строка в применение НЕ УХОДИТ, и это сказано у самой строки:
// иначе «применили 3» молча означало бы «2 применили, про третью не знаем».
//
// «Нечего применять» — три РАЗНЫХ утверждения: нечего сравнивать · всё уже
// есть · ни одна строка не проверена. Одна общая фраза на все три скрывала бы
// ровно ту разницу, из-за которой элемент и заведён.
//
// Границу K-14 элемент держит: что за изменения — знает приложение, здесь
// только форма (сторож — греп по исходнику в `DiffPreview.test.tsx`).
import { kitPlural, kitT, type KitLang } from '../i18n';
import { unknownWord } from './unknownOutcome';

/** Что строка сделает: добавится · снимется · уже есть. */
export type DiffKind = 'add' | 'remove' | 'same';

/**
 * Удалось ли проверить ЭТУ строку у источника.
 *
 * Причина обязательна там, где её отсутствие молчит: «не смогли» и «не дали»
 * без причины выглядят одинаково пустыми.
 */
export type DiffCheck =
  | { state: 'checked' }
  | { state: 'unverified'; reason?: string }
  | { state: 'forbidden'; reason?: string };

export interface DiffRow {
  id: string;
  kind: DiffKind;
  /** Что меняется — строкой от приложения. */
  text: string;
  /** Подробность рядом (серым): значение, уровень, что угодно от приложения. */
  detail?: string;
  check: DiffCheck;
}

export interface DiffPreviewProps {
  rows: readonly DiffRow[];
  /**
   * Применить. Получает ТОЛЬКО применимые строки: проверенные и меняющие
   * что-то. Результат применения — вход для пачки с окном отмены (K2-BATCH-UNDO).
   */
  onApply?: (rows: readonly DiffRow[]) => void;
  /** Идёт применение: кнопка занята и повторно не стреляет. */
  busy?: boolean;
  /** Подпись блока — от приложения. */
  label?: string;
  lang?: KitLang;
}

/** Применимо: строка что-то меняет И её удалось проверить. */
function applicable(r: DiffRow): boolean {
  return r.kind !== 'same' && r.check.state === 'checked';
}

export function DiffPreview({ rows, onApply, busy, label, lang = 'ru' }: DiffPreviewProps) {
  const changes = rows.filter(r => r.kind !== 'same');
  const toApply = rows.filter(applicable);

  // Почему применять нечего — три разных ответа.
  const nothing = toApply.length === 0
    ? rows.length === 0
      ? kitT(lang, 'kit.diff.none.empty')
      : changes.length === 0
        ? kitT(lang, 'kit.diff.none.same')
        : kitT(lang, 'kit.diff.none.unverified', { n: changes.length })
    : null;

  return (
    <section className="sk-diff" aria-label={label ?? kitT(lang, 'kit.diff.label')}>
      {label && <h3 className="sk-diff__head">{label}</h3>}

      {rows.length > 0 && (
        <ul className="sk-diff__list">
          {rows.map(r => {
            const reason = r.check.state === 'checked' ? null : (r.check.reason ?? null);
            return (
              <li
                key={r.id}
                className="sk-diff__row"
                data-testid={`kit-diff-row-${r.id}`}
                data-kind={r.kind}
                data-check={r.check.state}
              >
                <span className="sk-diff__sign" aria-hidden="true">
                  {r.kind === 'add' ? '+' : r.kind === 'remove' ? '−' : '='}
                </span>
                <span className="sk-diff__kind">{kitT(lang, `kit.diff.kind.${r.kind}` as 'kit.diff.kind.add')}</span>
                <span className="sk-diff__text">{r.text}</span>
                {r.detail && <span className="sk-diff__detail">{r.detail}</span>}
                {r.check.state !== 'checked' && (
                  <span className="sk-diff__check" data-testid={`kit-diff-check-${r.id}`}>
                    {/* Слова «неизвестно» — из общего словаря kit
                        (unknownOutcome.ts): те же, что у ячейки матрицы и у
                        цепочки причин. Второго словаря у kit нет. */}
                    {unknownWord(lang, r.check.state)}
                    {reason && <span className="sk-diff__reason">{reason}</span>}
                  </span>
                )}
                {r.kind !== 'same' && r.check.state !== 'checked' && (
                  <span className="sk-diff__skip" data-testid={`kit-diff-skip-${r.id}`}>
                    {kitT(lang, 'kit.diff.skip')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Режим чтения: обработчика применения нет — значит нет ни кнопки, ни
          фраз о применении. Они про действие, которого здесь не бывает, а
          кнопка-обманка читается как «изменения ещё не применены». */}
      {!onApply ? null : nothing
        ? <p className="sk-diff__nothing" data-testid="kit-diff-nothing">{nothing}</p>
        : (
          <button
            type="button"
            className="sk-diff__apply"
            data-testid="kit-diff-apply"
            aria-disabled={busy ? true : undefined}
            onClick={() => { if (!busy) onApply?.(toApply); }}
          >
            {kitPlural(lang, 'kit.diff.apply', toApply.length)}
          </button>
        )}
    </section>
  );
}
