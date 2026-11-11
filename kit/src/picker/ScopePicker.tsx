// ScopePicker — выбор нескольких проектов в шапке (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03).
//
//   • кнопка в шапке подписана выбором: «Все проекты» · «Все мои (N своих)» ·
//     название одного · «N проектов». Число своих даёт ПРИЛОЖЕНИЕ (`mineCount`):
//     счёт по загруженному списку назвал бы не «сколько своих», а «сколько
//     своих мы успели увидеть». Числа не дали — подпись без числа, и это
//     сказано; ноль и «не посчитали» — разные утверждения;
//   • в панели — поиск, «Все мои», «Все проекты», галочки и «только этот» у
//     каждой строки;
//   • широкий экран — поповер у кнопки (не модальный: Esc и клик мимо
//     закрывают, фокус возвращается на кнопку); телефон — лист снизу из kit
//     Sheet (модальный, ловушка фокуса);
//   • состояния честные: загрузка, ошибка с «Повторить», нет прав, проверенный
//     ноль, неполная выдача (Truncated) — и отдельно «роли не проверены»:
//     тогда «Все мои» недоступно с причиной, а не тихо выбирает ничего;
//   • выбранный код, которого нет в списке, остаётся видимым с пометкой.
//
// Компонент «глупый»: список, выбор и состояние даёт приложение (откуда — из
// слайсов LORE, из URL), здесь — только вид и действия.
import { ICON_CANON } from '../elements/iconCanon';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { GameIcon } from '../elements/GameIcon';
import { kitT, KitLangProvider, useKitLang } from '../i18n';
import type { KitLang } from '../i18n';
import { useNarrow } from '../shell/KitShell';
import { Sheet } from '../shell/Sheet';
import type { Completeness, LoadState } from '../states/loadState';
import { EmptyState, Forbidden, LoadError, Skeleton } from '../states/StateViews';
import { Truncated } from '../states/Truncated';
import {
  filterScopeOptions, mineScope, onlyScope, orderScopeOptions, scopeTitle, summarizeScope,
  toggleScope, unknownScopeIds,
} from './scopeModel';
import type { ScopeOption, ScopeSummary } from './scopeModel';

export interface ScopePickerProps {
  /** Что выбираем — подпись кнопки и имя диалога («Проекты»). */
  label?: string;
  icon?: string;
  options: readonly ScopeOption[];
  /** Выбранные коды; пустой — «все». */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Состояние загрузки списка (useLoadState). */
  state?: LoadState;
  error?: unknown;
  onRetry?: () => void;
  completeness?: Completeness;
  /** Причина «нет прав» (outside_scope.reason). */
  forbiddenReason?: string;
  /** Проверены ли роли пользователя: unknown — «Все мои» недоступно. */
  mine?: 'known' | 'unknown';
  /** Почему роли не проверены (нет входа, ошибка слайса…). */
  mineHint?: string;
  /**
   * Сколько записей СВОИХ — числом от приложения (10.11.2026).
   *
   * Почему не считаем сами по `options`: список бывает обрезан, и тогда счёт
   * по нему называл бы не «сколько своих», а «сколько своих мы успели
   * увидеть». Числа не дали — подпись идёт без него, и об этом сказано: ноль
   * и «не посчитали» — разные утверждения, и путать их нельзя.
   */
  mineCount?: number;
  /**
   * Подписанные группы (S7B-ACL-3): свои (`mine`) и остальные — двумя списками с
   * заголовками. Подписи — от приложения («участники проектов машины» / «не в
   * проектах машины»), kit делит только по `mine`. Роли не проверены — групп нет.
   */
  groups?: { mine: string; other: string };
  /**
   * Слова о выбираемом от приложения (долг kit из S7B-ACL-3): по умолчанию
   * picker говорит о проектах («Все проекты», «Найти проект», «Проектов: {n}»),
   * а выбирать им можно и людей, и машины. `{n}` в `many` подставляется.
   * Не задано (или задано не всё) — недостающие слова прежние, про проекты.
   */
  labels?: ScopeLabels;
  /** Телефон — лист снизу; иначе поповер. Не задан — по ширине экрана (useNarrow). */
  narrow?: boolean;
  /** Язык поверх KitLangProvider. */
  lang?: KitLang;
  className?: string;
}

