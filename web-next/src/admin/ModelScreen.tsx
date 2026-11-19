// Экран «Модель» админки v2 (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
// Прототип docs/prototypes/mc-06-model-screen.html (c20f9530) согласован владелицей 18.11.2026;
// 19.11: «экран то почему переделывать если он универсальный» — строится на модели 1.18 как есть.
//
// Вкладки Типы / Меню и видимость / Гигиена / История; вкладка и тип — в адресе (?mtab=, ?mtype=).
// Правится: подпись, группа, видимость, порядок. Только чтение: вид поля и свойство схемы — их
// расхождение ловит проверка согласованности сервера (MC-03/MC-05), а не редактор.
// Порядок правки: правка → дифф → «Проверить» (PUT dry_run; 422 — причина словами сервера) →
// «Применить…» с обязательным «что и зачем» → новая версия. Откат — новая версия с содержимым старой.
// Элементы — Seiðr kit: Tabs, Pill, DiffPreview, Sheet, GameIcon, Skeleton/Forbidden/LoadError/EmptyState.
import { useMemo, useState } from 'react';
import {
  DiffPreview, EmptyState, Forbidden, GameIcon, LoadError, Pill, Sheet, Skeleton, Tabs,
  useKitLang, useLoadState, useUrlParam, type DiffRow,
} from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  FIELD_GROUPS, fetchModelConfig, fetchModelHistory, fetchModelSchema, fetchModelVersion, modelDiff, modelHygiene,
  modelTypes, moveField, navRows, rollbackRequest, saveModel, setAudience, setFieldProp, typeList,
  type Audience, type ModelChange, type ModelConfig, type ModelDoc, type ModelVersion, type SaveAnswer, type SaveRequest,
  type SchemaInfo,
} from './model';
import './Admin.css';

export interface ModelScreenProps {
  fetchImpl?: typeof fetch;
}

const TABS = ['types', 'nav', 'hyg', 'hist'] as const;
type Tab = (typeof TABS)[number];

const reasonOf = (e: unknown) =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : undefined;

interface Loaded { cfg: ModelConfig; schema: SchemaInfo }

/** Схема не прочиталась — экран всё равно работает, а гигиена говорит «не смогли проверить». */
async function loadAll(signal: AbortSignal, fetchImpl?: typeof fetch): Promise<Loaded> {
  const [cfg, schema] = await Promise.all([
    fetchModelConfig({ signal, fetchImpl }),
    fetchModelSchema({ signal, fetchImpl }).catch((e: unknown): SchemaInfo => ({ types: null, reason: reasonOf(e) ?? 'error' })),
  ]);
  return { cfg, schema };
}

export function ModelScreen({ fetchImpl }: ModelScreenProps) {
  const t = useAppT();
  const res = useLoadState<Loaded>(signal => loadAll(signal, fetchImpl), [fetchImpl]);
  let body;
  if (res.state === 'loading' && !res.data) body = <Skeleton lines={8} label={t('admin.model.loading')} />;
  else if (res.state === 'forbidden') body = <div data-testid="adm-model-forbidden"><Forbidden reason={reasonOf(res.error)} /></div>;
  else if (res.state === 'error' || !res.data) body = <LoadError error={res.error} onRetry={res.reload} />;
  else body = <ModelEditor key={res.data.cfg.hash ?? ''} data={res.data} fetchImpl={fetchImpl} onSaved={res.reload} />;
  return (
    <section className="adm" aria-labelledby="adm-model-h" data-testid="adm-model">
      <h2 id="adm-model-h" className="adm-h">{t('admin.model.title')}</h2>
      <p className="adm-lead">{t('admin.model.lead')}</p>
      {body}
    </section>
  );
}

type Check =
  | { state: 'idle' }
  | { state: 'busy' }
  | { state: 'ok' }
  | { state: 'bad'; problems: string[] }
  | { state: 'conflict' }
  | { state: 'error'; reason: string };

/** Что применяем: правку экрана или откат к версии. */
interface Pending { kind: 'edit' | 'rollback'; content: string; when?: string }

