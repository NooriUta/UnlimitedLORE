// Вкладка «Связи» (K-04): рёбра записи из X_DATA.edges, группами по типу
// ребра (подпись и цвет — config.edges), с направлением. Цель вне выборки
// помечена, а не выброшена; упавший на сервере блок рёбер — ошибка, не «пусто».
import type { CSSProperties } from 'react';
import type { KitCtx, KitEdge, KitRecord } from '../core/contract';
import { EmptyState, LoadError } from '../states/StateViews';
import { kitT, type KitLang } from '../i18n';
import { edgeColor } from './graph';
import { findRecord } from './fmt';
import { ObjectMention } from '../elements/ObjectMention';

export interface RecordLink { type: string; dir: 'out' | 'in'; other: string; /** Вид другого конца, если его назвало ребро (K4-MENTION-LOOK). */ kind?: string }

/** Рёбра записи: тип, направление, другой конец; порядок — тип, out раньше in, id. */
export function recordLinks(id: string, edges: readonly KitEdge[]): RecordLink[] {
  const out: RecordLink[] = [];
  for (const e of edges) {
    if (e.from === id) out.push({ type: e.type, dir: 'out', other: e.to, ...(e.toKind ? { kind: e.toKind } : {}) });
    else if (e.to === id) out.push({ type: e.type, dir: 'in', other: e.from, ...(e.fromKind ? { kind: e.fromKind } : {}) });
  }
  return out.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
    || (a.dir === b.dir ? 0 : a.dir === 'out' ? -1 : 1)
    || (a.other < b.other ? -1 : a.other > b.other ? 1 : 0));
}

/** Подпись группы связей: слово и признак «подписи с этой стороны нет — показана другая». */
export interface LinkLabel { label: string; reverseMissing: boolean }

/**
 * Подпись ребра словами ПО СТОРОНЕ (K5-MODEL-NAV-EDGE-LABELS).
 *
 * Исходящие: `config.edges.label` (у LORE подписи там выверены) → `config.edgeLabels.out` (из
 * документа модели) → связь вида записи с той же стороной → связь любого вида с той же стороной.
 * Входящие: `config.edges.labelIn` → `config.edgeLabels.in` (из `inverse_label` модели) → связь вида
 * записи со стороной in → любого вида со стороной in. Подписи с этой стороны нет нигде — подпись другой
 * стороны (в т. ч. `config.edges.label` у входящих) с признаком `reverseMissing`: вкладка пишет её
 * словами «входящая: …» — «требует» и «нужна для» разные слова (методика §7.3.2). Нет ничего — код.
 */
export function linkLabel(ctx: KitCtx, recordKind: string, type: string, dir: 'out' | 'in' = 'out'): LinkLabel {
  const edge = ctx.config.edges?.[type];
  const pair = ctx.config.edgeLabels?.[type];
  const kindSide = (d: 'out' | 'in'): string | undefined => {
    const own = ctx.config.kinds[recordKind]?.relations?.find(r => r.rel === type && r.dir === d)?.label;
    if (own) return own;
    for (const k of Object.values(ctx.config.kinds)) {
      const l = k.relations?.find(r => r.rel === type && r.dir === d)?.label;
      if (l) return l;
    }
    return undefined;
  };
  const other: 'out' | 'in' = dir === 'out' ? 'in' : 'out';
  const same = (dir === 'out' ? edge?.label : edge?.labelIn) || pair?.[dir] || kindSide(dir);
  if (same) return { label: same, reverseMissing: false };
  const opposite = (other === 'out' ? edge?.label : edge?.labelIn) || pair?.[other] || kindSide(other);
  if (opposite) return { label: opposite, reverseMissing: true };
  return { label: type, reverseMissing: false };
}

/** Прежняя подпись без стороны — исходящая (совместимость для внешних вызовов). */
export function linkGroupLabel(ctx: KitCtx, recordKind: string, type: string, dir: 'out' | 'in' = 'out'): string {
  return linkLabel(ctx, recordKind, type, dir).label;
}

