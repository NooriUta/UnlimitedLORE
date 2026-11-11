// Редактор поля по его виду (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-FIELD-EDITORS).
//
// Реестр «вид → редактор» — форма, поэтому живёт в kit. Что за поля, какие у
// них виды, варианты и права — данные приложения (K-14). Неизвестный вид и
// поле без права правки рисуются ТОЛЬКО ЧТЕНИЕМ с названной причиной: пустое
// поле ввода на месте значения молча съело бы его при сохранении.
import { useId, useState } from 'react';
import { kitT, useKitLang, type KitKey } from '../i18n';
import {
  fieldKindOf, fromZonedIso, isEmptyValue, isKnownKind, optionLabel, optionValue, parseNumberInput,
  toZonedIso, zoneOffset, type FieldEditorDef,
} from './fieldKinds';

export interface FieldEditorProps {
  def: FieldEditorDef;
  value: unknown;
  /** Новое значение. Не задано — null, а не пустая строка или 0. */
  onChange: (next: unknown) => void;
  /** Показывать ли пометку пустого обязательного — решает форма (например после «Сохранить»). */
  showRequired?: boolean;
  /** Смещение зоны для даты-времени, минуты к востоку от UTC. По умолчанию — зона браузера. */
  tzOffsetMinutes?: number;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function FieldEditor({ def, value, onChange, showRequired, tzOffsetMinutes }: FieldEditorProps) {
  const lang = useKitLang();
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const id = useId();
  const hintId = `${id}-hint`;
  const kind = fieldKindOf(def);
  const [numText, setNumText] = useState(() => text(value));
  const [numBad, setNumBad] = useState(false);

  const empty = isEmptyValue(value);
  const req = showRequired && empty ? def.required : undefined;
  const invalid = req === 'block' || numBad;
  const label = (
    <label className="sk-field__label" htmlFor={id}>
      {def.label}{def.required === 'block' && <span className="sk-field__req" aria-hidden="true"> *</span>}
    </label>
  );
  const hint = numBad
    ? <p id={hintId} className="sk-field__err" role="alert">{t('kit.field.notNumber')}</p>
    : req === 'block' ? <p id={hintId} className="sk-field__err">{t('kit.field.required')}</p>
    : req === 'warn' ? <p id={hintId} className="sk-field__warn">{t('kit.field.warn')}</p>
    : null;
  const aria = {
    id,
    'aria-invalid': invalid ? true : undefined,
    'aria-required': def.required === 'block' ? true : undefined,
    'aria-describedby': hint ? hintId : undefined,
  } as const;

  // Только чтение: право не дано или вида kit не знает. Значение видно как есть.
  if (def.editable === false || !isKnownKind(kind)) {
    return (
      <div className="sk-field sk-field--ro" data-kind={kind}>
        <span className="sk-field__label">{def.label}</span>
        <span className="sk-field__value">{empty ? '—' : text(value)}</span>
        {!isKnownKind(kind) && <p className="sk-field__note">{t('kit.field.unsupported', { kind })}</p>}
      </div>
    );
  }

  let control;
  switch (kind) {
    case 'text':
      control = <input {...aria} className="sk-field__input" type="text" value={text(value)} onChange={e => onChange(e.target.value)} />;
      break;
    case 'number':
      control = (
        <input {...aria} className="sk-field__input sk-field__input--num" type="text" inputMode="decimal" value={numText}
          onChange={e => {
            setNumText(e.target.value);
            const r = parseNumberInput(e.target.value);
            setNumBad(!r.ok);
            if (r.ok) onChange(r.value);
          }} />
      );
      break;
    case 'date':
      control = <input {...aria} className="sk-field__input" type="date" value={text(value)} onChange={e => onChange(e.target.value || null)} />;
      break;
    case 'time':
      control = <input {...aria} className="sk-field__input" type="time" value={text(value)} onChange={e => onChange(e.target.value || null)} />;
      break;
    case 'datetime': {
      const off = tzOffsetMinutes ?? -new Date().getTimezoneOffset();
      control = (
        <span className="sk-field__row">
          <input {...aria} className="sk-field__input" type="datetime-local" value={fromZonedIso(value)}
            onChange={e => onChange(toZonedIso(e.target.value, off))} />
          <span className="sk-field__zone">UTC{zoneOffset(off)}</span>
        </span>
      );
      break;
    }
    case 'enum': {
      const opts = def.options ?? [];
      const cur = text(value);
      const known = opts.some(o => optionValue(o) === cur);
      control = (
        <select {...aria} className="sk-field__input" value={cur} onChange={e => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">{t('kit.field.none')}</option>
          {opts.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
          {/* Значение вне списка не пропадает: его видно и его можно оставить. */}
          {cur !== '' && !known && <option value={cur}>{t('kit.field.notInList', { value: cur })}</option>}
        </select>
      );
      break;
    }
    case 'boolean': {
      const states: { v: boolean | null; key: KitKey }[] = [
        { v: true, key: 'kit.field.yes' }, { v: false, key: 'kit.field.no' }, { v: null, key: 'kit.field.unset' },
      ];
      const curB = value === true ? true : value === false ? false : null;
      return (
        <div className="sk-field" data-kind={kind}>
          <span className="sk-field__label" id={`${id}-l`}>{def.label}</span>
          <span className="sk-field__seg" role="radiogroup" aria-labelledby={`${id}-l`}>
            {states.map(s => (
              <label key={String(s.v)} className="sk-field__opt">
                <input type="radio" name={id} checked={curB === s.v} onChange={() => onChange(s.v)} />
                <span>{t(s.key)}</span>
              </label>
            ))}
          </span>
          {hint}
        </div>
      );
    }
  }

  return (
    <div className="sk-field" data-kind={kind}>
      {label}
      {control}
      {hint}
    </div>
  );
}
