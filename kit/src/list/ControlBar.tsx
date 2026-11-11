// Стандартная полоса управления — для таблиц, которые рисуют свои строки
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-SPRINT-TASKS-CONTROLS).
//
// Повод — владелица 11.11.2026: «у всех табличных представлений по умолчанию
// сортировки, фильтры, группировки и поиск». Дерево (TreeTable) и таблица
// задач (TaskTable) не могут стать ListView — у них иерархия, правка в строке,
// массовый статус. Поэтому вынесена не таблица, а ПОЛОСА:
//   • те же части, что у ListView: сегменты `sk-list__seg` (filter · group ·
//     sort), поле поиска `sk-list__search`, `FacetFilter` на ось, `GroupMenu`,
//     `SortMenu` и кнопка «по убыванию»;
//   • та же модель: фильтр — `toFilterSet` / `applyFilterSet` / `facetOf`,
//     порядок — `sortRecords`. Своего «похожего» поиска здесь нет;
//   • своего класса нет: всё на классах списка, поэтому полоса выглядит
//     одинаково везде, где она есть.
// Состояние держит вызывающий: дерево — в памяти, экран — где хочет.
//
// Предметных имён нет (K-14): оси, подписи и значения приходят от вызывающего.
import type { ReactNode } from 'react';
import type { KitConfig, KitRecord } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { ICON_CANON } from '../elements/iconCanon';
import { kitT, useKitLang, type KitKey } from '../i18n';
import { FacetFilter, type ValueIcon } from './FacetFilter';
import { applyFilterSet, facetOf, toFilterSet, type FieldFilter } from './filterModel';
import { fieldValueTitle, groupKeyTitle, keyTitleMissing } from './groupLabel';
import { GroupMenu } from './GroupMenu';
import { sortRecords, type FilterOp, type ListSort } from './listModel';
import { SortMenu } from './SortMenu';

/** Состояние полосы — подмножество состояния списка (ListState) с тем же смыслом полей. */
export interface ControlState {
  text: string;
  filters: Record<string, string[]>;
  ops: Record<string, FilterOp>;
  group: string | null;
  sort: ListSort | null;
}

export const EMPTY_CONTROLS: ControlState = { text: '', filters: {}, ops: {}, group: null, sort: null };

/** Задан ли ФИЛЬТР (текст или условие поля). Порядок и группа фильтром не считаются. */
export function controlsActive(s: ControlState): boolean {
  const fs = toFilterSet(s);
  return Object.keys(fs.fields).length > 0 || !!fs.text;
}

/** Фильтр и порядок списка: сначала условие, потом порядок. Вход не мутируется. */
export function applyControls(records: readonly KitRecord[], s: ControlState, config: KitConfig): KitRecord[] {
  return sortRecords(applyFilterSet(records, toFilterSet(s)), s.sort, config);
}

export interface ControlBarProps {
  config: KitConfig;
  /** Записи, по которым считаются счётчики фасетов (то, что фильтруется). */
  records: readonly KitRecord[];
  state: ControlState;
  onChange: (next: ControlState) => void;
  /** Оси фасетов в языке колонок списка (`status`, `fields.<ключ>`). */
  filterKeys: readonly string[];
  /** Ключи группировки; не даны (и нет groupSlot) — сегмента группы нет. */
  groupKeys?: readonly string[];
  /** Своя группировка вызывающего — в стандартном сегменте вместо GroupMenu. */
  groupSlot?: ReactNode;
  /** Ключи порядка; не даны — сегмента порядка нет. */
  sortKeys?: readonly string[];
  /** Подпись значения оси; undefined — подпись списка (статус — из словаря). */
  valueTitle?: (key: string, v: string) => string | undefined;
  /** Подпись ключа; undefined — подпись списка. */
  keyTitle?: (key: string) => string | undefined;
  /** «Показано N из M» — когда условие задано. */
  shown?: { shown: number; total: number };
  narrow?: boolean;
}

