// Вкладка «Связи» (K-04): рёбра записи из X_DATA.edges, группами по типу
// ребра (подпись и цвет — config.edges), с направлением. Цель вне выборки
// помечена, а не выброшена; упавший на сервере блок рёбер — ошибка, не «пусто».
import type { CSSProperties } from 'react';
import type { KitCtx, KitEdge, KitRecord } from '../core/contract';
import { EmptyState, LoadError } from '../states/StateViews';
import { kitT, type KitLang } from '../i18n';
import { edgeColor } from './graph';
import { findRecord } from './fmt';

export interface RecordLink { type: string; dir: 'out' | 'in'; other: string }

/** Рёбра записи: тип, направление, другой конец; порядок — тип, out раньше in, id. */
export function recordLinks(id: string, edges: readonly KitEdge[]): RecordLink[] {
  const out: RecordLink[] = [];
  for (const e of edges) {
    if (e.from === id) out.push({ type: e.type, dir: 'out', other: e.to });
    else if (e.to === id) out.push({ type: e.type, dir: 'in', other: e.from });
  }
  return out.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
    || (a.dir === b.dir ? 0 : a.dir === 'out' ? -1 : 1)
    || (a.other < b.other ? -1 : a.other > b.other ? 1 : 0));
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
  const types = [...new Set(links.map(l => l.type))];
  return (
    <div className="sk-rec-links">
      {ctx.data.meta.truncated && <p className="sk-rec-note" role="note">{kitT(lang, 'kit.record.links.truncated')}</p>}
      {types.map(type => {
        const items = links.filter(l => l.type === type);
        const style = { '--edge-c': edgeColor(ctx.config, type) } as CSSProperties;
        return (
          <section key={type} className="sk-rec-links__group" data-testid="kit-link-group" data-type={type} style={style}
            aria-label={ctx.config.edges?.[type]?.label ?? type}>
            <h2 className="sk-rec-links__title">
              <span className="sk-rec-dot" aria-hidden="true" />
              <span>{ctx.config.edges?.[type]?.label ?? type}</span>
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
                    <a className="sk-rec-ref" href={ctx.href(l.other)}>
                      {r ? <span>{r.title}</span> : <span>{l.other}</span>}
                    </a>
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
