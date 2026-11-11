// Мини-окно ссылки на запись в MD (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050,
// spec:SPEC-LORE-MD-INLINE-REF §3). Открывается посреди набора (detectRefTrigger), поэтому
// стоит на общем Popover с takeFocus={false}: фокус остаётся в редакторе, а стрелки, Enter
// и Esc редактор передаёт сюда через handleKey.
//
// Две карточки одного окна:
//   • «Существующий» — то, что нашёл поиск приложения; выбор → onPick;
//   • «Новый» — форма по полям типа: сначала обязательные, остальные по «ещё поля».
//     required: 'block' — без поля сервер запись не создаст: отказ называется словами ДО
//     отправки; 'warn' — предупреждение, второй щелчок создаёт (D-2026-LORE-RECORD-FIELD-REQUIRED).
// Честные состояния различаются словами: не нашлось ≠ не загрузилось ≠ нет прав ≠ тип не знаем.
// Предметных имён kit не знает (K-14): типы, подписи, поля, поиск и создание — от приложения.
import { forwardRef, useImperativeHandle, useState } from 'react';
import { Popover } from '../shell/Popover';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';
import type { RefTrigger } from './refTrigger';

export interface RefItem { id: string; type: string; title: string }

export type RefSearch =
  | { state: 'loading' }
  | { state: 'ok'; items: RefItem[] }
  | { state: 'error'; reason: string };

export interface RefFieldDef {
  key: string;
  label: string;
  required?: 'block' | 'warn';
  /** варианты — поле выбором; нет — строкой */
  options?: string[];
  /** не показывать сразу, только по «ещё поля» */
  more?: boolean;
}

export type RefCreateSpec = { fields: RefFieldDef[] } | { denied: string };
export type RefCreateResult = { ok: true; item: RefItem } | { ok: false; reason: string };

export interface RefPickerProps {
  trigger: RefTrigger;
  /** тип → подпись; порядок ключей — порядок в выборе типа и в «есть: …» */
  typeLabels: Record<string, string>;
  search: RefSearch;
  onPick: (item: RefItem) => void;
  onClose: () => void;
  onRetry?: () => void;
  /** поля нового по типу или причина, почему заводить нельзя; нет — карточки «Новый» нет */
  createSpec?: (type: string) => RefCreateSpec;
  onCreate?: (type: string, values: Record<string, string>) => Promise<RefCreateResult>;
}

export interface RefPickerHandle {
  /** клавиша из редактора; true — окно её использовало, редактору не обрабатывать */
  handleKey: (key: string) => boolean;
}

/** Пустые обязательные поля: block — блокируют создание, warn — только предупреждают. */
export function checkRequired(fields: RefFieldDef[], values: Record<string, string>) {
  const empty = (f: RefFieldDef) => !(values[f.key] ?? '').trim();
  return {
    blocked: fields.filter(f => f.required === 'block' && empty(f)).map(f => f.label),
    warned: fields.filter(f => f.required === 'warn' && empty(f)).map(f => f.label),
  };
}

