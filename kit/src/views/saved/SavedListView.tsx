// Сохранённые виды списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-08,
// D-2026-UXR-VIEWS-SERVER): панель «Вид ▾ · изменён · Сохранить · Сохранить
// как… · Сбросить» и связка панели со списком kit (ListView в управляемом
// режиме).
//
// • Раздел открывается командным видом по умолчанию (или личным, если он
//   помечен), id вида — в URL (vw), состояние списка — в URL (lv/lq/lg/ls/lf).
// • «Сохранить» — только в свой вид; на командном/чужом кнопка выключена с
//   подсказкой, путь — «Сохранить как…» (имя + кому виден).
// • «Сбросить» — к сохранённому состоянию вида, без правок — к командному.
// • Хранилище — KitViewStore (контракт S2): сбой загрузки ≠ нет прав ≠ пусто,
//   сбой записи виден и не подменяет вид. Список работает при любом исходе.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { kitT, useKitLang } from '../../i18n';
import type { KitKey } from '../../i18n';
import { ListView } from '../../list/ListView';
import type { ListViewProps } from '../../list/ListView';
import { DEFAULT_LIST_STATE, LIST_URL_KEYS } from '../../list/listModel';
import type { ListState } from '../../list/listModel';
import { pushUrlState, readUrlState } from '../../resilience/urlState';
import type { UrlWindow } from '../../resilience/urlState';
import { classifyError } from '../../states/loadState';
import { Forbidden, LoadError } from '../../states/StateViews';
import {
  isViewDirty, listStateToQuery, queryToListState, resetTarget, startView, viewCanSave,
} from './savedViews';
import type { KitSavedListView, KitViewStore, KitViewVisibility } from './savedViews';

/** Ключ URL для id выбранного вида. */
export const VIEW_URL_KEY = 'vw';

type LoadPhase = 'loading' | 'ok' | 'empty' | 'error' | 'forbidden';

export interface ViewsBarProps {
  store: KitViewStore;
  section: string;
  /** kc_sub текущего пользователя: «свой» вид можно перезаписать. */
  user?: string | null;
  /** Текущее состояние списка. */
  state: ListState;
  /** Применить состояние вида к списку (выбор, сброс). */
  onApply: (state: ListState) => void;
  /** Окно для URL (vw); null — без URL. */
  win?: UrlWindow | null;
  /** Стартовать с вида по умолчанию — только если в URL не было своего состояния списка. */
  applyStartView?: boolean;
  /** Право заводить командный вид по умолчанию (админ). Нет права — флажка нет; сервер всё равно проверит сам. */
  canTeamDefault?: boolean;
  className?: string;
}

function urlViewId(win: UrlWindow | null | undefined): string | null {
  return win ? readUrlState(win).get(VIEW_URL_KEY) : null;
}

/** Панель видов. Состояние списка держит родитель — панель только читает и применяет. */
/**
 * Ссылка на вид: адрес раздела + {@link VIEW_URL_KEY}, без своего состояния списка (lv/lq/…) — у получателя
 * список открывается сохранённым состоянием вида, а не правками того, кто делится.
 */
export function viewShareHref(win: UrlWindow, id: string): string {
  // У окна адреса kit (UrlWindow) полного href может не быть — собираем из пути и строки запроса.
  const loc = win.location as UrlWindow['location'] & { href?: string };
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
  const u = new URL(loc.href ?? loc.pathname + loc.search, origin);
  for (const k of LIST_URL_KEYS) u.searchParams.delete(k);
  u.searchParams.set(VIEW_URL_KEY, id);
  return u.href;
}

