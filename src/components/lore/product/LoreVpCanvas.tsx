// VP-канва (Остервальдер, ADR-LORE-022/032) — зеркальная Value Proposition Canvas
// на ReactFlow: слева профиль клиента (jobs/pains/gains), справа карта ценности
// (фича + её user stories). Рёбра: штрих = ЗАЯВЛЕНО (фича обещает), сплошная =
// СДЕЛАНО (US реально снимает боль / создаёт выгоду / выполняет работу — замыкание fit).
// Обвязка ReactFlow зеркалит BiblioScreen (кастомные ноды на уровне модуля, токены темы).
import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Controls, Background, BackgroundVariant,
  Handle, Position, type NodeProps, type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type ProductScreenProps, productColor, useSlice, asArray, Pill } from './shared';
import {
  type LoreFeatureRow, type LoreUcRow, type LoreJobRow,
  type LorePainRow, type LoreGainRow, fetchLoreSlice,
} from '../../../api/lore';
import LoreSkeleton from '../LoreSkeleton';
import { EmptyState } from '../EmptyState';
import { useTranslation } from 'react-i18next';

/* ── ReactFlow custom node (module scope for stable reference) ──────────────
 * Data carries {label, tone}; tone (цвет-акцент) задаёт и рамку, и тонировку
 * фона — так профиль/карта раскрашиваются по семантическим токенам (productColor). */
interface VpNodeData extends Record<string, unknown> {
  label: string;
  tone: string;
}

function VpNodeComp({ data }: NodeProps) {
  const d = data as unknown as VpNodeData;
  return (
    <div style={{
      background:   `color-mix(in srgb, ${d.tone} 16%, var(--bg1))`,
      border:       `1.5px solid ${d.tone}`,
      borderRadius: 8,
      padding:      '6px 10px',
      fontSize:     11,
      color:        'var(--t1)',
      maxWidth:     180,
    }}>
      <Handle type="target" position={Position.Left}  isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      {d.label}
    </div>
  );
}

const RF_NODE_TYPES = { vp: VpNodeComp };

/* Геометрия колонок */
const COL_LEFT  = 0;    // профиль клиента
const COL_RIGHT = 420;  // карта ценности
const Y_STEP    = 70;

