// Экран «Модель» админки v2 (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
// Прототип v4 — docs/prototypes/mc-06-model-screen.html из 9ed3c814 (ветка proto/mc-06-phone),
// согласован владелицей 18.11.2026: «прототип согласован но должен строиться на объектах kit».
// 19.11: «экран то почему переделывать если он универсальный» — строится на модели 1.18 как есть;
// «HTML админки не адаптирован под телефон» — раскладка 360–412 px без прокрутки вбок, дифф под формой.
//
// Вкладки Типы / Меню и видимость / Гигиена / История; вкладка и тип — в адресе (?mtab=, ?mtype=).
// Тип: тексты RU/EN/PL, настройки типа, раскладка паспорта, поля (порядок, подпись, группа) и экран
// правки поля окном (на телефоне — во весь экран). Правится только то, что принимает PUT
// /lore/model/config (MC-05, кодек LoreModelCodec) и проверяет LoreModelConsistency; смена вида поля,
// ребра, двери записи, вершины графа — это миграция, а не настройка: только чтение с пометкой.
// Порядок правки: правка → дифф → «Проверить» (dry_run; 422 — причина словами сервера) →
// «Применить…» (kit ReasonDialog, «что и зачем» обязательно) → новая версия. Откат — новая версия
// с содержимым старой.
// Элементы — Seiðr kit: Tabs, Pill, DiffPreview, Dialog, ReasonDialog, LangTabs, SortableList, GameIcon,
// TipTapField, Skeleton/Forbidden/LoadError/EmptyState.
import { useMemo, useState } from 'react';
import {
  Dialog, DiffPreview, EmptyState, Forbidden, GameIcon, LangTabs, LoadError, Pill, ReasonDialog, Skeleton, SortableList, Tabs,
  useKitLang, useLoadState, useUrlParam, type DiffRow,
} from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { TipTapField } from '@seidr/kit/content';
import { useAppT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  FIELD_GROUPS, MODEL_LANGS, fetchModelConfig, fetchModelHistory, fetchModelSchema, fetchModelVersion, fieldLangMissing,
  modelDiff, modelHygiene, modelTypes, moveFieldTo, movePassport, navRows, passportSlots, rollbackRequest, saveModel,
  setAudience, setFieldProp, setFieldProps, setReadOnly, setTypeColor, setTypeProp, textKey, typeList,
  type Audience, type ModelChange, type ModelConfig, type ModelDoc, type ModelLang, type ModelVersion, type SaveAnswer,
  type SaveRequest, type SchemaInfo,
} from './model';
import './Admin.css';

export interface ModelScreenProps {
  fetchImpl?: typeof fetch;
}

const TABS = ['types', 'nav', 'hyg', 'hist'] as const;
type Tab = (typeof TABS)[number];
type Obj = Record<string, unknown>;

const reasonOf = (e: unknown) =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : undefined;
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const LANG_LABEL: Record<ModelLang, string> = { ru: 'RU', en: 'EN', pl: 'PL' };

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
    <section className="adm adm-model" aria-labelledby="adm-model-h" data-testid="adm-model">
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
  const dryRun = async () => {
    setCheck({ state: 'busy' });
    const a = await run({ content: JSON.stringify(draft), dry_run: true, expected_hash: cfg.hash ?? undefined });
    if (a === null) return;
    if (a.kind === 'inconsistent') setCheck({ state: 'bad', problems: a.problems });
    else if (a.kind === 'conflict') setCheck({ state: 'conflict' });
    else setCheck({ state: 'ok' });
  };

  const openApply = (p: Pending) => { setPending(p); setApplyError(null); };

  const apply = async (why: string) => {
    if (!pending) return;
    setApplyBusy(true);
    setApplyError(null);
    const req = pending.kind === 'rollback'
      ? rollbackRequest(pending.content, cfg.hash, { when: pending.when ?? '', why }, false)
      : { content: pending.content, dry_run: false, reason: why, expected_hash: cfg.hash ?? undefined };
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
        <span className="adm-mono adm-model-bar__ver" title={cfg.hash ?? undefined}>{t('admin.model.version')} <b>{(cfg.hash ?? '—').slice(0, 10)}</b></span>
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

      <ReasonDialog
        key={pending ? `${pending.kind}:${pending.when ?? ''}` : 'none'}
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.kind === 'rollback' ? t('admin.model.rollbackTitle', { when: pending.when ?? '' }) : t('admin.model.applyTitle')}
        confirmLabel={pending?.kind === 'rollback' ? t('admin.model.rollbackOk') : t('admin.model.applyOk')}
        reasonLabel={t('admin.model.why')}
        placeholder={t('admin.model.whyHint')}
        busy={applyBusy}
        error={applyError}
        onConfirm={apply}
      >
        {pending?.kind === 'rollback' ? t('admin.model.rollbackBody') : t('admin.model.applyBody', { n: changes.length })}
      </ReasonDialog>
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

