// VP-канва по канону Остервальдера (PL-36) + навигатор по канвам (PL-37).
//
// Форма несёт смысл: КВАДРАТ Value Map слева, КРУГ Customer Profile справа,
// канва читается «квадрат подгоняется к кругу», и достигнутый fit виден как
// совпадение половин. Произвольная раскладка превращала бы её в таблицу
// связей — тогда канва не нужна, то же есть в реестре.
//
// Второе, ради чего её открывают: РЁБРА. `ADDRESSES` (заявили) и `RELIEVES`
// (сняли) ведут к одной боли и без разделения выглядели одинаково — а
// расхождение между ними и есть предмет разговора.
//
// Раскладка держится на ReactFlow (по решению владельца), а не на CSS-сетке с
// самодельным SVG-слоем. Самодельная версия дважды ломалась ровно там, где у
// ReactFlow это встроено: перетаскивание карточек и пересчёт линий за ними.
// Здесь секции — родительские узлы (`parentId` + `extent: 'parent'`), поэтому
// стикер физически не может уехать в чужую секцию, а рёбра пересчитывает сам
// движок при любом сдвиге, прокрутке и зуме.
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow, Controls, Background, BackgroundVariant, Handle, Position,
  type NodeProps, type Node, type Edge, type NodeChange, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { LoreFeatureRow, LoreUcRow, LorePainRow, LoreGainRow, LoreJobRow, LoreActorRow } from '../../../api/lore';
import { fetchLoreSlice } from '../../../api/lore';
import LoreSkeleton from '../LoreSkeleton';
import { EmptyState } from '../EmptyState';
import { type ProductScreenProps, useSlice, asArray } from './shared';

/** Пара «заявлено vs сделано» — одна на все три вида ценности. */
interface Link {
  /** id узла-источника в Value Map; null — заявлено, но исполнителя нет */
  from: string | null;
  /** id узла-цели в Customer Profile */
  to: string;
  done: boolean;
}

// ── геометрия сцены (в координатах холста, не в пикселях экрана) ──
const FIG = 560;          // сторона квадрата = диаметр круга: канон их равняет
const GAP = 130;          // просвет между фигурами — там живут рёбра
const SCEN = { w: 128, h: 82 };
const VAL = { w: 114, h: 74 };

/**
 * Секции: ключ → прямоугольник ВНУТРИ своей фигуры.
 *
 * Подписи здесь не лежат: они переводимые и берутся через `t()`. Канонические
 * английские названия остаются значением по умолчанию — термины Остервальдера
 * узнаваемы именно в этом виде, и в англоязычной локали они и нужны.
 */
const SECTORS: Record<string, { fig: 'vm' | 'cp'; x: number; y: number; w: number; h: number }> = {
  // Value Map: продукт слева на всю высоту, справа сверху вниз — что даёт и что снимает.
  ps: { fig: 'vm', x: 8, y: 8, w: 262, h: 544 },
  gc: { fig: 'vm', x: 278, y: 8, w: 274, h: 270 },
  pr: { fig: 'vm', x: 278, y: 282, w: 274, h: 270 },
  // Customer Profile: работы клиента — по центру справа, выгоды и боли делят левую половину.
  gains: { fig: 'cp', x: 26, y: 14, w: 250, h: 266 },
  pains: { fig: 'cp', x: 26, y: 282, w: 250, h: 266 },
  jobs: { fig: 'cp', x: 292, y: 148, w: 246, h: 264 },
};

/** Канонические названия секций — значения по умолчанию для англоязычной локали. */
const SEC_FALLBACK: Record<string, string> = {
  ps: 'Products & Services', gc: 'Gain Creators', pr: 'Pain Relievers',
  gains: 'Gains', pains: 'Pains', jobs: 'Customer Jobs',
};

/* ── узлы (объявлены вне рендера: ReactFlow требует стабильных ссылок) ── */

