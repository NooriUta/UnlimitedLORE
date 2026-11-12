// Экран «Словари» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-31 п.1 и п.3; решение
// владелицы 11.11: 1а — свой раздел, 3б — «Теги» вкладкой внутри).
// Паритет со старыми вкладками v1 DictsTab и TagsTab.
//
// Правка справочника меняет язык всей системы: подписи и цвета статусов,
// областей, профилей видны на каждом экране. Поэтому:
//   • код — ключ, которым связаны данные: у существующего значения залочен;
//   • канон-словарь помечен и правится только с вводом кода (kit DiffPreview);
//   • деактивация — тоже с вводом кода (в v1 — второй клик «Точно…?»);
//   • перед записью — «было → станет» по полям (kit DiffPreview);
//   • счёт использований area: компоненты не прочитаны — «не смогли посчитать».
import { useMemo, useState, type ReactNode } from 'react';
import gameIconsData from '@iconify-json/game-icons/icons.json';
// S7B-22: логотипы harness (simple-icons:…) из поля icon справочника — зарегистрировать до показа чипа.
import './harnessLogos';
import {
  DiffPreview, EmptyState, Forbidden, GameIcon, LoadError, Skeleton, hasGameIcon, useKitLang, useLoadState, useUrlParam,
  type DiffRow,
} from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  DICT_COLOR_TOKENS, checkNewDictType, dictEntryBody, dictEntryDiff, dictTypes, fetchDicts, fetchTags, isCanonDict,
  needsDictConfirm, saveDictEntry, usageOf, type AreaUsage, type DictDraft, type DictRow, type DictsData, type TagRow,
  type UsageCell,
} from './dicts';
import './Admin.css';

export interface DictsScreenProps {
  fetchImpl?: typeof fetch;
}

const GAME_ICON_NAMES: string[] = Object.keys((gameIconsData as { icons: Record<string, unknown> }).icons);

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e ?? '');

const isForbidden = (state: string, e: unknown) =>
  state === 'forbidden' || (e instanceof LoreHttpError && (e.status === 401 || e.status === 403));

export function DictsScreen({ fetchImpl }: DictsScreenProps) {
  const t = useAppT();
  const [tab, setTab] = useUrlParam('adm-dicts-tab');
  const tags = tab === 'tags';
  return (
    <section className="adm" aria-labelledby="adm-dicts-h">
      <h2 id="adm-dicts-h" className="adm-h">{t('admin.dicts.title')}</h2>
      <p className="adm-lead">{t('admin.dicts.lead')}</p>
      <div className="adm-tabs" role="tablist" aria-label={t('admin.dicts.title')}>
        <button type="button" role="tab" className="adm-tab" aria-selected={!tags} aria-current={!tags ? 'page' : undefined}
          data-testid="adm-dicts-tab-dicts" onClick={() => setTab(null, { replace: true })}>{t('admin.dicts.tabDicts')}</button>
        <button type="button" role="tab" className="adm-tab" aria-selected={tags} aria-current={tags ? 'page' : undefined}
          data-testid="adm-dicts-tab-tags" onClick={() => setTab('tags', { replace: true })}>{t('admin.dicts.tabTags')}</button>
      </div>
      {tags ? <TagsPane fetchImpl={fetchImpl} /> : <DictsPane fetchImpl={fetchImpl} />}
    </section>
  );
}

// ── Словари ────────────────────────────────────────────────────────────────

function DictsPane({ fetchImpl }: DictsScreenProps) {
  const t = useAppT();
  const res = useLoadState<DictsData>(s => fetchDicts(s, fetchImpl), [fetchImpl], { rows: d => d.rows });
  const data = res.data;
  if (res.state === 'loading' && !data) return <Skeleton lines={6} label={t('admin.dicts.loading')} />;
  if (!data && isForbidden(res.state, res.error)) return <Forbidden reason={reasonOf(res.error)} />;
  if (!data) return <LoadError error={res.error} onRetry={res.reload} />;
  return <DictsBody data={data} fetchImpl={fetchImpl} reload={res.reload} />;
}

