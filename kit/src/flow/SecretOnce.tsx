// Значение, которое показывают ОДИН РАЗ (SPRINT_UXR_S10_SEIDR_KIT_2/K2-SECRET-ONCE).
//
// Элемент kit, а не код экрана, по одной причине: ошибиться здесь можно тихо.
// Достаточно один раз положить значение в состояние, которое уедет в
// хранилище, в адрес, в журнал или в текст ошибки — и утечка не проявится ни
// на одном экране. Поэтому правильно это делается один раз, с тестами, которые
// проверяют именно отсутствие утечки (`SecretOnce.test.tsx`, в том числе греп
// по исходнику: ни localStorage, ни location, ни console здесь не упоминаются).
//
// Три решения:
//
//  1. **Предупреждение ДО показа.** Сказать «значение больше не покажут» после
//     того, как человек его увидел и закрыл, — поздно. Поэтому первый вид
//     элемента — предупреждение и кнопка «Показать»; значение до нажатия в
//     разметку не попадает вовсе.
//  2. **Отказ буфера назван, но без значения.** «Скопировано» без проверки —
//     обман: буфер недоступен без https и запрещается политикой. При этом
//     текст отказа от браузера может содержать подставленное значение (так
//     бывает у самодельных обёрток), поэтому наружу идёт НАША строка, а не
//     message ошибки.
//  3. **Второй показ невозможен, и это сказано.** Элемент помнит, что значение
//     израсходовано, и предлагает выпустить новое. Новое значение (другая
//     строка в `value`) снова показывается — «нельзя» относится к старому.
//
// Границу K-14 элемент держит: что это за значение, знает приложение (`label`).
import { useEffect, useRef, useState } from 'react';
import { kitT, type KitLang } from '../i18n';

/** Куда писать: ровно `navigator.clipboard`, но подменяемый в тестах и средах без него. */
export interface SecretClipboard { writeText(text: string): Promise<void> }

export interface SecretOnceProps {
  /** Значение. `null` — значения нет (и это говорится словами, а не пустотой). */
  value: string | null;
  /** Что это за значение — знает приложение. */
  label: string;
  /** Показ закрыт: приложению пора забыть значение у себя. */
  onClose?: () => void;
  /** Буфер; `null` — буфера нет, и отказ копирования будет назван. */
  clipboard?: SecretClipboard | null;
  lang?: KitLang;
}

function defaultClipboard(): SecretClipboard | null {
  return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
}

type Phase = 'warned' | 'shown' | 'spent';

export function SecretOnce({ value, label, onClose, clipboard, lang = 'ru' }: SecretOnceProps) {
  const [phase, setPhase] = useState<Phase>('warned');
  const [copied, setCopied] = useState(false);
  const [copyFail, setCopyFail] = useState<string | null>(null);
  // Новое значение — новый показ: «показать нельзя» относится к прошлому.
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value;
      setPhase('warned');
      setCopied(false);
      setCopyFail(null);
    }
  }, [value]);

  const buffer = clipboard === undefined ? defaultClipboard() : clipboard;

  if (!value) {
    return (
      <div className="sk-secret" data-phase="none">
        <span className="sk-secret__label">{label}</span>
        <p className="sk-secret__none" data-testid="kit-secret-none">{kitT(lang, 'kit.secret.none')}</p>
      </div>
    );
  }

  return (
    <div className="sk-secret" data-phase={phase}>
      <span className="sk-secret__label">{label}</span>

      {phase === 'warned' && (
        <>
          <p className="sk-secret__warn" data-testid="kit-secret-warn">{kitT(lang, 'kit.secret.warn')}</p>
          <button
            type="button"
            className="sk-secret__btn"
            data-testid="kit-secret-reveal"
            onClick={() => setPhase('shown')}
          >
            {kitT(lang, 'kit.secret.reveal')}
          </button>
        </>
      )}

      {phase === 'shown' && (
        <>
          <code className="sk-secret__value" data-testid="kit-secret-value">{value}</code>
          <div className="sk-secret__row">
            <button
              type="button"
              className="sk-secret__btn"
              data-testid="kit-secret-copy"
              onClick={() => {
                setCopied(false);
                setCopyFail(null);
                if (!buffer) { setCopyFail(kitT(lang, 'kit.secret.copyNoBuffer')); return; }
                // Своя строка, а не message ошибки: в сообщении браузера или
                // обёртки может оказаться само значение.
                buffer.writeText(value).then(
                  () => setCopied(true),
                  () => setCopyFail(kitT(lang, 'kit.secret.copyFailed')),
                );
              }}
            >
              {kitT(lang, 'kit.secret.copy')}
            </button>
            <button
              type="button"
              className="sk-secret__btn"
              data-testid="kit-secret-hide"
              onClick={() => { setPhase('spent'); setCopied(false); setCopyFail(null); onClose?.(); }}
            >
              {kitT(lang, 'kit.secret.hide')}
            </button>
            {copied && <span className="sk-secret__ok" role="status" data-testid="kit-secret-copied">{kitT(lang, 'kit.secret.copied')}</span>}
            {copyFail && <span className="sk-secret__fail" role="alert" data-testid="kit-secret-copyfail">{copyFail}</span>}
          </div>
        </>
      )}

      {phase === 'spent' && (
        <p className="sk-secret__spent" data-testid="kit-secret-spent">{kitT(lang, 'kit.secret.spent')}</p>
      )}
    </div>
  );
}
