// Вкладка «Граф» (K-04): локальный граф записи — ego в центре, соседи по
// секторам типа ребра, кольца по глубине (config.graph.depth/limit). Узел —
// ссылка на запись с целью касания ≥44px; цвет узла — по типу ребра или по
// вердикту (config.graph.colorBy). Обрезка лимитом сказана словами.
import type { CSSProperties } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { EmptyState, LoadError } from '../states/StateViews';
import { kitT, type KitLang } from '../i18n';
import { edgeColor, egoGraph, verdictTone } from './graph';
import { blockError } from './RecordLinks';

/** Радиус кольца глубины и цель касания — в px viewBox (1 ед. = 1 px). */
const RING = 96;
const HIT = 22;

function nodeColor(r: KitRecord | undefined, sector: string, ctx: KitCtx): string {
  if (ctx.config.graph?.colorBy === 'verdict') {
    if (!r || !ctx.config.verdict) return 'var(--t3)';
    try {
      return `var(--${verdictTone(ctx.config.verdict(r, ctx))})`;
    } catch {
      return 'var(--t3)';
    }
  }
  return edgeColor(ctx.config, sector);
}

export function RecordGraph({ record, ctx, lang }: { record: KitRecord; ctx: KitCtx; lang: KitLang }) {
  const failed = blockError(ctx, 'edges');
  if (failed !== undefined) return <LoadError compact title={kitT(lang, 'kit.record.links.failed')} error={failed} />;
  const depth = ctx.config.graph?.depth ?? 1;
  const limit = ctx.config.graph?.limit ?? 60;
  const g = egoGraph(record.id, ctx.data, { depth, limit });
  if (g.nodes.length === 0) {
    return <EmptyState compact title={kitT(lang, 'kit.record.graph.empty')} hint={kitT(lang, 'kit.record.links.emptyHint')} />;
  }
  const maxDepth = Math.max(...g.nodes.map(n => n.depth));
  const half = RING * maxDepth + HIT + 24;
  const pos = new Map<string, { x: number; y: number }>([[g.center.id, { x: 0, y: 0 }]]);
  for (const n of g.nodes) pos.set(n.id, { x: n.x * RING, y: n.y * RING });
  const label = (r: KitRecord | undefined, id: string) => (r ? `${r.title} (${id})` : id);

  return (
    <div className="sk-rec-graph" data-testid="kit-graph">
      {g.truncated && (
        <p className="sk-rec-note" role="note">
          {kitT(lang, 'kit.record.graph.shown', { shown: g.nodes.length, total: g.total, limit })}
        </p>
      )}
      <svg
        className="sk-rec-graph__svg"
        role="group"
        aria-label={kitT(lang, 'kit.record.graph.label', { id: record.id })}
        viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
        width={half * 2}
        height={half * 2}
      >
        {Array.from({ length: maxDepth }, (_, i) => (
          <circle key={i} className="sk-rec-graph__ring" r={RING * (i + 1)} cx={0} cy={0} />
        ))}
        {g.links.map(l => {
          const a = pos.get(l.from)!;
          const b = pos.get(l.to)!;
          return (
            <line key={`${l.type}:${l.from}:${l.to}`} className="sk-rec-graph__edge" data-type={l.type}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: edgeColor(ctx.config, l.type) }} />
          );
        })}
        <g className="sk-rec-graph__node sk-rec-graph__node--center" data-node={g.center.id} data-center="true">
          <circle r={14} style={{ fill: nodeColor(record, '', ctx) }} />
          <text className="sk-rec-graph__label" y={14 + 14} textAnchor="middle">{record.id}</text>
        </g>
        {g.nodes.map(n => {
          const p = pos.get(n.id)!;
          const style = { '--node-c': nodeColor(n.record, n.sector, ctx) } as CSSProperties;
          return (
            <a key={n.id} href={ctx.href(n.id)} role="link" aria-label={label(n.record, n.id)}
              className="sk-rec-graph__node" data-node={n.id} data-missing={n.record ? undefined : 'true'} style={style}>
              <circle className="sk-rec-graph__hit" cx={p.x} cy={p.y} r={HIT} />
              <circle className="sk-rec-graph__dot" cx={p.x} cy={p.y} r={n.depth === 1 ? 9 : 6} />
              <text className="sk-rec-graph__label" x={p.x} y={p.y + HIT + 4} textAnchor="middle">{n.id}</text>
            </a>
          );
        })}
      </svg>
      <ul className="sk-rec-graph__legend" data-testid="kit-graph-legend" aria-label={kitT(lang, 'kit.record.graph.legend')}>
        {g.sectors.map(s => (
          <li key={s.type} style={{ '--edge-c': edgeColor(ctx.config, s.type) } as CSSProperties}>
            <span className="sk-rec-dot" aria-hidden="true" />
            <span>{ctx.config.edges?.[s.type]?.label ?? s.type}</span>
            <span className="sk-rec-links__count">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
