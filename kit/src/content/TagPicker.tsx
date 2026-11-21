// Окно тегов в MD (SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE, прототип docs/prototypes/supertags-spike.html).
// «#» перед словом, которое не тип записи, открывает это окно вместо окна ссылки:
//   а · список тегов по набранному: сколько записей уже несут тег и какие поля у него встречаются;
//   б · тег выбран — те же поля к заполнению, все необязательны; «Без полей» ставит голый тег;
//   в · «Поставить тег» — запись полей на ребро делает приложение (source.apply), в текст ложится ОДИН токен
//       [[ЗАПИСЬ#тег]] (это делает TipTapField по onDone); отказ записи — причиной здесь, токена нет.
// Честные состояния: не нашлось ≠ не загрузилось; записи без ID (не сохранена) тег не ставится — сказано словами.
// Предметных имён kit не знает (K-14): какие теги и куда пишутся поля — решает приложение.
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Popover } from '../shell/Popover';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';

/** Тег в подсказке: имя, сколько записей его несут, какие ключи полей встречаются на его рёбрах. */
export interface TagSuggestion { tag: string; uses: number; keys: string[] }

/** Ответ записи: ok — поля после записи (если сервер их вернул), иначе причина отказа словами. */
export type TagApplyResult = { ok: true; fields?: Record<string, string> } | { ok: false; reason: string };

/** Ребро TAGGED_WITH своей записи: поля и отметки «кто и когда поставил / правил». */
export interface TagEdge {
  fields: Record<string, string>;
  tagged_at?: string | null; tagged_by?: string | null;
  changed_at?: string | null; changed_by?: string | null;
}

/** Источник тегов приложения. host — ID записи, в теле которой пишут (null — запись ещё не сохранена). */
export interface TipTapTagSource {
  host: string | null;
  search: (query: string) => Promise<TagSuggestion[]>;
  /** Поставить тег / patch полей: null снимает поле (истории нет). */
  apply: (tag: string, fields: Record<string, string | null>) => Promise<TagApplyResult>;
  /** Поля ребра host→тег для чипа (шаг «г»): null — ребра нет; отказ (throw) — «не смогли загрузить». */
  fields?: (tag: string) => Promise<TagEdge | null>;
  /** Снять тег с записи (ребро удаляется). Нет — кнопки «Снять тег» в поповере чипа нет. */
  remove?: (tag: string) => Promise<TagApplyResult>;
}

export interface TagPickerHandle { handleKey: (key: string) => boolean }

