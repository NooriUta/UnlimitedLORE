// «Почему такой вывод»: вердикт и упорядоченная цепочка причин
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-CHAIN-EXPLAIN).
//
// Зачем элемент вообще: на экранах доступа человек видит ИТОГ — «есть»,
// «нельзя», «не проверено» — и не видит, из чего он сложился. Итог без
// цепочки нечем ни проверить, ни оспорить: не видно, какой шаг его дал и
// дошли ли проверки до конца.
//
// **Главное требование и причина, по которой элемент дорогой: у шага НЕ два
// исхода.** «Подтвердил» и «опроверг» — лишь два из пяти. Остальные три это
// разные виды «неизвестно»: не смогли проверить · смотреть не дали · не
// спрашивали. Последнее — НАШ выбор, а не отказ источника, и путать его с
// отказом нельзя: по отказу идут чинить связь, по «не спрашивали» — включать
// источник. Словарь этих трёх взят ОДИН на весь kit (`unknownOutcome.ts`, он
// же у ячейки матрицы): два разных «неизвестно» на одном экране заставили бы
// искать разницу там, где её нет.
//
// **Решающий шаг назван.** Без пометки цепочка читается как список фактов, а
// не как объяснение: не видно, какой именно шаг дал итог. Решающего не
// назвали — так и сказано; назвали шаг, которого в цепочке нет, — сказано и
// это (молча выбрать первый значило бы соврать про объяснение).
//
// **Оборванная цепочка сказана словами.** Проверки часто прекращают на
// середине («дальше не считали, уже решилось»). Незаконченная цепочка,
// выглядящая законченной, врёт о полноте проверки — а по ней раздают доступы.
// Сколько шагов не считали, знает приложение; не сказало — печатаем фразу БЕЗ
// числа, а не с нулём: «не посчитали» и «ноль» — разные утверждения.
//
// **Объяснения не дали — так и сказано**, а не нарисована пустая рамка:
// пустой список шагов читается как «проверок не было», что само является
// утверждением, которого мы не делали.
//
// Границу K-14 элемент держит: что из чего следует — предметное знание.
// Вердикт, шаги, их подписи, исходы и причины приходят ДАННЫМИ от приложения
// (сторож — греп по исходнику в `ChainExplain.test.tsx`).
import { kitPlural, kitT, type KitLang } from '../i18n';
import { unknownWord, type UnknownOutcome } from './unknownOutcome';

/**
 * Исход ОДНОГО шага — честный набор из пяти, а не «да / нет».
 *
 * `detail` у подтвердившего и опровергшего — что именно он нашёл; `reason` у
 * трёх «неизвестно» — почему не знаем. Это разные вещи, и одним полем их
 * называть нельзя: «нашли вот это» и «не смогли посмотреть вот почему»
 * человек читает по-разному.
 */
export type ChainOutcome =
  | { state: 'confirmed'; detail?: string }
  | { state: 'denied'; detail?: string }
  | UnknownOutcome;

export interface ChainStep {
  /** Код шага; им же приложение называет решающий шаг. */
  id: string;
  /** Подпись шага — от приложения. */
  title: string;
  outcome: ChainOutcome;
}

/** Цепочку прекратили раньше конца. */
export interface ChainStop {
  /**
   * Сколько шагов не считали. Не знает приложение — не передаёт, и фраза
   * идёт без числа: ноль здесь означал бы «ничего не пропустили».
   */
  notRun?: number;
  /** Почему остановились — словами от приложения. */
  reason?: string;
}

export interface ChainExplainProps {
  /** Итог одной строкой — текст от приложения. */
  verdict: string;
  /** Окраска итога; смысл цвета знает приложение, kit его не выводит. */
  tone?: 'suc' | 'wrn' | 'dng' | 'inf';
  /** Шаги В ТОМ ПОРЯДКЕ, в котором они решали. */
  steps: readonly ChainStep[];
  /** Код шага, давшего итог. */
  decidedBy?: string;
  /** Цепочка оборвана: не передан — цепочка прошла целиком. */
  stopped?: ChainStop;
  /** Подпись блока — от приложения. */
  label?: string;
  lang?: KitLang;
}

