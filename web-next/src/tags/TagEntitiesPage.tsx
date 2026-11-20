// Экран «сущности по тегу с полями» (SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE, прототип
// docs/prototypes/supertags-spike.html, экран 2). Данные — GET /lore/tag/entities: колонки-поля — объединение ключей
// с рёбер TAGGED_WITH этого тега (схемы у тега нет), фасеты с явным «не задано». Состояние — в адресе: ?tag, ?type, ?f.
// Правка полей ребра — из строки (patch на /lore/tag/apply, истории нет). Телефон — карточки, без горизонтальной
// прокрутки. Честные состояния: тег не выбран ≠ пусто ≠ не загрузилось.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, GameIcon, ICON_CANON, LoadError, Pill, Skeleton, useKitLang, useNarrow, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import { applyTag, fetchTagEntities, fetchTagSuggest, type TagRow, type TagTable } from './tagApi';
import type { TagSuggestion } from '@seidr/kit/content';
import './TagEntitiesPage.css';

export interface TagEntitiesPageProps {
  fetchImpl?: typeof fetch;
  win?: Window;
  narrow?: boolean;
  /** Внутри оболочки v2 (раздел «Теги»): h1 подписан id оболочки, корень — не второй <main>. */
  titleId?: string;
}

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; error: unknown };

const TYPE_KEY: Record<string, AppKey> = { adr: 'mdref.type.adr', decision: 'mdref.type.decision' };
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

function readParams(w: Window | undefined) {
  const p = new URLSearchParams(w?.location.search ?? '');
  return { tag: p.get('tag') ?? '', type: p.get('type') ?? '', f: p.get('f') ?? '' };
}