function FrameNode({ data }: NodeProps) {
  const d = data as unknown as { circle?: boolean; title: string; sub: string; right?: boolean };
  return (
    <div style={{
      width: FIG, height: FIG, border: '1px solid var(--bd)', background: 'var(--bg1)',
      borderRadius: d.circle ? '50%' : '12px 0 0 12px',
      // Крестовина рисует деление на секции: без неё канва читается как четыре
      // не связанных списка, а не как одна фигура.
      backgroundImage: `
        linear-gradient(to right, transparent calc(50% - 1px), var(--bd) calc(50% - 1px), var(--bd) calc(50% + 1px), transparent calc(50% + 1px)),
        linear-gradient(to bottom, transparent calc(50% - 1px), var(--bd) calc(50% - 1px), var(--bd) calc(50% + 1px), transparent calc(50% + 1px))`,
      backgroundSize: '100% 100%, 50% 100%',
      backgroundPosition: d.circle ? '0 0, 0 0' : '0 0, 100% 0',
      backgroundRepeat: 'no-repeat',
    }}>
      <div style={{
        position: 'absolute', top: -26, [d.right ? 'right' : 'left']: 2,
        display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--t2)' }}>{d.title}</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{d.sub}</span>
      </div>
    </div>
  );
}

function SectorNode({ data }: NodeProps) {
  const d = data as unknown as { label: string; w: number; h: number };
  return (
    <div style={{ width: d.w, height: d.h, position: 'relative' }}>
      <div style={{
        fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '.06em',
        color: 'var(--t3)', padding: '2px 4px',
      }}>{d.label}</div>
    </div>
  );
}

function StickerNode({ data }: NodeProps) {
  const d = data as unknown as { title: string; code: string; color: string; w: number; h: number; dim: boolean; ghost?: boolean };
  return (
    <div
      title={d.ghost ? d.title : `${d.title} · ${d.code}`}
      style={{
        position: 'relative', width: d.w, height: d.h, boxSizing: 'border-box',
        padding: '5px 7px 13px',
        // Пустая карточка «делать некому» — пунктиром и без заливки: это не
        // сущность корпуса, а обозначенная дыра, и выглядеть как сделанная
        // работа она не должна.
        border: d.ghost ? `1px dashed ${d.color}` : `1px solid ${d.color}`, borderRadius: 3,
        background: d.ghost ? 'transparent' : 'var(--bg2)',
        color: d.ghost ? 'var(--wrn)' : 'var(--t1)', textAlign: 'left',
        fontSize: 'var(--fs-2xs)', lineHeight: 1.25,
        boxShadow: d.ghost ? 'none' : '1px 1px 0 rgba(0,0,0,.18)', cursor: d.ghost ? 'default' : 'grab',
        opacity: d.dim ? 0.3 : 1, transition: 'opacity .12s',
      }}
    >
      {/* Текст обрезается по высоте карточки: длинная формулировка иначе
          вылезала бы за рамку. Полный — в подсказке. */}
      <div style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {d.title}
      </div>
      <span style={{
        position: 'absolute', right: 5, bottom: 2, fontFamily: 'var(--mono)', fontSize: 8,
        color: 'var(--t3)', maxWidth: 'calc(100% - 10px)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{d.ghost ? '' : d.code}</span>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

const RF_NODE_TYPES = { frame: FrameNode, sector: SectorNode, sticker: StickerNode };

const S = {
  wrap: { padding: 14, width: '100%' } as CSSProperties,
  navRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 14 },
};

export default function LoreVpCanvas({ onError, selectedId, onSelect }: ProductScreenProps) {
  const { t } = useTranslation();

  const { rows: features, loading } = useSlice<LoreFeatureRow>('features', undefined, onError, []);
  const { rows: pains } = useSlice<LorePainRow>('pains', undefined, onError, []);
  const { rows: gains } = useSlice<LoreGainRow>('gains', undefined, onError, []);
  const { rows: jobs } = useSlice<LoreJobRow>('jobs', undefined, onError, []);
  const { rows: actors } = useSlice<LoreActorRow>('actors', undefined, onError, []);

  // Выбранная канва живёт в `?passport=` — ссылкой делятся, и локальное
  // состояние привело бы получателя на чужую канву.
  const featureId = selectedId ?? '';
  useEffect(() => {
    if (!featureId && features.length) onSelect(features[0].uc_id);
  }, [features, featureId, onSelect]);

  const [ucs, setUcs] = useState<LoreUcRow[]>([]);
  useEffect(() => {
    if (!featureId) { setUcs([]); return; }
    const ctrl = new AbortController();
    fetchLoreSlice<LoreUcRow>('use_cases_of_feature', { id: featureId }, ctrl.signal)
      .then(setUcs)
      .catch(e => { if (!ctrl.signal.aborted) onError(e); });
    return () => ctrl.abort();
  }, [featureId, onError]);

  const titleOf = useMemo(() => {
    const m = new Map<string, string>();
    jobs.forEach(j => m.set(j.job_id, j.title ?? j.job_id));
    pains.forEach(p => m.set(p.pain_id, p.title ?? p.pain_id));
    gains.forEach(g => m.set(g.gain_id, g.title ?? g.gain_id));
    // Сценарии тоже нужны: в Products & Services стоят они, и без их
    // заголовков стикер показывал бы голый id — код вместо смысла.
    ucs.forEach(u => m.set(u.uc_id, u.title ?? u.uc_id));
    return m;
  }, [jobs, pains, gains, ucs]);
  const hasMetric = useMemo(
    () => new Set(gains.filter(g => (g.metric_md ?? '').trim()).map(g => g.gain_id)),
    [gains],
  );

  const feature = useMemo(() => features.find(f => f.uc_id === featureId) ?? null, [features, featureId]);

  /**
   * Кто ЧТО реально закрывает: сценарий → ценность.
   *
   * Ищем по рёбрам «доставлено» (RELIEVES/DELIVERS/PERFORMS). Заявленное без
   * исполнителя остаётся без источника — и рисуется от сектора, потому что
   * карточки в Value Map для него нет. В этом и смысл «заявили, но не сделали».
   */
  const doneBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const uc of ucs) {
      for (const id of asArray(uc.relieves_pain_ids)) m.set(id, uc.uc_id);
      for (const id of asArray(uc.delivers_gain_ids)) m.set(id, uc.uc_id);
      for (const id of asArray(uc.performs_job_ids)) m.set(id, uc.uc_id);
    }
    return m;
  }, [ucs]);

  /**
   * ЧЕЙ это профиль (PL-36).
   *
   * Канва Остервальдера всегда про ОДИН сегмент: боли водителя и боли механика
   * рядом в одном круге складываются в несуществующего клиента, и подгонка
   * квадрата к такому кругу ничего не значит. Раньше круг показывал всё
   * вперемешку и не называл, кому это принадлежит.
   *
   * Принадлежность берём с рёбер самой ценности: FELT_BY у боли, DESIRED_BY у
   * выгоды, PERFORMED_BY у работы.
   */
  const actorOf = useMemo(() => {
    const m = new Map<string, string[]>();
    pains.forEach(p => m.set(p.pain_id, asArray(p.actor_ids)));
    gains.forEach(g => m.set(g.gain_id, asArray(g.actor_ids)));
    jobs.forEach(j => m.set(j.job_id, asArray(j.actor_ids)));
    return m;
  }, [pains, gains, jobs]);
  const actorName = useMemo(() => {
    const m = new Map<string, string>();
    actors.forEach(a => m.set(a.actor_id, a.name ?? a.actor_id));
    return m;
  }, [actors]);

  const [actorId, setActorId] = useState<string>('');   // '' — весь круг, без разбора

  /** Акторы, которые вообще встречаются на ЭТОЙ канве: чужих в выбор не берём. */
  const canvasActors = useMemo(() => {
    const s = new Set<string>();
    [...asArray(feature?.pain_ids), ...asArray(feature?.gain_ids), ...asArray(feature?.job_ids)]
      .forEach(id => (actorOf.get(id) ?? []).forEach(a => s.add(a)));
    return [...s];
  }, [feature, actorOf]);
  // Выбор снимается при переходе на канву, где такого актора нет: иначе круг
  // молча пустеет и выглядит как «ценностей не завели».
  useEffect(() => {
    if (actorId && !canvasActors.includes(actorId)) setActorId('');
  }, [actorId, canvasActors]);

  // Мемоизация обязательна: asArray отдаёт НОВЫЙ массив на каждый рендер, и без
  // неё узлы пересобирались бы бесконечно.
  const byActor = useCallback(
    (ids: string[]) => (actorId ? ids.filter(id => (actorOf.get(id) ?? []).includes(actorId)) : ids),
    [actorId, actorOf],
  );
  const painIds = useMemo(() => byActor(asArray(feature?.pain_ids)), [feature, byActor]);
  const gainIds = useMemo(() => byActor(asArray(feature?.gain_ids)), [feature, byActor]);
  const jobIds = useMemo(() => byActor(asArray(feature?.job_ids)), [feature, byActor]);

  /** Сценарии-исполнители по видам: кто снимает боли, кто создаёт выгоды. */
  const relievers = useMemo(
    () => ucs.filter(u => asArray(u.relieves_pain_ids).some(id => painIds.includes(id))).map(u => u.uc_id),
    [ucs, painIds],
  );
  const creators = useMemo(
    () => ucs.filter(u => asArray(u.delivers_gain_ids).some(id => gainIds.includes(id))).map(u => u.uc_id),
    [ucs, gainIds],
  );

  // Связь идёт ОТ СЦЕНАРИЯ к ценности. Один сценарий может снимать несколько
  // болей — он стоит в секторе один раз, а линий от него столько, сколько
  // закрывает: иначе пришлось бы дублировать стикер и врать о составе.
  const links: Link[] = useMemo(() => [
    ...painIds.map(id => ({ from: doneBy.has(id) ? 'rel-' + doneBy.get(id) : null, to: id, done: doneBy.has(id) })),
    ...gainIds.map(id => ({ from: doneBy.has(id) ? 'crt-' + doneBy.get(id) : null, to: id, done: doneBy.has(id) })),
    ...jobIds.map(id => ({ from: doneBy.has(id) ? 'ps-' + doneBy.get(id) : null, to: id, done: doneBy.has(id) })),
  ], [painIds, gainIds, jobIds, doneBy]);

  // ── раскладка: сохранённые позиции поверх сетки по умолчанию ──
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('lore.vp.pos') ?? '{}'); } catch { return {}; }
  });
  const [hover, setHover] = useState<string | null>(null);

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    // Порядок обязателен: родитель должен идти В МАССИВЕ раньше ребёнка, иначе
    // ReactFlow не свяжет их и дети встанут в координатах холста.
    // Размеры заданы ЯВНО, а не выведены из вёрстки: `extent: 'parent'` считает
    // границу по размеру родителя, и до первого замера её просто нет — стикер
    // спокойно улетал за пределы своей секции и записывался туда навсегда.
    out.push({
      id: 'fig-vm', type: 'frame', position: { x: 0, y: 0 }, width: FIG, height: FIG,
      draggable: false, selectable: false,
      data: {
        title: t('lore.product.canvas.vmap', 'Карта ценности'),
        sub: t('lore.product.canvas.vmapSub', 'что мы делаем · квадрат'),
      },
    });
    out.push({
      id: 'fig-cp', type: 'frame', position: { x: FIG + GAP, y: 0 }, width: FIG, height: FIG,
      draggable: false, selectable: false,
      data: {
        circle: true, right: true,
        title: t('lore.product.canvas.cprof', 'Профиль клиента'),
        // Круг называет, ЧЕЙ он: без имени сегмента подгонка квадрата ни к
        // чему не относится.
        sub: actorId
          ? (actorName.get(actorId) ?? actorId)
          : t('lore.product.canvas.allActors', 'все акторы вместе'),
      },
    });
    for (const [key, s] of Object.entries(SECTORS)) {
      out.push({
        id: key, type: 'sector', parentId: s.fig === 'vm' ? 'fig-vm' : 'fig-cp',
        position: { x: s.x, y: s.y }, width: s.w, height: s.h,
        draggable: false, selectable: false,
        data: { label: t(`lore.product.canvas.sec.${key}`, SEC_FALLBACK[key]), w: s.w, h: s.h },
      });
    }
    const fill = (key: string, ids: string[], prefix: string, color: string, size: { w: number; h: number }) => {
      const s = SECTORS[key];
      const cols = Math.max(1, Math.floor((s.w - 8) / (size.w + 8)));
      ids.forEach((bare, i) => {
        const id = prefix + bare;
        const grid = {
          x: 6 + (i % cols) * (size.w + 8),
          y: 24 + Math.floor(i / cols) * (size.h + 8),
        };
        out.push({
          id, type: 'sticker', parentId: key, width: size.w, height: size.h,
          // Секция — родитель, а `extent: 'parent'` физически не выпускает
          // стикер наружу: перетащить боль в чужой сектор нельзя, потому что
          // это была бы не правка раскладки, а порча смысла.
          extent: 'parent', position: pos[id] ?? grid,
          data: {
            title: titleOf.get(bare) ?? bare, code: bare, color, w: size.w, h: size.h,
            dim: !!hover && hover !== id && !links.some(l => (l.from === hover || l.to === hover) && (l.from === id || l.to === id)),
          },
        });
      });
    };
    fill('ps', ucs.map(u => u.uc_id), 'ps-', 'var(--g-do)', SCEN);
    fill('gc', creators, 'crt-', 'var(--gain)', SCEN);
    fill('pr', relievers, 'rel-', 'var(--pain)', SCEN);
    fill('gains', gainIds, '', 'var(--gain)', VAL);
    fill('jobs', jobIds, '', 'var(--job)', VAL);
    fill('pains', painIds, '', 'var(--pain)', VAL);

    /**
     * Пустая карточка «делать некому» — начало пунктирных связей.
     *
     * Раньше такая связь выходила из края сектора и читалась как ребро в
     * никуда: не видно ни откуда она, ни почему пунктирная. Теперь у неё есть
     * источник, который прямо называет разрыв: ценность заявлена (ADDRESSES /
     * PROMISES / HELPS_WITH), а сценария, который её закрывает, нет.
     */
    const holes: Record<string, number> = { pr: 0, gc: 0, ps: 0 };
    painIds.forEach(id => { if (!doneBy.has(id)) holes.pr++; });
    gainIds.forEach(id => { if (!doneBy.has(id)) holes.gc++; });
    jobIds.forEach(id => { if (!doneBy.has(id)) holes.ps++; });
    for (const [key, n] of Object.entries(holes)) {
      if (!n) continue;
      const s = SECTORS[key];
      const taken = key === 'pr' ? relievers.length : key === 'gc' ? creators.length : ucs.length;
      const cols = Math.max(1, Math.floor((s.w - 8) / (SCEN.w + 8)));
      out.push({
        id: `hole-${key}`, type: 'sticker', parentId: key, width: SCEN.w, height: SCEN.h,
        extent: 'parent', draggable: false, selectable: false,
        position: {
          x: 6 + (taken % cols) * (SCEN.w + 8),
          y: 24 + Math.floor(taken / cols) * (SCEN.h + 8),
        },
        data: {
          ghost: true, code: '', color: 'var(--wrn)', w: SCEN.w, h: SCEN.h, dim: false,
          title: `${t('lore.product.canvas.hole', 'делать некому')} · ${n}`,
        },
      });
    }
    return out;
  }, [t, ucs, creators, relievers, gainIds, jobIds, painIds, titleOf, pos, hover, links, doneBy, actorId, actorName]);

  const edges: Edge[] = useMemo(() => links.map(l => {
    // Некому делать — линия идёт от карточки-дыры своего сектора: боль ждут в
    // Pain Relievers, выгоду в Gain Creators, работу в Products & Services.
    const hole = gainIds.includes(l.to) ? 'hole-gc' : jobIds.includes(l.to) ? 'hole-ps' : 'hole-pr';
    const source = l.from ?? hole;
    return {
      id: `e-${source}-${l.to}`, source, target: l.to, type: 'bezier',
      style: {
        stroke: l.done ? 'var(--suc)' : 'var(--wrn)', strokeWidth: 2,
        strokeDasharray: l.done ? undefined : '5 4',
        opacity: hover && l.from !== hover && l.to !== hover ? 0.12 : 1,
      },
      // Рёбра ребёнка ReactFlow по умолчанию кладёт ПОВЕРХ узлов — линии
      // перечёркивали бы карточки. Опускаем под них.
      zIndex: 0,
    };
  }), [links, hover, gainIds, jobIds]);

  /** Перетаскивание: позиции применяем сразу, на диск пишем по отпусканию. */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setPos(prev => {
      let next = prev;
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          if (next === prev) next = { ...prev };
          next[c.id] = { x: c.position.x, y: c.position.y };
        }
      }
      return next;
    });
  }, []);
  const persist = useCallback(() => {
    setPos(p => { localStorage.setItem('lore.vp.pos', JSON.stringify(p)); return p; });
  }, []);

  /**
   * Перевписать сцену при изменении размера окна и при смене канвы.
   *
   * `fitView` срабатывает один раз на монтировании: у сузившегося контейнера
   * холст оставался в прежнем масштабе, и нижняя фигура уезжала за кромку —
   * канва выглядела обрезанной при полностью живых данных.
   */
  const rf = useRef<ReactFlowInstance | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => rf.current?.fitView({ padding: 0.1 }));
    ro.observe(el);
    return () => ro.disconnect();
    // Зависимость от `loading` обязательна: пока данные грузятся, компонент
    // возвращает скелет, холста в DOM ещё нет и ref пуст. С пустым списком
    // зависимостей наблюдатель не вешался вовсе, и на узком экране сцена
    // оставалась в масштабе широкого — половина канвы за кромкой.
  }, [loading]);
  useEffect(() => {
    const id = requestAnimationFrame(() => rf.current?.fitView({ padding: 0.1 }));
    return () => cancelAnimationFrame(id);
  }, [featureId]);

  if (loading) return <div style={S.wrap}><LoreSkeleton rows={6} /></div>;
  if (features.length === 0) {
    return <div style={S.wrap}><EmptyState message={t('lore.product.canvas.empty', 'Канв пока нет — заведите корневой сценарий')} /></div>;
  }

  // ── навигатор (PL-37) ──
  const nav = (
    <div style={S.navRow}>
      {features.map(f => {
        const p = asArray(f.pain_ids), g = asArray(f.gain_ids);
        const items = [...p, ...g];
        const done = items.filter(x => doneBy.has(x)).length;
        // Счётчики считаются по ВЫБРАННОЙ канве: `doneBy` знает только её
        // сценарии. Для прочих карточек показываем охват заявленного — это
        // честнее, чем выдавать ноль за «ничего не сделано».
        const isCur = f.uc_id === featureId;
        const noMetric = g.filter(x => !hasMetric.has(x)).length;
        return (
          <button
            key={f.uc_id}
            type="button"
            onClick={() => onSelect(f.uc_id)}
            aria-pressed={isCur}
            style={{
              textAlign: 'left', minWidth: 210, padding: '8px 11px', cursor: 'pointer',
              border: `1px solid ${isCur ? 'var(--acc)' : 'var(--bd)'}`, borderRadius: 8,
              background: isCur ? 'var(--bg2)' : 'var(--bg1)', color: 'var(--t1)',
            }}
          >
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--g-value)' }}>{f.uc_id}</div>
            <div style={{ fontSize: 'var(--fs-sm)' }}>{f.title ?? f.uc_id}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, fontSize: 'var(--fs-2xs)' }}>
              <span style={{ fontFamily: 'var(--mono)' }}>{isCur ? `${done}/${items.length}` : `${items.length}`}</span>
              <span style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg3)', overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', width: `${items.length && isCur ? (100 * done / items.length) : 0}%`, background: 'var(--suc)' }} />
              </span>
            </div>
            {/* Сигналы — то, ради чего в канву заходят: без них список канв
                отвечает «какие есть», но не «зачем переключаться». */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4, fontSize: 'var(--fs-2xs)' }}>
              {noMetric > 0 && (
                <span style={{ color: 'var(--wrn)', border: '1px solid var(--wrn)', borderRadius: 999, padding: '0 6px' }}>
                  {noMetric} {t('lore.product.canvas.noMetric', 'без метрики')}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  /**
   * Чей это продукт.
   *
   * Канва показывала ценности, не называя, к какому продукту они относятся: в
   * корпусе несколько проектов, и одинаковые по звучанию боли разных продуктов
   * читались как одна картина. Проект берётся с самой фичи (BELONGS_TO_PROJECT);
   * «не задан» показывается явно — это пропуск, который надо закрыть, а не
   * повод молчать.
   */
  const featureProjects = asArray(feature?.projects).filter(Boolean);
  const productLine = feature && (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 'var(--fs-sm)' }}>
      <span style={{ color: 'var(--t3)' }}>{t('lore.product.canvas.product', 'Продукт:')}</span>
      {featureProjects.length > 0 ? featureProjects.map(p => (
        <span key={p} style={{
          fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', padding: '1px 8px', borderRadius: 999,
          border: '1px solid var(--bd)', color: 'var(--t1)',
        }}>{p}</span>
      )) : (
        <span style={{ color: 'var(--wrn)' }}>
          ⚠ {t('lore.product.canvas.noProject', 'проект не задан — ценности разных продуктов сольются в одну картину')}
        </span>
      )}
      <span style={{ color: 'var(--t3)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{feature.uc_id}</span>
    </div>
  );

  // ── чей профиль: выбор сегмента (PL-36) ──
  const actorPicker = canvasActors.length > 0 && (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontSize: 'var(--fs-sm)' }}>
      <span style={{ color: 'var(--t3)' }}>{t('lore.product.canvas.forActor', 'Профиль клиента:')}</span>
      {['', ...canvasActors].map(a => {
        const on = a === actorId;
        return (
          <button
            key={a || '*'}
            type="button"
            onClick={() => setActorId(a)}
            aria-pressed={on}
            style={{
              padding: '2px 10px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${on ? 'var(--acc)' : 'var(--bd)'}`,
              background: on ? 'var(--bg2)' : 'transparent', color: 'var(--t1)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            {a ? (actorName.get(a) ?? a) : t('lore.product.canvas.allActors', 'все акторы вместе')}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={S.wrap}>
      {productLine}
      {actorPicker}
      {/* Высота задана в пикселях: ReactFlow меряет контейнер, и у схлопнутого
          в ноль холст остаётся пустым при полностью живых данных. */}
      {/* Пропорция подогнана под сцену (две фигуры в ряд ≈ 2.2:1): в более
          высоком контейнере fitView упирается в ширину, и половина холста
          остаётся пустой — канва при этом выглядит мельче, чем могла бы. */}
      <div
        ref={boxRef}
        style={{
          // Высота задана напрямую, БЕЗ aspect-ratio. С `aspect-ratio` минимум
          // высоты раздувает ШИРИНУ: на 375px контейнер вырастал до 836px и
          // уезжал за экран (найдено на проверке PL-42). Здесь ширина всегда
          // равна доступной, а высота подстраивается сама.
          position: 'relative', width: '100%', height: 'clamp(320px, 42vw, 620px)',
          border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden',
        }}
      >
        <ReactFlow
          onInit={i => { rf.current = i; }}
          nodes={nodes}
          edges={edges}
          nodeTypes={RF_NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStop={persist}
          onNodeMouseEnter={(_, n) => setHover(n.id)}
          onNodeMouseLeave={() => setHover(null)}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.12}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Controls showInteractive={false} />
          <Background variant={BackgroundVariant.Dots} color="var(--bd)" gap={22} size={1} />
        </ReactFlow>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 'var(--fs-sm)', color: 'var(--t2)', marginTop: 10 }}>
        <span><i style={{ display: 'inline-block', width: 22, borderTop: '2px solid var(--suc)', verticalAlign: 'middle', marginRight: 5 }} />
          {t('lore.product.canvas.legendDone', 'сделано — снимает, даёт, выполняет')}</span>
        <span><i style={{ display: 'inline-block', width: 22, borderTop: '2px dashed var(--wrn)', verticalAlign: 'middle', marginRight: 5 }} />
          {t('lore.product.canvas.legendClaimed', 'только заявлено')}</span>
      </div>

      {/* Навигатор по канвам — ПОД канвой: сверху он отжимал саму канву вниз, а
          нужен он на выходе, когда с этой канвой разобрались. */}
      {nav}
    </div>
  );
}