export function ChainExplain({ verdict, tone, steps, decidedBy, stopped, label, lang = 'ru' }: ChainExplainProps) {
  const said = verdict.trim();
  const decider = decidedBy ? steps.find(s => s.id === decidedBy) ?? null : null;
  const want = decidedBy?.trim() ? decidedBy.trim() : null;

  /** Слово исхода: три «неизвестно» берутся из общего словаря kit. */
  function word(o: ChainOutcome): string {
    if (o.state === 'confirmed') return kitT(lang, 'kit.chain.outcome.confirmed');
    if (o.state === 'denied') return kitT(lang, 'kit.chain.outcome.denied');
    return unknownWord(lang, o.state);
  }

  /** Подробность или причина — одно из двух, и они не смешиваются. */
  function aside(o: ChainOutcome): string | null {
    const text = o.state === 'confirmed' || o.state === 'denied' ? o.detail : o.reason;
    return text?.trim() ? text.trim() : null;
  }

  const stopText = stopped
    ? typeof stopped.notRun === 'number' && Number.isFinite(stopped.notRun) && stopped.notRun > 0
      ? kitPlural(lang, 'kit.chain.stoppedN', Math.trunc(stopped.notRun))
      : kitT(lang, 'kit.chain.stopped')
    : null;

  return (
    <section className="sk-chain" aria-label={label ?? kitT(lang, 'kit.chain.label')} data-tone={tone}>
      {label && <h3 className="sk-chain__head">{label}</h3>}

      {said
        ? (
          <p className="sk-chain__verdict" data-testid="kit-chain-verdict" data-tone={tone}>
            {said}
          </p>
        )
        : (
          <p className="sk-chain__note" data-testid="kit-chain-noverdict">
            {kitT(lang, 'kit.chain.noVerdict')}
          </p>
        )}

      {/* Цепочки нет — говорим это словами. Пустой список читался бы как
          «проверок не было», а такого мы не утверждали. */}
      {steps.length === 0
        ? (
          <p className="sk-chain__none" data-testid="kit-chain-none">
            {kitT(lang, 'kit.chain.none')}
          </p>
        )
        : (
          <ol className="sk-chain__steps" data-testid="kit-chain-steps">
            {steps.map((s, i) => {
              const extra = aside(s.outcome);
              const isDecider = decider !== null && s.id === decider.id;
              return (
                <li
                  key={s.id}
                  className="sk-chain__step"
                  data-testid={`kit-chain-step-${s.id}`}
                  data-state={s.outcome.state}
                  data-decider={isDecider ? 'true' : undefined}
                >
                  <span className="sk-chain__num" data-testid={`kit-chain-num-${s.id}`}>{i + 1}</span>
                  <span className="sk-chain__title">{s.title}</span>
                  <span className="sk-chain__outcome" data-testid={`kit-chain-outcome-${s.id}`}>
                    {word(s.outcome)}
                  </span>
                  {extra && <span className="sk-chain__aside">{extra}</span>}
                  {isDecider && (
                    <span className="sk-chain__decider" data-testid={`kit-chain-decider-${s.id}`}>
                      {kitT(lang, 'kit.chain.decider')}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}

      {/* Решающего не назвали — цепочка читается как список фактов, и об этом
          надо сказать. Назвали отсутствующий — сказать тем более: иначе
          пометки просто нет, и выглядит это как «не назвали». */}
      {steps.length > 0 && want === null && (
        <p className="sk-chain__note" data-testid="kit-chain-nodecider">
          {kitT(lang, 'kit.chain.noDecider')}
        </p>
      )}
      {steps.length > 0 && want !== null && decider === null && (
        <p className="sk-chain__note sk-chain__note--wrn" data-testid="kit-chain-decider-missing">
          {kitT(lang, 'kit.chain.deciderMissing', { id: want })}
        </p>
      )}

      {stopText && (
        <p className="sk-chain__note sk-chain__note--wrn" data-testid="kit-chain-stopped">
          {stopText}
          {stopped?.reason?.trim() && <span className="sk-chain__aside">{stopped.reason.trim()}</span>}
        </p>
      )}
    </section>
  );
}
