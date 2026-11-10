// Фасет фильтра listView (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05): кнопка поля с
// кратким итогом и раскрывающаяся панель — условие «есть / нет / пусто / не
// пусто» и значения с иконкой и счётчиком. Счётчики — по выдаче с прочими
// фильтрами (facetOf). Иконка значения не заменяет подпись. Escape закрывает
// панель и возвращает фокус на кнопку. Цели — не меньше --tap.
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { GameIcon } from '../elements/GameIcon';
import { kitT } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import type { Facet, FieldFilter } from './filterModel';
import { FILTER_OPS } from './listModel';
import type { FilterOp } from './listModel';

/** Иконка значения поля: слаг game-icons и цвет токеном. */
export interface ValueIcon { icon: string; color?: string }

/** Иконка значения (декоративная: подпись рядом остаётся). */
export function ValueIconMark({ icon }: { icon: ValueIcon | null | undefined }) {
  if (!icon) return null;
  return (
    <span className="sk-list__vicon" data-icon={icon.icon} aria-hidden="true">
      <GameIcon slug={icon.icon} size={12} color={icon.color} />
    </span>
  );
}

export interface FacetFilterProps {
  title: string;
  filter: FieldFilter;
  facet: Facet;
  valueTitle: (v: string) => string;
  valueIcon: (v: string) => ValueIcon | null | undefined;
  /** Свой порядок значений (статусы — порядком словаря); по умолчанию — по счётчику. */
  compare?: (a: string, b: string) => number;
  onChange: (f: FieldFilter) => void;
  lang: KitLang;
  /**
   * Откуда числа (S9-01): `all` — посчитаны источником по всей выдаче, `page` —
   * по загруженным строкам. Это говорится словами: рядом с «Показано 2 из 400»
   * число по странице читается как число по выдаче, а это другое утверждение.
   */
  countsFrom?: 'all' | 'page';
  /**
   * Счётчики не посчитаны (причина словами, пустая строка — причины не дали).
   * Тогда вместо чисел — «?», тот же приём, что у счётчика вкладки: «не
   * посчитали» обязано быть отличимо от нуля.
   */
  countsUnknown?: string;
  /** У записи бывает несколько значений: Σcount > total — норма, а не сбой счёта. */
  multi?: boolean;
}

/**
 * Счётчик значения: число, а при «не посчитали» — «?» с подсказкой (приём
 * счётчика вкладки, `TabCount`: одно «неизвестно» на весь kit, а не второе).
 */
function FacetCount({ n, from, unknown, lang }: { n: number; from: 'all' | 'page'; unknown?: string; lang: KitLang }) {
  if (unknown !== undefined) {
    const why = unknown ? kitT(lang, 'kit.list.count.unknownWhy', { reason: unknown }) : kitT(lang, 'kit.list.count.unknown');
    return <span className="sk-facet__n" data-unknown="" title={why}>?</span>;
  }
  return (
    <span className="sk-facet__n" data-src={from} title={kitT(lang, from === 'all' ? 'kit.list.count.all' : 'kit.list.count.page')}>
      {n}
    </span>
  );
}

/** Порог «их стало много»: с этого числа значений появляется поиск. Тот же
 *  порог у поиска по группам списка (S9-02) — одно число на один смысл. */
export const FIND_FROM = 10;

