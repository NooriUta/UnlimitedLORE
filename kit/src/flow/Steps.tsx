// Шаги мастера (SPRINT_UXR_S10_SEIDR_KIT_2/K2-STEPS).
//
// Один элемент на все мастера приложения. Повод: мастеров в прототипе админки
// четыре, и четыре экрана написали бы четыре разные полосы шагов — так у нас
// уже вышло пять разных способов потянуть границу между блоками (S4-30).
//
// **Шаги — не вкладки.** У вкладок порядок не значит ничего и перейти можно в
// любую; у шагов есть порядок, условие перехода и накопленное введённое.
// Поэтому `Tabs` здесь не подходит, хотя внешне похож.
//
// Три решения, которые стоит прочитать прежде, чем менять:
//
//  1. **Все шаги остаются в дереве, неактивные скрыты `hidden`.** Рисовать
//     только активный проще, но тогда возврат назад теряет набранное в
//     НЕуправляемом поле — а это ровно то, чего задача требует не допускать
//     (п. 3). Скрытый `hidden`-блок не читается вслух и не ловит табуляцию, то
//     есть ведёт себя как отсутствующий, но DOM-состояние полей держит.
//     Цена — содержимое всех шагов рисуется сразу; для мастера на 3–5 шагов
//     это дешевле, чем заставлять каждое приложение поднимать своё состояние.
//
//  2. **«Вперёд нельзя» всегда называет причину.** Серая кнопка молча — это
//     отказ без объяснения; человек жмёт и не понимает, чего от него хотят.
//     Причину даёт приложение (`blocked`), элемент печатает её рядом и
//     связывает с кнопкой через `aria-describedby` — иначе читающему вслух
//     причина не достанется вовсе.
//
//  3. **Незнакомый шаг в адресе — открыт первый, и это сказано.** Молча
//     подменить шаг значит соврать про ссылку, по которой пришли.
//
// Границу K-14 элемент держит: он не знает ни про людей, ни про проекты, ни
// про роли. Шаги, их подписи и условия задаёт приложение (сторож —
// `Steps.test.tsx`, греп по исходнику).
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { kitT, type KitLang } from '../i18n';
import { useUrlParam } from '../resilience/useUrlParam';

export interface StepDef {
  /** Ключ шага; он же значение параметра адреса. */
  key: string;
  /** Подпись в полосе шагов. */
  title: string;
  /**
   * Почему вперёд нельзя. Пусто — можно.
   *
   * Это ТЕКСТ, а не флаг: элемент обязан напечатать причину, и флаг `false`
   * заставил бы его выдумывать её за приложение.
   */
  blocked?: string | null;
  /** Содержимое шага. */
  render: () => ReactNode;
}

/** Пункт «осталось руками»: чего система сделать не может. */
export interface StepsManualItem {
  text: string;
  /** Куда идти, если это другая система. */
  href?: string;
  /** Короткое пояснение: почему руками. */
  hint?: string;
}

export interface StepsProps {
  steps: readonly StepDef[];
  /**
   * Имя параметра адреса; `null` — состояние только в памяти.
   *
   * Своё имя нужно, когда на экране два мастера: общий `step` они толкали бы
   * друг у друга.
   */
  urlKey?: string | null;
  /** Последний шаг: чего система сделать НЕ может. Пустой список — блока нет. */
  manual?: { title: string; items: readonly StepsManualItem[] };
  lang?: KitLang;
  /** Нажато «Готово» на последнем шаге. */
  onDone?: () => void;
  /** Отметка для стилей приложения и для тестов. */
  flow?: string;
}

