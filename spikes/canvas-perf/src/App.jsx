// SPRINT_UXR_S7C_WHY_CANVAS/S7C-07 — замер React Flow на N стикерах.
// Параметры URL:
//   n=500     число стикеров (рёбер n-1: каждый стикер связан с одним из предыдущих)
//   memo=1    nodeTypes вынесен за компонент + узел в React.memo (0 = анти-паттерн: inline nodeTypes, без memo)
//   lod=1     уровень детализации: ниже zoom < LOD_ZOOM текст стикера не рисуется
//   ovr=1     onlyRenderVisibleElements
// Позиции детерминированы (mulberry32, seed 7), разметка «сеткой с дрожанием», как на доске Miro.
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
} from '@xyflow/react';

const q = new URLSearchParams(location.search);
const N = Number(q.get('n') ?? 500);
const MEMO = q.get('memo') !== '0';
const LOD = q.get('lod') === '1';
const OVR = q.get('ovr') === '1';
const LOD_ZOOM = 0.5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['клиент', 'боль', 'выгода', 'работа', 'сценарий', 'данные', 'отчёт', 'граф', 'релиз', 'спринт',
  'проверка', 'поиск', 'телефон', 'стикер', 'рамка', 'решение', 'метрика', 'команда', 'платёж', 'доступ'];

function buildGraph(n) {
  const rnd = mulberry32(7);
  const cols = Math.ceil(Math.sqrt(n));
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) {
    const words = Array.from({ length: 9 + Math.floor(rnd() * 6) }, () => WORDS[Math.floor(rnd() * WORDS.length)]);
    nodes.push({
      id: `s${i}`,
      type: 'sticky',
      position: { x: (i % cols) * 220 + Math.round((rnd() - 0.5) * 60), y: Math.floor(i / cols) * 160 + Math.round((rnd() - 0.5) * 40) },
      data: { title: `Стикер ${i}`, text: words.join(' ') },
    });
    if (i > 0) {
      const back = Math.max(0, i - 1 - Math.floor(rnd() * Math.min(i, cols + 2)));
      edges.push({ id: `e${i}`, source: `s${back}`, target: `s${i}` });
    }
  }
  return { nodes, edges };
}

const zoomBelow = (s) => s.transform[2] < LOD_ZOOM;

function StickyBody({ data }) {
  // С LOD подписка на булев признак: перерисовка только при пересечении порога, а не на каждый кадр зума.
  const far = useStore(LOD ? zoomBelow : () => false);
  if (far) return <div className="sticky lod" />;
  return (
    <div className="sticky">
      <b>{data.title}</b>
      {data.text}
    </div>
  );
}

const StickyMemo = memo(StickyBody);
const NODE_TYPES = { sticky: StickyMemo };

// Метрики, которые читает measure.cjs
window.__perf = { ready: null, drag: [], renders: 0 };

function Canvas() {
  const init = useMemo(() => buildGraph(N), []);
  const [nodes, , onNodesChange] = useNodesState(init.nodes);
  const [edges, , onEdgesChange] = useEdgesState(init.edges);
  const initialized = useNodesInitialized();
  const rf = useReactFlow();
  const dragT0 = useRef(null);
  window.__perf.renders++;

  useLayoutEffect(() => {
    if (initialized && window.__perf.ready == null) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__perf.ready = performance.now();
      }));
    }
  }, [initialized]);

  // Латентность перетаскивания: timeStamp события касания → кадр после коммита нового положения.
  useLayoutEffect(() => {
    const t0 = dragT0.current;
    if (t0 == null) return;
    dragT0.current = null;
    requestAnimationFrame(() => window.__perf.drag.push(performance.now() - t0));
  }, [nodes]);

  const onNodeDrag = useCallback((e) => {
    if (dragT0.current == null) dragT0.current = e.timeStamp ?? e.sourceEvent?.timeStamp ?? performance.now();
  }, []);

  window.__rf = rf;

  // memo=0 — намеренный анти-паттерн: новый объект nodeTypes на каждый рендер и узел без memo.
  const nodeTypes = MEMO ? NODE_TYPES : { sticky: (p) => <StickyBody {...p} /> };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDrag={onNodeDrag}
      nodeTypes={nodeTypes}
      onlyRenderVisibleElements={OVR}
      fitView
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    />
  );
}

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  );
}