export const RefPicker = forwardRef<RefPickerHandle, RefPickerProps>(function RefPicker(
  { trigger, typeLabels, search, onPick, onClose, onRetry, createSpec, onCreate }, ref,
) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [card, setCard] = useState<'old' | 'new'>('old');
  const [index, setIndex] = useState(0);
  const items = search.state === 'ok' ? search.items : [];
  const at = Math.min(index, Math.max(items.length - 1, 0));
  const listUsable = card === 'old' && !trigger.unknownType && search.state === 'ok' && items.length > 0;

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (key === 'Escape') { onClose(); return true; }
      if (!listUsable) return false;
      if (key === 'ArrowDown') { setIndex((at + 1) % items.length); return true; }
      if (key === 'ArrowUp') { setIndex((at - 1 + items.length) % items.length); return true; }
      if (key === 'Enter' || key === 'Tab') { onPick(items[at]); return true; }
      return false;
    },
  }), [at, items, listUsable, onClose, onPick]);

  const known = Object.values(typeLabels).join(', ');
  const scope = trigger.type ? (typeLabels[trigger.type] ?? trigger.type) : t('kit.ref.all');

  return (
    <Popover onClose={onClose} takeFocus={false} walk="focusable" arrows={false} className="sk-ref">
      <div className="sk-ref__head" data-testid="ref-head">
        <span className="sk-ref__trig">{trigger.trigger === 'brackets' ? '[[' : trigger.trigger === 'at' ? '@' : '#'}</span>
        <span className="sk-ref__scope">{scope}{trigger.query ? ` · «${trigger.query}»` : ''}</span>
        {createSpec && (
          <span className="sk-ref__seg" role="group" aria-label={t('kit.ref.label')}>
            <button type="button" aria-pressed={card === 'old'} onClick={() => setCard('old')}>{t('kit.ref.cardOld')}</button>
            <button type="button" aria-pressed={card === 'new'} onClick={() => setCard('new')}>{t('kit.ref.cardNew')}</button>
          </span>
        )}
      </div>
      {card === 'old' ? (
        trigger.unknownType ? (
          <p className="sk-ref__state sk-ref__state--err">{t('kit.ref.unknownType', { word: trigger.unknownType, known })}</p>
        ) : search.state === 'loading' ? (
          <p className="sk-ref__state">{t('kit.ref.loading')}</p>
        ) : search.state === 'error' ? (
          <p className="sk-ref__state sk-ref__state--err">
            {t('kit.ref.error', { reason: search.reason })}{' '}
            {onRetry && <button type="button" className="sk-ref__btn" onClick={onRetry}>{t('kit.ref.retry')}</button>}
          </p>
        ) : items.length === 0 ? (
          <p className="sk-ref__state">
            {t('kit.ref.notFound', { q: trigger.query })}{' '}
            {createSpec && <button type="button" className="sk-ref__btn" onClick={() => setCard('new')}>{t('kit.ref.toNew')}</button>}
          </p>
        ) : (
          <ul className="sk-ref__list">
            {items.map((it, i) => (
              <li key={`${it.type}:${it.id}`}>
                <button type="button" className={`sk-ref__item${i === at ? ' is-on' : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => onPick(it)}>
                  <span className="sk-ref__ty">{typeLabels[it.type] ?? it.type}</span>
                  <span className="sk-ref__id">{it.id}</span>
                  <span className="sk-ref__title">{it.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        createSpec && <NewCard trigger={trigger} typeLabels={typeLabels} createSpec={createSpec} onCreate={onCreate} onPick={onPick} onCancel={() => setCard('old')} t={t} />
      )}
    </Popover>
  );
});

function NewCard({ trigger, typeLabels, createSpec, onCreate, onPick, onCancel, t }: {
  trigger: RefTrigger;
  typeLabels: Record<string, string>;
  createSpec: (type: string) => RefCreateSpec;
  onCreate?: RefPickerProps['onCreate'];
  onPick: (item: RefItem) => void;
  onCancel: () => void;
  t: (k: KitKey, v?: Record<string, string | number>) => string;
}) {
  const [type, setType] = useState(trigger.type ?? Object.keys(typeLabels)[0] ?? '');
  const spec = createSpec(type);
  const fields = 'fields' in spec ? spec.fields : [];
  const [values, setValues] = useState<Record<string, string>>(() => (fields[0] && trigger.query ? { [fields[0].key]: trigger.query } : {}));
  const [more, setMore] = useState(false);
  const [tried, setTried] = useState(false);
  const [warned, setWarned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const typePick = !trigger.type && (
    <label className="sk-ref__fld">{t('kit.ref.type')}
      <select value={type} onChange={e => { setType(e.target.value); setValues({}); setTried(false); setWarned(false); }}>
        {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
  if ('denied' in spec) {
    return (
      <div className="sk-ref__form">
        {typePick}
        <p className="sk-ref__state sk-ref__state--lock">{t('kit.ref.denied', { type: typeLabels[type] ?? type, reason: spec.denied })}</p>
      </div>
    );
  }
  const { blocked, warned: soft } = checkRequired(fields, values);
  const shown = fields.filter(f => !f.more || more);
  const create = async () => {
    setTried(true);
    setFailed(null);
    if (blocked.length) return;
    if (soft.length && !warned) { setWarned(true); return; }
    if (!onCreate) return;
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    setBusy(true);
    const r = await onCreate(type, clean);
    setBusy(false);
    if (r.ok) onPick(r.item); else setFailed(r.reason);
  };
  return (
    <div className="sk-ref__form">
      {typePick}
      {shown.map(f => {
        const bad = tried && !(values[f.key] ?? '').trim() && f.required;
        const mark = f.required === 'block' ? t('kit.ref.required') : f.required === 'warn' ? t('kit.ref.wanted') : null;
        const set = (v: string) => setValues(s => ({ ...s, [f.key]: v }));
        return (
          <label key={f.key} className={`sk-ref__fld${bad ? ` sk-ref__fld--${f.required}` : ''}`}>
            <span>{f.label}{mark && <span className={`sk-ref__mk sk-ref__mk--${f.required}`}> {mark}</span>}</span>
            {f.options ? (
              <select value={values[f.key] ?? ''} onChange={e => set(e.target.value)}>
                <option value="">—</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input value={values[f.key] ?? ''} onChange={e => set(e.target.value)} />
            )}
          </label>
        );
      })}
      {fields.some(f => f.more) && !more && (
        <button type="button" className="sk-ref__btn" onClick={() => setMore(true)}>{t('kit.ref.more')}</button>
      )}
      {tried && blocked.length > 0 && <p role="alert" className="sk-ref__msg sk-ref__msg--block">{t('kit.ref.blocked', { fields: blocked.join(', ') })}</p>}
      {failed && <p role="alert" className="sk-ref__msg sk-ref__msg--block">{t('kit.ref.failed', { reason: failed })}</p>}
      {warned && !blocked.length && soft.length > 0 && <p role="status" className="sk-ref__msg sk-ref__msg--warn">{t('kit.ref.warned', { fields: soft.join(', ') })}</p>}
      <div className="sk-ref__row">
        <button type="button" className="sk-ref__btn sk-ref__btn--pri" disabled={busy} onClick={() => { void create(); }}>
          {busy ? t('kit.ref.creating') : warned && !blocked.length && soft.length ? t('kit.ref.createAnyway') : t('kit.ref.create')}
        </button>
        <button type="button" className="sk-ref__btn" onClick={onCancel}>{t('kit.ref.cancel')}</button>
      </div>
    </div>
  );
}
