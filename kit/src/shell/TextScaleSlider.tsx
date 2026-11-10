// Ползунок размера текста: множитель поверх выбранной ступени (S4-16).
//
// Решение владелицы 10.11.2026, дословно: «не а на мобилке даже покрупнее
// сделайте вообще ползунок с сохранением множителя поставьте в настройках я
// скажу сколько мин макс оставить после выкатки».
//
// Два следствия из её слов, которые видны в коде:
//  • «с сохранением» — значение хранит ПРИЛОЖЕНИЕ (ключ личных настроек).
//    Сюда оно приходит пропом, отсюда уходит событием; kit не знает ни про
//    сервер, ни про имя ключа (K-14);
//  • «я скажу мин макс после выкатки» — границы здесь названы один раз, в
//    одном месте, и меняются одной правкой. Они не вшиты в разметку.
//
// Множитель НЕ заменяет ступени `text_size`: ступень задаёт основу, ползунок —
// подгонку поверх неё. При 1 не меняется ничего.
import { useKitLang, kitT } from '../i18n';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, TEXT_SCALE_STEP, clampTextScale } from '../core/textScale';

export interface TextScaleSliderProps {
  /** Нынешний множитель; значение вне границ прижимается к краю. */
  value: number;
  /** Человек подвинул ползунок. Сохранение — на стороне приложения. */
  onChange: (value: number) => void;
  className?: string;
}

export function TextScaleSlider({ value, onChange, className }: TextScaleSliderProps) {
  const lang = useKitLang();
  const t = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => kitT(lang, k, v);
  const now = clampTextScale(value);
  // Проценты, а не доля: «125» человек читает сразу, «1.25» — нет.
  const percent = Math.round(now * 100);
  return (
    <div className={['sk-tscale', className].filter(Boolean).join(' ')} data-testid="kit-text-scale" data-value={now}>
      <input
        className="sk-tscale__range"
        type="range"
        min={TEXT_SCALE_MIN}
        max={TEXT_SCALE_MAX}
        step={TEXT_SCALE_STEP}
        value={now}
        onChange={e => onChange(clampTextScale(e.currentTarget.value))}
        aria-label={t('kit.scale.label')}
        // Вслух читается процентами, а не долей: «один и двадцать пять сотых»
        // не говорит человеку ничего.
        aria-valuetext={t('kit.scale.now', { percent })}
      />
      <span className="sk-tscale__now" aria-hidden="true">{t('kit.scale.now', { percent })}</span>
    </div>
  );
}
