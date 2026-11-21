// Чип тега в TipTap и правка его полей (SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE, шаг «г» прототипа
// docs/prototypes/supertags-spike.html).
//   · токен [[ЗАПИСЬ#тег]] в визуальном режиме рисуется чипом «#тег» с краткими полями (до трёх значений) —
//     как в чтении (MartProse, .sk-wref--tag). В markdown остаётся тот же токен: это только отображение;
//   · щелчок/касание по чипу (или Enter на выделенном чипе) открывает поповер полей ребра TAGGED_WITH.
//     Запись — через приложение (source.apply: null снимает поле), «Снять тег» — подтверждением прямо здесь.
// Честные состояния: «загружаю» ≠ «полей нет» ≠ «не смогли загрузить»; «Сохраняю…», «Не сохранилось: причина».
// Правится только тег СВОЕЙ записи (host источника): токен чужой записи — чип без правки.
import { useState } from 'react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { Popover } from '../shell/Popover';
import { IconButton } from '../elements/IconButton';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';
import { mdRawLabel } from './markdownLossless';
import { kitDay } from '../core/fmtValue';
import type { TagEdge, TipTapTagSource } from './TagPicker';

/** Токен тега [[ЗАПИСЬ#тег]] → {host, tag}; любая другая ссылка — null. Тот же разбор, что у чтения (markdownWiki). */
export function parseTagToken(raw: string): { host: string; tag: string } | null {
  const m = /^\[\[([^[\]\n]{1,200})\]\]$/.exec(raw.trim());
  if (!m) return null;
  const inner = m[1].trim();
  const typed = /^([a-z]+):(.+)$/i.exec(inner);
  const full = typed ? typed[2].trim() : inner;
  const tg = /^(.+?)#([\p{L}\p{N}][\p{L}\p{N}_.-]*)$/u.exec(full);
  return tg ? { host: tg[1], tag: tg[2] } : null;
}

export type TagEdgeState =
  | { state: 'loading' }
  | { state: 'ok'; edge: TagEdge | null }
  | { state: 'error'; reason: string };

/** Поля рёбер по тегу (для своей записи): один запрос на тег, чипы подписаны на изменения. */
export class TagChipStore {
  private map = new Map<string, TagEdgeState>();
  private subs = new Set<() => void>();
  constructor(private source: () => TipTapTagSource | undefined) {}
  get(tag: string): TagEdgeState | undefined { return this.map.get(tag); }
  set(tag: string, st: TagEdgeState) { this.map.set(tag, st); this.subs.forEach(f => f()); }
  subscribe(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }
  ensure(tag: string) { if (!this.map.has(tag)) this.load(tag); }
  load(tag: string) {
    const fields = this.source()?.fields;
    if (!fields) { this.set(tag, { state: 'ok', edge: null }); return; }
    this.set(tag, { state: 'loading' });
    fields(tag).then(
      edge => this.set(tag, { state: 'ok', edge }),
      (e: unknown) => this.set(tag, { state: 'error', reason: e instanceof Error ? e.message : String(e) }),
    );
  }
}

const MAX_VALUES = 3;

/** Кому принадлежит чип: свой ли он (host совпал) — тогда поля грузятся и щелчок открывает правку. */
export interface TagChipEnv {
  store: TagChipStore;
  host: () => string | null;
  lang: () => Parameters<typeof kitT>[0];
  onOpen: (tag: string, el: HTMLElement) => void;
}

/** Обычный вид атома-исходника — как renderHTML у mdRaw (markdownLossless). */
function plainRaw(node: PMNode): HTMLElement {
  const kind = String(node.attrs.kind);
  const raw = String(node.attrs.raw);
  const el = document.createElement('span');
  el.className = `sk-md__raw sk-md__raw--${kind}`;
  el.setAttribute('data-md-raw', kind);
  el.setAttribute('data-raw', raw);
  el.textContent = mdRawLabel(kind, raw);
  return el;
}