function DictsBody({ data, fetchImpl, reload }: { data: DictsData; fetchImpl?: typeof fetch; reload: () => void }) {
  const t = useAppT();
  const types = useMemo(() => dictTypes(data.rows), [data.rows]);
  const typeNames = types.map(x => x.type);
  const [dtParam, setDt] = useUrlParam('adm-dict');
  const dt = dtParam ?? (typeNames.includes('area') ? 'area' : typeNames[0] ?? 'area');
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<{ before: DictRow | null; draft: DictDraft } | null>(null);
  const [newType, setNewType] = useState('');
  const newCheck = checkNewDictType(newType, typeNames);

  const rows = data.rows.filter(r => r.dict_type === dt);
  const ql = q.trim().toLowerCase();
  const shown = rows
    .filter(r => all || r.is_active)
    .filter(r => !ql || r.code.toLowerCase().includes(ql) || (r.label_ru ?? '').toLowerCase().includes(ql)
      || (r.label_en ?? '').toLowerCase().includes(ql));
  const canon = isCanonDict(dt);

  const pick = (x: string) => { setDt(x, { replace: true }); setEdit(null); };
  const openNew = (count: number) => setEdit({
    before: null,
    draft: { code: '', label_ru: '', label_en: null, color: null, icon: null, sort_order: (count + 1) * 10, is_active: true },
  });
  const applyNewType = () => {
    if (newCheck.kind === 'exists') { pick(newCheck.code); setNewType(''); return; }
    if (newCheck.kind !== 'new') return;
    // Тип не живёт отдельно от записей: «Завести» сразу открывает форму первой записи.
    pick(newCheck.code); setNewType(''); openNew(0);
  };
  const openEdit = (r: DictRow, reactivate = false) => setEdit({ before: r, draft: { ...r, is_active: reactivate ? true : r.is_active } });
  const done = () => { setEdit(null); reload(); };

  return (
    <>
      {data.truncated && <p className="adm-note" data-tone="wrn" role="status">{t('admin.dicts.truncated')}</p>}
      {data.usage.state === 'unknown' && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-dicts-usage-error">
          {t('admin.dicts.usageError', { reason: data.usage.reason })}
        </p>
      )}
      <div className="adm-chips" role="group" aria-label={t('admin.dicts.types')} data-testid="adm-dicts-types">
        {types.map(x => (
          <button key={x.type} type="button" className="adm-chip adm-mono" aria-pressed={dt === x.type}
            data-canon={isCanonDict(x.type) || undefined}
            title={isCanonDict(x.type) ? t('admin.dicts.canonChip') : undefined}
            onClick={() => pick(x.type)}>
            {x.type} <b>{x.n}</b>
          </button>
        ))}
      </div>
      <div className="adm-filters">
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.newType')}</span>
          <input className="adm-input adm-mono" type="text" aria-label={t('admin.dicts.newType')} value={newType}
            placeholder={t('admin.dicts.newTypePh')} onChange={e => setNewType(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyNewType(); }} />
        </label>
        <div className="adm-field adm-field--btns">
          <button type="button" className="adm-btn" disabled={newCheck.kind === 'empty' || newCheck.kind === 'bad'} onClick={applyNewType}>
            {newCheck.kind === 'exists' ? t('admin.dicts.newTypeOpen') : t('admin.dicts.newTypeCreate')}
          </button>
        </div>
        {newCheck.kind === 'bad' && <p className="adm-hint adm-err">{t('admin.dicts.newTypeBad')}</p>}
        {newCheck.kind === 'new' && <p className="adm-hint">{t('admin.dicts.newTypeHint')}</p>}
      </div>
      {canon && <p className="adm-note" data-tone="wrn" role="note" data-testid="adm-dicts-canon">{t('admin.dicts.canonWarn')}</p>}
      <div className="adm-filters">
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.search')}</span>
          <input className="adm-input" type="search" aria-label={t('admin.dicts.search')} value={q}
            placeholder={t('admin.dicts.searchPh')} onChange={e => setQ(e.target.value)} />
        </label>
        <div className="adm-chips" role="group" aria-label={t('admin.dicts.filter')}>
          <button type="button" className="adm-chip" aria-pressed={!all} data-testid="adm-dicts-active" onClick={() => setAll(false)}>
            {t('admin.dicts.fltActive')} <b>{rows.filter(r => r.is_active).length}</b>
          </button>
          <button type="button" className="adm-chip" aria-pressed={all} data-testid="adm-dicts-all" onClick={() => setAll(true)}>
            {t('admin.dicts.fltAll')} <b>{rows.length}</b>
          </button>
        </div>
        <p className="adm-hint">{t('admin.dicts.shown', { n: shown.length, total: rows.length })}</p>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={all ? t('admin.dicts.emptyH', { dt }) : t('admin.dicts.emptyActiveH', { dt })}
          hint={q ? t('admin.dicts.emptyQ') : t('admin.dicts.emptyB')} />
      ) : (
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-dicts">
            <caption className="sk-sr">{t('admin.dicts.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.dicts.col.code')}</th>
                <th scope="col">{t('admin.dicts.col.label')}</th>
                <th scope="col">{t('admin.dicts.col.look')}</th>
                <th scope="col">{t('admin.dicts.col.uses')}</th>
                <th scope="col">{t('admin.dicts.col.order')}</th>
                <th scope="col">{t('admin.dicts.col.active')}</th>
                <th scope="col"><span className="sk-sr">{t('admin.dicts.col.act')}</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const open = edit?.before?.code === r.code;
                return (
                  <DictRowView key={r.code} r={r} usage={data.usage} open={open}
                    onEdit={() => (open ? setEdit(null) : openEdit(r))} onReactivate={() => openEdit(r, true)}>
                    {open && edit && (
                      <DictForm dt={dt} before={edit.before} draft={edit.draft} usage={data.usage}
                        onDraft={d => setEdit({ before: edit.before, draft: d })} onCancel={() => setEdit(null)} onSaved={done}
                        fetchImpl={fetchImpl} />
                    )}
                  </DictRowView>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" data-testid="adm-dicts-add" onClick={() => openNew(rows.length)}>{t('admin.dicts.addValue')}</button>
      </div>
      {edit && edit.before === null && (
        <DictForm dt={dt} before={null} draft={edit.draft} usage={data.usage}
          onDraft={d => setEdit({ before: null, draft: d })} onCancel={() => setEdit(null)} onSaved={done} fetchImpl={fetchImpl} />
      )}
    </>
  );
}

