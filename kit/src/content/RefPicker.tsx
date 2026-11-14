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
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Popover } from '../shell/Popover';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';
import type { RefTrigger } from './refTrigger';
import { RefSearchList, type RefItem, type RefSearch, type RefSearchListHandle } from './RefSearchList';

export interface RefFieldDef {
  key: string;
  label: string;
  required?: 'block' | 'warn';
  /** варианты — поле выбором; нет — строкой */
  options?: string[];
  /** не показывать сразу, только по «ещё поля» */
  more?: boolean;
  /** значение по умолчанию (родитель из контекста, «я» в исполнителе) — приложение знает, kit нет */
  value?: string;
  /** кнопка «Себя» рядом с полем ставит это значение (владелица: «исполнителя выбирает или кнопка себя») */
  self?: string;
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
  const list = useRef<RefSearchListHandle>(null);

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (key === 'Escape') { onClose(); return true; }
      // Список — общий RefSearchList; в карточке «Новый» и при «тип не знаем» его нет.
      if (card !== 'old' || trigger.unknownType || !list.current) return false;
      return list.current.handleKey(key);
    },
  }), [card, onClose, trigger.unknownType]);

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
        ) : (
          <RefSearchList ref={list} search={search} query={trigger.query} typeLabels={typeLabels} onPick={onPick} onRetry={onRetry}
            onCreateNew={createSpec ? () => setCard('new') : undefined} />
        )
      ) : (
        createSpec && <NewCard trigger={trigger} typeLabels={typeLabels} createSpec={createSpec} onCreate={onCreate} onPick={onPick} onCancel={() => setCard('old')} t={t} />
      )}
    </Popover>
  );
});

function NewCard({ trigger, typeLabels, createSpec, onCreate, onPick, onCancel, t, preset }: {
  trigger: RefTrigger;
  /** поля, заданные ссылкой (тип и ID из текста): подставлены и не правятся — запись заводится под ними */
  preset?: Record<string, string>;
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
  const initial = (fs: RefFieldDef[], query: string) => {
    const v: Record<string, string> = {};
    for (const x of fs) if (x.value) v[x.key] = x.value;
    if (fs[0] && query) v[fs[0].key] = query;
    return { ...v, ...(preset ?? {}) };
  };
  const [values, setValues] = useState<Record<string, string>>(() => initial(fields, trigger.query));
  const [more, setMore] = useState(false);
  const [tried, setTried] = useState(false);
  const [warned, setWarned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const typePick = !trigger.type && (
    <label className="sk-ref__fld">{t('kit.ref.type')}
      <select value={type} onChange={e => {
        const next = createSpec(e.target.value);
        setType(e.target.value); setValues(initial('fields' in next ? next.fields : [], '')); setTried(false); setWarned(false);
      }}>
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
            ) : f.self !== undefined ? (
              <span className="sk-ref__self">
                <input value={values[f.key] ?? ''} onChange={e => set(e.target.value)} />
                <button type="button" className="sk-ref__btn" onClick={() => set(f.self!)}>{t('kit.ref.self')}</button>
              </span>
            ) : (
              <input value={values[f.key] ?? ''} readOnly={preset?.[f.key] !== undefined} onChange={e => set(e.target.value)} />
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

/**
 * MD-WINDOW §3a, кадр 20: «Завести» у красной ссылки — та же карточка «Новый», но под ТЕМ ЖЕ ID:
 * тип и поля из ID (preset) заданы ссылкой и не правятся, остаются обязательные поля записи.
 */
export function RefCreateCard({ id, type, typeLabels, createSpec, onCreate, preset, onDone, onClose }: {
  id: string;
  type: string;
  typeLabels: Record<string, string>;
  createSpec: (type: string) => RefCreateSpec;
  onCreate: NonNullable<RefPickerProps['onCreate']>;
  preset?: Record<string, string>;
  onDone: (item: RefItem) => void;
  onClose: () => void;
}) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  return (
    <Popover onClose={onClose} walk="focusable" arrows={false} className="sk-ref">
      <div data-testid="kit-ref-create">
        <div className="sk-ref__head"><span className="sk-ref__scope">{t('kit.ref.underId', { id })}</span></div>
        <NewCard trigger={{ trigger: 'brackets', type, query: '', start: 0 }} typeLabels={typeLabels} createSpec={createSpec}
          onCreate={onCreate} onPick={onDone} onCancel={onClose} t={t} preset={preset} />
      </div>
    </Popover>
  );
}
