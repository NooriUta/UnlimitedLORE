// «Редактировать всё» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24). Владелица 11.11: «полноэкранный контент
// можно редактировать только частями, нет общей кнопки редактировать, и в свойства ничего не
// получится внести». 13.11: «кнопка наверху сохранить и прототип на реально большом ADR» →
// docs/prototypes/s4-24-edit-all.html, «да норм прототип берем».
//
// Правка копится и уходит ОДНИМ действием «Сохранить»: onSave на каждое изменённое поле,
// onRelation на каждую привязку/отвязку. Что не сохранилось — названо, правка не закрывается
// (сохранённое уже на сервере, повторно его не шлём). Путь записи и права — от приложения (K-14):
// правится только то, что поле объявило (md при слоте записи, editable для простых, relation).
import { useEffect, useMemo, useState } from 'react';
import type { KitCtx, KitRecord, KindConfig } from '../core/contract';
import { chipId, chipLabel, isChipList, toChips } from '../core/chipValue';
import { kitPlural, kitT, type KitLang } from '../i18n';
import { RelationPicker } from './RelationPicker';

type FieldDef = NonNullable<KindConfig['fields']>[number];
type Save = (field: string, from: unknown) => (to: unknown) => Promise<void>;

const SIMPLE = new Set(['text', 'number', 'date', 'enum', 'bool']);

/** Что правится в «Редактировать всё»: тексты, объявленные простые поля, связи-атрибуты. */
export function editAllFields(kind: KindConfig | undefined, ctx: KitCtx, canSave: boolean): FieldDef[] {
  const canRel = !!ctx.config.hooks?.onRelation && (ctx.config.roles?.[ctx.role ?? 'reader']?.canEdit ?? false);
  // Тексты записи (разделы тела: контекст, решение, следствия) — первыми, как на экране.
  const body: FieldDef[] = canSave ? (kind?.bodySections ?? []).filter(b => b.editable !== false).map(b => ({ key: b.key, title: b.title, type: 'md' as const })) : [];
  return [...body, ...(kind?.fields ?? []).filter(f => !body.some(b => b.key === f.key)).filter(f =>
    (f.type === 'md' && canSave)
    || (canSave && f.editable && SIMPLE.has(f.type) && (f.type !== 'enum' || (f.options?.length ?? 0) > 0))
    || (f.type === 'ref' && f.relation && canRel))];
}

