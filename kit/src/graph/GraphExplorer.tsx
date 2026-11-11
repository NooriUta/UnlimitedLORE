// GraphExplorer (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03) — общий граф знаний kit.
//
// Владелица 11.11.2026: «делай как отдельный большой компонент, понадобится не
// только там»; «оставляем как обсидиан и force пока, будем думать кто финалист».
// Поэтому два вида с ОДНОЙ физикой и одной панелью — сравнивать их честно:
//   • Force — force-graph (d3-force, Canvas 2D, главный поток);
//   • Обсидиан — d3-force в воркере, рисует sigma (WebGL).
// Слева — панель как у Обсидиана (Фильтры, Группы, Отображение, Силы); её
// значения живут в браузере человека (storageKey), вид по умолчанию задаёт
// приложение (у LORE — личная настройка).
//
// kit не знает предметных слов (K-14): типы узлов и связей, подписи и цвета —
// от приложения. Движки грузятся лениво: граф не утяжеляет основной бандл.
import { Suspense, lazy, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { kitT, type KitLang } from '../i18n';
import { EmptyState, LoadError } from '../states/StateViews';
import { Pill } from '../elements/Pill';
import { toCssColor } from '../record/graph';
import { GraphSettingsPanel } from './GraphSettingsPanel';
import {
  GX_DEFAULTS, GX_ENGINES, gxFilter, gxGroupColor, gxTypeCounts, loadGx, saveGx,
  type GxEdge, type GxEngine, type GxNode, type GxSettings, type GxStyle,
} from './settings';

const ForceEngine = lazy(() => import('./ForceEngine'));
const ObsidianEngine = lazy(() => import('./ObsidianEngine'));

/** Пунктир вида связи — как в прототипе: мягкая и «к сведению» — штрих. */
const KIND_DASH: Record<string, number[]> = { soft: [6, 4], informs: [2, 4], untyped: [1, 3] };

export interface GraphExplorerProps {
  nodes: GxNode[];
  edges: GxEdge[];
  /** Типы узлов: подпись и цвет. Нет типа — подпись = ключ, цвет — приглушённый. */
  types?: Record<string, GxStyle>;
  /** Типы связей: подпись и цвет. */
  rels?: Record<string, GxStyle>;
  /** Вид — управляемо (тогда нужен onEngineChange) или по умолчанию. */
  engine?: GxEngine;
  defaultEngine?: GxEngine;
  onEngineChange?: (e: GxEngine) => void;
  /** Показывать свой переключатель вида (вкладка «Граф» рисует свой). */
  engineSwitch?: boolean;
  /** Двойной щелчок по узлу. */
  onOpen?: (id: string) => void;
  /** Адрес записи: у выбранного узла появляется обычная ссылка «Открыть». */
  hrefOf?: (id: string) => string;
  /** Ключ настроек панели в браузере человека; разные места — разные настройки. */
  storageKey?: string;
  /** Панель открыта при первом показе. */
  panelOpen?: boolean;
  lang: KitLang;
  className?: string;
}

export function GraphExplorer(props: GraphExplorerProps) {
  const { nodes, edges, types = {}, rels = {}, lang, storageKey = 'default', engineSwitch = true } = props;
  const [ownEngine, setOwnEngine] = useState<GxEngine>(props.defaultEngine ?? 'force');
  const engine = props.engine ?? ownEngine;
  const setEngine = (e: GxEngine) => { if (props.engine === undefined) setOwnEngine(e); props.onEngineChange?.(e); };
  const [settings, setSettingsRaw] = useState<GxSettings>(() => loadGx(storageKey));
  const setSettings = useCallback((s: GxSettings) => { setSettingsRaw(s); saveGx(storageKey, s); }, [storageKey]);
  const [panel, setPanel] = useState(props.panelOpen ?? true);
  const [selected, setSelected] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(undefined);

  // Фильтры меняют НАБОР узлов — движок пересоздаёт холст; отображение и силы — нет.
  const filterKey = `${settings.search}\u0000${settings.hiddenTypes.join(',')}\u0000${settings.orphans}`;
  const view = useMemo(() => gxFilter(nodes, edges, settings), [nodes, edges, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeList = useMemo(() => [...gxTypeCounts(nodes)].map(([key, count]) => ({
    key, count, style: types[key] ?? { label: key, color: '--t3' },
  })), [nodes, types]);

  const nodeColor = useCallback((n: GxNode) =>
    toCssColor(gxGroupColor(n, settings.groups) ?? types[n.type]?.color ?? '--t2'), [settings.groups, types]);
  const edgeColor = useCallback((e: GxEdge) => toCssColor(rels[e.rel]?.color ?? '--bd'), [rels]);
  const edgeDash = useCallback((e: GxEdge) => (e.kind ? KIND_DASH[e.kind] ?? null : null), []);

  const Engine = engine === 'obsidian' ? ObsidianEngine : ForceEngine;
  const sel = selected ? nodes.find(n => n.id === selected) : undefined;

  return (
    <div className={['sk-gx', panel ? 'sk-gx--panel' : '', props.className].filter(Boolean).join(' ')} data-testid="sk-gx">
      <div className="sk-gx__bar" role="toolbar" aria-label={kitT(lang, 'kit.graph.toolbar')}>
        <button type="button" className="sk-btn sk-gx__ghost" aria-pressed={panel} aria-controls="sk-gx-panel"
          onClick={() => setPanel(v => !v)}>
          {kitT(lang, panel ? 'kit.graph.panelHide' : 'kit.graph.panelShow')}
        </button>
        {engineSwitch && (
          <div className="sk-gx__engines" role="group" aria-label={kitT(lang, 'kit.graph.engine')} data-testid="sk-gx-engines">
            {GX_ENGINES.map(e => (
              <Pill key={e} variant="filter" pressed={engine === e} onToggle={() => setEngine(e)}
                title={kitT(lang, e === 'force' ? 'kit.graph.engineForceHint' : 'kit.graph.engineObsidianHint')}>
                {kitT(lang, e === 'force' ? 'kit.graph.engineForce' : 'kit.graph.engineObsidian')}
              </Pill>
            ))}
          </div>
        )}
        <span className="sk-gx__count" data-testid="sk-gx-count">
          {kitT(lang, view.nodes.length === view.total ? 'kit.graph.count' : 'kit.graph.countOf',
            { n: view.nodes.length, total: view.total, e: view.edges.length })}
        </span>
      </div>
      <div className="sk-gx__body">
        {panel && (
          <div id="sk-gx-panel" className="sk-gx__side">
            <GraphSettingsPanel lang={lang} settings={settings} onChange={setSettings} types={typeList} />
          </div>
        )}
        <div className="sk-gx__stage">
          {failure !== undefined ? (
            <LoadError compact title={kitT(lang, 'kit.graph.failed')} error={failure}
              onRetry={() => setFailure(undefined)} />
          ) : view.nodes.length === 0 ? (
            <EmptyState compact title={kitT(lang, nodes.length ? 'kit.graph.filtered' : 'kit.graph.empty')}
              action={nodes.length ? (
                <button type="button" className="sk-btn" onClick={() => setSettings({ ...settings, search: '', hiddenTypes: [], orphans: true })}>
                  {kitT(lang, 'kit.graph.reset')}
                </button>
              ) : undefined} />
          ) : (
            <Suspense fallback={<div className="sk-gx__loading" role="status">{kitT(lang, 'kit.graph.loading')}</div>}>
              <Engine key={engine} nodes={view.nodes} edges={view.edges} settings={settings}
                nodeColor={nodeColor} edgeColor={edgeColor} edgeDash={edgeDash}
                selected={selected} onSelect={setSelected} onOpen={props.onOpen} onError={setFailure} />
            </Suspense>
          )}
          {sel && (
            <div className="sk-gx__sel" role="status" data-testid="sk-gx-selected">
              <span className="sk-gx-dot" aria-hidden="true" style={{ '--gx-c': nodeColor(sel) } as CSSProperties} />
              <span className="sk-gx__sel-title">{sel.title ?? sel.id}</span>
              <code className="sk-gx__sel-id">{sel.id}</code>
              {props.hrefOf ? (
                <a className="sk-btn" href={props.hrefOf(sel.id)}>{kitT(lang, 'kit.graph.open')}</a>
              ) : props.onOpen && (
                <button type="button" className="sk-btn" onClick={() => props.onOpen!(sel.id)}>{kitT(lang, 'kit.graph.open')}</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { GX_DEFAULTS };