/** Ошибка блока данных из meta.errors (block: 'edges' | 'journal' …). */
export function blockError(ctx: KitCtx, block: string): string | undefined {
  return ctx.data.meta.errors?.find(e => e.block === block)?.reason;
}

export function RecordLinks({ record, ctx, lang }: { record: KitRecord; ctx: KitCtx; lang: KitLang }) {
  const failed = blockError(ctx, 'edges');
  if (failed !== undefined) return <LoadError compact title={kitT(lang, 'kit.record.links.failed')} error={failed} />;
  const links = recordLinks(record.id, ctx.data.edges);
  if (links.length === 0) {
    return <EmptyState compact title={kitT(lang, 'kit.record.links.empty')} hint={kitT(lang, 'kit.record.links.emptyHint')} />;
  }
  // Группа — ребро И сторона (K5-MODEL-NAV-EDGE-LABELS): исходящие и входящие одной связи
  // подписаны разными словами («требует» / «нужна для»), поэтому в одну группу не сводятся.
  const groups = [...new Map(links.map(l => [`${l.type}\u0000${l.dir}`, { type: l.type, dir: l.dir }] as const)).values()];
  return (
    <div className="sk-rec-links">
      {ctx.data.meta.truncated && <p className="sk-rec-note" role="note">{kitT(lang, 'kit.record.links.truncated')}</p>}
      {groups.map(({ type, dir }) => {
        const items = links.filter(l => l.type === type && l.dir === dir);
        const style = { '--edge-c': edgeColor(ctx.config, type) } as CSSProperties;
        const found = linkLabel(ctx, record.kind, type, dir);
        // Подписи с этой стороны нет — сторона названа словами («входящая: Требует»), а не то же слово.
        const reverseMissing = found.reverseMissing;
        const label = reverseMissing ? `${kitT(lang, dir === 'out' ? 'kit.record.links.out' : 'kit.record.links.in')}: ${found.label}` : found.label;
        return (
          <section key={`${type}:${dir}`} className="sk-rec-links__group" data-testid="kit-link-group" data-type={type} data-dir={dir} style={style}
            aria-label={label}>
            <h2 className="sk-rec-links__title">
              <span className="sk-rec-dot" aria-hidden="true" />
              <span title={reverseMissing ? kitT(lang, 'kit.record.links.reverseMissingHint') : undefined}>{label}</span>
              <code className="sk-rec-links__code">{type}</code>
              <span className="sk-rec-links__count">{items.length}</span>
            </h2>
            <ul className="sk-rec-links__list">
              {items.map(l => {
                const r = findRecord(ctx, l.other);
                const dirLabel = kitT(lang, l.dir === 'out' ? 'kit.record.links.out' : 'kit.record.links.in');
                return (
                  <li key={`${l.dir}:${l.other}`} className="sk-rec-links__item" data-missing={r ? undefined : 'true'}>
                    <span className="sk-rec-links__dir" title={dirLabel}>
                      <span aria-hidden="true">{l.dir === 'out' ? '→' : '←'}</span>
                      <span className="sk-sr">{dirLabel}</span>
                    </span>
                    {/* K4-MENTION-LOOK: значок и цвет вида — общим элементом упоминания. */}
                    <ObjectMention id={l.other} kind={r?.kind ?? l.kind} title={r?.title}
                      href={ctx.href(l.other)} kinds={ctx.config.kinds} className="sk-rec-ref" />
                    {r && <span className="sk-pill sk-pill--id">{l.other}</span>}
                    {r && <span className="sk-rec-links__kind">{ctx.config.kinds[r.kind]?.title ?? r.kind}</span>}
                    {!r && <span className="sk-rec-links__missing">{kitT(lang, 'kit.record.links.missing')}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