export function FacetFilter({
  title, filter, facet, valueTitle, valueIcon, compare, onChange, lang,
  countsFrom = 'page', countsUnknown, multi,
}: FacetFilterProps) {
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const opTitle = (op: FilterOp) => t(`kit.list.op.${op}` as KitKey);
  const counts = new Map(facet.values.map(v => [v.value, v.count]));
  // отмеченное значение видно и с нулём — его надо уметь снять
  for (const v of filter.values) if (v !== '' && !counts.has(v)) counts.set(v, 0);
  let values = [...counts].map(([value, count]) => ({ value, count }));
  if (compare) values.sort((a, b) => compare(a.value, b.value));
  else values.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru', { numeric: true }));
  const needle = find.trim().toLocaleLowerCase();
  if (needle) values = values.filter(v => `${v.value} ${valueTitle(v.value)}`.toLocaleLowerCase().includes(needle));

  const active = filter.op === 'empty' || filter.op === 'nonempty' || filter.values.length > 0;
  let summary: string;
  if (filter.op === 'empty' || filter.op === 'nonempty') summary = opTitle(filter.op);
  else if (!filter.values.length) summary = t('kit.list.facetAll');
  else {
    const first = valueTitle(filter.values[0]);
    const v = filter.values.length > 1 ? t('kit.list.facetMany', { first, n: filter.values.length - 1 }) : first;
    summary = filter.op === 'not' ? `${opTitle('not')} ${v}` : v;
  }

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
  const toggleValue = (v: string) => {
    const has = filter.values.includes(v);
    onChange({ op: filter.op, values: has ? filter.values.filter(x => x !== v) : [...filter.values, v] });
  };
  const opCount = (op: FilterOp): number | null => (op === 'empty' ? facet.empty : op === 'nonempty' ? facet.nonempty : null);
  const pickValues = filter.op === 'any' || filter.op === 'not';

  return (
    <div className={`sk-facet${open ? ' is-open' : ''}`} onKeyDown={onKey}>
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
      <div
        id={panelId}
        className="sk-facet__panel"
        role="group"
        aria-label={t('kit.list.facetPanel', { field: title })}
        hidden={!open}
      >
        {open && (
          <>
            <div role="radiogroup" aria-label={t('kit.list.op')} className="sk-facet__ops">
              {FILTER_OPS.map(op => {
                const n = opCount(op);
                return (
                  <button
                    key={op}
                    type="button"
                    role="radio"
                    aria-checked={filter.op === op}
                    className={`sk-facet__op${filter.op === op ? ' is-on' : ''}`}
                    onClick={() => onChange({ op, values: filter.values })}
                  >
                    {opTitle(op)}{n !== null && <> <FacetCount n={n} from={countsFrom} unknown={countsUnknown} lang={lang} /></>}
                  </button>
                );
              })}
            </div>
            {pickValues && (
              <>
                {counts.size > FIND_FROM && (
                  <input
                    type="search"
                    className="sk-facet__find"
                    aria-label={t('kit.list.facetFind')}
                    placeholder={t('kit.list.facetFind')}
                    value={find}
                    onChange={e => setFind(e.target.value)}
                  />
                )}
                {values.length > 0 ? (
                  <div className="sk-facet__opts">
                    {values.map(v => (
                      <label key={v.value} className="sk-facet__opt">
                        <input type="checkbox" checked={filter.values.includes(v.value)} onChange={() => toggleValue(v.value)} />
                        <ValueIconMark icon={valueIcon(v.value)} />
                        <span className="sk-facet__vt">{valueTitle(v.value)}</span>
                        <FacetCount n={v.count} from={countsFrom} unknown={countsUnknown} lang={lang} />
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="sk-facet__empty">{counts.size ? t('kit.list.facetNoMatch') : t('kit.list.facetNoValues')}</p>
                )}
              </>
            )}
            {/*
              Откуда числа — словами, в самой панели (S9-01). Иначе «240» и «1»
              выглядят одинаково достоверными, хотя первое посчитано по выдаче,
              а второе — по загруженной странице. Сумма больше итога тоже
              называется нормой: у записи бывает несколько значений, и без этих
              слов подпись выглядит как ошибка счёта.
            */}
            <p className="sk-facet__note">
              {countsUnknown !== undefined
                ? (countsUnknown ? t('kit.list.facet.noCountsWhy', { reason: countsUnknown }) : t('kit.list.facet.noCounts'))
                : t(countsFrom === 'all' ? 'kit.list.facet.fromAll' : 'kit.list.facet.fromPage')}
              {countsUnknown === undefined && multi ? ` ${t('kit.list.facet.multi')}` : ''}
            </p>
            <div className="sk-facet__foot">
              <button type="button" className="sk-btn" onClick={close}>{t('kit.list.facetDone')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
