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
// **Смена значения — ОДНА строка, а не две** (запрос сессии приложения
// 10.11.2026). Раньше видов было три, и смену экран изображал парой «снимется
// прежнее» + «добавится новое». Человек читает такую пару как два действия и
// как провал доступа между ними — то есть разметка утверждает то, чего не
// будет. Поэтому у смены свой вид `change` с прежним и новым значением,
// различимыми СЛОВАМИ («было» / «стало») и разметкой, а не только цветом.
//
// **Подтверждение словом** (`confirm`) — для опасной пачки. Что считать
// опасным и каким словом подтверждать, знает приложение: это предметное
// знание, и kit его не выдумывает. Отказ называет причину ТЕКСТОМ — то же
// правило, что у «вперёд нельзя» в `Steps`: серая кнопка молча это отказ без
// объяснения.
//
// Границу K-14 элемент держит: что за изменения — знает приложение, здесь
// только форма (сторож — греп по исходнику в `DiffPreview.test.tsx`).
import { useId, useState } from 'react';
import { kitPlural, kitT, type KitLang } from '../i18n';
import { unknownWord } from './unknownOutcome';

/** Что строка сделает: добавится · снимется · сменится · уже есть. */
export type DiffKind = 'add' | 'remove' | 'same' | 'change';

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

interface DiffRowBase {
  id: string;
  /** Что меняется — строкой от приложения. */
  text: string;
  /** Подробность рядом (серым): значение, уровень, что угодно от приложения. */
  detail?: string;
  check: DiffCheck;
}

/**
 * Строка диффа.
 *
 * Тип РАЗНЫЙ у смены и у остальных видов НАМЕРЕННО: у `change` прежнее и
 * новое значения обязательны. Прежнего значения нет — это не смена, а
 * добавление, и «было (пусто) → стало X» на экране было бы ложью. Тип ловит
 * это у тех, кто зовёт элемент из TypeScript; у данных, пришедших извне,
 * тот же случай ловит сторож внутри (`shape`), и подмена вида не молчит.
 */
export type DiffRow =
  | (DiffRowBase & { kind: 'add' | 'remove' | 'same'; from?: undefined; to?: undefined })
  | (DiffRowBase & { kind: 'change'; from: string; to: string });

/** Подтверждение словом перед применением опасной пачки. */
export interface DiffConfirm {
  /** Слово, которое надо ввести. Выбирает ПРИЛОЖЕНИЕ: это предметное знание. */
  word: string;
  /** Подпись поля («введите имя раздела», «введите СНЯТЬ») — от приложения. */
  label: string;
  /**
   * Регистр не важен.
   *
   * По умолчанию важен: слово выбрало приложение, и молча приравнять иное
   * написание значит ослабить заслон, о котором нас не просили. Нужно иначе —
   * приложение говорит об этом вслух, этим полем.
   */
  ignoreCase?: boolean;
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
  /**
   * Подтвердить применение вводом слова. Не задано — поля нет и поведение
   * прежнее: что опасно, решает приложение, а не элемент.
   */
  confirm?: DiffConfirm;
  lang?: KitLang;
}

/** Применимо: строка что-то меняет И её удалось проверить. */
function applicable(r: DiffRow): boolean {
  return r.kind !== 'same' && r.check.state === 'checked';
}

/**
 * Что строка нарисует на самом деле — и оговорка, если вид пришлось поправить.
 *
 * Смена без прежнего значения — это добавление, без нового — снятие. Поправка
 * НЕ молчаливая: рядом печатается, чего не передали. Молча нарисовать «было
 * (пусто) → стало X» значило бы соврать про предыдущее состояние, а молча
 * подменить вид — соврать про присланные данные.
 *
 * Пусто и там и там — попадает в первое правило (нет «было»): выбор
 * произвольный, но определённый, и оговорка в обоих случаях названа.
 */
function shape(r: DiffRow): { kind: DiffKind; note: 'from' | 'to' | null } {
  if (r.kind !== 'change') return { kind: r.kind, note: null };
  if (!String(r.from ?? '').trim()) return { kind: 'add', note: 'from' };
  if (!String(r.to ?? '').trim()) return { kind: 'remove', note: 'to' };
  return { kind: 'change', note: null };
}

const SIGN: Record<DiffKind, string> = { add: '+', remove: '−', same: '=', change: '→' };

