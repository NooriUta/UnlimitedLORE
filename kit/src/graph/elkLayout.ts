// Раскладка ELK вне главного потока (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-02). Разбор наработок AIDA — GC-01
// (docs/reports/gc-01-graph-inventory.md):
//  · `elk.bundled.js` без пакета `web-worker` игнорирует `workerUrl` и считает в главном потоке
//    (замер SPEC-LORE-GRAPH-VIEWS §10) — поэтому здесь `elk-api.js` + настоящий воркер `elk-worker.min.js`;
//  · отмена в LOOM звала `terminate?.()`, а у ELK метод `terminateWorker()` — старые воркеры считали
//    дальше; здесь таймаут и отмена останавливают воркер по-настоящему;
//  · таймаут в LOOM молча давал сетку; здесь — состояние «timeout» словами (решает экран).
// Опции — адаптивные по числу узлов (пороги LOOM 500/700, сняты на живых данных).

export interface ElkGraphIn {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; from: string; to: string }[];
}
export type ElkLayoutResult =
  | { state: 'ok'; positions: Record<string, { x: number; y: number }> }
  | { state: 'timeout'; ms: number }
  | { state: 'aborted' }
  | { state: 'error'; reason: string };

/** Что нужно от ELK: раскладка и остановка воркера. */
export interface ElkLike {
  layout: (g: unknown) => Promise<{ children?: { id: string; x?: number; y?: number }[] }>;
  terminateWorker?: () => void;
}

/** Опции ELK по числу узлов: на больших графах меньше проходов уточнения (иначе не уложится в срок). */
export function elkLayoutOptions(nodeCount: number): Record<string, string> {
  const base: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': '24',
    'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  };
  if (nodeCount > 700) return { ...base, 'elk.layered.thoroughness': '1', 'elk.layered.compaction.postCompaction.strategy': 'NONE' };
  if (nodeCount > 500) return { ...base, 'elk.layered.thoroughness': '3' };
  return { ...base, 'elk.layered.thoroughness': '7' };
}

/** Настоящий ELK в воркере — грузится лениво, отдельной частью сборки. */
export async function createElkWorker(): Promise<ElkLike> {
  const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
    import('elkjs/lib/elk-api.js'),
    import('elkjs/lib/elk-worker.min.js?url'),
  ]);
  return new ELK({ workerUrl }) as unknown as ElkLike;
}

export async function layoutWithElk(
  g: ElkGraphIn,
  opts: { elk?: ElkLike; timeoutMs: number; signal?: AbortSignal },
): Promise<ElkLayoutResult> {
  if (opts.signal?.aborted) return { state: 'aborted' };
  const elk = opts.elk ?? await createElkWorker();
  const graph = {
    id: 'root',
    layoutOptions: elkLayoutOptions(g.nodes.length),
    children: g.nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: g.edges.map(e => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };
  return new Promise<ElkLayoutResult>(resolve => {
    let done = false;
    const finish = (r: ElkLayoutResult, stop: boolean) => {
      if (done) return;
      done = true;
      globalThis.clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (stop) elk.terminateWorker?.();
      resolve(r);
    };
    const onAbort = () => finish({ state: 'aborted' }, true);
    const timer = globalThis.setTimeout(() => finish({ state: 'timeout', ms: opts.timeoutMs }, true), opts.timeoutMs);
    opts.signal?.addEventListener('abort', onAbort);
    elk.layout(graph).then(
      out => finish({ state: 'ok', positions: Object.fromEntries((out.children ?? []).map(c => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }])) }, false),
      e => finish({ state: 'error', reason: e instanceof Error ? e.message : String(e) }, false),
    );
  });
}