export function TagEntitiesPage({ fetchImpl, win, narrow, titleId }: TagEntitiesPageProps) {
  const lang = useKitLang();
  const t = (k: AppKey, v?: Record<string, string | number>) => appT(lang, k, v);
  const isNarrow = useNarrow(narrow);
  const w = win ?? (typeof window === 'undefined' ? undefined : window);
  const [params, setParams] = useState(() => readParams(w));
  const [table, setTable] = useState<Load<TagTable>>({ state: 'idle' });
  const [tags, setTags] = useState<Load<TagSuggestion[]>>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);

  const setUrl = useCallback((patch: Partial<typeof params>) => {
    setParams(prev => {
      const next = { ...prev, ...patch };
      if (w) {
        const p = new URLSearchParams(w.location.search);
        for (const [k, v] of Object.entries(next)) if (v) p.set(k, v); else p.delete(k);
        const q = p.toString();
        w.history.replaceState(null, '', `${w.location.pathname}${q ? `?${q}` : ''}${w.location.hash}`);
      }
      return next;
    });
  }, [w]);

  useEffect(() => {
    let live = true;
    fetchTagSuggest('', { fetchImpl }).then(d => live && setTags({ state: 'ok', data: d }), e => live && setTags({ state: 'error', error: e }));
    return () => { live = false; };
  }, [fetchImpl]);

  useEffect(() => {
    if (!params.tag) { setTable({ state: 'idle' }); return; }
    let live = true;
    setTable({ state: 'loading' });
    fetchTagEntities(params.tag, params.type || null, { fetchImpl }).then(
      d => live && setTable({ state: 'ok', data: d }),
      e => live && setTable({ state: 'error', error: e }),
    );
    return () => { live = false; };
  }, [params.tag, params.type, fetchImpl, reload]);

  const [fKey, fVal] = useMemo(() => {
    const i = params.f.indexOf(':');
    return i > 0 ? [params.f.slice(0, i), params.f.slice(i + 1)] : ['', ''];
  }, [params.f]);
  const rows = useMemo(() => {
    if (table.state !== 'ok') return [];
    if (!fKey) return table.data.rows;
    return table.data.rows.filter(r => (fVal === '' ? !r.fields[fKey] : r.fields[fKey] === fVal));
  }, [table, fKey, fVal]);

  const Root = titleId ? 'div' : 'main';
  const headId = titleId ?? 'tg-title';
  return (
    <Root className={titleId ? 'tg tg--in-shell' : 'tg'} aria-labelledby={headId}>
      <header className="tg__head">
        <h1 id={headId} className="tg__title">{t('tags.title')}</h1>
        <p className="tg__lead">{t('tags.lead')}</p>
      </header>

      <section className="tg__bar" aria-label={t('tags.pick')}>
        <span className="tg__label">{t('tags.pick')}</span>
        {tags.state === 'loading' && <span className="tg__muted">{t('tags.loadingTags')}</span>}
        {tags.state === 'error' && <span className="tg__err" role="status">{t('tags.suggestError')}: {String((tags.error as Error)?.message ?? tags.error)}</span>}
        {tags.state === 'ok' && tags.data.length === 0 && <span className="tg__muted">{t('tags.noTags')}</span>}
        {tags.state === 'ok' && tags.data.map(x => (
          <Pill key={x.tag} variant="filter" pressed={x.tag === params.tag} onToggle={() => { setEditing(null); setUrl({ tag: x.tag, f: '', type: '' }); }}>
            {`#${x.tag} · ${x.uses}`}
          </Pill>
        ))}
      </section>

      {!params.tag ? (
        <EmptyState title={t('tags.pickTitle')} hint={t('tags.pickHint')} />
      ) : table.state === 'loading' || table.state === 'idle' ? (
        <Skeleton lines={5} label={t('tags.loading')} />
      ) : table.state === 'error' ? (
        <LoadError error={table.error} title={t('tags.error')} hint={t('tags.errorHint')} onRetry={() => setReload(n => n + 1)} />
      ) : table.data.rows.length === 0 ? (
        <EmptyState title={t('tags.empty', { tag: params.tag })} hint={t('tags.emptyHint')} />
      ) : (
        <>
          <section className="tg__bar" aria-label={t('tags.typeLabel')}>
            <span className="tg__label">{t('tags.typeLabel')}</span>
            <Pill variant="filter" pressed={!params.type} onToggle={() => setUrl({ type: '' })}>{t('tags.typeAll')}</Pill>
            {Object.entries(table.data.types).map(([ty, n]) => (
              <Pill key={ty} variant="filter" pressed={params.type === ty} onToggle={() => setUrl({ type: params.type === ty ? '' : ty })}>
                {`${typeLabel(lang, ty)} · ${n}`}
              </Pill>
            ))}
          </section>
          <section className="tg__facets" aria-label={t('tags.facets')}>
            {table.data.columns.map(c => {
              const fc = table.data.facets[c.key];
              if (!fc) return null;
              const val = (v: string) => `${c.key}:${v}`;
              return (
                <div key={c.key} className="tg__facet">
                  {fc.values.map(v => (
                    <Pill key={v.value} variant="filter" pressed={params.f === val(v.value)} onToggle={() => setUrl({ f: params.f === val(v.value) ? '' : val(v.value) })}>
                      {`${c.key}: ${v.value} · ${v.count}`}
                    </Pill>
                  ))}
                  {fc.empty > 0 && (
                    <Pill variant="filter" pressed={params.f === val('')} onToggle={() => setUrl({ f: params.f === val('') ? '' : val('') })}>
                      {`${c.key}: ${t('tags.facetEmpty')} · ${fc.empty}`}
                    </Pill>
                  )}
                  {fc.truncated && <span className="tg__muted">{t('tags.facetTruncated')}</span>}
                </div>
              );
            })}
          </section>
          {fKey && <p className="tg__muted">{t('tags.filtered', { n: rows.length, total: table.data.rows.length })}</p>}
          {isNarrow ? (
            <div className="tg__cards">
              {rows.map(r => (
                <article key={`${r.type}:${r.id}`} className="tg-card">
                  <RowHead r={r} lang={lang} />
                  <dl className="tg-card__fields">
                    {table.data.columns.map(c => (
                      <div key={c.key} className="tg-card__f"><dt>{c.key}</dt><dd>{r.fields[c.key] ?? '—'}</dd></div>
                    ))}
                  </dl>
                  <RowEdit r={r} tag={params.tag} keys={table.data.columns.map(c => c.key)} open={editing === r.id}
                    onOpen={() => setEditing(editing === r.id ? null : r.id)} onSaved={() => { setEditing(null); setReload(n => n + 1); }} fetchImpl={fetchImpl} lang={lang} />
                </article>
              ))}
            </div>
          ) : (
            <div className="tg__tbl">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('tags.colRecord')}</th>
                    <th scope="col">{t('tags.colType')}</th>
                    {table.data.columns.map(c => <th key={c.key} scope="col" className="tg__th-f">{c.key}</th>)}
                    <th scope="col">{t('tags.colTagged')}</th>
                    <th scope="col"><span className="tg__sr">{t('tags.edit')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={`${r.type}:${r.id}`}>
                      <td><RowHead r={r} lang={lang} /></td>
                      <td><Pill variant="id">{r.type}</Pill></td>
                      {table.data.columns.map(c => <td key={c.key}>{r.fields[c.key] ?? <span className="tg__muted">—</span>}</td>)}
                      <td className="tg__mono">{(r.tagged_at ?? '').slice(0, 10) || '—'}</td>
                      <td>
                        <RowEdit r={r} tag={params.tag} keys={table.data.columns.map(c => c.key)} open={editing === r.id}
                          onOpen={() => setEditing(editing === r.id ? null : r.id)} onSaved={() => { setEditing(null); setReload(n => n + 1); }} fetchImpl={fetchImpl} lang={lang} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="tg__note">{t('tags.colsNote')}</p>
        </>
      )}
    </Root>
  );
}

function typeLabel(lang: KitLang, ty: string): string {
  const k = TYPE_KEY[ty];
  return k ? appT(lang, k) : ty;
}

function RowHead({ r }: { r: TagRow; lang: KitLang }) {
  const href = recordHref(r.type, r.id);
  return (
    <span className="tg__rec">
      {href ? <a className="tg__id" href={href}>{r.id}</a> : <span className="tg__id">{r.id}</span>}
      {r.title && <span className="tg__ttl">{r.title}</span>}
    </span>
  );
}

/** Правка полей ребра записи → тег: patch (пустое снимает поле), истории нет; одно новое поле «ключ = значение». */
function RowEdit({ r, tag, keys, open, onOpen, onSaved, fetchImpl, lang }: {
  r: TagRow; tag: string; keys: string[]; open: boolean;
  onOpen: () => void; onSaved: () => void; fetchImpl?: typeof fetch; lang: KitLang;
}) {
  const t = (k: AppKey, v?: Record<string, string | number>) => appT(lang, k, v);
  const [values, setValues] = useState<Record<string, string>>({});
  const [nk, setNk] = useState('');
  const [nv, setNv] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { if (open) { setValues({ ...r.fields }); setNk(''); setNv(''); setFailed(null); } }, [open, r.fields]);
  const keyBad = nk !== '' && !KEY_RE.test(nk);
  const save = async () => {
    const patch: Record<string, string | null> = {};
    for (const k of keys) {
      const before = r.fields[k] ?? '';
      const after = (values[k] ?? '').trim();
      if (after !== before) patch[k] = after === '' ? null : after;
    }
    if (nk && !keyBad && nv.trim()) patch[nk] = nv.trim();
    setBusy(true); setFailed(null);
    try {
      await applyTag({ type: r.type, id: r.id, tag, fields: patch }, { fetchImpl });
      onSaved();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="tg-edit">
      <button type="button" className="tg__btn" aria-expanded={open} aria-label={`${t('tags.edit')} · ${r.id}`} onClick={onOpen}>
        <GameIcon slug={ICON_CANON.ctlEdit} size={13} /> <span className="tg__btn-t">{t('tags.edit')}</span>
      </button>
      {open && (
        <div className="tg-edit__form" role="group" aria-label={`#${tag} → ${r.id}`}>
          {keys.map(k => (
            <label key={k} className="tg-edit__row">
              <span className="tg-edit__k">{k}</span>
              <input aria-label={k} value={values[k] ?? ''} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} />
            </label>
          ))}
          <div className="tg-edit__row tg-edit__row--new">
            <input aria-label={t('tags.newField')} placeholder={t('tags.newField')} value={nk} onChange={e => setNk(e.target.value)} />
            <input aria-label={t('tags.newValue')} placeholder={t('tags.newValue')} value={nv} onChange={e => setNv(e.target.value)} />
          </div>
          {keyBad && <p className="tg__err">{t('tags.keyBad')}</p>}
          <p className="tg__note">{t('tags.editHint')}</p>
          {failed && <p className="tg__err" role="alert">{t('tags.saveFailed', { reason: failed })}</p>}
          <div className="tg-edit__btns">
            <button type="button" className="tg__btn" onClick={onOpen} disabled={busy}>{t('tags.cancel')}</button>
            <button type="button" className="tg__btn tg__btn--pri" onClick={() => void save()} disabled={busy || keyBad}>{busy ? t('tags.saving') : t('tags.save')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TagEntitiesPage;