type Found = { state: 'loading' } | { state: 'ok'; items: TagSuggestion[] } | { state: 'error'; reason: string };

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const TagPicker = forwardRef<TagPickerHandle, {
  word: string;
  source: TipTapTagSource;
  onDone: (tag: string) => void;
  onClose: () => void;
}>(function TagPicker({ word, source, onDone, onClose }, ref) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [found, setFound] = useState<Found>({ state: 'loading' });
  const [retry, setRetry] = useState(0);
  const [on, setOn] = useState(0);
  const [chosen, setChosen] = useState<{ tag: string; keys: string[] } | null>(null);

  useEffect(() => {
    if (!source.host) return;
    let live = true;
    setFound({ state: 'loading' });
    source.search(word).then(
      items => { if (live) { setFound({ state: 'ok', items }); setOn(0); } },
      (e: unknown) => { if (live) setFound({ state: 'error', reason: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [word, retry, source]);

  const items = found.state === 'ok' ? found.items : [];
  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (key === 'Escape') { if (chosen) setChosen(null); else onClose(); return true; }
      if (chosen || !items.length) return false;
      if (key === 'ArrowDown') { setOn(i => (i + 1) % items.length); return true; }
      if (key === 'ArrowUp') { setOn(i => (i - 1 + items.length) % items.length); return true; }
      if (key === 'Enter') { const x = items[on]; if (x) setChosen({ tag: x.tag, keys: x.keys }); return true; }
      return false;
    },
  }), [chosen, items, on, onClose]);

  return (
    <Popover onClose={onClose} takeFocus={false} walk="focusable" arrows={false} className="sk-ref sk-tagpick" label={t('kit.tag.label')}>
      <div className="sk-ref__head" data-testid="tag-head">
        <span className="sk-ref__trig">#</span>
        <span className="sk-ref__scope">{t('kit.tag.head')} · «{chosen ? chosen.tag : word}»</span>
      </div>
      {!source.host ? (
        <p className="sk-ref__state">{t('kit.tag.noHost')}</p>
      ) : chosen ? (
        <TagFields tag={chosen.tag} host={source.host} keys={chosen.keys} apply={source.apply} onDone={onDone} onBack={() => setChosen(null)} t={t} />
      ) : found.state === 'loading' ? (
        <p className="sk-ref__state">{t('kit.tag.loading')}</p>
      ) : found.state === 'error' ? (
        <p className="sk-ref__state sk-ref__state--err">
          {t('kit.tag.error', { reason: found.reason })}{' '}
          <button type="button" className="sk-tagpick__link" onClick={() => setRetry(n => n + 1)}>{t('kit.tag.retry')}</button>
        </p>
      ) : (
        <>
          {items.length === 0 && <p className="sk-ref__state">{t('kit.tag.notFound', { q: word })}</p>}
          {items.length > 0 && (
            <ul className="sk-tagpick__list" role="listbox" aria-label={t('kit.tag.label')}>
              {items.map((x, i) => (
                <li key={x.tag} role="option" aria-selected={i === on} className={`sk-tagpick__opt${i === on ? ' is-on' : ''}`}
                  onMouseDown={e => e.preventDefault()} onClick={() => setChosen({ tag: x.tag, keys: x.keys })}>
                  <span className="sk-tagpick__name">#{x.tag}</span>
                  <span className="sk-tagpick__uses">{t('kit.tag.uses', { n: x.uses })}</span>
                  {x.keys.length > 0 && (
                    <span className="sk-tagpick__keys">{x.keys.map(k => <span key={k} className="sk-tagpick__key">{k}</span>)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!items.some(x => x.tag === word) && (
            <button type="button" className="sk-tagpick__link sk-tagpick__new" onClick={() => setChosen({ tag: word, keys: [] })}>
              {t('kit.tag.create', { q: word })}
            </button>
          )}
        </>
      )}
    </Popover>
  );
});

/** б · Поля тега к заполнению: все необязательны, истории нет; плюс одно новое поле «ключ = значение». */
function TagFields({ tag, host, keys, apply, onDone, onBack, t }: {
  tag: string; host: string; keys: string[];
  apply: TipTapTagSource['apply'];
  onDone: (tag: string) => void;
  onBack: () => void;
  t: (k: KitKey, v?: Record<string, string | number>) => string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const keyBad = newKey !== '' && !KEY_RE.test(newKey);

  const send = async (withFields: boolean) => {
    const fields: Record<string, string> = {};
    if (withFields) {
      for (const [k, v] of Object.entries(values)) if (v.trim()) fields[k] = v.trim();
      if (newKey && !keyBad && newVal.trim()) fields[newKey] = newVal.trim();
    }
    setBusy(true);
    setFailed(null);
    try {
      const r = await apply(tag, fields);
      if (r.ok) onDone(tag); else setFailed(r.reason);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sk-tagpick__form">
      <div className="sk-tagpick__edge">#{tag} → {host}</div>
      {keys.map(k => (
        <label key={k} className="sk-tagpick__row">
          <span className="sk-tagpick__lab">{k}</span>
          <input aria-label={k} value={values[k] ?? ''} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} />
        </label>
      ))}
      <div className="sk-tagpick__row sk-tagpick__row--new">
        <input aria-label={t('kit.tag.newKey')} placeholder={t('kit.tag.newKey')} value={newKey} onChange={e => setNewKey(e.target.value)} />
        <input aria-label={t('kit.tag.newValue')} placeholder={t('kit.tag.newValue')} value={newVal} onChange={e => setNewVal(e.target.value)} />
      </div>
      {keyBad && <p className="sk-ref__state sk-ref__state--err">{t('kit.tag.keyBad')}</p>}
      <p className="sk-tagpick__note">{t('kit.tag.hint')}</p>
      {failed && <p className="sk-ref__state sk-ref__state--err" role="alert">{t('kit.tag.failed', { reason: failed })}</p>}
      <div className="sk-tagpick__btns">
        <button type="button" className="sk-tagpick__link" onClick={onBack} disabled={busy}>{t('kit.tag.back')}</button>
        <button type="button" onClick={() => void send(false)} disabled={busy}>{t('kit.tag.bare')}</button>
        <button type="button" className="is-pri" onClick={() => void send(true)} disabled={busy || keyBad}>{busy ? t('kit.tag.applying') : t('kit.tag.apply')}</button>
      </div>
    </div>
  );
}