export function Steps({ steps, urlKey = 'step', manual, lang = 'ru', onDone, flow }: StepsProps) {
  const [urlValue, setUrlValue] = useUrlParam(urlKey ?? '__kit_steps_unused');
  const [memory, setMemory] = useState<string | null>(null);
  const wanted = urlKey === null ? memory : urlValue;

  const index = useMemo(() => {
    if (!steps.length) return -1;
    const i = steps.findIndex(s => s.key === wanted);
    return i >= 0 ? i : 0;
  }, [steps, wanted]);

  // «Шага нет» и «шаг не называли» — разные случаи: про первый говорим, про
  // второй молчим (так открывается мастер с чистого адреса).
  const unknown = wanted && index === 0 && steps.length > 0 && steps[0].key !== wanted ? wanted : null;

  const go = useCallback((key: string) => {
    if (urlKey === null) setMemory(key);
    else setUrlValue(key);
  }, [urlKey, setUrlValue]);

  if (!steps.length) {
    return (
      <div className="sk-steps" data-flow={flow}>
        <p className="sk-steps__empty" data-testid="kit-steps-empty">{kitT(lang, 'kit.steps.empty')}</p>
      </div>
    );
  }

  const current = steps[index];
  const last = index === steps.length - 1;
  const blocked = current.blocked?.trim() ? current.blocked.trim() : null;
  const blockedId = blocked ? 'kit-steps-blocked-reason' : undefined;
  const manualItems = last ? (manual?.items ?? []) : [];

  return (
    <div className="sk-steps" data-flow={flow}>
      <ol className="sk-steps__bar" aria-label={kitT(lang, 'kit.steps.bar')}>
        {steps.map((s, i) => {
          const done = i < index;
          const here = i === index;
          // Вперёд полосой не ходят: вперёд ведёт только кнопка с проверкой
          // условия, иначе шаг можно было бы перескочить мимо условия.
          const reachable = done || here;
          return (
            <li key={s.key} className="sk-steps__item">
              <button
                type="button"
                className={['sk-steps__step', here ? 'is-here' : '', done ? 'is-done' : ''].filter(Boolean).join(' ')}
                aria-current={here ? 'step' : undefined}
                aria-disabled={reachable ? undefined : true}
                onClick={() => { if (reachable && !here) go(s.key); }}
              >
                <span className="sk-steps__num">{i + 1}</span>
                <span className="sk-steps__title">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="sk-steps__progress" data-testid="kit-steps-progress">
        {kitT(lang, 'kit.steps.progress', { n: index + 1, total: steps.length })}
      </p>

      {unknown && (
        <p className="sk-steps__note" role="status" data-testid="kit-steps-unknown">
          {kitT(lang, 'kit.steps.unknown', { key: unknown })}
        </p>
      )}

      {steps.map((s, i) => (
        <div
          key={s.key}
          className="sk-steps__panel"
          data-testid={`kit-steps-panel-${s.key}`}
          hidden={i !== index}
        >
          {s.render()}
        </div>
      ))}

      {manualItems.length > 0 && (
        <section className="sk-steps__manual" data-testid="kit-steps-manual" aria-label={manual!.title}>
          <h3 className="sk-steps__manual-head">{manual!.title}</h3>
          <ul className="sk-steps__manual-list">
            {manualItems.map(m => (
              <li key={m.text} className="sk-steps__manual-item">
                {m.href
                  ? <a className="sk-steps__manual-link" href={m.href} target="_blank" rel="noreferrer">{m.text}</a>
                  : <span className="sk-steps__manual-text">{m.text}</span>}
                {m.hint && <span className="sk-steps__manual-hint">{m.hint}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="sk-steps__nav">
        {index > 0 && (
          <button
            type="button"
            className="sk-steps__btn"
            data-testid="kit-steps-back"
            onClick={() => go(steps[index - 1].key)}
          >
            {kitT(lang, 'kit.steps.back')}
          </button>
        )}
        {last
          ? (
            <button
              type="button"
              className="sk-steps__btn is-primary"
              data-testid="kit-steps-done"
              aria-disabled={blocked ? true : undefined}
              aria-describedby={blockedId}
              onClick={() => { if (!blocked) onDone?.(); }}
            >
              {kitT(lang, 'kit.steps.done')}
            </button>
          )
          : (
            <button
              type="button"
              className="sk-steps__btn is-primary"
              data-testid="kit-steps-next"
              aria-disabled={blocked ? true : undefined}
              aria-describedby={blockedId}
              onClick={() => { if (!blocked) go(steps[index + 1].key); }}
            >
              {kitT(lang, 'kit.steps.next')}
            </button>
          )}
        {blocked && (
          <span className="sk-steps__blocked" id={blockedId} role="status" data-testid="kit-steps-blocked">
            {blocked}
          </span>
        )}
      </div>
    </div>
  );
}
