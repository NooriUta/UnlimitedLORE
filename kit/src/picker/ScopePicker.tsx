// ScopePicker — выбор нескольких проектов в шапке (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03).
//
//   • кнопка в шапке подписана выбором: «Все проекты» · «Все мои (N)» · название
//     одного · «N проектов»;
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
  /** Телефон — лист снизу; иначе поповер. Не задан — по ширине экрана (useNarrow). */
  narrow?: boolean;
  /** Язык поверх KitLangProvider. */
  lang?: KitLang;
  className?: string;
}

/** Скрытое — числом (S4-23): «Все проекты · 23», если число проектов известно. */
function summaryText(lang: KitLang, s: ScopeSummary, total = 0): string {
  switch (s.kind) {
    case 'all': return total > 0 ? kitT(lang, 'kit.scope.allN', { n: total }) : kitT(lang, 'kit.scope.all');
    case 'mine': return kitT(lang, 'kit.scope.summary.mine', { n: s.count });
    case 'one': return s.title;
    case 'many': return kitT(lang, 'kit.scope.summary.many', { n: s.count });
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
  forbiddenReason, mine = 'known', mineHint, narrow: narrowProp, lang = 'ru', className,
}: ScopePickerProps) {
  const narrow = useNarrow(narrowProp);
  const name = label ?? kitT(lang, 'kit.scope.label');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const summary = summarizeScope(value, options, mine === 'known');
  const sumText = summaryText(lang, summary, options.length);

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
}

function ScopeBody({
  lang, options, value, onChange, state, error, onRetry, completeness, forbiddenReason, mine, mineHint,
}: BodyProps) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const mineKnown = mine === 'known';
  const mineIds = useMemo(() => mineScope(options), [options]);
  const ordered = useMemo(() => orderScopeOptions(options, mineKnown), [options, mineKnown]);
  const shown = useMemo(() => filterScopeOptions(ordered, query), [ordered, query]);
  const missing = useMemo(() => unknownScopeIds(value, options), [value, options]);
  const hasData = state === 'ok' || state === 'partial';

  const mineDisabled = !hasData || !mineKnown || mineIds.length === 0;
  let mineNote: string | null = null;
  if (hasData && !mineKnown) {
    mineNote = [kitT(lang, 'kit.scope.mineUnknown'), mineHint].filter(Boolean).join(' · ');
  } else if (hasData && mineIds.length === 0) {
    mineNote = kitT(lang, 'kit.scope.mineNone');
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
            {shown.map(o => (
              <ScopeRow
                key={o.id}
                lang={lang}
                option={o}
                checked={value.includes(o.id)}
                showMine={mineKnown}
                onToggle={() => onChange(toggleScope(value, o.id))}
                onOnly={() => onChange(onlyScope(o.id))}
              />
            ))}
          </ul>
        </>
      );
  }

  return (
    <div className="sk-scope__body">
      <label className="sk-sr" htmlFor={searchId}>{kitT(lang, 'kit.scope.search')}</label>
      <input
        id={searchId}
        type="search"
        className="sk-scope__search"
        placeholder={kitT(lang, 'kit.scope.search')}
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
          {kitT(lang, 'kit.scope.all')}
        </button>
      </div>
      {mineNote && <p className="sk-scope__note sk-scope__note--wrn">{mineNote}</p>}
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
    <li className={['sk-scope__row', missing ? 'sk-scope__row--missing' : ''].filter(Boolean).join(' ')}>
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