function chipView(node: PMNode, env: TagChipEnv): NodeView {
  const raw = String(node.attrs.raw);
  const tok = node.attrs.kind === 'wikilink' ? parseTagToken(raw) : null;
  if (!tok) {
    const dom = plainRaw(node);
    return { dom, update: n => n.type === node.type && n.attrs.raw === raw && n.attrs.kind === node.attrs.kind, ignoreMutation: () => true };
  }
  const host = env.host();
  const own = host !== null && tok.host === host;
  const dom = document.createElement('span');
  dom.className = 'sk-md__raw sk-md__raw--wikilink sk-md__tagchip';
  dom.setAttribute('data-md-raw', 'wikilink');
  dom.setAttribute('data-raw', raw);
  dom.setAttribute('data-tag', tok.tag);
  dom.setAttribute('contenteditable', 'false');
  const name = document.createElement('span');
  name.className = 'sk-md__tagchip-name';
  name.textContent = `#${tok.tag}`;
  const vals = document.createElement('span');
  vals.className = 'sk-md__tagchip-vals';
  dom.append(name, vals);
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(env.lang(), k, v);

  const paint = () => {
    if (!own) {
      // Нет источника тегов (или запись не сохранена) — просто чип, как в чтении; чужая запись — сказано.
      dom.setAttribute('data-tag-state', host === null ? 'view' : 'foreign');
      dom.title = host === null ? `${tok.host} · #${tok.tag}` : t('kit.tagchip.foreign', { host: tok.host, tag: tok.tag });
      vals.textContent = '';
      return;
    }
    const st = env.store.get(tok.tag) ?? { state: 'loading' as const };
    dom.setAttribute('data-tag-state', st.state === 'ok' ? (st.edge ? 'ok' : 'noedge') : st.state);
    dom.setAttribute('role', 'button');
    if (st.state === 'loading') { vals.textContent = ''; dom.title = t('kit.tagchip.loading'); return; }
    if (st.state === 'error') { vals.textContent = '?'; dom.title = t('kit.tagchip.chipError', { reason: st.reason }); return; }
    if (!st.edge) { vals.textContent = ''; dom.title = t('kit.tagchip.chipNoEdge'); return; }
    const entries = Object.entries(st.edge.fields).filter(([, v]) => v !== '');
    const shown = entries.slice(0, MAX_VALUES).map(([, v]) => v);
    const more = entries.length - shown.length;
    vals.textContent = shown.length ? shown.join(' · ') + (more > 0 ? ` +${more}` : '') : '';
    dom.title = entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join('\n') : t('kit.tagchip.noFields');
  };
  paint();
  const off = own ? env.store.subscribe(paint) : () => {};
  if (own) env.store.ensure(tok.tag);
  const onClick = (e: MouseEvent) => {
    if (!own) return;
    e.preventDefault();
    env.onOpen(tok.tag, dom);
  };
  dom.addEventListener('click', onClick);
  return {
    dom,
    update: n => n.type === node.type && n.attrs.raw === raw && n.attrs.kind === node.attrs.kind,
    ignoreMutation: () => true,
    stopEvent: e => e.type === 'click' && own,
    destroy: () => { off(); dom.removeEventListener('click', onClick); },
  };
}

const chipKey = new PluginKey('skTagChip');

/** Вид атомов mdRaw: токен тега — чип; прочие — как раньше (renderHTML). Схема и сериализация не меняются. */
export function tagChipExtension(env: TagChipEnv) {
  return Extension.create({
    name: 'skTagChip',
    addProseMirrorPlugins() {
      return [new Plugin({ key: chipKey, props: { nodeViews: { mdRaw: node => chipView(node, env) } } })];
    },
  });
}