export function DiffPreview({ rows, onApply, busy, label, confirm, lang = 'ru' }: DiffPreviewProps) {
  const uid = useId();
  const [typed, setTyped] = useState('');

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

  const word = (confirm?.word ?? '').trim();
  const said = typed.trim();
  const fits = confirm?.ignoreCase
    ? said.toLocaleLowerCase() === word.toLocaleLowerCase()
    : said === word;

  // Отказ всегда называет ПРИЧИНУ, и причины разные: слова не задали ·
  // ещё не ввели · ввели не то. Одна фраза на три случая скрыла бы, что
  // именно не так.
  const blocked = !confirm
    ? null
    : !word
      ? kitT(lang, 'kit.diff.confirm.noword')
      : fits
        ? null
        : said === ''
          ? kitT(lang, 'kit.diff.confirm.empty')
          : kitT(lang, 'kit.diff.confirm.wrong');

  const blockedId = `${uid}-blocked`;
  const wordId = `${uid}-word`;

  return (
    <section className="sk-diff" aria-label={label ?? kitT(lang, 'kit.diff.label')}>
      {label && <h3 className="sk-diff__head">{label}</h3>}

      {rows.length > 0 && (
        <ul className="sk-diff__list">
          {rows.map(r => {
            const reason = r.check.state === 'checked' ? null : (r.check.reason ?? null);
            const { kind, note } = shape(r);
            // Уцелевшее значение у поправленной смены: «добавится X» без него
            // не сказало бы, что именно добавится.
            const left = r.kind === 'change' && note ? String((note === 'from' ? r.to : r.from) ?? '') : null;
            return (
              <li
                key={r.id}
                className="sk-diff__row"
                data-testid={`kit-diff-row-${r.id}`}
                data-kind={kind}
                data-check={r.check.state}
              >
                <span className="sk-diff__sign" aria-hidden="true">{SIGN[kind]}</span>
                <span className="sk-diff__kind">{kitT(lang, `kit.diff.kind.${kind}` as 'kit.diff.kind.add')}</span>
                <span className="sk-diff__text">{r.text}</span>
                {r.kind === 'change' && kind === 'change' && (
                  <span className="sk-diff__change" data-testid={`kit-diff-change-${r.id}`}>
                    <span className="sk-diff__was">
                      <span className="sk-diff__cap">{kitT(lang, 'kit.diff.change.from')}</span>
                      <span className="sk-diff__val">{r.from}</span>
                    </span>
                    <span className="sk-diff__arrow" aria-hidden="true">→</span>
                    <span className="sk-diff__now">
                      <span className="sk-diff__cap">{kitT(lang, 'kit.diff.change.to')}</span>
                      <span className="sk-diff__val">{r.to}</span>
                    </span>
                  </span>
                )}
                {left && <span className="sk-diff__val">{left}</span>}
                {note && (
                  <span className="sk-diff__note" data-testid={`kit-diff-note-${r.id}`}>
                    {kitT(lang, note === 'from' ? 'kit.diff.change.nofrom' : 'kit.diff.change.noto')}
                  </span>
                )}
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
                {kind !== 'same' && r.check.state !== 'checked' && (
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
          фраз о применении, ни поля подтверждения. Они про действие, которого
          здесь не бывает, а кнопка-обманка читается как «изменения ещё не
          применены».

          Поле подтверждения живёт ВНУТРИ этой ветки, рядом с кнопкой, а не
          отдельным блоком выше. Так «нечего применять» и «нечего
          подтверждать» — одно и то же условие, а не два, которые однажды
          разойдутся: поле, стоящее там, где кнопки нет, подтверждает
          несуществующее действие. */}
      {!onApply ? null : nothing
        ? <p className="sk-diff__nothing" data-testid="kit-diff-nothing">{nothing}</p>
        : (
          <div className="sk-diff__go">
            {confirm && (
              <span className="sk-diff__ask">
                <label className="sk-diff__ask-label" htmlFor={wordId}>{confirm.label}</label>
                <input
                  id={wordId}
                  className="sk-diff__word"
                  data-testid="kit-diff-confirm"
                  type="text"
                  value={typed}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={said !== '' && !fits ? true : undefined}
                  aria-describedby={blocked ? blockedId : undefined}
                  onChange={e => setTyped(e.target.value)}
                />
              </span>
            )}
            <button
              type="button"
              className="sk-diff__apply"
              data-testid="kit-diff-apply"
              aria-disabled={busy || blocked ? true : undefined}
              aria-describedby={blocked ? blockedId : undefined}
              onClick={() => { if (!busy && !blocked) onApply?.(toApply); }}
            >
              {kitPlural(lang, 'kit.diff.apply', toApply.length)}
            </button>
            {blocked && (
              <p className="sk-diff__blocked" id={blockedId} role="status" data-testid="kit-diff-blocked">
                {blocked}
              </p>
            )}
          </div>
        )}
    </section>
  );
}
