// Редактор поля по его виду (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-FIELD-EDITORS).
//
// Реестр «вид → редактор» — форма, поэтому живёт в kit. Что за поля, какие у
// них виды, варианты и права — данные приложения (K-14). Неизвестный вид и
// поле без права правки рисуются ТОЛЬКО ЧТЕНИЕМ с названной причиной: пустое
// поле ввода на месте значения молча съело бы его при сохранении.
import { useId, useState, type ReactNode } from 'react';
import { kitT, useKitLang, type KitKey } from '../i18n';
import {
  fieldKindOf, fromZonedIso, isEmptyValue, isRefValue, refText, isKnownKind, optionLabel, optionValue, parseNumberInput,
  toZonedIso, zoneOffset, type FieldEditorDef, type RefValue,
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
  /**
   * Редактор MD — слотом от приложения (TipTapField из '@seidr/kit/content').
   * Не передан — MD только для чтения: тянуть тяжёлый редактор в основной
   * пакет kit ради поля нельзя, а поле ввода вместо MD-редактора нарушило бы
   * правило «MD-поля — только через TipTapField».
   */
  mdEditor?: (p: { value: string; onChange: (next: string) => void; label: string; id: string }) => ReactNode;
  /**
   * Выбор записи для ref — слотом от приложения (RefSearchList + поиск по
   * def.refTypes). Kit не знает, какие записи бывают и как их искать (K-14).
   * Не передан — ссылка только для чтения.
   */
  refEditor?: (p: { value: RefValue | null; onChange: (next: RefValue | null) => void; label: string; id: string; refTypes?: string[] }) => ReactNode;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function FieldEditor({ def, value, onChange, showRequired, tzOffsetMinutes, mdEditor, refEditor }: FieldEditorProps) {
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
  if (def.editable === false || !isKnownKind(kind) || (kind === 'md' && !mdEditor) || (kind === 'ref' && !refEditor)) {
    return (
      <div className="sk-field sk-field--ro" data-kind={kind}>
        <span className="sk-field__label">{def.label}</span>
        <span className="sk-field__value">{empty ? '—' : isRefValue(value) ? refText(value) : text(value)}</span>
        {!isKnownKind(kind) && <p className="sk-field__note">{t('kit.field.unsupported', { kind })}</p>}
        {kind === 'md' && !mdEditor && def.editable !== false && <p className="sk-field__note">{t('kit.field.mdNoEditor')}</p>}
        {kind === 'ref' && !refEditor && def.editable !== false && <p className="sk-field__note">{t('kit.field.refNoEditor')}</p>}
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
    case 'md':
      control = mdEditor!({ value: text(value), onChange: v => onChange(v), label: def.label, id });
      break;
    case 'ref':
      control = refEditor!({ value: isRefValue(value) ? value : null, onChange: v => onChange(v), label: def.label, id, refTypes: def.refTypes });
      break;
    case 'enum': {
      const opts = def.options ?? [];
      if (def.multi) {
        const cur = Array.isArray(value) ? value.map(String) : [];
        const all = [...opts.map(optionValue), ...cur.filter(v => !opts.some(o => optionValue(o) === v))];
        const toggle = (v: string) => onChange(cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]);
        const move = (i: number, d: -1 | 1) => { const n = [...cur]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
        const labelOfV = (v: string) => {
          const o = opts.find(x => optionValue(x) === v);
          return o ? optionLabel(o) : t('kit.field.notInList', { value: v });
        };
        return (
          <div className="sk-field" data-kind={kind}>
            <span className="sk-field__label" id={`${id}-l`}>{def.label}</span>
            <span className="sk-field__checks" role="group" aria-labelledby={`${id}-l`}>
              {all.map(v => (
                <label key={v} className="sk-field__opt">
                  <input type="checkbox" checked={cur.includes(v)} onChange={() => toggle(v)} />
                  <span>{labelOfV(v)}</span>
                </label>
              ))}
            </span>
            {def.ordered && cur.length > 0 && (
              <ol className="sk-field__order">
                {cur.map((v, i) => (
                  <li key={v} className="sk-field__orderitem">
                    <span>{labelOfV(v)}</span>
                    <button type="button" className="sk-btn" aria-label={t('kit.field.up', { item: labelOfV(v) })} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="sk-btn" aria-label={t('kit.field.down', { item: labelOfV(v) })} disabled={i === cur.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </li>
                ))}
              </ol>
            )}
            {hint}
          </div>
        );
      }
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