export function ViewsBar({ store, section, user, state, onApply, win, applyStartView = true, canTeamDefault = false, className }: ViewsBarProps) {
  const lang = useKitLang();
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const formId = useId();
  const [views, setViews] = useState<KitSavedListView[]>([]);
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [activeId, setActiveId] = useState<string | null>(() => urlViewId(win));
  const [saveErr, setSaveErr] = useState<{ key: KitKey; error: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asOpen, setAsOpen] = useState(false);
  const [asName, setAsName] = useState('');
  const [asVis, setAsVis] = useState<'me' | 'all'>('me');
  const [asTeam, setAsTeam] = useState(false);
  // Ссылка по vw не нашла вида среди видимых — сказать, а не молча открыть другой (видимость решает сервер).
  const [linkMissing, setLinkMissing] = useState(false);
  const [share, setShare] = useState<{ href: string; copied: boolean | null } | null>(null);
  const started = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Ссылка, а не зависимость: новая функция у родителя не перезапрашивает виды.
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  const select = useCallback((v: KitSavedListView | null, apply: boolean) => {
    setActiveId(v?.id ?? null);
    setShare(null);
    if (win) pushUrlState({ [VIEW_URL_KEY]: v?.id ?? null }, { win, replace: true });
    if (apply) onApplyRef.current(v ? queryToListState(v.query) : DEFAULT_LIST_STATE);
  }, [win]);

  const load = useCallback(() => {
    setPhase('loading');
    let alive = true;
    store.list(section).then(list => {
      if (!alive) return;
      setViews(list);
      setPhase(list.length ? 'ok' : 'empty');
      if (!started.current) {
        started.current = true;
        const urlId = urlViewId(win);
        if (urlId && !list.some(v => v.id === urlId && v.section === section)) setLinkMissing(true);
        const first = startView(list, section, urlId);
        // Своё состояние списка в URL (ссылка, перезагрузка) важнее вида по умолчанию.
        select(first, applyStartView);
      }
    }, err => {
      if (!alive) return;
      setLoadErr(err);
      setPhase(classifyError(err));
    });
    return () => { alive = false; };
  }, [store, section, win, select, applyStartView]);

  useEffect(() => load(), [load]);

  const active = useMemo(() => views.find(v => v.id === activeId) ?? null, [views, activeId]);
  const dirty = isViewDirty(active, state);
  const canSave = viewCanSave(active, user) && dirty;
  const reset = resetTarget(views, section, active, state);

  const team = views.filter(v => v.owner === null);
  const mine = views.filter(v => v.owner !== null && v.owner === user);
  const shared = views.filter(v => v.owner !== null && v.owner !== user);

  const doSave = async () => {
    if (!active) return;
    setBusy(true);
    setSaveErr(null);
    try {
      const upd = await store.update(active.id, { query: listStateToQuery(stateRef.current) });
      setViews(prev => prev.map(v => v.id === upd.id ? upd : v));
    } catch (error) {
      setSaveErr({ key: 'kit.views.saveError', error });
    } finally {
      setBusy(false);
    }
  };

  const doShare = () => {
    if (!active || !win) return;
    const href = viewShareHref(win, active.id);
    setShare({ href, copied: null });
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clip?.writeText) clip.writeText(href).then(() => setShare({ href, copied: true }), () => setShare({ href, copied: false }));
    else setShare({ href, copied: false });
  };

  const doPersonalDefault = async (on: boolean) => {
    if (!active || !viewCanSave(active, user)) return;
    setBusy(true);
    setSaveErr(null);
    try {
      const upd = await store.update(active.id, { personal_default: on });
      // личный по умолчанию в разделе один: сервер снимает флажок с прочих своих — то же и здесь
      setViews(prev => prev.map(v => (v.id === upd.id ? upd : on && v.section === upd.section && v.owner === user ? { ...v, personal_default: false } : v)));
    } catch (error) {
      setSaveErr({ key: 'kit.views.saveError', error });
    } finally {
      setBusy(false);
    }
  };

  const openSaveAs = () => {
    setAsName(t('kit.views.nameDefault', { n: mine.length + 1 }));
    setAsVis('me');
    setAsTeam(false);
    setSaveErr(null);
    setAsOpen(true);
  };

  const doSaveAs = async (e: FormEvent) => {
    e.preventDefault();
    const name = asName.trim();
    if (!name) return;
    setBusy(true);
    setSaveErr(null);
    try {
      const visibility: KitViewVisibility = asVis;
      const team = canTeamDefault && asTeam && visibility !== 'me';
      const created = await store.create({ name, section, query: listStateToQuery(stateRef.current), visibility, ...(team ? { team_default: true } : {}) });
      setViews(prev => [...prev, created]);
      setPhase('ok');
      setAsOpen(false);
      select(created, false);
    } catch (error) {
      setSaveErr({ key: 'kit.views.saveError', error });
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    if (!active || !viewCanSave(active, user)) return;
    setBusy(true);
    setSaveErr(null);
    try {
      await store.remove(active.id);
      const rest = views.filter(v => v.id !== active.id);
      setViews(rest);
      if (!rest.length) setPhase('empty');
      select(startView(rest, section, null), true);
    } catch (error) {
      setSaveErr({ key: 'kit.views.removeError', error });
    } finally {
      setBusy(false);
    }
  };

  const cls = ['sk-views', className].filter(Boolean).join(' ');

  if (phase === 'error' || phase === 'forbidden') {
    return (
      <div className={cls} data-testid="kit-views" data-state={phase} role="group" aria-label={t('kit.views.bar')}>
        {phase === 'error'
          ? <LoadError compact title={t('kit.views.loadError')} hint={t('kit.views.loadErrorHint')} error={loadErr} onRetry={load} />
          : <Forbidden compact title={t('kit.views.forbidden')} hint={t('kit.views.forbiddenHint')} />}
      </div>
    );
  }

  const option = (v: KitSavedListView) => <option key={v.id} value={v.id}>{v.name}</option>;
  const saveTitle = !active
    ? t('kit.views.saveHintNone')
    : !viewCanSave(active, user) ? t('kit.views.saveHintTeam') : undefined;
  const shareTitle = !active ? t('kit.views.shareHintNone')
    : active.visibility === 'me' ? t('kit.views.shareHintMe')
      : !win ? t('kit.views.shareHintNoUrl') : undefined;
  const resetTitle = !reset
    ? t('kit.views.resetNone')
    : reset.id === active?.id ? t('kit.views.resetHintDirty', { name: reset.name }) : t('kit.views.resetHintTeam', { name: reset.name });

  return (
    <div className={cls} data-testid="kit-views" data-state={phase} role="group" aria-label={t('kit.views.bar')} aria-busy={phase === 'loading' || busy}>
      <label className="sk-views__field">
        <span className="sk-views__label">{t('kit.views.label')}</span>
        <select
          aria-label={t('kit.views.label')}
          className="sk-views__select"
          value={activeId ?? ''}
          disabled={phase === 'loading'}
          onChange={e => select(views.find(v => v.id === e.target.value) ?? null, true)}
        >
          <option value="">{phase === 'loading' ? t('kit.views.loading') : t('kit.views.none')}</option>
          {team.length > 0 && <optgroup label={t('kit.views.groupTeam')}>{team.map(option)}</optgroup>}
          {mine.length > 0 && <optgroup label={t('kit.views.groupMine')}>{mine.map(option)}</optgroup>}
          {shared.length > 0 && <optgroup label={t('kit.views.groupShared')}>{shared.map(option)}</optgroup>}
        </select>
      </label>
      {dirty && phase !== 'loading' && (
        <span className="sk-views__dirty" data-testid="kit-views-dirty" title={t('kit.views.dirtyHint')}>{t('kit.views.dirty')}</span>
      )}
      <button type="button" className="sk-btn" disabled={!canSave || busy} title={saveTitle} onClick={doSave}>{t('kit.views.save')}</button>
      <button type="button" className="sk-btn" disabled={busy || phase === 'loading'} aria-expanded={asOpen} aria-controls={formId} onClick={() => (asOpen ? setAsOpen(false) : openSaveAs())}>
        {t('kit.views.saveAs')}
      </button>
      <button type="button" className="sk-btn" disabled={!reset || busy} title={resetTitle} onClick={() => reset && select(reset, true)}>{t('kit.views.reset')}</button>
      <button type="button" className="sk-btn" disabled={!!shareTitle || busy} title={shareTitle} onClick={doShare}>{t('kit.views.share')}</button>
      {active && viewCanSave(active, user) && (
        <label className="sk-views__field sk-views__check">
          <input type="checkbox" checked={!!active.personal_default} disabled={busy} onChange={e => { void doPersonalDefault(e.target.checked); }} />
          <span>{t('kit.views.personalDefault')}</span>
        </label>
      )}
      {active && viewCanSave(active, user) && (
        <button type="button" className="sk-btn sk-views__remove" disabled={busy} onClick={doRemove}>
          {t('kit.views.remove', { name: active.name })}
        </button>
      )}
      {phase === 'empty' && <span className="sk-views__hint">{t('kit.views.empty')}</span>}
      {linkMissing && <span className="sk-views__hint" role="status" data-testid="kit-views-link-missing">{t('kit.views.linkMissing')}</span>}
      {share && (
        <span className="sk-views__share" data-testid="kit-views-share">
          <input className="sk-views__input" readOnly aria-label={t('kit.views.shareLink')} value={share.href} onFocus={e => e.currentTarget.select()} />
          {share.copied !== null && <span className="sk-views__hint" role="status">{t(share.copied ? 'kit.views.shareCopied' : 'kit.views.shareCopyManual')}</span>}
        </span>
      )}
      {asOpen && (
        <form id={formId} className="sk-views__form" onSubmit={doSaveAs}>
          <label className="sk-views__field">
            <span className="sk-views__label">{t('kit.views.name')}</span>
            <input
              className="sk-views__input"
              aria-label={t('kit.views.name')}
              value={asName}
              required
              autoFocus
              onChange={e => setAsName(e.target.value)}
            />
          </label>
          <label className="sk-views__field">
            <span className="sk-views__label">{t('kit.views.visibility')}</span>
            <select aria-label={t('kit.views.visibility')} className="sk-views__select" value={asVis} onChange={e => setAsVis(e.target.value === 'all' ? 'all' : 'me')}>
              <option value="me">{t('kit.views.visMe')}</option>
              <option value="all">{t('kit.views.visAll')}</option>
            </select>
          </label>
          {canTeamDefault && asVis === 'all' && (
            <label className="sk-views__field sk-views__check">
              <input type="checkbox" checked={asTeam} onChange={e => setAsTeam(e.target.checked)} />
              <span>{t('kit.views.teamDefault')}</span>
            </label>
          )}
          <button type="submit" className="sk-btn" disabled={busy || !asName.trim()}>{t('kit.views.create')}</button>
          <button type="button" className="sk-btn" onClick={() => setAsOpen(false)}>{t('kit.views.cancel')}</button>
        </form>
      )}
      {saveErr && <LoadError compact title={t(saveErr.key)} error={saveErr.error} />}
    </div>
  );
}