const relIds = (v: unknown): { id: string; label: string; inherited: boolean }[] => {
  if (isChipList(v)) return toChips(v).map(c => ({ id: chipId(c), label: chipLabel(c), inherited: !!c.inherited_from }));
  const arr = Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v];
  return arr.map(x => ({ id: String(x), label: String(x), inherited: false }));
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function RecordEditAll({ record, ctx, lang, fields, save, onDone }: {
  record: KitRecord; ctx: KitCtx; lang: KitLang; fields: FieldDef[]; save?: Save; onDone: () => void;
}) {
  const t = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => kitT(lang, k, v);
  const [vals, setVals] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.filter(f => f.type !== 'ref').map(f => [f.key, record.fields[f.key] ?? null])));
  const [rel, setRel] = useState<Record<string, { add: string[]; remove: string[] }>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ title: string; reason: string }[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(() => new Set());

  const changed = useMemo(() => fields.filter(f => {
    if (saved.has(f.key)) return false;
    if (f.type === 'ref') { const r = rel[f.key]; return !!r && (r.add.length > 0 || r.remove.length > 0); }
    return !same(vals[f.key], record.fields[f.key]);
  }), [fields, vals, rel, record, saved]);

  const leave = () => { if (changed.length) setConfirm(true); else onDone(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !confirm) { e.preventDefault(); leave(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const doSave = async () => {
    setBusy(true);
    const fails: { title: string; reason: string }[] = [];
    const ok = new Set(saved);
    const onRelation = ctx.config.hooks?.onRelation;
    for (const f of changed) {
      try {
        if (f.type === 'ref' && f.relation && onRelation) {
          const r = rel[f.key];
          for (const id of r.remove) await onRelation({ type: record.kind, id: record.id, rel: f.relation.rel, dir: f.relation.dir, target: id, action: 'remove' });
          for (const id of r.add) await onRelation({ type: record.kind, id: record.id, rel: f.relation.rel, dir: f.relation.dir, target: id, action: 'add' });
        } else if (save) {
          await save(f.key, record.fields[f.key] ?? null)(vals[f.key]);
        }
        ok.add(f.key);
      } catch (e) {
        fails.push({ title: f.title, reason: e instanceof Error && e.message ? e.message : String(e) });
      }
    }
    setBusy(false);
    setSaved(ok);
    setFailed(fails);
    if (fails.length === 0) onDone();
  };

  const field = (f: FieldDef) => {
    const id = `sk-editall-${f.key}`;
    if (f.type === 'ref' && f.relation) {
      const r = rel[f.key] ?? { add: [], remove: [] };
      const cur = relIds(record.fields[f.key]);
      const toggle = (cid: string) => setRel(p => {
        const x = p[f.key] ?? { add: [], remove: [] };
        if (x.add.includes(cid)) return { ...p, [f.key]: { ...x, add: x.add.filter(a => a !== cid) } };
        return { ...p, [f.key]: { ...x, remove: x.remove.includes(cid) ? x.remove.filter(a => a !== cid) : [...x.remove, cid] } };
      });
      const options = ctx.config.hooks?.relationOptions;
      return (
        <div className="sk-rec-editall__rel">
          <ul className="sk-relfield__chips">
            {cur.map(c => {
              const gone = r.remove.includes(c.id);
              return (
                <li key={c.id} className={`sk-relfield__chip${gone ? ' is-removed' : ''}${c.inherited ? ' sk-relfield__chip--inherited' : ''}`}>
                  <span>{c.label}</span>
                  {!c.inherited && (
                    <button type="button" className="sk-relfield__x" onClick={() => toggle(c.id)}
                      aria-label={gone ? t('kit.record.editAll.restore', { title: c.id }) : t('kit.record.rel.unlink', { title: c.id })}>{gone ? '↺' : '×'}</button>
                  )}
                </li>
              );
            })}
            {r.add.map(a => (
              <li key={`+${a}`} className="sk-relfield__chip is-added">
                <span>{a}</span>
                <button type="button" className="sk-relfield__x" onClick={() => toggle(a)} aria-label={t('kit.record.rel.unlink', { title: a })}>×</button>
              </li>
            ))}
          </ul>
          {options && (
            <RelationPicker lang={lang} label={f.title} recordType={record.kind} recordId={record.id} rel={f.relation.rel} dir={f.relation.dir}
              options={options} linked={[...cur.map(c => c.id), ...r.add]} busy={busy}
              onPick={pid => setRel(p => { const x = p[f.key] ?? { add: [], remove: [] }; return { ...p, [f.key]: { ...x, add: [...x.add, pid] } }; })} />
          )}
        </div>
      );
    }
    const v = vals[f.key];
    const set = (to: unknown) => setVals(p => ({ ...p, [f.key]: to }));
    if (f.type === 'md') {
      return <textarea id={id} className="sk-rec-editall__md" aria-label={f.title} value={v == null ? '' : String(v)} onChange={e => set(e.target.value)} />;
    }
    // MC-08: флаг — «Да / Нет / —» (null ≠ false); уходит булевым, а не словом.
    if (f.type === 'bool') {
      const b = v === true || v === 'true' ? 'true' : v === false || v === 'false' ? 'false' : '';
      return (
        <select id={id} className="sk-rec-editall__in" aria-label={f.title} value={b}
          onChange={e => set(e.target.value === 'true' ? true : e.target.value === 'false' ? false : null)}>
          <option value="">—</option>
          <option value="true">{t('kit.field.yes')}</option>
          <option value="false">{t('kit.field.no')}</option>
        </select>
      );
    }
    if (f.type === 'enum') {
      return (
        <select id={id} className="sk-rec-editall__in" aria-label={f.title} value={v == null ? '' : String(v)} onChange={e => set(e.target.value || null)}>
          <option value="">—</option>
          {(f.options ?? []).map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
    return (
      <input id={id} type={type} className="sk-rec-editall__in" aria-label={f.title} value={v == null ? '' : String(v)}
        onChange={e => set(f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />
    );
  };

  const missing = fields.filter(f => f.required === 'block' && f.type !== 'ref' && (vals[f.key] == null || vals[f.key] === ''));
  const why = busy ? '' : missing.length ? t('kit.record.editAll.whyRequired', { fields: missing.map(f => f.title).join(', ') })
    : changed.length === 0 ? t('kit.record.editAll.whyNone') : '';

  return (
    <section className="sk-rec-editall" aria-label={t('kit.record.editAll.title', { id: record.id })}>
      <div className="sk-rec-editall__bar">
        <span className="sk-rec-editall__name">{t('kit.record.editAll.title', { id: record.id })}</span>
        <span className="sk-rec-editall__state" data-testid="kit-editall-state">
          {changed.length ? `${kitPlural(lang, 'kit.record.editAll.changed', changed.length)} — ${changed.map(f => f.title).join(', ')}` : t('kit.record.editAll.none')}
        </span>
        {why && <span className="sk-rec-editall__why" data-testid="kit-editall-why">{why}</span>}
        <span className="sk-rec-editall__grow" />
        <button type="button" className="sk-btn" onClick={leave} disabled={busy}>{t('kit.record.editAll.cancel')}</button>
        <button type="button" className="sk-btn sk-btn--primary" onClick={() => void doSave()} disabled={busy || changed.length === 0 || missing.length > 0}>
          {busy ? t('kit.record.editAll.saving') : t('kit.record.editAll.save')}
        </button>
      </div>
      {failed.length > 0 && (
        <div className="sk-rec-editall__fail" role="alert">
          {t('kit.record.editAll.failed')} {failed.map(f => `${f.title}: ${f.reason}`).join('; ')}
        </div>
      )}
      {confirm && (
        <div className="sk-rec-editall__confirm" role="alertdialog" aria-label={t('kit.record.editAll.leaveTitle')}>
          <b>{t('kit.record.editAll.leaveTitle')}</b> {t('kit.record.editAll.leaveLost')} {changed.map(f => f.title).join(', ')}
          <span className="sk-rec-editall__grow" />
          <button type="button" className="sk-btn" onClick={() => setConfirm(false)}>{t('kit.record.editAll.stay')}</button>
          <button type="button" className="sk-btn sk-btn--danger" onClick={() => { setConfirm(false); onDone(); }}>{t('kit.record.editAll.drop')}</button>
        </div>
      )}
      <dl className="sk-rec-editall__fields">
        {fields.map(f => {
          const dirty = changed.includes(f);
          return (
            <div key={f.key} className={`sk-rec-editall__row${f.type === 'md' ? ' is-md' : ''}${dirty ? ' is-dirty' : ''}`} data-field={f.key}>
              <dt><label htmlFor={`sk-editall-${f.key}`}>{f.title}</label>{dirty && <span className="sk-rec-editall__mark">{t('kit.record.editAll.mark')}</span>}</dt>
              <dd>{field(f)}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