function Chip({ color, icon, text }: { color: string | null; icon: string | null; text: string }) {
  // Цвет — значение справочника (токен темы или выражение на токенах), не литерал кода.
  return (
    <span className="adm-flag" data-dict-chip style={{ color: color ?? 'var(--t3)' }}>
      {icon ? <GameIcon slug={icon} size={12} /> : null} {text}
    </span>
  );
}

function UsageView({ cell }: { cell: UsageCell }) {
  const t = useAppT();
  if (cell.kind === 'n') return <span className={cell.n ? 'adm-mono' : 'adm-dim'} data-testid="adm-dict-uses" data-state="known">{cell.n}</span>;
  if (cell.kind === 'na') {
    return <span className="adm-dim" data-testid="adm-dict-uses" data-state="na" title={t('admin.dicts.usageNA')}>{t('admin.dicts.na')}</span>;
  }
  return <span className="adm-missing" data-testid="adm-dict-uses" data-state="unknown" title={cell.reason}>{t('admin.dicts.usageUnknown')}</span>;
}

function DictRowView({ r, usage, open, onEdit, onReactivate, children }: {
  r: DictRow; usage: AreaUsage; open: boolean; onEdit: () => void; onReactivate: () => void; children?: ReactNode;
}) {
  const t = useAppT();
  return (
    <>
      <tr data-testid={`adm-dict-${r.code}`} data-active={r.is_active} className={r.is_active ? undefined : 'adm-dim'}>
        <th scope="row"><span className="adm-mono">{r.code}</span></th>
        <td>
          {r.label_ru ?? <span className="adm-missing">—</span>}
          {r.label_en && <span className="adm-dim"> · {r.label_en}</span>}
        </td>
        <td><Chip color={r.color} icon={r.icon} text={r.label_ru ?? r.code} /></td>
        <td><UsageView cell={usageOf(r.dict_type, r.code, usage)} /></td>
        <td><span className="adm-mono">{r.sort_order ?? '—'}</span></td>
        <td>{r.is_active ? <GameIcon slug="tick" size={12} label={t('admin.dicts.on')} /> : <span className="adm-dim">{t('admin.dicts.off')}</span>}</td>
        <td>
          <span className="adm-field--btns">
            <button type="button" className="adm-btn" aria-expanded={open} onClick={onEdit}>
              {open ? t('admin.dicts.collapse') : t('admin.dicts.edit')}
            </button>
            {!r.is_active && <button type="button" className="adm-btn" onClick={onReactivate}>{t('admin.dicts.reactivate')}</button>}
          </span>
        </td>
      </tr>
      {children && <tr><td colSpan={7}>{children}</td></tr>}
    </>
  );
}