function ModelEditor({ data, fetchImpl, onSaved }: { data: Loaded; fetchImpl?: typeof fetch; onSaved: () => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const { cfg, schema } = data;
  const [tabParam, setTab] = useUrlParam('mtab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'types';
  const [draft, setDraft] = useState<ModelDoc>(cfg.doc);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [pending, setPending] = useState<Pending | null>(null);
  const [why, setWhy] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const changes = useMemo(() => modelDiff(cfg.doc, draft), [cfg.doc, draft]);
  const hygiene = useMemo(() => modelHygiene(cfg.doc, schema, cfg), [cfg, schema]);
  const typesCount = modelTypes(cfg.doc).length;

  const edit = (next: ModelDoc) => { setDraft(next); setCheck({ state: 'idle' }); };

  const run = async (req: SaveRequest): Promise<SaveAnswer | null> => {
    try { return await saveModel(req, fetchImpl); }
    catch (e) { setCheck({ state: 'error', reason: reasonOf(e) ?? 'error' }); return null; }
  };
  const verdict = (a: SaveAnswer | null) => {
    if (a === null) return;
    if (a.kind === 'inconsistent') setCheck({ state: 'bad', problems: a.problems });
    else if (a.kind === 'conflict') setCheck({ state: 'conflict' });
    else setCheck({ state: 'ok' });
  };

  const dryRun = async () => {
    setCheck({ state: 'busy' });
    verdict(await run({ content: JSON.stringify(draft), dry_run: true, expected_hash: cfg.hash ?? undefined }));
  };

  const openApply = (p: Pending) => { setPending(p); setWhy(''); setApplyError(null); };

  const apply = async () => {
    if (!pending || !why.trim()) return;
    setApplyBusy(true);
    setApplyError(null);
    const req = pending.kind === 'rollback'
      ? rollbackRequest(pending.content, cfg.hash, { when: pending.when ?? '', why }, false)
      : { content: pending.content, dry_run: false, reason: why.trim(), expected_hash: cfg.hash ?? undefined };
    try {
      const a = await saveModel(req, fetchImpl);
      if (a.kind === 'ok') { setPending(null); onSaved(); return; }
      setApplyError(a.kind === 'conflict' ? t('admin.model.conflict') : a.problems.join('; '));
    } catch (e) {
      setApplyError(reasonOf(e) ?? 'error');
    } finally {
      setApplyBusy(false);
    }
  };

  const items = [
    { id: 'types', label: t('admin.model.tab.types'), count: typesCount },
    { id: 'nav', label: t('admin.model.tab.nav') },
    { id: 'hyg', label: t('admin.model.tab.hyg'), count: hygiene.length },
    { id: 'hist', label: t('admin.model.tab.hist') },
  ];

  return (
    <>
      <div className="adm-model-bar" data-testid="adm-model-bar">
        <span className="adm-mono" title={cfg.hash ?? undefined}>{t('admin.model.version')} <b>{(cfg.hash ?? '—').slice(0, 10)}</b></span>
        <Pill tone={cfg.source === 'lore' ? 'suc' : 'wrn'}>{cfg.source === 'lore' ? t('admin.model.src.lore') : t('admin.model.src.file')}</Pill>
        {cfg.seedDrift && <Pill tone="dng">DRIFTED</Pill>}
        <span className="adm-model-bar__grow" />
        {changes.length > 0 && <span data-testid="adm-model-dirty"><Pill tone="wrn">{t('admin.model.dirty', { n: changes.length })}</Pill></span>}
        <button type="button" className="adm-btn" data-testid="adm-model-check" disabled={changes.length === 0 || check.state === 'busy'} onClick={dryRun}>
          {t('admin.model.check')}
        </button>
        <button type="button" className="adm-btn" data-tone="acc" data-testid="adm-model-apply" disabled={check.state !== 'ok' || changes.length === 0}
          onClick={() => openApply({ kind: 'edit', content: JSON.stringify(draft) })}>
          {t('admin.model.apply')}
        </button>
        <button type="button" className="adm-btn" data-testid="adm-model-reset" disabled={changes.length === 0} onClick={() => edit(cfg.doc)}>
          {t('admin.model.reset')}
        </button>
      </div>
      {cfg.warning && <p className="adm-note" data-tone="dng" role="status">{cfg.warning}</p>}

      <div className="adm-model-body" data-diff={changes.length > 0 ? '' : undefined}>
        <div className="adm-model-main">
          <Tabs label={t('admin.model.tabs')} value={tab} onChange={id => setTab(id === 'types' ? null : id)} items={items}>
            {tab === 'types' && <TypesTab doc={draft} base={cfg.doc} schema={schema} onEdit={edit} />}
            {tab === 'nav' && <NavTab doc={draft} base={cfg.doc} onEdit={edit} />}
            {tab === 'hyg' && <HygieneTab rows={hygiene} />}
            {tab === 'hist' && <HistoryTab cfg={cfg} fetchImpl={fetchImpl} onRollback={openApply} />}
          </Tabs>
        </div>
        {changes.length > 0 && (
          <aside className="adm-model-diff" aria-label={t('admin.model.diff')} data-testid="adm-model-diff">
            <DiffPreview rows={diffRows(changes)} lang={lang} label={t('admin.model.diff')} />
            <CheckOut check={check} />
          </aside>
        )}
      </div>

      <Sheet open={pending !== null} onClose={() => setPending(null)}
        title={pending?.kind === 'rollback' ? t('admin.model.rollbackTitle', { when: pending.when ?? '' }) : t('admin.model.applyTitle')}>
        <div className="adm-model-sheet" data-testid="adm-model-sheet">
          <p className="adm-dim">{pending?.kind === 'rollback' ? t('admin.model.rollbackBody') : t('admin.model.applyBody', { n: changes.length })}</p>
          <label className="adm-field">
            <span className="adm-field__l">{t('admin.model.why')}</span>
            <input className="adm-input" data-testid="adm-model-why" value={why} placeholder={t('admin.model.whyHint')}
              onChange={e => setWhy(e.target.value)} />
          </label>
          {applyError && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-model-apply-error">{applyError}</p>}
          <div className="adm-danger__btns">
            <button type="button" className="adm-btn" onClick={() => setPending(null)}>{t('admin.model.cancel')}</button>
            <button type="button" className="adm-btn" data-tone="acc" data-testid="adm-model-apply-ok" disabled={!why.trim() || applyBusy} onClick={apply}>
              {t('admin.model.applyOk')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function diffRows(changes: readonly ModelChange[]): DiffRow[] {
  return changes.map(c => c.from && c.to
    ? { id: c.path, kind: 'change' as const, text: c.path, from: c.from, to: c.to, check: { state: 'checked' as const } }
    : { id: c.path, kind: c.to ? 'add' as const : 'remove' as const, text: c.path, detail: c.to || c.from, check: { state: 'checked' as const } });
}

function CheckOut({ check }: { check: Check }) {
  const t = useAppT();
  if (check.state === 'idle') return <p className="adm-dim" data-testid="adm-model-check-out" data-state="idle">{t('admin.model.checkHint')}</p>;
  if (check.state === 'busy') return <p className="adm-dim" data-testid="adm-model-check-out" data-state="busy">{t('admin.model.checking')}</p>;
  if (check.state === 'ok') return <p className="adm-note" data-tone="inf" role="status" data-testid="adm-model-check-out" data-state="ok">{t('admin.model.checkOk')}</p>;
  if (check.state === 'conflict') return <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-model-check-out" data-state="conflict">{t('admin.model.conflict')}</p>;
  if (check.state === 'error') return <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-model-check-out" data-state="error">{t('admin.model.checkError', { reason: check.reason })}</p>;
  return (
    <div className="adm-note" data-tone="dng" role="alert" data-testid="adm-model-check-out" data-state="bad">
      <b>422 MODEL_INCONSISTENT</b>
      <ul className="adm-plist">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>
    </div>
  );
}

// ── Типы ─────────────────────────────────────────────────────────────

function TypesTab({ doc, base, schema, onEdit }: { doc: ModelDoc; base: ModelDoc; schema: SchemaInfo; onEdit: (d: ModelDoc) => void }) {
  const t = useAppT();
  const [sel, setSel] = useUrlParam('mtype');
  const [q, setQ] = useState('');
  const types = modelTypes(doc);
  const baseTypes = modelTypes(base);
  const groups = typeList(doc);
  const cur = types.find(x => x.type === sel) ?? types[0];
  const needle = q.trim().toLowerCase();
  const match = (type: string) => {
    if (!needle) return true;
    const ty = types.find(x => x.type === type);
    return !!ty && (ty.type.includes(needle) || ty.label.toLowerCase().includes(needle)
      || ty.fields.some(f => String(f.key).toLowerCase().includes(needle) || String(f.label ?? '').toLowerCase().includes(needle)));
  };
  if (!cur) return <EmptyState title={t('admin.model.noTypes')} />;
  const baseFields = baseTypes.find(x => x.type === cur.type)?.fields ?? [];
  const sch = schema.types?.[cur.type];
  return (
    <div className="adm-model-types">
      <nav className="adm-model-side" aria-label={t('admin.model.typesNav')}>
        <input className="adm-input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('admin.model.search')}
          aria-label={t('admin.model.search')} data-testid="adm-model-search" />
        {groups.map(g => {
          const shown = g.types.filter(match);
          if (!shown.length) return null;
          return (
            <div key={g.group ?? '_'}>
              <div className="adm-field__l">{g.labelKey ? t(g.labelKey as AppKey) : t('admin.model.otherGroup')}</div>
              {shown.map(type => {
                const ty = types.find(x => x.type === type)!;
                return (
                  <button key={type} type="button" className="adm-model-side__a" aria-pressed={type === cur.type}
                    data-testid={`adm-model-type-${type}`} onClick={() => setSel(type)}>
                    <GameIcon slug={ty.icon} size={12} /> {ty.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="adm-model-typebody">
        <div className="adm-dim">{t('admin.model.typeKind')} · <span className="adm-mono">{cur.type}</span></div>
        <h3 className="adm-model-h1">{cur.label}</h3>
        <p className="adm-sub">
          {cur.childOnly && <Pill>{t('admin.model.childOnly')}</Pill>}
          {sch === undefined && <Pill tone="wrn">{t('admin.model.schemaUnknown')}</Pill>}
        </p>
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-model-fields">
            <thead>
              <tr>
                <th scope="col">{t('admin.model.col.key')}</th>
                <th scope="col">{t('admin.model.col.label')}</th>
                <th scope="col">{t('admin.model.col.kind')}</th>
                <th scope="col">{t('admin.model.col.group')}</th>
                <th scope="col">{t('admin.model.col.property')}</th>
                <th scope="col">{t('admin.model.col.order')}</th>
              </tr>
            </thead>
            <tbody>
              {cur.fields.map((f, i) => {
                const key = String(f.key ?? '');
                const was = baseFields.find(b => b.key === key);
                const changed = !was || was.label !== f.label || was.group !== f.group || baseFields.indexOf(was) !== i;
                const sf = sch?.fields[key];
                return (
                  <tr key={key} data-testid={`adm-model-field-${key}`} data-changed={changed ? '' : undefined}>
                    <th scope="row"><span className="adm-mono">{key}</span></th>
                    <td>
                      <input className="adm-input" value={String(f.label ?? '')} aria-label={t('admin.model.col.label') + ' ' + key}
                        onChange={e => onEdit(setFieldProp(doc, cur.type, key, 'label', e.target.value))} />
                    </td>
                    <td className="adm-dim">{String(f.kind ?? '')}</td>
                    <td>
                      <select className="adm-select" value={String(f.group ?? '')} aria-label={t('admin.model.col.group') + ' ' + key}
                        onChange={e => onEdit(setFieldProp(doc, cur.type, key, 'group', e.target.value))}>
                        {[...new Set([...FIELD_GROUPS, String(f.group ?? '')])].filter(Boolean).map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td className="adm-mono">
                      {sch === undefined ? <span className="adm-missing">{t('admin.model.schemaUnknownShort')}</span>
                        : sf?.property ? `${sf.property} · ${sf.propertyType ?? '?'}`
                          : sf?.source === 'EDGE' ? t('admin.model.viaEdge')
                            : <span className="adm-missing">{t('admin.model.noProperty')}</span>}
                    </td>
                    <td className="adm-model-order">
                      <button type="button" className="adm-btn" aria-label={t('admin.model.up', { key })} disabled={i === 0}
                        onClick={() => onEdit(moveField(doc, cur.type, key, -1))}>↑</button>
                      <button type="button" className="adm-btn" aria-label={t('admin.model.down', { key })} disabled={i === cur.fields.length - 1}
                        onClick={() => onEdit(moveField(doc, cur.type, key, 1))}>↓</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="adm-dim">{t('admin.model.legend')}</p>
      </div>
    </div>
  );
}

// ── Меню и видимость ─────────────────────────────────────────────────

function NavTab({ doc, base, onEdit }: { doc: ModelDoc; base: ModelDoc; onEdit: (d: ModelDoc) => void }) {
  const t = useAppT();
  const rows = navRows(doc);
  const baseRows = navRows(base);
  const types = modelTypes(doc);
  const name = (section: string) => types.find(x => x.type === section)?.label ?? section;
  return (
    <>
      <p className="adm-dim">{t('admin.model.navLead')}</p>
      <div className="adm-tablewrap">
        <table className="adm-table" data-testid="adm-model-nav">
          <thead>
            <tr>
              <th scope="col">{t('admin.model.col.navGroup')}</th>
              <th scope="col">{t('admin.model.col.section')}</th>
              <th scope="col">{t('admin.model.col.level')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const was = baseRows.find(b => b.section === r.section)?.audience;
              return (
                <tr key={`${r.group}/${r.section}`} data-testid={`adm-model-nav-${r.section}`} data-changed={was !== r.audience ? '' : undefined}>
                  <td className="adm-dim">{r.labelKey ? t(r.labelKey as AppKey) : r.group}</td>
                  <td>{name(r.section)} <span className="adm-mono">{r.section}</span></td>
                  <td>
                    <span className="adm-chips" role="radiogroup" aria-label={t('admin.model.col.level') + ' ' + r.section}>
                      {(['everywhere', 'admin'] as Audience[]).map(lv => (
                        <button key={lv} type="button" role="radio" className="adm-chip" aria-checked={r.audience === lv} aria-pressed={r.audience === lv}
                          data-testid={`adm-model-aud-${r.section}-${lv}`} onClick={() => onEdit(setAudience(doc, r.section, lv))}>
                          {t(lv === 'admin' ? 'admin.model.aud.admin' : 'admin.model.aud.everywhere')}
                        </button>
                      ))}
                      {r.audience === null && <span className="adm-missing">{t('admin.model.aud.none')}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Гигиена ──────────────────────────────────────────────────────────

const HYG_TONE = { unverified: 'dng', fileFallback: 'dng', drifted: 'dng', undeclared: 'wrn', unclassified: 'wrn', badGroup: 'dng', emptyNav: 't2' } as const;

function HygieneTab({ rows }: { rows: ReturnType<typeof modelHygiene> }) {
  const t = useAppT();
  const [, setTab] = useUrlParam('mtab');
  const [, setType] = useUrlParam('mtype');
  if (rows.length === 0) return <div data-testid="adm-model-hyg-empty"><EmptyState title={t('admin.model.hyg.clean')} /></div>;
  return (
    <div className="adm-tablewrap">
      <table className="adm-table" data-testid="adm-model-hyg">
        <thead>
          <tr>
            <th scope="col">{t('admin.model.col.class')}</th>
            <th scope="col">{t('admin.model.col.where')}</th>
            <th scope="col">{t('admin.model.col.todo')}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.kind}:${r.where}`} data-kind={r.kind}>
              <td><Pill tone={HYG_TONE[r.kind]}>{t(`admin.model.hyg.k.${r.kind}` as AppKey)}</Pill></td>
              <td className="adm-mono">{r.where}</td>
              <td>{t(`admin.model.hyg.d.${r.kind}` as AppKey, { detail: r.detail ?? '' })}</td>
              <td>
                {r.type && (
                  <button type="button" className="adm-btn" onClick={() => { setTab(null); setType(r.type!); }}>{t('admin.model.hyg.toType')}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── История ──────────────────────────────────────────────────────────

function HistoryTab({ cfg, fetchImpl, onRollback }: { cfg: ModelConfig; fetchImpl?: typeof fetch; onRollback: (p: Pending) => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const res = useLoadState<ModelVersion[]>(signal => fetchModelHistory({ signal, fetchImpl }), [fetchImpl]);
  const [open, setOpen] = useState<{ uid: string; content: string; when: string } | null>(null);
  const [verdict, setVerdict] = useState<{ uid: string; check: Check } | null>(null);

  if (res.state === 'loading' && !res.data) return <Skeleton lines={4} label={t('admin.model.hist.loading')} />;
  if (res.state === 'forbidden') return <Forbidden reason={reasonOf(res.error)} />;
  if (res.state === 'error' || !res.data) return <LoadError error={res.error} onRetry={res.reload} />;
  const rows = res.data;
  if (rows.length === 0) return <div data-testid="adm-model-hist-empty"><EmptyState title={t('admin.model.hist.empty')} hint={t('admin.model.hist.emptyHint')} /></div>;

  const whenOf = (iso: string | null) => kitMinute(iso)?.text ?? t('admin.model.hist.noTime');
  const show = async (v: ModelVersion) => {
    setVerdict(null);
    try { setOpen({ uid: v.state_uid, content: await fetchModelVersion(v.state_uid, { fetchImpl }), when: whenOf(v.valid_from) }); }
    catch (e) { setVerdict({ uid: v.state_uid, check: { state: 'error', reason: reasonOf(e) ?? 'error' } }); }
  };
  const tryRollback = async (v: ModelVersion) => {
    const when = whenOf(v.valid_from);
    setVerdict({ uid: v.state_uid, check: { state: 'busy' } });
    try {
      const content = await fetchModelVersion(v.state_uid, { fetchImpl });
      const a = await saveModel(rollbackRequest(content, cfg.hash, { when, why: '' }, true), fetchImpl);
      if (a.kind === 'ok') { setVerdict({ uid: v.state_uid, check: { state: 'ok' } }); onRollback({ kind: 'rollback', content, when }); }
      else setVerdict({ uid: v.state_uid, check: a.kind === 'conflict' ? { state: 'conflict' } : { state: 'bad', problems: a.problems } });
    } catch (e) {
      setVerdict({ uid: v.state_uid, check: { state: 'error', reason: reasonOf(e) ?? 'error' } });
    }
  };

  return (
    <div data-testid="adm-model-hist">
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">{t('admin.col.since')}</th>
              <th scope="col">{t('admin.col.author')}</th>
              <th scope="col">{t('admin.model.col.reason')}</th>
              <th scope="col">{t('admin.col.hash')}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map(v => {
              const current = v.valid_to === null;
              return (
                <tr key={v.state_uid} data-testid={`adm-model-ver-${v.state_uid}`} data-current={current ? '' : undefined}>
                  <td className="adm-mono">{whenOf(v.valid_from)}</td>
                  <td>{v.changed_by ?? <span className="adm-missing">{t('admin.model.hist.noAuthor')}</span>}</td>
                  <td>{v.reason ?? <span className="adm-missing">—</span>}</td>
                  <td className="adm-mono">{(v.content_hash ?? '—').slice(0, 10)}</td>
                  <td className="adm-model-order">
                    {current ? <Pill tone="suc">{t('admin.model.hist.current')}</Pill> : (
                      <>
                        <button type="button" className="adm-btn" data-testid={`adm-model-verdiff-${v.state_uid}`} onClick={() => show(v)}>{t('admin.model.hist.diff')}</button>
                        <button type="button" className="adm-btn adm-btn--dng" data-testid={`adm-model-rollback-${v.state_uid}`} onClick={() => tryRollback(v)}>{t('admin.model.hist.rollback')}</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {verdict && verdict.check.state !== 'ok' && <CheckOut check={verdict.check} />}
      {open && (
        <div className="adm-access" data-testid="adm-model-verdiff">
          <h3 className="adm-access__h">{t('admin.model.hist.diffTitle', { when: open.when })}</h3>
          {(() => {
            let rows2: ModelChange[];
            try { rows2 = modelDiff(cfg.doc, JSON.parse(open.content)); }
            catch { return <p className="adm-note" data-tone="dng" role="alert">{t('admin.model.hist.badJson')}</p>; }
            return rows2.length === 0 ? <p className="adm-dim">{t('admin.model.hist.same')}</p>
              : <DiffPreview rows={diffRows(rows2)} lang={lang} label={t('admin.model.hist.diffTitle', { when: open.when })} />;
          })()}
        </div>
      )}
      <p className="adm-dim">{t('admin.model.hist.note')}</p>
    </div>
  );
}
