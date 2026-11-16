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
import type { KitCtx, KitRecord } from '../core/contract';
import { EmptyState, LoadError } from '../states/StateViews';
import { Pill } from '../elements/Pill';
import { kitT, pluralForm, type KitLang } from '../i18n';
import { edgeColor, egoGraph, typesAround } from './graph';
import type { EgoCluster } from './graph';
import { CheckMenu } from '../elements/CheckMenu';
import type { GraphDepth } from './graphState';
import { DEFAULT_GRAPH_VIEW, GRAPH_DEPTHS, GRAPH_VIEWS, rememberedGraphView, allowedEdgeTypes, edgeLabel, isStructural, useGraphState } from './graphState';
import { blockError } from './RecordLinks';
import { useRef } from 'react';
import { GraphExplorer } from '../graph/GraphExplorer';
import type { GxEdge, GxEngine, GxNode, GxStyle } from '../graph/settings';
import type { GraphView } from './graphState';

/** Вид узла-кластера в Force/Обсидиане (PU-11); ключом вида записи не бывает. */
const CLUSTER_KIND = '@kit:cluster';

export function RecordGraph(
  { record, ctx, lang }: { record: KitRecord; ctx: KitCtx; lang: KitLang; /** Прежний признак узкого экрана: вид больше от ширины не зависит (16.11). */ narrow?: boolean },
) {
  const { state, setDepth, toggleType, setStructural, reset, toggleOpen, setView } = useGraphState(ctx.config);
  const failed = blockError(ctx, 'edges');
  if (failed !== undefined) return <LoadError compact title={kitT(lang, 'kit.record.links.failed')} error={failed} />;

  // Типы связей: сервер знает ВСЕ типы окрестности (graphRels) — и снятые фильтром тоже;
  // без него — посчитанные по пришедшим данным, как раньше.
  const serverRels = ctx.data.meta.graphRels;
  const around = serverRels?.length
    ? serverRels.map(r => ({ type: r.rel, count: r.count }))
    : typesAround(record.id, ctx.data, state.depth);
  if (around.length === 0) {
    return <EmptyState compact title={kitT(lang, 'kit.record.graph.empty')} hint={kitT(lang, 'kit.record.links.emptyHint')} />;
  }
  const structuralAround = around.filter(t => isStructural(ctx.config, t.type));
  const chips = around.filter(t => state.structural || !isStructural(ctx.config, t.type));
  const allowed = allowedEdgeTypes(around.map(t => t.type), ctx.config, state);
  const limit = ctx.config.graph?.limit ?? 60;
  // S9-08 (препрод 14.11): число кластера — точное из счётчика рёбер сервера, если он есть
  // (на шаге 1 рёбра типа = соседи типа); «не меньше» — только когда выдача ИСТОЧНИКА неполна
  // и точного числа нет. Свой лимит рисования неполнотой не считается.
  const exact = state.depth === 1 && serverRels?.length && !ctx.data.meta.graphRelsCut
    ? new Map(serverRels.map(r => [r.rel, r.count] as const))
    : undefined;
  const g = egoGraph(record.id, ctx.data, {
    depth: state.depth, limit, types: allowed, expanded: new Set(state.open),
    incomplete: !!ctx.data.meta.truncated, exact,
  });
  const off = new Set(state.off);
  // Вид: выбор человека главнее ширины; не выбирал — на телефоне СПИСОК, там
  // холст не читается (S9-08). Порог — общий порог kit, его же знает список.
  // GC-03: умолчание вида может прийти от приложения (у LORE — личная настройка
  // человека); выбор в адресе всё равно главнее. На телефоне без того и другого — список.
  // Владелица 16.11: «уберите из раздела графиков связи списком и первый прототип, оставьте только
  // последние 3» — виды Force · Обсидиан · Структура; первым — «либо обсидиан либо предыдущий».
  // Порядок: адрес → настройка приложения → прежний выбор человека → Обсидиан. Старое
  // «graph»/«links» ни на одном уровне не принимается — сводится к следующему (graphState).
  const appView = ctx.config.graph?.view;
  const view: GraphView = state.view ?? (appView && GRAPH_VIEWS.includes(appView) ? appView : null) ?? rememberedGraphView() ?? DEFAULT_GRAPH_VIEW;

  const controls = (
    <div className="sk-rec-graph__ctl" role="group" aria-label={kitT(lang, 'kit.record.graph.controls')}>
      {/* S9-08, владелица 14.11: «сделай выбор, сколько шагов от записи пройти … дропдауном». */}
      <label className="sk-rec-graph__depth">
        <span className="sk-rec-graph__ctl-label">{kitT(lang, 'kit.record.graph.steps')}</span>
        <select className="sk-rec-graph__select" value={state.depth}
          onChange={e => setDepth(Number(e.target.value) as GraphDepth)}>
          {GRAPH_DEPTHS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <div className="sk-rec-graph__view" role="group" data-testid="kit-graph-view" aria-label={kitT(lang, 'kit.record.graph.view')}>
        <Pill variant="filter" pressed={view === 'force'} onToggle={() => setView('force')}
          title={kitT(lang, 'kit.record.graph.viewForceHint')}>
          {kitT(lang, 'kit.record.graph.viewForce')}
        </Pill>
        <Pill variant="filter" pressed={view === 'obsidian'} onToggle={() => setView('obsidian')}
          title={kitT(lang, 'kit.record.graph.viewObsidianHint')}>
          {kitT(lang, 'kit.record.graph.viewObsidian')}
        </Pill>
        <Pill variant="filter" pressed={view === 'structure'} onToggle={() => setView('structure')}
          title={kitT(lang, 'kit.record.graph.viewStructureHint')}>
          {kitT(lang, 'kit.record.graph.viewStructure')}
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

  const notes = ctx.data.meta.graphNotes ?? [];
  const legend = (
    <>
    {/* S9-08, владелица 14.11: «выбор типа не полем, а дропдауном» — галочки вместо чипов. */}
    <div className="sk-rec-graph__legend" data-testid="kit-graph-legend">
      <CheckMenu lang={lang} label={kitT(lang, 'kit.record.graph.legend')} onToggle={toggleType}
        items={chips.map(t => ({ key: t.type, label: edgeLabel(ctx.config, t.type), color: edgeColor(ctx.config, t.type), count: t.count, checked: !off.has(t.type) }))} />
    </div>
    {notes.length > 0 && (
      <ul className="sk-rec-graph__notes" data-testid="kit-graph-notes">
        {notes.map(n => <li key={n}>{n}</li>)}
      </ul>
    )}
    </>
  );

  if (g.nodes.length === 0 && g.clusters.length === 0) {
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
  const byId = new Map(ctx.data.records.map(r => [r.id, r] as const));
  const clusterText = (c: EgoCluster) => {
    // PU-11: все свёрнутые одного вида и приложение дало формы слова — «27 спек ▸»: человек
    // ищет, ЧЕГО там 27, а не как называется связь. Иначе — прежняя подпись типом связи.
    // Приёмка 14.11: под одним типом связи бывают узлы РАЗНЫХ видов (у компонента DOCUMENTED_IN —
    // спеки и технологии), тогда — счёт по каждому виду: «25 спек · 23 технологии ▸». Код связи —
    // только если у какого-то вида нет форм слова (или вид узла неизвестен).
    const perKind = new Map<string, number>();
    for (const id of c.ids) {
      const k = byId.get(id)?.kind ?? '';
      perKind.set(k, (perKind.get(k) ?? 0) + 1);
    }
    const parts = [...perKind].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => {
      const forms = k ? ctx.config.graph?.types?.[k]?.count : undefined;
      return forms ? (forms[pluralForm(lang, n)] ?? forms.many).replace('{n}', String(n)) : null;
    });
    // Точный счёт сервера больше загруженного — разбивка по видам из загруженного соврала бы;
    // один вид — его формы слова с точным числом, несколько — подпись типом связи.
    if (c.count !== c.ids.length) {
      const only = perKind.size === 1 ? [...perKind.keys()][0] : '';
      const forms = only ? ctx.config.graph?.types?.[only]?.count : undefined;
      if (forms) {
        const what = (forms[pluralForm(lang, c.count)] ?? forms.many).replace('{n}', String(c.count));
        return `${c.atLeast ? kitT(lang, 'kit.record.graph.clusterAtLeastKind', { what }) : what} ▸`;
      }
      parts.length = 0;
    }
    if (parts.length > 0 && parts.every(p => p !== null)) {
      const what = parts.join(' · ');
      return `${c.atLeast ? kitT(lang, 'kit.record.graph.clusterAtLeastKind', { what }) : what} ▸`;
    }
    return kitT(lang, c.atLeast ? 'kit.record.graph.clusterAtLeast' : 'kit.record.graph.cluster',
      { n: c.count, label: edgeLabel(ctx.config, c.sector) });
  };
  const clusterId = (key: string) => `cluster:${key}`;

  // GC-03: граф знаний — тот же круг записей (глубина и фильтры вкладки), но
  // живой физикой и без свёртки хабов: в Force/Обсидиане хаб читается сам.
  // PU-11: правило кластера одно для всех раскладок — хаб и здесь один узел (раньше в
  // Force/Обсидиане 27 спек шли поштучно и подписи слипались). Выбор кластера даёт «раскрыть».
  const clusterNodes = g.clusters.map(c => ({ id: clusterId(c.key), kind: CLUSTER_KIND, title: clusterText(c) }));
  const clusterLinks = g.clusters.map(c => (c.dir === 'in'
    ? { from: clusterId(c.key), to: record.id, type: c.sector }
    : { from: record.id, to: clusterId(c.key), type: c.sector }));
  const byCluster = new Map(g.clusters.map(c => [clusterId(c.key), c]));
  return (
    <div className="sk-rec-graph" data-testid="kit-graph">
      {controls}
      {legend}
      <RecordGraphExplorer record={record} ctx={ctx} lang={lang} engine={view} onEngine={setView}
        nodes={[...g.nodes, ...clusterNodes]} links={[...g.links, ...clusterLinks]}
        cluster={{
          is: id => byCluster.has(id),
          open: id => { const c = byCluster.get(id); if (c) toggleOpen(c.key); },
          label: kitT(lang, 'kit.record.graph.clusterKind'),
        }} />
    </div>
  );
}

const KIND_TONES = ['--acc', '--inf', '--suc', '--wrn', '--dng', '--t2'] as const;

/**
 * Вкладка «Граф» в видах Force и «Обсидиан» (GC-03): данные вкладки → общий
 * GraphExplorer. Узел — запись, тип узла — её вид (kinds приложения), связь —
 * тип ребра с подписью и цветом из config.edges. Переход к записи — той же
 * ссылкой, что у секторов (ctx.href), чтобы приложение перехватило её как обычно.
 */
function RecordGraphExplorer({ record, ctx, lang, engine, onEngine, nodes, links, cluster }: {
  record: KitRecord; ctx: KitCtx; lang: KitLang; engine: GxEngine; onEngine: (v: GraphView) => void;
  nodes: { id: string; record?: KitRecord; depth?: number; kind?: string; title?: string }[]; links: { from: string; to: string; type: string }[];
  /** PU-11: узлы-кластеры хабов — подпись типа, распознавание и раскрытие. */
  cluster?: { is: (id: string) => boolean; open: (id: string) => void; label: string };
}) {
  const host = useRef<HTMLDivElement>(null);
  const kindKeys = Object.keys(ctx.config.kinds);
  const types: Record<string, GxStyle> = {};
  // K4-MENTION-LOOK: цвет вида от приложения — тот же, что у упоминания; нет — тон по порядку.
  kindKeys.forEach((k, i) => { types[k] = { label: ctx.config.kinds[k].title, color: ctx.config.kinds[k].color || KIND_TONES[i % KIND_TONES.length] }; });
  // GC-04: типы от приложения главнее — иначе у соседей чужого типа ни подписи, ни цвета.
  for (const [k, v] of Object.entries(ctx.config.graph?.types ?? {})) types[k] = { label: v.label, color: v.color };
  const rels: Record<string, GxStyle> = {};
  for (const [k, e] of Object.entries(ctx.config.edges ?? {})) rels[k] = { label: e.label, color: e.color };
  if (cluster) types[CLUSTER_KIND] = { label: cluster.label, color: '--t3' };
  const gxNodes: GxNode[] = [
    { id: record.id, type: record.kind ?? 'other', title: record.title, depth: 0 },
    ...nodes.filter(n => n.id !== record.id).map(n => ({ id: n.id, type: n.kind ?? n.record?.kind ?? 'other', title: n.title ?? n.record?.title, depth: ctx.data.meta.graphDepth?.[n.id] ?? n.depth ?? 1 })),
  ];
  const gxEdges: GxEdge[] = links.map(l => ({ from: l.from, to: l.to, rel: l.type }));
  const open = (id: string) => {
    if (cluster?.is(id)) { cluster.open(id); return; }
    // Обычная ссылка, а не location: приложение перехватывает ссылки kit само.
    const a = document.createElement('a');
    a.href = ctx.href(id);
    host.current?.appendChild(a);
    a.click();
    a.remove();
  };
  // Выбран кластер — его подпись и «раскрыть»; иначе карточка приложения (Peek), если она есть.
  const peek = ctx.config.graph?.peek;
  const selected = cluster && (peek || nodes.some(n => cluster.is(n.id)))
    ? (id: string) => (cluster.is(id)
      ? (
        // S9-08 (препрод 14.11): свой класс, а не sk-gx__sel — тот прижат position:absolute к низу
        // холста, и внутри карточки-peek (тоже absolute, высота по содержимому) карточка
        // схлопывалась в линию: кнопки «раскрыть» не было видно.
        <div className="sk-gx__csel" role="status" data-testid="gx-cluster">
          <span className="sk-gx__sel-title">{nodes.find(n => n.id === id)?.title ?? id}</span>
          <button type="button" className="sk-btn" onClick={() => cluster.open(id)}>{kitT(lang, 'kit.record.graph.clusterOpen')}</button>
        </div>
      )
      : peek ? peek(id) : <span className="sk-gx__sel-title">{nodes.find(n => n.id === id)?.record?.title ?? id}</span>)
    : peek;
  return (
    <div ref={host} className="sk-rec-graph__gx">
      <GraphExplorer nodes={gxNodes} edges={gxEdges} types={types} rels={rels} lang={lang}
        engine={engine} onEngineChange={onEngine} engineSwitch={false}
        hrefOf={ctx.href} onOpen={open} storageKey="record" renderSelected={selected}
        clickOpens={cluster?.is} />
    </div>
  );
}