const FIELD_LABEL: Record<string, AppKey> = {
  code: 'admin.dicts.f.code', label_ru: 'admin.dicts.f.labelRu', label_en: 'admin.dicts.f.labelEn',
  color: 'admin.dicts.f.color', icon: 'admin.dicts.f.icon', sort_order: 'admin.dicts.f.order', is_active: 'admin.dicts.f.active',
};
const COLOR_LABEL: Record<(typeof DICT_COLOR_TOKENS)[number], AppKey> = {
  'var(--acc)': 'admin.dicts.color.acc', 'var(--suc)': 'admin.dicts.color.suc', 'var(--inf)': 'admin.dicts.color.inf',
  'var(--wrn)': 'admin.dicts.color.wrn', 'var(--dng)': 'admin.dicts.color.dng', 'var(--t2)': 'admin.dicts.color.t2',
};

function DictForm({ dt, before, draft, usage, onDraft, onCancel, onSaved, fetchImpl }: {
  dt: string; before: DictRow | null; draft: DictDraft; usage: AreaUsage;
  onDraft: (d: DictDraft) => void; onCancel: () => void; onSaved: () => void; fetchImpl?: typeof fetch;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = before === null;
  const set = <K extends keyof DictDraft>(k: K) => (v: DictDraft[K]) => onDraft({ ...draft, [k]: v });
  const iconOk = !draft.icon || hasGameIcon(draft.icon);
  const iconLike = draft.icon && !iconOk ? GAME_ICON_NAMES.filter(n => n.includes(draft.icon!.toLowerCase())).slice(0, 6) : [];
  const listId = `adm-dict-icons-${dt}`;
  const use = isNew ? null : usageOf(dt, draft.code, usage);
  const confirmNeeded = needsDictConfirm(dt, before, draft);

  const all = dictEntryDiff(before, draft).map(r => ({ ...r, text: t(FIELD_LABEL[r.id]) })) as DiffRow[];
  const changed = all.filter(r => r.kind !== 'same');
  const rows = changed.length ? changed : all;

  const apply = () => {
    if (busy) return;
    if (!draft.code.trim()) { setError(t('admin.dicts.codeRequired')); return; }
    setBusy(true);
    setError(null);
    saveDictEntry(dictEntryBody(dt, draft), fetchImpl).then(
      () => { setBusy(false); onSaved(); },
      (e: unknown) => { setBusy(false); setError(reasonOf(e)); },
    );
  };

  return (
    <div className="adm-card" data-testid="adm-dict-form">
      {!isNew && before && !before.is_active && draft.is_active && <p className="adm-note" data-tone="inf">{t('admin.dicts.reactivateNote')}</p>}
      <div className="adm-filters">
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.f.code')}</span>
          <input className="adm-input adm-mono" type="text" aria-label={t('admin.dicts.f.code')} value={draft.code} readOnly={!isNew}
            title={isNew ? undefined : t('admin.dicts.codeLocked')}
            onChange={e => { if (isNew) set('code')(e.target.value); }} />
          {!isNew && <span className="adm-hint">{t('admin.dicts.codeLocked')}</span>}
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.f.labelRu')}</span>
          <input className="adm-input" type="text" aria-label={t('admin.dicts.f.labelRu')} value={draft.label_ru ?? ''}
            onChange={e => set('label_ru')(e.target.value)} />
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.f.labelEn')}</span>
          <input className="adm-input" type="text" aria-label={t('admin.dicts.f.labelEn')} value={draft.label_en ?? ''}
            onChange={e => set('label_en')(e.target.value || null)} />
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.f.color')}</span>
          <select className="adm-select" aria-label={t('admin.dicts.f.color')}
            value={(DICT_COLOR_TOKENS as readonly string[]).includes(draft.color ?? '') ? draft.color! : '_custom'}
            onChange={e => { if (e.target.value !== '_custom') set('color')(e.target.value); }}>
            {DICT_COLOR_TOKENS.map(v => <option key={v} value={v}>{t(COLOR_LABEL[v])}</option>)}
            <option value="_custom">{t('admin.dicts.colorCustom')}</option>
          </select>
          <input className="adm-input adm-mono" type="text" aria-label={t('admin.dicts.colorCss')} value={draft.color ?? ''}
            placeholder="color-mix(in srgb, var(--acc) 55%, var(--inf))" onChange={e => set('color')(e.target.value || null)} />
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.f.icon')}</span>
          <input className="adm-input adm-mono" type="text" aria-label={t('admin.dicts.f.icon')} list={listId} value={draft.icon ?? ''}
            placeholder="tied-scroll" onChange={e => set('icon')(e.target.value || null)} />
          <datalist id={listId}>
            {(draft.icon ? GAME_ICON_NAMES.filter(n => n.includes(draft.icon!.toLowerCase())).slice(0, 20) : []).map(n => <option key={n} value={n} />)}
          </datalist>
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.dicts.f.order')}</span>
          <input className="adm-input adm-mono" type="number" aria-label={t('admin.dicts.f.order')} value={draft.sort_order ?? ''}
            onChange={e => set('sort_order')(e.target.value === '' ? null : Number(e.target.value))} />
        </label>
        <label className="adm-field adm-field--btns">
          <input type="checkbox" checked={draft.is_active} onChange={e => set('is_active')(e.target.checked)} />
          <span>{t('admin.dicts.f.active')}</span>
        </label>
      </div>
      <p className="adm-sub">
        <span className="adm-field__l">{t('admin.dicts.preview')}</span>
        <Chip color={draft.color} icon={draft.icon && iconOk ? draft.icon : null} text={draft.label_ru || draft.code || '—'} />
        {!iconOk && (
          <span className="adm-err" data-testid="adm-dict-icon-bad">
            {t('admin.dicts.iconBad')}{iconLike.length > 0 ? ` ${t('admin.dicts.iconMaybe', { list: iconLike.join(', ') })}` : ''}
          </span>
        )}
      </p>
      {use?.kind === 'n' && use.n > 0 && <p className="adm-note" data-tone="wrn">{t('admin.dicts.usageWarn', { n: use.n })}</p>}
      {use?.kind === 'unknown' && <p className="adm-note" data-tone="wrn">{t('admin.dicts.usageWarnUnknown')}</p>}
      {/* key: другое значение — новое поле слова; введённое для прежнего не переезжает. */}
      <DiffPreview key={`${dt}|${before?.code ?? '+'}`} rows={rows} onApply={apply} busy={busy} lang={lang}
        label={t('admin.dicts.diff')}
        confirm={confirmNeeded ? {
          word: (before?.code ?? draft.code).trim(),
          label: isCanonDict(dt)
            ? t('admin.dicts.confirmCanon', { code: (before?.code ?? draft.code).trim() })
            : t('admin.dicts.confirmDeact', { code: (before?.code ?? draft.code).trim() }),
        } : undefined} />
      {error && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-dict-save-error">{t('admin.dicts.saveError', { reason: error })}</p>}
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" onClick={onCancel}>{t('admin.dicts.cancel')}</button>
      </div>
    </div>
  );
}

// ── Теги (только чтение) ────────────────────────────────────────────────────

function TagsPane({ fetchImpl }: DictsScreenProps) {
  const t = useAppT();
  const res = useLoadState<{ rows: TagRow[]; truncated: boolean }>(s => fetchTags(s, fetchImpl), [fetchImpl], { rows: d => d.rows });
  const [q, setQ] = useState('');
  const [sort, setSort] = useUrlParam('adm-tags-sort');
  const alpha = sort === 'alpha';
  const data = res.data;
  if (res.state === 'loading' && !data) return <Skeleton lines={6} label={t('admin.tags.loading')} />;
  if (!data && isForbidden(res.state, res.error)) return <Forbidden reason={reasonOf(res.error)} />;
  if (!data) return <LoadError error={res.error} onRetry={res.reload} />;
  const ql = q.trim().toLowerCase();
  const shown = data.rows
    .filter(r => !ql || r.tag_id.toLowerCase().includes(ql))
    .sort((a, b) => (alpha ? a.tag_id.localeCompare(b.tag_id) : b.uses - a.uses || a.tag_id.localeCompare(b.tag_id)));
  return (
    <>
      <p className="adm-note" data-tone="inf" role="note">{t('admin.tags.note')}</p>
      {data.truncated && <p className="adm-note" data-tone="wrn" role="status">{t('admin.tags.truncated')}</p>}
      <div className="adm-filters">
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.tags.search')}</span>
          <input className="adm-input adm-mono" type="search" aria-label={t('admin.tags.search')} value={q}
            placeholder={t('admin.tags.searchPh')} onChange={e => setQ(e.target.value)} />
        </label>
        <div className="adm-chips" role="group" aria-label={t('admin.tags.sort')}>
          <button type="button" className="adm-chip" aria-pressed={!alpha} onClick={() => setSort(null, { replace: true })}>{t('admin.tags.byUses')}</button>
          <button type="button" className="adm-chip" aria-pressed={alpha} onClick={() => setSort('alpha', { replace: true })}>{t('admin.tags.byAlpha')}</button>
        </div>
        <p className="adm-hint">{t('admin.dicts.shown', { n: shown.length, total: data.rows.length })}</p>
      </div>
      {data.rows.length === 0 ? <EmptyState title={t('admin.tags.empty')} /> : (
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-tags">
            <caption className="sk-sr">{t('admin.dicts.tabTags')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.tags.col.tag')}</th>
                <th scope="col">{t('admin.dicts.col.uses')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.tag_id} data-tag={r.tag_id} className={r.uses === 0 ? 'adm-dim' : undefined}>
                  <th scope="row"><span className="adm-mono">{r.tag_id}</span></th>
                  <td>
                    <span className="adm-mono">{r.uses}</span>
                    {r.uses === 0 && <span className="adm-dim"> · {t('admin.tags.orphan')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
