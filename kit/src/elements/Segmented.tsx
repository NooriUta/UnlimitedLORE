// Segmented и SettingRow (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02): выбор одного
// значения из нескольких — ряд кнопок-сегментов с aria-pressed (как seg в
// прототипе v4), и строка настройки «подпись + подсказка + управление».
// Цель касания — не меньше --tap (44px на сенсоре), видимый фокус.

import type { ReactNode } from 'react';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedProps<V extends string> {
  /** Имя группы (aria-label) — обязательно: без него сегменты непонятно о чём. */
  label: string;
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange: (value: V) => void;
  /** Все сегменты недоступны (например, идёт сохранение). */
  disabled?: boolean;
}

export function Segmented<V extends string>({ label, value, options, onChange, disabled }: SegmentedProps<V>) {
  return (
    <div className="sk-seg" role="group" aria-label={label}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={['sk-seg__btn', on ? 'is-on' : ''].filter(Boolean).join(' ')}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => { if (!on) onChange(o.value); }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface SettingRowProps {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Отметка строки для тестов и стилей приложения (data-setting). */
  setting?: string;
}

export function SettingRow({ label, hint, children, setting }: SettingRowProps) {
  return (
    <div className="sk-setting" data-setting={setting}>
      <div className="sk-setting__text">
        <span className="sk-setting__label">{label}</span>
        {hint && <span className="sk-setting__hint">{hint}</span>}
      </div>
      <div className="sk-setting__ctl">{children}</div>
    </div>
  );
}