export interface SavedListViewProps extends Omit<ListViewProps, 'state' | 'onStateChange'> {
  store: KitViewStore;
  section: string;
  user?: string | null;
  canTeamDefault?: boolean;
  onStateChange?: (state: ListState) => void;
}

function resolveWin(urlState: ListViewProps['urlState']): UrlWindow | null {
  if (urlState === false) return null;
  if (urlState && typeof urlState === 'object') return urlState;
  return typeof window === 'undefined' ? null : window;
}

/** Список kit с сохранёнными видами: панель видов сверху, ListView в управляемом режиме. */
export function SavedListView({ store, section, user, canTeamDefault, onStateChange, initial, ...listProps }: SavedListViewProps) {
  const win = resolveWin(listProps.urlState);
  const [urlHasList] = useState(() => !!win && LIST_URL_KEYS.some(k => readUrlState(win).has(k)));
  const [state, setState] = useState<ListState>(() => {
    const base: ListState = { ...DEFAULT_LIST_STATE, ...initial };
    if (!win || !urlHasList) return base;
    return { ...base, ...queryToListState(readUrlState(win).toString()) };
  });
  const apply = useCallback((s: ListState) => {
    setState(s);
    onStateChange?.(s);
  }, [onStateChange]);
  return (
    <div className="sk-saved">
      <ViewsBar store={store} section={section} user={user} state={state} onApply={apply} win={win} applyStartView={!urlHasList} canTeamDefault={canTeamDefault} />
      <ListView {...listProps} state={state} onStateChange={apply} />
    </div>
  );
}
