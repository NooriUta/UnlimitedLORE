// Вкладка «Граф» (K-04): локальный граф записи — ego в центре, соседи по
// секторам типа ребра, кольца по глубине (config.graph.depth/limit). Узел —
// ссылка на запись с целью касания ≥44px; цвет узла — по типу ребра или по
// вердикту (config.graph.colorBy). Обрезка лимитом сказана словами.
//
// S5-10 (SPRINT_UXR_S5_RECORD_TASKS): над графом — глубина 1–3, фильтр типов
// рёбер (кнопки-чипы с подписью словами и счётом) и слой структурных связей
// (config.edges[type].layer === 'structural', скрыт по умолчанию). Состояние —
// в URL (useGraphState). У ребра — подпись из config.edges (title на любом
// ребре, видимый текст — на рёбрах центра). «Фильтры скрыли всё» — отдельное
// честное состояние с кнопкой сброса, а не «связей нет».
import type { CSSProperties } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { EmptyState, LoadError } from '../states/StateViews';
import { Pill } from '../elements/Pill';
import { kitT, type KitLang } from '../i18n';
import { edgeColor, egoGraph, typesAround, verdictTone } from './graph';
import type { EgoCluster } from './graph';
import { GRAPH_DEPTHS, allowedEdgeTypes, edgeLabel, isStructural, useGraphState } from './graphState';
import { blockError } from './RecordLinks';
import { useNarrow } from '../core/narrow';

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

