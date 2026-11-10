// Быстрые A− / A+ над существующей осью размера текста
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-16).
//
// Повод — владелица 10.11.2026: «очень крупно» на телефоне. Механизм у нас уже
// был: ступени sm/md/lg/xl (`data-text-size`, шкалы в seidr.css) и личная
// настройка `text_size`; ступень xl добавлена 09.11 по её же просьбе про
// 4К-монитор, и та же настройка приезжает на телефон.
//
// Не хватало не механизма, а быстрого доступа: чтобы сменить ступень, надо
// было уходить в настройки. Это — он.
//
// Второй оси размера здесь НЕТ и быть не должно: числа кеглей живут только в
// теме, компонент ходит по TEXT_SIZES и ничего не знает о пикселях. Хранение
// выбора — дело приложения (K-14): наружу уходит «человек выбрал эту ступень».
import { useKitLang, kitT } from '../i18n';
import { TEXT_SIZES, DEFAULT_DISPLAY, type TextSize } from '../tokens/prefs';

/**
 * Соседняя ступень оси; с краю остаётся край.
 *
 * Значение не с оси (пришло из чужих настроек, пустое) — это «выбора не
 * было», поэтому шагаем от умолчания, а не от самой мелкой ступени.
 */
export function stepTextSize(value: TextSize, dir: 1 | -1): TextSize {
  const i0 = TEXT_SIZES.indexOf(value);
  const i = i0 >= 0 ? i0 : TEXT_SIZES.indexOf(DEFAULT_DISPLAY.textSize);
  const next = i + dir;
  if (next < 0 || next >= TEXT_SIZES.length) return TEXT_SIZES[i];
  return TEXT_SIZES[next];
}

export interface TextSizeQuickProps {
  /** Нынешняя ступень; значение не с оси считается «выбора не было». */
  value: TextSize;
  /** Человек выбрал другую ступень. Сохранение — на стороне приложения. */
  onChange: (value: TextSize) => void;
  className?: string;
}

export function TextSizeQuick({ value, onChange, className }: TextSizeQuickProps) {
  const lang = useKitLang();
  const t = (k: Parameters<typeof kitT>[1]) => kitT(lang, k);
  const i = TEXT_SIZES.indexOf(value);
  const at = i >= 0 ? i : TEXT_SIZES.indexOf(DEFAULT_DISPLAY.textSize);
  return (
    <div
      className={['sk-tscale', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={t('kit.scale.label')}
      data-testid="kit-text-size"
      data-value={TEXT_SIZES[at]}
    >
      <button
        type="button"
        className="sk-tscale__btn"
        onClick={() => onChange(stepTextSize(TEXT_SIZES[at], -1))}
        // На краю оси кнопка выключена, а не «нажимается без последствий»:
        // нажатие в никуда человек читает как поломку.
        disabled={at === 0}
        aria-label={t('kit.scale.smaller')}
      >
        A−
      </button>
      {/* Ступень названа словом оси, а не числом: числа кеглей живут в теме. */}
      <span className="sk-tscale__now" aria-live="polite">{TEXT_SIZES[at].toUpperCase()}</span>
      <button
        type="button"
        className="sk-tscale__btn"
        onClick={() => onChange(stepTextSize(TEXT_SIZES[at], 1))}
        disabled={at === TEXT_SIZES.length - 1}
        aria-label={t('kit.scale.bigger')}
      >
        A+
      </button>
    </div>
  );
}