export function ControlBar({
  config, records, state, onChange, filterKeys, groupKeys, groupSlot, sortKeys, valueTitle, keyTitle, shown, narrow = false,
}: ControlBarProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const keyName = (k: string) => keyTitle?.(k) ?? groupKeyTitle(config, lang, k);
  const valueName = (k: string, v: string) => valueTitle?.(k, v) ?? fieldValueTitle(config, lang, k, v);
  const statuses = new Map(config.statuses.items.map((s, i) => [s.code, { s, i }]));
  const iconOf = (k: string, v: string): ValueIcon | null => {
    if (k !== 'status') return null;
    const s = statuses.get(v)?.s;
    return s ? { icon: s.icon, color: s.color } : null;
  };
  const statusCompare = (a: string, b: string) =>
    (statuses.get(a)?.i ?? Infinity) - (statuses.get(b)?.i ?? Infinity) || a.localeCompare(b);
  const filterSet = toFilterSet(state);
  const update = (p: Partial<ControlState>) => onChange({ ...state, ...p });
  const setField = (k: string, f: FieldFilter) => {
    const filters = { ...state.filters };
    const ops = { ...state.ops };
    if (f.values.length) filters[k] = f.values; else delete filters[k];
    if (f.op !== 'any') ops[k] = f.op; else delete ops[k];
    update({ filters, ops });
  };
  const filterCount = Object.keys(filterSet.fields).length + (filterSet.text ? 1 : 0);
  const segCount = (n: number) => (n > 0
    ? <span className="sk-list__segcount" title={t('kit.list.segActive', { n })}>{n}</span>
    : null);
  const active = controlsActive(state);
  const hasGroup = !!groupSlot || (groupKeys?.length ?? 0) > 0;

  return (
    <div role="group" aria-label={t('kit.list.filters')} className="sk-list__controls" data-testid="kit-ctlbar">
      <fieldset className="sk-list__seg" data-seg="filter">
        <legend className="sk-list__seglabel">{t('kit.list.desc.filter')}</legend>
        <GameIcon slug={ICON_CANON.segFilter} size={14} className="sk-list__segicon" />
        {segCount(filterCount)}
        <input
          type="search"
          className="sk-list__search"
          aria-label={t('kit.list.text')}
          placeholder={t('kit.list.textPlaceholder')}
          value={state.text}
          onChange={e => update({ text: e.target.value })}
        />
        {filterKeys.map(k => (
          <FacetFilter
            key={k}
            title={keyName(k)}
            untitled={!keyTitle?.(k) && keyTitleMissing(config, k)}
            filter={{ op: state.ops[k] ?? 'any', values: state.filters[k] ?? [] }}
            facet={facetOf(records, filterSet, k)}
            valueTitle={v => valueName(k, v)}
            valueIcon={v => iconOf(k, v)}
            compare={k === 'status' ? statusCompare : undefined}
            onChange={f => setField(k, f)}
            lang={lang}
            countsFrom="all"
            narrow={narrow}
          />
        ))}
      </fieldset>
      {hasGroup && (
        <fieldset className="sk-list__seg" data-seg="group">
          <legend className="sk-list__seglabel">{t('kit.list.group')}</legend>
          <GameIcon slug={ICON_CANON.segGroup} size={14} className="sk-list__segicon" />
          {groupSlot ?? (
            <>
              {segCount(state.group ? 1 : 0)}
              <GroupMenu
                group={state.group}
                sub={null}
                options={{ fields: [...(groupKeys ?? [])], relations: [] }}
                withSub={false}
                keyTitle={keyName}
                onGroup={g => update({ group: g })}
                onSub={() => {}}
                bare
                narrow={narrow}
              />
            </>
          )}
        </fieldset>
      )}
      {sortKeys && sortKeys.length > 0 && (
        <fieldset className="sk-list__seg" data-seg="sort">
          <legend className="sk-list__seglabel">{t('kit.list.sort')}</legend>
          <GameIcon slug={ICON_CANON.segSort} size={14} className="sk-list__segicon" />
          {segCount(state.sort ? 1 : 0)}
          <SortMenu
            value={state.sort?.key ?? null}
            keys={[...sortKeys]}
            keyTitle={keyName}
            onChange={k => update({ sort: k ? { key: k, dir: state.sort?.dir ?? 'asc' } : null })}
            narrow={narrow}
          />
          <button
            type="button"
            className="sk-list__dir"
            aria-pressed={state.sort?.dir === 'desc'}
            disabled={!state.sort}
            onClick={() => state.sort && update({ sort: { ...state.sort, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' } })}
          >
            {t('kit.list.sortDesc')}
          </button>
        </fieldset>
      )}
      {active && (
        <button type="button" className="sk-btn" onClick={() => update({ text: '', filters: {}, ops: {} })}>
          {t('kit.list.reset')}
        </button>
      )}
      {active && shown && (
        <span className="sk-list__shown" role="status">{t('kit.list.shown', shown)}</span>
      )}
    </div>
  );
}
