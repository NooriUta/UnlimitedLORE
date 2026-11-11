// Фильтр по дате в полосе списка (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DATE-RANGE):
// кнопка поля с итогом словами и панель — быстрые периоды, «с … по …»
// нативным вводом даты (на телефоне — системный выбор дня, без узкого
// календаря-попапа) и зона местное / UTC.
//
// Вид — тот же, что у фасета (sk-facet): фильтр по дате стоит в одном ряду с
// прочими и ведёт себя так же — Escape закрывает панель и возвращает фокус.
// Чем поле является и куда уходит значение, решает приложение (K-14): сюда
// приходят подпись, значение, «сейчас» источника и откуда отобрано.
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { kitT } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import {
  DATE_PRESETS, describeDateRange, isDateRangeActive, resolveDateRange,
  type DatePreset, type DateRangeValue, type DateZone,
} from './dateRange';

/** Откуда отобраны строки: `source` — источник принял диапазон, `loaded` — фильтр по загруженному. */
export type DateFilterScope = 'source' | 'loaded';

export interface DateRangeFilterProps {
  /** Подпись поля — называет приложение («Изменены»). */
  title: string;
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  /** «Сейчас» ИСТОЧНИКА (ISO): от него считаются быстрые периоды, а не от часов браузера. */
  now: string;
  /** Пояс для «местного» дня (IANA); по умолчанию — пояс браузера. */
  timeZone: string;
  lang: KitLang;
  scope?: DateFilterScope;
  /** Сколько записей без отметки времени не вошло (только при фильтре по загруженному). */
  undated?: number;
  /** Фильтр недоступен — причина словами (источник не отдаёт время для типа). */
  unavailable?: string;
}

export function DateRangeFilter({
  title, value, onChange, now, timeZone, lang, scope = 'loaded', undated = 0, unavailable,
}: DateRangeFilterProps) {
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const active = isDateRangeActive(value);
  const resolved = resolveDateRange(value, now, timeZone);
  const custom = active && !value.preset;

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
    }
  };
  const setPreset = (p: DatePreset) => onChange({ from: null, to: null, preset: p, zone: value.zone });
  // «Свой» начинается с границ текущего периода: человек правит их, а не вводит с нуля.
  const setCustom = () => onChange({ from: resolved.from, to: resolved.to, zone: value.zone });
  const setBound = (which: 'from' | 'to', day: string) => {
    const next = { from: resolved.from, to: resolved.to, zone: value.zone, [which]: day === '' ? null : day };
    // Перевёрнутые границы не становятся «0 записей»: вторая граница едет за первой.
    if (next.from && next.to && next.from > next.to) {
      if (which === 'from') next.to = next.from; else next.from = next.to;
    }
    onChange(next);
  };
  const setZone = (zone: DateZone) => onChange({ ...value, zone });
  const clear = () => onChange({ from: null, to: null, zone: value.zone });

  if (unavailable !== undefined) {
    return (
      <div className="sk-facet sk-daterange" data-testid="kit-daterange">
        <button type="button" className="sk-facet__btn" disabled aria-disabled="true"
          title={t('kit.date.unavailable', { reason: unavailable })}>
          <span className="sk-list__label">{title}</span>
          <span className="sk-facet__sum">{t('kit.date.unavailableShort')}</span>
        </button>
      </div>
    );
  }

  const summary = active ? describeDateRange(value, lang, { showZone: true }) : t('kit.date.any');

  return (
    <div className={`sk-facet sk-daterange${open ? ' is-open' : ''}`} onKeyDown={onKey} data-testid="kit-daterange">
      <button
        ref={trigger}
        type="button"
        className={`sk-facet__btn${active ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        <span className="sk-list__label">{title}</span>
        <span className="sk-facet__sum">{summary}</span>
        <span className="sk-facet__chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div id={panelId} className="sk-facet__panel" role="group" aria-label={t('kit.date.panel', { field: title })} hidden={!open}>
        {open && (
          <>
            <div role="radiogroup" aria-label={t('kit.date.period')} className="sk-facet__ops sk-daterange__presets">
              {DATE_PRESETS.map(p => (
                <button key={p} type="button" role="radio" aria-checked={value.preset === p}
                  className={`sk-facet__op${value.preset === p ? ' is-on' : ''}`} onClick={() => setPreset(p)}>
                  {t(`kit.date.btn.${p}` as KitKey)}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={custom}
                className={`sk-facet__op${custom ? ' is-on' : ''}`} onClick={setCustom}>
                {t('kit.date.btn.custom')}
              </button>
            </div>
            <div className="sk-daterange__bounds">
              <label className="sk-daterange__bound">
                <span>{t('kit.date.from')}</span>
                <input type="date" className="sk-daterange__input" value={resolved.from ?? ''}
                  max={resolved.to ?? undefined} onChange={e => setBound('from', e.target.value)} />
              </label>
              <label className="sk-daterange__bound">
                <span>{t('kit.date.to')}</span>
                <input type="date" className="sk-daterange__input" value={resolved.to ?? ''}
                  min={resolved.from ?? undefined} onChange={e => setBound('to', e.target.value)} />
              </label>
            </div>
            <div role="radiogroup" aria-label={t('kit.date.zone')} className="sk-facet__ops">
              {(['local', 'utc'] as const).map(z => (
                <button key={z} type="button" role="radio" aria-checked={value.zone === z}
                  className={`sk-facet__op${value.zone === z ? ' is-on' : ''}`} onClick={() => setZone(z)}>
                  {t(`kit.date.zone.${z}` as KitKey)}
                </button>
              ))}
            </div>
            {/* Откуда отобрано и что не вошло — словами (S9-01): иначе выдача
                по загруженной странице читается как выдача по всем записям. */}
            <p className="sk-facet__note" data-testid="kit-daterange-note">
              {t(scope === 'source' ? 'kit.date.scope.source' : 'kit.date.scope.loaded')}
              {scope === 'loaded' && active && undated > 0 ? ` ${t('kit.date.undated', { n: undated })}` : ''}
            </p>
            <div className="sk-facet__foot">
              {active && <button type="button" className="sk-btn" onClick={clear}>{t('kit.date.clear')}</button>}
              <button type="button" className="sk-btn" onClick={close}>{t('kit.list.facetDone')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