/** г · Поповер полей ребра: правка, снятие поля (null), снятие тега с подтверждением на месте. */
export function TagChipEditor({ tag, host, state, source, onSaved, onRemoved, onRetry, onClose }: {
  tag: string;
  host: string;
  state: TagEdgeState;
  source: TipTapTagSource;
  onSaved: (fields: Record<string, string>) => void;
  onRemoved: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const orig = state.state === 'ok' && state.edge ? state.edge.fields : {};
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...orig }));
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'remove'>(null);
  const [failed, setFailed] = useState<{ kind: 'save' | 'remove'; reason: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const keyBad = newKey !== '' && !/^[a-z][a-z0-9_]{0,39}$/.test(newKey);
  const edge = state.state === 'ok' ? state.edge : null;
  const stamp = edge ? (edge.changed_at ? { at: edge.changed_at, by: edge.changed_by } : edge.tagged_at ? { at: edge.tagged_at, by: edge.tagged_by } : null) : null;

  const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const save = async () => {
    const patch: Record<string, string | null> = {};
    for (const [k, v0] of Object.entries(orig)) {
      const v = (values[k] ?? '').trim();
      if (!v) patch[k] = null; else if (v !== v0) patch[k] = v;
    }
    if (newKey && !keyBad && newVal.trim()) patch[newKey] = newVal.trim();
    // Ребра нет (токен есть, тега нет) — «Сохранить» ставит тег, даже без полей.
    if (Object.keys(patch).length === 0 && edge) { onClose(); return; }
    setBusy('save');
    setFailed(null);
    try {
      const r = await source.apply(tag, patch);
      if (!r.ok) { setFailed({ kind: 'save', reason: r.reason }); return; }
      const merged: Record<string, string> = r.fields ?? Object.fromEntries(
        Object.entries({ ...orig, ...patch }).filter((e): e is [string, string] => e[1] != null && e[1] !== ''),
      );
      onSaved(merged);
    } catch (e) {
      setFailed({ kind: 'save', reason: reasonOf(e) });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!source.remove) return;
    setBusy('remove');
    setFailed(null);
    try {
      const r = await source.remove(tag);
      if (r.ok) onRemoved(); else setFailed({ kind: 'remove', reason: r.reason });
    } catch (e) {
      setFailed({ kind: 'remove', reason: reasonOf(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover onClose={onClose} walk="focusable" arrows={false} className="sk-ref sk-tagpick sk-tagchip-pop"
      initialFocus={r => r.querySelector<HTMLElement>('input, button')}>
      <div role="dialog" aria-label={`${t('kit.tagchip.title')} #${tag}`}>
        <div className="sk-ref__head">
          <span className="sk-ref__trig">#</span>
          <span className="sk-ref__scope">{tag} · {host}</span>
          {stamp && <span className="sk-tagchip-pop__stamp">{t('kit.tagchip.changed', { at: kitDay(stamp.at)?.text ?? stamp.at, by: stamp.by ?? '—' })}</span>}
        </div>
        {state.state === 'loading' ? (
          <p className="sk-ref__state">{t('kit.tagchip.loading')}</p>
        ) : state.state === 'error' ? (
          <p className="sk-ref__state sk-ref__state--err">
            {t('kit.tagchip.loadError', { reason: state.reason })}{' '}
            <button type="button" className="sk-tagpick__link" onClick={onRetry}>{t('kit.tag.retry')}</button>
          </p>
        ) : (
          <div className="sk-tagpick__form">
            {!edge && <p className="sk-ref__state">{t('kit.tagchip.noEdge')}</p>}
            {edge && Object.keys(orig).length === 0 && <p className="sk-tagpick__note">{t('kit.tagchip.noFields')}</p>}
            {Object.keys(orig).map(k => (
              <div key={k} className="sk-tagpick__row sk-tagchip-pop__row">
                <label className="sk-tagpick__lab" htmlFor={`sk-tagchip-${k}`}>{k}</label>
                <input id={`sk-tagchip-${k}`} aria-label={k} value={values[k] ?? ''} placeholder={t('kit.tagchip.cleared')}
                  disabled={busy !== null} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} />
                <IconButton icon="cross-mark" label={t('kit.tagchip.clear', { key: k })} iconSize={12} disabled={busy !== null || !(values[k] ?? '')}
                  onClick={() => setValues(v => ({ ...v, [k]: '' }))} />
              </div>
            ))}
            <div className="sk-tagpick__row sk-tagpick__row--new">
              <input aria-label={t('kit.tag.newKey')} placeholder={t('kit.tag.newKey')} value={newKey} disabled={busy !== null} onChange={e => setNewKey(e.target.value)} />
              <input aria-label={t('kit.tag.newValue')} placeholder={t('kit.tag.newValue')} value={newVal} disabled={busy !== null} onChange={e => setNewVal(e.target.value)} />
            </div>
            {keyBad && <p className="sk-ref__state sk-ref__state--err">{t('kit.tag.keyBad')}</p>}
            <p className="sk-tagpick__note">{t('kit.tagchip.hint')}</p>
          </div>
        )}
        {busy && <p className="sk-ref__state" role="status">{t(busy === 'save' ? 'kit.tagchip.saving' : 'kit.tagchip.removing')}</p>}
        {failed && (
          <p className="sk-ref__state sk-ref__state--err" role="alert">
            {t(failed.kind === 'save' ? 'kit.tagchip.failed' : 'kit.tagchip.removeFailed', { reason: failed.reason })}
          </p>
        )}
        {asking ? (
          <div className="sk-tagchip-pop__ask">
            <p className="sk-tagpick__note">{t('kit.tagchip.removeAsk', { tag, host })}</p>
            <div className="sk-tagpick__btns">
              <button type="button" onClick={() => setAsking(false)} disabled={busy !== null}>{t('kit.tagchip.cancel')}</button>
              <button type="button" className="is-danger" onClick={() => void remove()} disabled={busy !== null}>{t('kit.tagchip.removeYes')}</button>
            </div>
          </div>
        ) : (
          <div className="sk-tagpick__btns">
            {source.remove && (
              <button type="button" className="sk-tagchip-pop__remove" onClick={() => { setFailed(null); setAsking(true); }} disabled={busy !== null}>
                {t('kit.tagchip.remove')}
              </button>
            )}
            {state.state === 'ok' && (
              <button type="button" className="is-pri" onClick={() => void save()} disabled={busy !== null || keyBad}>{t('kit.tagchip.save')}</button>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