/** Подписи ScopePicker от приложения — см. `ScopePickerProps.labels`. */
export interface ScopeLabels {
  /** «Все …» — кнопка в диалоге и итог «ничего не выбрано» (с числом: «{all} · {n}»). */
  all?: string;
  /** Поле поиска: подпись и подсказка. */
  search?: string;
  /** Итог «выбрано несколько»; `{n}` — сколько. */
  many?: string;
}

/** Число своих — только от приложения; нет числа — нет и цифры в подписи. */
function knownCount(n: number | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** Скрытое — числом (S4-23): «Все проекты · 23», если число проектов известно. */
function summaryText(lang: KitLang, s: ScopeSummary, total = 0, mineCount?: number, labels?: ScopeLabels): string {
  switch (s.kind) {
    case 'all':
      if (labels?.all) return total > 0 ? `${labels.all} · ${total}` : labels.all;
      return total > 0 ? kitT(lang, 'kit.scope.allN', { n: total }) : kitT(lang, 'kit.scope.all');
    // «Все мои» без числа читается как «всё, что есть». Число своих знает
    // приложение; не сказало — говорим, что не посчитали, а не печатаем счёт
    // по загруженному списку (он бывает обрезан) и не ставим ноль.
    case 'mine': {
      const own = knownCount(mineCount);
      return own === null
        ? kitT(lang, 'kit.scope.summary.mineUncounted')
        : kitT(lang, 'kit.scope.summary.mine', { n: own });
    }
    case 'one': return s.title;
    case 'many': return labels?.many
      ? labels.many.split('{n}').join(String(s.count))
      : kitT(lang, 'kit.scope.summary.many', { n: s.count });
  }
}

export function ScopePicker(props: ScopePickerProps) {
  const ctxLang = useKitLang();
  const lang = props.lang ?? ctxLang;
  return (
    <KitLangProvider lang={lang}>
      <ScopePickerInner {...props} lang={lang} />
    </KitLangProvider>
  );
}

function ScopePickerInner({
  label, icon = ICON_CANON.scopeAll, options, value, onChange, state = 'ok', error, onRetry, completeness,
  forbiddenReason, mine = 'known', mineHint, mineCount, groups, labels, narrow: narrowProp, lang = 'ru', className,
}: ScopePickerProps) {
  const narrow = useNarrow(narrowProp);
  const name = label ?? kitT(lang, 'kit.scope.label');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const summary = summarizeScope(value, options, mine === 'known');
  const sumText = summaryText(lang, summary, options.length, mineCount, labels);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // Поповер: клик мимо закрывает (фокус не уводим — пользователь кликнул куда-то ещё).
  useEffect(() => {
    if (!open || narrow) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, narrow]);

  const body = (
    <ScopeBody
      lang={lang}
      options={options}
      value={value}
      onChange={onChange}
      state={state}
      error={error}
      onRetry={onRetry}
      completeness={completeness}
      forbiddenReason={forbiddenReason}
      mine={mine}
      mineHint={mineHint}
      mineCount={mineCount}
      groups={groups}
      labels={labels}
    />
  );

  return (
    <div ref={wrap} className={['sk-scope', className].filter(Boolean).join(' ')}>
      <button
        ref={trigger}
        type="button"
        className="sk-scope__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${name}: ${sumText}`}
        onClick={() => setOpen(o => !o)}
      >
        <GameIcon slug={icon} size={14} />
        <span className="sk-scope__name">{name}</span>
        <span className="sk-scope__value" data-kind={summary.kind}>{sumText}</span>
        <span className="sk-scope__chev" aria-hidden="true">▾</span>
      </button>
      {open && narrow && (
        <Sheet open onClose={() => setOpen(false)} title={name} side="bottom" className="sk-scope__sheet">
          {body}
        </Sheet>
      )}
      {open && !narrow && <ScopePopover name={name} onClose={close}>{body}</ScopePopover>}
    </div>
  );
}

function ScopePopover({ name, onClose, children }: { name: string; onClose: (refocus?: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input, button:not([aria-disabled="true"])');
    first?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose(true);
    }
  };
  return (
    <div ref={ref} role="dialog" aria-label={name} className="sk-scope__pop" onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

interface BodyProps {
  lang: KitLang;
  options: readonly ScopeOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  state: LoadState;
  error?: unknown;
  onRetry?: () => void;
  completeness?: Completeness;
  forbiddenReason?: string;
  mine: 'known' | 'unknown';
  mineHint?: string;
  mineCount?: number;
  groups?: { mine: string; other: string };
  labels?: ScopeLabels;
}

function ScopeBody({
  lang, options, value, onChange, state, error, onRetry, completeness, forbiddenReason, mine, mineHint, mineCount, groups, labels,
}: BodyProps) {
  const searchText = labels?.search || kitT(lang, 'kit.scope.search');
  const allText = labels?.all || kitT(lang, 'kit.scope.all');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const mineKnown = mine === 'known';
  const mineIds = useMemo(() => mineScope(options), [options]);
  const ordered = useMemo(() => orderScopeOptions(options, mineKnown), [options, mineKnown]);
  const shown = useMemo(() => filterScopeOptions(ordered, query), [ordered, query]);
  const missing = useMemo(() => unknownScopeIds(value, options), [value, options]);
  const hasData = state === 'ok' || state === 'partial';
  // Подписанные группы — только когда есть подписи и роли проверены: делить не по чему иначе.
  const grouped = !!groups && mineKnown;
  const renderRow = (o: ScopeOption) => (
              <ScopeRow
                key={o.id}
                lang={lang}
                option={o}
                checked={value.includes(o.id)}
                showMine={mineKnown && !grouped}
                onToggle={() => onChange(toggleScope(value, o.id))}
                onOnly={() => onChange(onlyScope(o.id))}
              />
            );

  const mineDisabled = !hasData || !mineKnown || mineIds.length === 0;
  const own = knownCount(mineCount);

  // Четыре РАЗНЫХ утверждения, и каждое своё:
  //   роли не проверены · своих ноль (проверено) · своих в списке нет, а
  //   сколько всего — не посчитали · своих N, но в загруженный список они не
  //   попали. Прежний код печатал второе там, где верно третье: ноль считался
  //   по загруженному списку, а он бывает обрезан.
  let mineNote: string | null = null;
  if (hasData && !mineKnown) {
    mineNote = [kitT(lang, 'kit.scope.mineUnknown'), mineHint].filter(Boolean).join(' · ');
  } else if (hasData && own === 0) {
    mineNote = kitT(lang, 'kit.scope.mineNone');
  } else if (hasData && mineIds.length === 0) {
    mineNote = own === null
      ? kitT(lang, 'kit.scope.mineUncounted')
      : kitT(lang, 'kit.scope.mineOffList', { n: own });
  }

  let content: ReactNode;
  switch (state) {
    case 'loading':
      content = <Skeleton lines={4} />;
      break;
    case 'error':
      content = <LoadError compact error={error} onRetry={onRetry} />;
      break;
    case 'forbidden':
      content = <Forbidden compact reason={forbiddenReason} />;
      break;
    case 'empty':
      content = <EmptyState compact title={kitT(lang, 'kit.scope.empty')} />;
      break;
    default:
      content = (
        <>
          {state === 'partial' && completeness && <Truncated completeness={completeness} />}
          {shown.length === 0 && query.trim() !== '' && (
            <p className="sk-scope__note" role="status">{kitT(lang, 'kit.scope.noMatch', { q: query.trim() })}</p>
          )}
          {grouped ? (
            <>
              {missing.length > 0 && <ul className="sk-scope__list">
            {missing.map(id => (
              <ScopeRow
                key={`missing:${id}`}
                lang={lang}
                option={{ id }}
                checked
                missing
                onToggle={() => onChange(toggleScope(value, id))}
                onOnly={() => onChange(onlyScope(id))}
              />
            ))}
              </ul>}
              {[{ key: 'mine', title: groups!.mine, list: shown.filter(o => o.mine) }, { key: 'other', title: groups!.other, list: shown.filter(o => !o.mine) }]
                .filter(g => g.list.length > 0)
                .map(g => (
                  <div key={g.key} className="sk-scope__grp">
                    <h4 className="sk-scope__grph" id={`${searchId}-${g.key}`}>{g.title}</h4>
                    <ul className="sk-scope__list" aria-labelledby={`${searchId}-${g.key}`}>{g.list.map(renderRow)}</ul>
                  </div>
                ))}
            </>
          ) : (
          <ul className="sk-scope__list">
            {missing.map(id => (
              <ScopeRow
                key={`missing:${id}`}
                lang={lang}
                option={{ id }}
                checked
                missing
                onToggle={() => onChange(toggleScope(value, id))}
                onOnly={() => onChange(onlyScope(id))}
              />
            ))}
            {shown.map(renderRow)}
          </ul>
          )}
        </>
      );
  }

  return (
    <div className="sk-scope__body">
      <label className="sk-sr" htmlFor={searchId}>{searchText}</label>
      <input
        id={searchId}
        type="search"
        className="sk-scope__search"
        placeholder={searchText}
        value={query}
        disabled={!hasData}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="sk-scope__actions">
        <button
          type="button"
          className="sk-scope__act"
          aria-disabled={mineDisabled ? true : undefined}
          onClick={() => { if (!mineDisabled) onChange(mineIds); }}
        >
          <GameIcon slug="person" size={13} />
          {kitT(lang, 'kit.scope.mine')}
        </button>
        <button
          type="button"
          className="sk-scope__act"
          aria-pressed={value.length === 0}
          onClick={() => onChange([])}
        >
          <GameIcon slug={ICON_CANON.scopeAll} size={13} />
          {allText}
        </button>
      </div>
      {mineNote && <p className="sk-scope__note sk-scope__note--wrn" data-testid="kit-scope-minenote">{mineNote}</p>}
      {content}
      {hasData && (
        <p className="sk-scope__count" aria-live="polite">
          {value.length === 0
            ? kitT(lang, 'kit.scope.countAll')
            : kitT(lang, 'kit.scope.count', { n: value.length })}
        </p>
      )}
    </div>
  );
}

interface RowProps {
  lang: KitLang;
  option: ScopeOption;
  checked: boolean;
  missing?: boolean;
  showMine?: boolean;
  onToggle: () => void;
  onOnly: () => void;
}

function ScopeRow({ lang, option, checked, missing, showMine, onToggle, onOnly }: RowProps) {
  const title = scopeTitle(option);
  return (
    <li className={['sk-scope__row', missing ? 'sk-scope__row--missing' : ''].filter(Boolean).join(' ')} data-scope-id={option.id}>
      <label className="sk-scope__check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="sk-scope__title">{title}</span>
        {title !== option.id && <span className="sk-scope__id">{option.id}</span>}
        {showMine && option.mine && <span className="sk-scope__tag">{kitT(lang, 'kit.scope.mineTag')}</span>}
        {missing && <span className="sk-scope__tag sk-scope__tag--wrn">{kitT(lang, 'kit.scope.missing')}</span>}
      </label>
      <button
        type="button"
        className="sk-scope__only"
        aria-label={kitT(lang, 'kit.scope.onlyLabel', { title })}
        onClick={onOnly}
      >
        {kitT(lang, 'kit.scope.only')}
      </button>
    </li>
  );
}