export function RecordGraph(
  { record, ctx, lang, narrow: narrowProp }: { record: KitRecord; ctx: KitCtx; lang: KitLang; narrow?: boolean },
) {
  const { state, setDepth, toggleType, setStructural, reset, toggleOpen, setView } = useGraphState(ctx.config);
  const narrow = useNarrow(narrowProp);
  const failed = blockError(ctx, 'edges');
  if (failed !== undefined) return <LoadError compact title={kitT(lang, 'kit.record.links.failed')} error={failed} />;

  const around = typesAround(record.id, ctx.data, state.depth);
  if (around.length === 0) {
    return <EmptyState compact title={kitT(lang, 'kit.record.graph.empty')} hint={kitT(lang, 'kit.record.links.emptyHint')} />;
  }
  const structuralAround = around.filter(t => isStructural(ctx.config, t.type));
  const chips = around.filter(t => state.structural || !isStructural(ctx.config, t.type));
  const allowed = allowedEdgeTypes(around.map(t => t.type), ctx.config, state);
  const limit = ctx.config.graph?.limit ?? 60;
  const g = egoGraph(record.id, ctx.data, {
    depth: state.depth, limit, types: allowed, expanded: new Set(state.open),
  });
  const off = new Set(state.off);
  // Вид: выбор человека главнее ширины; не выбирал — на телефоне СПИСОК, там
  // холст не читается (S9-08). Порог — общий порог kit, его же знает список.
  const view = state.view ?? (narrow ? 'links' : 'graph');

  const controls = (
    <div className="sk-rec-graph__ctl" role="group" aria-label={kitT(lang, 'kit.record.graph.controls')}>
      <div className="sk-rec-graph__depth" role="group" aria-label={kitT(lang, 'kit.record.graph.depth')}>
        <span className="sk-rec-graph__ctl-label" aria-hidden="true">{kitT(lang, 'kit.record.graph.depth')}</span>
        {GRAPH_DEPTHS.map(d => (
          <Pill key={d} variant="filter" pressed={state.depth === d} onToggle={() => setDepth(d)}
            title={kitT(lang, 'kit.record.graph.depthHint', { n: d })}>
            {String(d)}
          </Pill>
        ))}
      </div>
      <div className="sk-rec-graph__view" role="group" data-testid="kit-graph-view" aria-label={kitT(lang, 'kit.record.graph.view')}>
        <Pill variant="filter" pressed={view === 'graph'} onToggle={() => setView('graph')}
          title={kitT(lang, 'kit.record.graph.viewGraphHint')}>
          {kitT(lang, 'kit.record.graph.viewGraph')}
        </Pill>
        <Pill variant="filter" pressed={view === 'links'} onToggle={() => setView('links')}
          title={kitT(lang, 'kit.record.graph.viewLinksHint')}>
          {kitT(lang, 'kit.record.graph.viewLinks')}
        </Pill>
      </div>
      {structuralAround.length > 0 && (
        <Pill variant="filter" pressed={state.structural} onToggle={setStructural}
          className="sk-rec-graph__layer" title={kitT(lang, 'kit.record.graph.structuralHint')}>
          <span>{kitT(lang, 'kit.record.graph.structural')}</span>
          <span className="sk-rec-links__count">{structuralAround.reduce((n, t) => n + t.count, 0)}</span>
        </Pill>
      )}
    </div>
  );

  const legend = (
    <div className="sk-rec-graph__legend" role="group" data-testid="kit-graph-legend" aria-label={kitT(lang, 'kit.record.graph.legend')}>
      {chips.map(t => (
        <Pill key={t.type} variant="filter" pressed={!off.has(t.type)} onToggle={() => toggleType(t.type)} title={t.type}>
          <span className="sk-rec-dot" aria-hidden="true" style={{ '--edge-c': edgeColor(ctx.config, t.type) } as CSSProperties} />
          <span>{edgeLabel(ctx.config, t.type)}</span>
          <span className="sk-rec-links__count">{t.count}</span>
        </Pill>
      ))}
    </div>
  );

  if (g.nodes.length === 0) {
    const onlyStructural = around.every(t => isStructural(ctx.config, t.type));
    return (
      <div className="sk-rec-graph" data-testid="kit-graph">
        {controls}
        {legend}
        <EmptyState compact title={kitT(lang, 'kit.record.graph.filtered')}
          hint={kitT(lang, 'kit.record.graph.filteredHint', { total: around.reduce((n, t) => n + t.count, 0) })}
          action={(
            <button type="button" className="sk-btn" onClick={() => reset(state.structural || onlyStructural)}>
              {kitT(lang, 'kit.record.graph.reset')}
            </button>
          )} />
      </div>
    );
  }

  /**
   * Подпись кластера: число и ПОДПИСЬ ТИПА РЕБРА из конфига приложения.
   * Слово «релизов» предметное, и kit его не знает (K-14) — он знает «сколько»
   * и «какого типа связь».
   *
   * Выдача обрезана лимитом — число «не меньше», а не точное: под кластером
   * может быть больше. Кластер «149», под которым четыреста, хуже каши — каша
   * видна, а неверное число выглядит знанием.
   */
  const clusterText = (c: EgoCluster) =>
    kitT(lang, c.atLeast ? 'kit.record.graph.clusterAtLeast' : 'kit.record.graph.cluster',
      { n: c.count, label: edgeLabel(ctx.config, c.sector) });

  if (view === 'links') {
    // Список связей: читается на телефоне и не требует раскладки. Однотипные
    // хабы и здесь свёрнуты — сто сорок девять строк это та же каша, только
    // вертикальная.
    const byType = new Map<string, typeof g.nodes>();
    for (const n of g.nodes) {
      const list = byType.get(n.sector);
      if (list) list.push(n); else byType.set(n.sector, [n]);
    }
    return (
      <div className="sk-rec-graph" data-testid="kit-graph">
        {controls}
        {legend}
        <div className="sk-rec-graph__links" data-testid="kit-graph-links">
          {g.clusters.map(c => (
            <section key={"c:" + c.key} className="sk-rec-graph__lgroup" data-cluster={c.key}
              data-at-least={c.atLeast ? 'true' : undefined}>
              <h4 className="sk-rec-graph__lhead">
                <span>{clusterText(c)}</span>
                <button type="button" className="sk-btn" data-cluster-open={c.key}
                  aria-expanded="false" onClick={() => toggleOpen(c.key)}>
                  {kitT(lang, 'kit.record.graph.clusterOpen')}
                </button>
              </h4>
            </section>
          ))}
          {[...byType.entries()].map(([type, list]) => (
            <section key={type} className="sk-rec-graph__lgroup" data-ltype={type}>
              <h4 className="sk-rec-graph__lhead">
                <span>{edgeLabel(ctx.config, type)}</span>
                <span className="sk-rec-links__count">{list.length}</span>
              </h4>
              <ul className="sk-rec-graph__litems">
                {list.map(n => (
                  <li key={n.id}>
                    <a className="sk-rec-graph__lref" href={ctx.href(n.id)} data-node={n.id}
                      data-missing={n.record ? undefined : 'true'}>
                      {n.record ? n.record.title + " (" + n.id + ")" : n.id}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const maxDepth = Math.max(...g.nodes.map(n => n.depth), 1);
  const half = RING * maxDepth + HIT + 24;
  const pos = new Map<string, { x: number; y: number }>([[g.center.id, { x: 0, y: 0 }]]);
  for (const n of g.nodes) pos.set(n.id, { x: n.x * RING, y: n.y * RING });
  const label = (r: KitRecord | undefined, id: string) => (r ? `${r.title} (${id})` : id);

  return (
    <div className="sk-rec-graph" data-testid="kit-graph">
      {controls}
      {legend}
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
          const text = edgeLabel(ctx.config, l.type);
          const key = `${l.type}:${l.from}:${l.to}`;
          return (
            <g key={key} data-edge={key} data-type={l.type}>
              <title>{`${l.from} — ${text} → ${l.to}`}</title>
              <line className="sk-rec-graph__edge" data-structural={isStructural(ctx.config, l.type) ? 'true' : undefined}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: edgeColor(ctx.config, l.type) }} />
            </g>
          );
        })}
        {g.links.filter(l => l.from === g.center.id || l.to === g.center.id).map(l => {
          const a = pos.get(l.from)!;
          const b = pos.get(l.to)!;
          return (
            <text key={`lbl:${l.type}:${l.from}:${l.to}`} className="sk-rec-graph__edge-label" aria-hidden="true"
              x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle">
              {edgeLabel(ctx.config, l.type)}
            </text>
          );
        })}
        <g className="sk-rec-graph__node sk-rec-graph__node--center" data-node={g.center.id} data-center="true">
          <circle r={14} style={{ fill: nodeColor(record, '', ctx) }} />
          <text className="sk-rec-graph__label" y={14 + 14} textAnchor="middle">{record.id}</text>
        </g>
        {/*
          Кластер-хаб: одно место вместо сотни кружков (S9-08). Нарисован как
          кнопка, а не как ссылка: он никуда не ведёт, он раскрывается — и
          работать это обязано без мыши.
        */}
        {g.clusters.map(c => {
          const x = c.x * RING;
          const y = c.y * RING;
          const style = { '--node-c': edgeColor(ctx.config, c.sector) } as CSSProperties;
          return (
            <g key={"c:" + c.key} className="sk-rec-graph__cluster" data-cluster={c.key}
              data-at-least={c.atLeast ? 'true' : undefined} style={style}>
              <title>{clusterText(c)}</title>
              <line className="sk-rec-graph__edge" x1={0} y1={0} x2={x} y2={y}
                style={{ stroke: edgeColor(ctx.config, c.sector) }} />
              <foreignObject x={x - 72} y={y - 16} width={144} height={32}>
                <button type="button" className="sk-btn sk-rec-graph__cbtn" data-cluster-open={c.key}
                  aria-expanded="false" onClick={() => toggleOpen(c.key)}>
                  {clusterText(c)}
                </button>
              </foreignObject>
            </g>
          );
        })}
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
    </div>
  );
}