export default function LoreVpCanvas({ onError }: ProductScreenProps) {
  const { t } = useTranslation();
  const { rows: features, loading } = useSlice<LoreFeatureRow>('features', undefined, onError, []);
  const { rows: pains } = useSlice<LorePainRow>('pains', undefined, onError, []);
  const { rows: gains } = useSlice<LoreGainRow>('gains', undefined, onError, []);
  const { rows: jobs }  = useSlice<LoreJobRow>('jobs', undefined, onError, []);

  const [featureId, setFeatureId] = useState<string>('');
  const [ucs, setUcs] = useState<LoreUcRow[]>([]);

  // Дефолт — первая фича, как только список загрузился.
  useEffect(() => {
    if (!featureId && features.length) setFeatureId(features[0].feature_id);
  }, [features, featureId]);

  // UC выбранной фичи — снимают/создают/выполняют (сторона «СДЕЛАНО»).
  useEffect(() => {
    if (!featureId) { setUcs([]); return; }
    const ctrl = new AbortController();
    fetchLoreSlice<LoreUcRow>('use_cases_of_feature', { id: featureId }, ctrl.signal)
      .then(setUcs)
      .catch(e => { if (!ctrl.signal.aborted) onError(e); });
    return () => ctrl.abort();
  }, [featureId, onError]);

  // id → title для профиля клиента.
  const titleOf = useMemo(() => {
    const m = new Map<string, string>();
    jobs.forEach(j => m.set(j.job_id, j.title ?? j.job_id));
    pains.forEach(p => m.set(p.pain_id, p.title ?? p.pain_id));
    gains.forEach(g => m.set(g.gain_id, g.title ?? g.gain_id));
    return m;
  }, [jobs, pains, gains]);

  const feature = useMemo(
    () => features.find(f => f.feature_id === featureId) ?? null,
    [features, featureId],
  );

  const { rfNodes, rfEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    if (!feature) return { rfNodes: nodes, rfEdges: edges };

    // ── LEFT: профиль клиента (jobs → pains → gains, стопкой сверху вниз) ──
    const profileIds: string[] = [
      ...asArray(feature.job_ids),
      ...asArray(feature.pain_ids),
      ...asArray(feature.gain_ids),
    ];
    const profileSet = new Set(profileIds);
    profileIds.forEach((entityId, i) => {
      nodes.push({
        id:       `p:${entityId}`,
        type:     'vp',
        position: { x: COL_LEFT, y: i * Y_STEP },
        data:     { label: titleOf.get(entityId) ?? entityId, tone: productColor(entityId) } satisfies VpNodeData,
      });
    });

    // ── RIGHT: карта ценности (фича сверху, ниже её UC/US) ──
    nodes.push({
      id:       `f:${feature.feature_id}`,
      type:     'vp',
      position: { x: COL_RIGHT, y: 0 },
      data:     { label: feature.title ?? feature.feature_id, tone: productColor(feature.feature_id) } satisfies VpNodeData,
    });
    ucs.forEach((uc, i) => {
      nodes.push({
        id:       `u:${uc.uc_id}`,
        type:     'vp',
        position: { x: COL_RIGHT, y: (i + 1) * Y_STEP },
        data:     { label: uc.title ?? uc.uc_id, tone: productColor(uc.uc_id) } satisfies VpNodeData,
      });
    });

    // ── EDGES ── заявлено: фича ЗАЯВЛЯЕТ (ADDRESSES/PROMISES/HELPS_WITH) ──
    profileIds.forEach(entityId => {
      edges.push({
        id:     `claim:${feature.feature_id}:${entityId}`,
        source: `f:${feature.feature_id}`,
        target: `p:${entityId}`,
        type:   'smoothstep',
        style:  { strokeDasharray: '5 4', stroke: 'var(--t3)' },
        animated: false,
      });
    });

    // ── сделано: UC СНИМАЕТ/СОЗДАЁТ/ВЫПОЛНЯЕТ (RELIEVES/DELIVERS/PERFORMS) ──
    ucs.forEach(uc => {
      const done = [
        ...asArray(uc.relieves_pain_ids),
        ...asArray(uc.delivers_gain_ids),
        ...asArray(uc.performs_job_ids),
      ];
      done.forEach(entityId => {
        if (!profileSet.has(entityId)) return; // цель есть только в профиле фичи
        edges.push({
          id:     `done:${uc.uc_id}:${entityId}`,
          source: `u:${uc.uc_id}`,
          target: `p:${entityId}`,
          type:   'smoothstep',
          style:  { stroke: 'var(--acc)' },
        });
      });
    });

    return { rfNodes: nodes, rfEdges: edges };
  }, [feature, ucs, titleOf]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, background: 'var(--bg0)' }}>
      {/* Верхняя полоса: заголовок · выбор фичи · легенда · пометка */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '9px 14px', borderBottom: '1px solid var(--bd)', background: 'var(--bg1)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>
          VP-канва · зеркальная (Остервальдер)
        </span>
        <select
          value={featureId}
          onChange={e => setFeatureId(e.target.value)}
          disabled={!features.length}
          style={{
            fontSize: 12, padding: '3px 8px', borderRadius: 5,
            border: '1px solid var(--bd)', background: 'var(--bg2)', color: 'var(--t1)',
            fontFamily: 'var(--mono)', maxWidth: 320,
          }}
        >
          {features.map(f => (
            <option key={f.feature_id} value={f.feature_id}>
              {f.feature_id} · {f.title ?? ''}
            </option>
          ))}
        </select>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={26} height={8} style={{ overflow: 'visible' }}>
            <line x1={0} y1={4} x2={26} y2={4} stroke="var(--t3)" strokeWidth={1.5} strokeDasharray="5 4" />
          </svg>
          <span style={{ fontSize: 10, color: 'var(--t2)' }}>{t('lore.product.canvas.claimed', 'заявлено')}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={26} height={8} style={{ overflow: 'visible' }}>
            <line x1={0} y1={4} x2={26} y2={4} stroke="var(--acc)" strokeWidth={2} />
          </svg>
          <span style={{ fontSize: 10, color: 'var(--t2)' }}>{t('lore.product.canvas.done', 'сделано')}</span>
        </span>
        <Pill tone="muted" style={{ marginLeft: 'auto' }}>в проде — ReactFlow (как LOOM)</Pill>
      </div>

      {/* Тело */}
      {loading ? (
        <LoreSkeleton rows={4} />
      ) : !features.length ? (
        <EmptyState message={t('lore.product.canvas.empty', 'Нет фич для канвы')} />
      ) : (
        <div style={{ position: 'relative', height: 'calc(100vh - 230px)', minHeight: 420 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={RF_NODE_TYPES}
              fitView
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
              elementsSelectable={true}
              style={{ background: 'var(--bg0)' }}
            >
              <Controls />
              <Background variant={BackgroundVariant.Dots} color="var(--bd)" gap={22} />
            </ReactFlow>
          </div>
          {/* Пояснение поверх канвы */}
          <div style={{
            position: 'absolute', left: 12, bottom: 12, right: 12, pointerEvents: 'none',
            fontSize: 10.5, color: 'var(--t3)', lineHeight: 1.5, maxWidth: 640,
          }}>
            Слева — профиль клиента (работы / боли / выгоды), справа — карта ценности
            (фича и её user stories). Штрих = фича <b>ЗАЯВЛЯЕТ</b> (обещание);
            сплошная = US <b>реально делает</b> (снимает боль, создаёт выгоду, выполняет
            работу) — замыкание fit.
          </div>
        </div>
      )}
    </div>
  );
}