/** Строка «только чтение»: что и почему не правится здесь. */
function RoRow({ label, value, why }: { label: string; value: string; why: string }) {
  return (
    <div className="adm-model-ro">
      <span className="adm-field__l">{label}</span>
      <span className="adm-mono adm-model-ro__v">{value || '—'}</span>
      <span className="adm-dim">{why}</span>
    </div>
  );
}

// ── Типы ─────────────────────────────────────────────────────────────

function TypesTab({ doc, base, schema, onEdit }: { doc: ModelDoc; base: ModelDoc; schema: SchemaInfo; onEdit: (d: ModelDoc) => void }) {
  const t = useAppT();
  const [sel, setSel] = useUrlParam('mtype');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
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
  const changedFields = new Set(cur.fields.map((f, i) => {
    const key = String(f.key ?? '');
    const was = baseFields.find(b => b.key === key);
    return !was || JSON.stringify(was) !== JSON.stringify(f) || baseFields.indexOf(was) !== i ? key : '';
  }).filter(Boolean));
  const editField = editing ? cur.fields.find(f => f.key === editing) : undefined;
  return (
    <div className="adm-model-types">
      <nav className="adm-model-side" aria-label={t('admin.model.typesNav')}>
        <input className="adm-input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('admin.model.search')}
          aria-label={t('admin.model.search')} data-testid="adm-model-search" />
        <div className="adm-model-side__list">
          {groups.map(g => {
            const shown = g.types.filter(match);
            if (!shown.length) return null;
            return (
              <div key={g.group ?? '_'} className="adm-model-side__grp">
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
        </div>
      </nav>
      <div className="adm-model-typebody">
        <div className="adm-dim">{t('admin.model.typeKind')} · <span className="adm-mono">{cur.type}</span></div>
        <h3 className="adm-model-h1">{cur.label}</h3>
        <p className="adm-sub">
          {cur.childOnly && <Pill>{t('admin.model.childOnly')}</Pill>}
          {sch === undefined && <Pill tone="wrn">{t('admin.model.schemaUnknown')}</Pill>}
        </p>

        <TypeText doc={doc} type={cur.type} onEdit={onEdit} />
        <TypeSettings doc={doc} type={cur.type} childOnly={cur.childOnly} onEdit={onEdit} />
        <PassportLayout doc={doc} base={base} type={cur.type} onEdit={onEdit} />

        <h4 className="adm-model-h2">{t('admin.model.fields')}</h4>
        <div data-testid="adm-model-fields" className="adm-model-fields">
          <SortableList
            label={t('admin.model.fieldsOrder')}
            items={cur.fields.map(f => ({ id: String(f.key ?? ''), label: String(f.key ?? ''), f }))}
            changed={changedFields}
            onMove={(from, to) => onEdit(moveFieldTo(doc, cur.type, from, to))}
            renderItem={({ id: key, f }) => {
              const sf = sch?.fields[key];
              return (
                <div className="adm-model-field" data-testid={`adm-model-field-${key}`} data-changed={changedFields.has(key) ? '' : undefined}>
                  <span className="adm-mono adm-model-field__key">{key}</span>
                  <input className="adm-input adm-model-field__label" value={s(f.label)} aria-label={`${t('admin.model.col.label')} ${key}`}
                    onChange={e => onEdit(setFieldProp(doc, cur.type, key, 'label', e.target.value))} />
                  <span className="adm-dim adm-model-field__kind" title={t('admin.model.col.kind')}>{s(f.kind)}</span>
                  <select className="adm-select adm-model-field__group" value={s(f.group)} aria-label={`${t('admin.model.col.group')} ${key}`}
                    onChange={e => onEdit(setFieldProp(doc, cur.type, key, 'group', e.target.value))}>
                    {[...new Set([...FIELD_GROUPS, s(f.group)])].filter(Boolean).map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <span className="adm-mono adm-model-field__prop" title={t('admin.model.col.property')}>
                    {sch === undefined ? <span className="adm-missing">{t('admin.model.schemaUnknownShort')}</span>
                      : sf?.property ? `${sf.property} · ${sf.propertyType ?? '?'}`
                        : sf?.source === 'EDGE' ? t('admin.model.viaEdge')
                          : <span className="adm-missing">{t('admin.model.noProperty')}</span>}
                  </span>
                  <button type="button" className="adm-btn adm-model-field__edit" aria-label={t('admin.model.editField', { key })}
                    data-testid={`adm-model-edit-${key}`} onClick={() => setEditing(key)}>
                    {t('admin.model.edit')}
                  </button>
                </div>
              );
            }}
          />
        </div>
        <p className="adm-dim">{t('admin.model.legend')}</p>
      </div>
      {editField && (
        <FieldDialog key={`${cur.type}.${editing}`} type={cur.type} field={editField} schemaProp={sch?.fields[String(editField.key)]}
          onCancel={() => setEditing(null)}
          onApply={patch => { onEdit(setFieldProps(doc, cur.type, String(editField.key), patch)); setEditing(null); }} />
      )}
    </div>
  );
}

/** Тексты типа: подпись RU/EN/PL. Определения и описания типа модель 1.18 не хранит — сказано. */
function TypeText({ doc, type, onEdit }: { doc: ModelDoc; type: string; onEdit: (d: ModelDoc) => void }) {
  const t = useAppT();
  const [lang, setLang] = useState<ModelLang>('ru');
  const ty = modelTypes(doc).find(x => x.type === type);
  const raw = obj([...(doc.types as unknown[] ?? []), ...(doc.child_only as unknown[] ?? [])].map(obj).find(x => x.type === type));
  if (!ty) return null;
  const key = textKey('label', lang) as 'label' | 'labelEn' | 'labelPl';
  const langs = MODEL_LANGS.map(l => ({ id: l, label: LANG_LABEL[l], missing: l !== 'ru' && !s(raw[textKey('label', l)]).trim() }));
  return (
    <div className="adm-model-sect" data-testid="adm-model-typetext">
      <h4 className="adm-model-h2">{t('admin.model.typeText')}</h4>
      <LangTabs label={t('admin.model.textLang')} langs={langs} value={lang} onChange={l => setLang(l as ModelLang)}
        i18nKey={s(raw.labelKey) || undefined}>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.model.typeLabel')}</span>
          <input className="adm-input" value={s(raw[key])} aria-label={t('admin.model.typeLabel')}
            placeholder={lang !== 'ru' ? t('admin.model.noTranslation') : undefined}
            onChange={e => onEdit(setTypeProp(doc, type, key, e.target.value))} />
        </label>
      </LangTabs>
      <p className="adm-note" data-tone="inf" role="note">{t('admin.model.typeTextNoApi')}</p>
    </div>
  );
}

function TypeSettings({ doc, type, childOnly, onEdit }: { doc: ModelDoc; type: string; childOnly: boolean; onEdit: (d: ModelDoc) => void }) {
  const t = useAppT();
  const raw = obj([...(doc.types as unknown[] ?? []), ...(doc.child_only as unknown[] ?? [])].map(obj).find(x => x.type === type));
  const colors = [...new Set(Object.values(obj(doc.type_color)).map(String))].sort();
  const color = s(obj(doc.type_color)[type]);
  const ro = (doc.read_only as unknown[] ?? []).map(String).includes(type);
  const g = obj(obj(doc.graph)[type]);
  const aliases = Object.entries(obj(obj(doc.aliases)[type])).map(([k, v]) => `${k} → ${String(v)}`).join(', ');
  const create = obj(obj(doc.create)[type]);
  const computed = (obj(doc.computed)[type] as unknown[] ?? []).map(obj).map(c => s(c.label) || s(c.key)).join(', ');
  const time = obj(obj(doc.time)[type]);
  const precision = Object.entries(obj(doc.precision)).filter(([k]) => k.startsWith(`${type}.`)).map(([k, v]) => `${k.slice(type.length + 1)}: ${String(v)}`).join(', ');
  const migration = t('admin.model.ro.migration');
  return (
    <div className="adm-model-sect">
      <h4 className="adm-model-h2">{t('admin.model.typeSettings')}</h4>
      <div className="adm-model-grid">
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.model.icon')}</span>
          <span className="adm-model-icon">
            <GameIcon slug={s(raw.icon) || null} size={16} />
            <input className="adm-input" value={s(raw.icon)} aria-label={t('admin.model.icon')}
              onChange={e => onEdit(setTypeProp(doc, type, 'icon', e.target.value))} />
          </span>
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.model.typeColor')}</span>
          <select className="adm-select" value={color} aria-label={t('admin.model.typeColor')}
            onChange={e => onEdit(setTypeColor(doc, type, e.target.value || null))}>
            <option value="">{t('admin.model.noColor')}</option>
            {colors.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="adm-check">
          <input type="checkbox" checked={ro} onChange={e => onEdit(setReadOnly(doc, type, e.target.checked))} />
          {t('admin.model.readOnly')}
        </label>
      </div>
      <div className="adm-model-rolist" data-testid="adm-model-type-readonly">
        <RoRow label="child_only" value={childOnly ? t('admin.model.yes') : t('admin.model.no')} why={migration} />
        <RoRow label="graph" value={[s(g.vertex), s(g.key) && `key ${s(g.key)}`, s(g.hist) && `hist ${s(g.hist)}`].filter(Boolean).join(' · ')} why={migration} />
        <RoRow label="aliases" value={aliases} why={migration} />
        <RoRow label="create" value={s(create.endpoint) || t('admin.model.ro.noCreate')} why={t('admin.model.ro.code')} />
        <RoRow label="workflow" value={doc.workflow ? t('admin.model.ro.workflowShared') : '—'} why={t('admin.model.ro.code')} />
        <RoRow label="computed" value={computed} why={t('admin.model.ro.server')} />
        <RoRow label="time / precision" value={[s(time.history), precision].filter(Boolean).join(' · ')} why={migration} />
      </div>
    </div>
  );
}

function PassportLayout({ doc, base, type, onEdit }: { doc: ModelDoc; base: ModelDoc; type: string; onEdit: (d: ModelDoc) => void }) {
  const t = useAppT();
  const slots = passportSlots(doc, type);
  const was = passportSlots(base, type).map(x => x.key);
  const changed = new Set(slots.filter((x, i) => was[i] !== x.key).map(x => x.key));
  return (
    <div className="adm-model-sect" data-testid="adm-model-passport">
      <h4 className="adm-model-h2">{t('admin.model.passport')}</h4>
      {slots.length === 0 ? <p className="adm-dim">{t('admin.model.passportEmpty')}</p> : (
        <SortableList label={t('admin.model.passport')} items={slots.map(x => ({ id: x.key, label: x.key, slot: x.slot }))} changed={changed}
          onMove={(from, to) => onEdit(movePassport(doc, type, from, to))}
          renderItem={it => <span><span className="adm-mono">{it.id}</span> <span className="adm-dim">{it.slot}</span></span>} />
      )}
    </div>
  );
}

// ── Правка поля окном ────────────────────────────────────────────────

const BOOL_EDITABLE = ['required', 'historic', 'multi'] as const;

function FieldDialog({ type, field, schemaProp, onCancel, onApply }: {
  type: string; field: Obj; schemaProp?: { property: string | null; propertyType: string | null; source: string | null };
  onCancel: () => void; onApply: (patch: Record<string, unknown>) => void;
}) {
  const t = useAppT();
  const key = String(field.key ?? '');
  const [f, setF] = useState<Obj>(() => structuredClone(field));
  const [lang, setLang] = useState<ModelLang>('ru');
  const set = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }));
  const missing = fieldLangMissing(f);
  const write = obj(f.write);
  const hasWrite = !!s(write.endpoint);
  const options = f.options ? obj(f.options) : null;
  const patch = () => {
    const out: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(field), ...Object.keys(f)]);
    for (const k of keys) if (JSON.stringify(field[k]) !== JSON.stringify(f[k])) out[k] = f[k] ?? '';
    return out;
  };
  const migration = t('admin.model.ro.migration');
  return (
    <Dialog open size="wide" className="adm-model-fe" onClose={onCancel} title={t('admin.model.fe.title', { key, type })}
      actions={(
        <>
          <button type="button" className="adm-btn" data-testid="adm-model-fe-cancel" onClick={onCancel}>{t('admin.model.fe.cancel')}</button>
          <button type="button" className="adm-btn" data-tone="acc" data-testid="adm-model-fe-apply" onClick={() => onApply(patch())}>{t('admin.model.fe.toDiff')}</button>
        </>
      )}>
      <div className="adm-model-grid">
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.model.col.group')}</span>
          <select className="adm-select" value={s(f.group)} onChange={e => set('group', e.target.value)}>
            {[...new Set([...FIELD_GROUPS, s(f.group)])].filter(Boolean).map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.model.fe.layer')}</span>
          <select className="adm-select" value={s(f.layer)} onChange={e => set('layer', e.target.value)}>
            <option value="">{t('admin.model.fe.layerNone')}</option>
            <option value="stable">{t('admin.model.fe.layerStable')}</option>
            <option value="optional">{t('admin.model.fe.layerOptional')}</option>
          </select>
        </label>
        {BOOL_EDITABLE.map(k => (
          <label key={k} className="adm-check">
            <input type="checkbox" checked={f[k] === true} onChange={e => set(k, e.target.checked)} />
            {t(`admin.model.fe.${k}` as AppKey)}
          </label>
        ))}
        <label className="adm-check">
          <input type="checkbox" checked={f.editable === true} disabled={!hasWrite} onChange={e => set('editable', e.target.checked)} />
          {t('admin.model.fe.editable')}
          {!hasWrite && <span className="adm-missing"> · {t('admin.model.fe.noWrite')}</span>}
        </label>
        {options && (
          <label className="adm-field">
            <span className="adm-field__l">{t('admin.model.fe.optionsSlice')}</span>
            <input className="adm-input" value={s(options.slice)} onChange={e => set('options', { ...options, slice: e.target.value })} />
          </label>
        )}
      </div>

      <h4 className="adm-model-h2">{t('admin.model.fe.texts')}</h4>
      <LangTabs label={t('admin.model.textLang')} value={lang} onChange={l => setLang(l as ModelLang)}
        langs={MODEL_LANGS.map(l => ({ id: l, label: LANG_LABEL[l], missing: missing[l] }))} i18nKey={s(f.labelKey) || undefined}>
        {(['label', 'shortLabel', 'definition'] as const).map(b => (
          <label key={`${lang}.${b}`} className="adm-field">
            <span className="adm-field__l">{t(`admin.model.fe.${b}` as AppKey)}</span>
            <input className="adm-input" value={s(f[textKey(b, lang)])} aria-label={t(`admin.model.fe.${b}` as AppKey)}
              placeholder={lang !== 'ru' ? t('admin.model.noTranslation') : undefined}
              onChange={e => set(textKey(b, lang), e.target.value)} />
          </label>
        ))}
        <div className="adm-field">
          <span className="adm-field__l">{t('admin.model.fe.description')}</span>
          <TipTapField key={lang} value={s(f[textKey('description', lang)])} ariaLabel={t('admin.model.fe.description')}
            placeholder={lang !== 'ru' ? t('admin.model.noTranslation') : undefined}
            onChange={md => set(textKey('description', lang), md)} />
        </div>
      </LangTabs>

      <h4 className="adm-model-h2">{t('admin.model.fe.readOnly')}</h4>
      <div className="adm-model-rolist" data-testid="adm-model-fe-readonly">
        <RoRow label={t('admin.model.col.kind')} value={s(f.kind)} why={t('admin.model.ro.kind')} />
        <RoRow label={t('admin.model.col.property')} value={schemaProp?.property ? `${schemaProp.property} · ${schemaProp.propertyType ?? '?'}` : ''} why={t('admin.model.ro.schema')} />
        <RoRow label="dict" value={s(f.dict)} why={migration} />
        <RoRow label="write" value={hasWrite ? `${s(write.endpoint)} · ${s(write.field)}` : ''} why={t('admin.model.ro.code')} />
        <RoRow label="refType" value={s(f.refType)} why={migration} />
        <RoRow label="rel · dir" value={[s(f.rel), s(f.dir), s(f.relation)].filter(Boolean).join(' · ')} why={migration} />
        {options && <RoRow label="options" value={[s(options.param), s(options.value), s(options.label), s(options.group)].filter(Boolean).join(' · ')} why={t('admin.model.ro.code')} />}
      </div>
      <p className="adm-dim">{t('admin.model.fe.note')}</p>
    </Dialog>
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
        <table className="adm-table adm-model-cards" data-testid="adm-model-nav">
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
      <table className="adm-table adm-model-cards" data-testid="adm-model-hyg">
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
        <table className="adm-table adm-model-cards">
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
