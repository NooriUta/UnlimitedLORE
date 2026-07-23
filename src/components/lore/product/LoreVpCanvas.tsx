// VP-канва по канону Остервальдера (PL-36) + навигатор по канвам (PL-37).
//
// Прежняя редакция строилась на ReactFlow произвольной раскладкой: профиль
// клиента слева, карта ценности справа, обе — прямоугольниками. Канон ровно
// обратный, и форма в нём несёт смысл: КВАДРАТ Value Map слева, КРУГ Customer
// Profile справа, канва читается «квадрат подгоняется к кругу», и достигнутый
// fit виден как совпадение половин. Произвольная раскладка превращала её в
// таблицу связей — тогда канва не нужна, то же есть в реестре.
//
// Второе, чего не было вовсе: РЁБРА. Показывались наборы карточек, но не то,
// какой pain reliever снимает какую боль. При этом `ADDRESSES` (заявили) и
// `RELIEVES` (сняли) ведут к одной боли и выглядели одинаково — а расхождение
// между ними и есть то, ради чего канву открывают.
//
// ReactFlow снят намеренно: он давал перетаскивание узлов, которое здесь не
// нужно (раскладка канона фиксирована), а взамен требовал держать координаты.
// Прототип показал, что CSS-сетка и один SVG-слой делают то же самое.
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { LoreFeatureRow, LoreUcRow, LorePainRow, LoreGainRow, LoreJobRow } from '../../../api/lore';
import { fetchLoreSlice } from '../../../api/lore';
import LoreSkeleton from '../LoreSkeleton';
import { EmptyState } from '../EmptyState';
import { type ProductScreenProps, useSlice, asArray } from './shared';
import { useIsNarrow } from '../../../hooks/useMediaQuery';

/** Пара «заявлено vs сделано» — одна на все три вида ценности. */
interface Link {
  /** id стикера-источника в Value Map; null — заявлено, но исполнителя нет */
  from: string | null;
  /** id стикера-цели в Customer Profile */
  to: string;
  done: boolean;
}

const S = {
  wrap: { padding: 14, overflow: 'auto', width: '100%' } as CSSProperties,
  navRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 14 },
  canvas: { position: 'relative' as const, display: 'grid', gridTemplateColumns: '1fr 110px 1fr', alignItems: 'center', width: '100%' },
  links: { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', pointerEvents: 'none' as const, zIndex: 2 },
  figwrap: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  head: { display: 'flex', alignItems: 'baseline', gap: 8 },
  headH: { fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' as const, color: 'var(--t2)' },
  headSub: { fontSize: 'var(--fs-2xs)', color: 'var(--t3)' },
  fig: { position: 'relative' as const, aspectRatio: '1' },
  st: { fontSize: 'var(--fs-2xs)', textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--t3)', marginBottom: 3 },
};

/** Стикер: почти квадратный, код мелко в правом нижнем углу, лёгкое перекрытие. */
function Sticker({ id, title, color, small, onHover, onDragStart, onDrop }: {
  id: string; title: string; color: string; small?: boolean;
  onHover: (id: string | null) => void;
  onDragStart?: () => void;
  onDrop?: () => void;
}) {
  return (
    <div
      data-vp={id}
      draggable={!!onDragStart}
      onDragStart={e => {
        // setData обязателен: без него drop не выстрелит ни в Chrome, ни в Firefox —
        // перетаскивание выглядит рабочим, а результата нет.
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragOver={e => { if (onDrop) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDrop={e => { e.preventDefault(); onDrop?.(); }}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      title={id}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'flex-start',
        width: small ? 92 : 118, minHeight: small ? 48 : 64,
        padding: small ? '5px 6px 12px' : '6px 7px 14px',
        border: `1px solid ${color}`, borderRadius: 3, background: 'var(--bg2)',
        fontSize: small ? 'var(--fs-2xs)' : 'var(--fs-sm)', lineHeight: 1.25,
        boxShadow: '1px 1px 0 rgba(0,0,0,.18)',
        // Отрицательный отступ — стикеры не выкладывают по линейке; при
        // наведении карточка поднимается, иначе сосед перекрывал бы подпись.
        margin: '0 -6px 4px 0', verticalAlign: 'top', cursor: onDragStart ? 'grab' : 'default',
      }}
    >
      {title}
      <span style={{
        position: 'absolute', right: 5, bottom: 3, fontFamily: 'var(--mono)',
        fontSize: 8, color: 'var(--t3)', maxWidth: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{id.replace(/^(ps|rel|crt)-/, '')}</span>
    </div>
  );
}

export default function LoreVpCanvas({ onError, selectedId, onSelect }: ProductScreenProps) {
  const { t } = useTranslation();
  const narrow = useIsNarrow(900);

  const { rows: features, loading } = useSlice<LoreFeatureRow>('features', undefined, onError, []);
  const { rows: pains } = useSlice<LorePainRow>('pains', undefined, onError, []);
  const { rows: gains } = useSlice<LoreGainRow>('gains', undefined, onError, []);
  const { rows: jobs } = useSlice<LoreJobRow>('jobs', undefined, onError, []);

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

  // Мемоизация обязательна: asArray отдаёт НОВЫЙ массив на каждый рендер, и
  // без неё useMemo ниже пересчитывался бы всегда, эффект рисования звал
  // setPaths, тот вызывал рендер — и цикл замыкался (React честно ругался
  // «Maximum update depth exceeded»).
  const painIds = useMemo(() => asArray(feature?.pain_ids), [feature]);
  const gainIds = useMemo(() => asArray(feature?.gain_ids), [feature]);
  const jobIds = useMemo(() => asArray(feature?.job_ids), [feature]);

  /** Сценарии-исполнители по видам: кто снимает боли, кто создаёт выгоды. */
  const relievers = useMemo(
    () => ucs.filter(u => asArray(u.relieves_pain_ids).some(id => painIds.includes(id))),
    [ucs, painIds],
  );
  const creators = useMemo(
    () => ucs.filter(u => asArray(u.delivers_gain_ids).some(id => gainIds.includes(id))),
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

  // ── линии ──
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [order, setOrder] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('lore.vp.order') ?? '{}'); } catch { return {}; }
  });
  const dragRef = useRef<{ sec: string; id: string } | null>(null);

  useEffect(() => { localStorage.setItem('lore.vp.order', JSON.stringify(order)); }, [order]);

  /** Порядок сектора: сохранённый, дополненный новыми и очищенный от исчезнувших. */
  const ordered = (sec: string, ids: string[]) => {
    const saved = order[sec] ?? [];
    const known = saved.filter(x => ids.includes(x));
    return [...known, ...ids.filter(x => !known.includes(x))];
  };

  /** Перестановка внутри СВОЕГО сектора: между секторами смысл разный. */
  const dropOn = (sec: string, targetId: string, ids: string[]) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.sec !== sec || d.id === targetId) return;
    const cur = ordered(sec, ids);
    const from = cur.indexOf(d.id), to = cur.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...cur];
    next.splice(to, 0, ...next.splice(from, 1));
    setOrder(o => ({ ...o, [sec]: next }));
  };
  const [paths, setPaths] = useState<{ d: string; done: boolean; a: string | null; b: string }[]>([]);

  useEffect(() => {
    if (narrow) { setPaths([]); return; }
    const draw = () => {
      const box = canvasRef.current?.getBoundingClientRect();
      if (!box) return;
      const next: { d: string; done: boolean; a: string | null; b: string }[] = [];
      for (const l of links) {
        const bEl = canvasRef.current?.querySelector(`[data-vp="${l.to}"]`);
        if (!bEl) continue;
        const aEl = l.from ? canvasRef.current?.querySelector(`[data-vp="${l.from}"]`) : null;
        const fallback = canvasRef.current?.querySelector(l.to.startsWith('JOB-') ? '[data-sec="ps"]' : '[data-sec="pr"]');
        const src = (aEl ?? fallback)?.getBoundingClientRect();
        const dst = bEl.getBoundingClientRect();
        if (!src) continue;
        const x1 = src.right - box.left, y1 = src.top + src.height / 2 - box.top;
        const x2 = dst.left - box.left, y2 = dst.top + dst.height / 2 - box.top;
        const dx = Math.max(30, (x2 - x1) * 0.45);
        next.push({ d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, done: l.done, a: l.from, b: l.to });
      }
      setPaths(next);
    };
    // Считаем ПОСЛЕ отрисовки стикеров: до неё координат ещё нет, и все линии
    // сошлись бы в одну точку.
    const id = requestAnimationFrame(draw);
    window.addEventListener('resize', draw);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', draw); };
  }, [links, ucs, narrow, featureId, order]);

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

  const sec = (key: string, label: string, children: React.ReactNode, style?: CSSProperties) => (
    <div data-sec={key} style={{ padding: '4px 6px', minHeight: 0, overflow: 'auto', ...style }}>
      <div style={S.st}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );

  const dim = (id: string) => hover && hover !== id && !paths.some(p => (p.a === hover || p.b === hover) && (p.a === id || p.b === id));

  /**
   * Стикеры сектора в СОХРАНЁННОМ порядке, с перетаскиванием внутри него.
   *
   * `sec` — ключ сектора: перекладывать между секторами нельзя, там разный
   * смысл (боль не станет выгодой от переноса), и такая «правка раскладки»
   * была бы порчей смысла.
   */
  const stickers = (sec: string, ids: string[], prefix: string, color: string, small?: boolean) =>
    ordered(sec, ids).map(id => (
      <span key={id} style={{ opacity: dim(prefix + id) ? 0.35 : 1 }}>
        <Sticker
          id={prefix + id}
          title={titleOf.get(id) ?? id}
          color={color}
          small={small}
          onHover={setHover}
          onDragStart={() => { dragRef.current = { sec, id }; }}
          onDrop={() => dropOn(sec, id, ids)}
        />
      </span>
    ));

  const valueMap = (
    <div style={S.figwrap}>
      <div style={S.head}>
        <span style={S.headH}>Value Map</span>
        <span style={S.headSub}>{t('lore.product.canvas.vmapSub', 'что мы делаем · квадрат')}</span>
      </div>
      <div style={{ ...S.fig, aspectRatio: narrow ? 'auto' : '1' }}>
        {/* Подложка рисует ФОРМУ, содержимое лежит поверх: обрежь мы его
            формой, срезало бы заголовки и стикеры — канон превратился бы в
            дефект. */}
        <div style={{
          position: 'absolute', inset: 0, border: '1px solid var(--bd)',
          background: 'var(--bg1)', borderRadius: narrow ? 10 : '12px 0 0 12px',
        }} />
        {!narrow && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: '12px 0 0 12px', opacity: .45,
            background: `
              linear-gradient(to right, transparent calc(50% - 1px), var(--bd) calc(50% - 1px), var(--bd) calc(50% + 1px), transparent calc(50% + 1px)),
              linear-gradient(to bottom, transparent calc(50% - 1px), var(--bd) calc(50% - 1px), var(--bd) calc(50% + 1px), transparent calc(50% + 1px))`,
            backgroundSize: '100% 100%, 50% 100%',
            backgroundPosition: '0 0, 100% 0',
            backgroundRepeat: 'no-repeat',
          }} />
        )}
        <div style={{
          position: narrow ? 'relative' : 'absolute', inset: 0, padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: narrow ? '1fr' : '1fr 1fr',
          gridTemplateRows: narrow ? 'auto auto auto' : '1fr 1fr',
          gap: 6,
        }}>
          {sec('ps', 'Products & Services', stickers('ps', ucs.map(u => u.uc_id), 'ps-', 'var(--g-do)'), narrow ? undefined : { gridRow: '1 / span 2' })}
          {sec('gc', 'Gain Creators', stickers('gc', creators.map(u => u.uc_id), 'crt-', 'var(--gain)'), narrow ? undefined : { gridColumn: 2, gridRow: 1 })}
          {sec('pr', 'Pain Relievers', stickers('pr', relievers.map(u => u.uc_id), 'rel-', 'var(--pain)'), narrow ? undefined : { gridColumn: 2, gridRow: 2 })}
        </div>
      </div>
    </div>
  );

  const profile = (
    <div style={S.figwrap}>
      <div style={{ ...S.head, justifyContent: narrow ? 'flex-start' : 'flex-end' }}>
        <span style={S.headH}>Customer Profile</span>
        <span style={S.headSub}>{t('lore.product.canvas.cprofSub', 'что есть у клиента · круг')}</span>
      </div>
      <div style={{ ...S.fig, aspectRatio: narrow ? 'auto' : '1' }}>
        <div style={{
          position: 'absolute', inset: 0, border: '1px solid var(--bd)',
          background: 'var(--bg1)', borderRadius: narrow ? 10 : '50%',
        }} />
        {!narrow && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: '50%', opacity: .4,
            background: `
              linear-gradient(to right, transparent calc(50% - 1px), var(--bd) calc(50% - 1px), var(--bd) calc(50% + 1px), transparent calc(50% + 1px)),
              linear-gradient(to bottom, transparent calc(50% - 1px), var(--bd) calc(50% - 1px), var(--bd) calc(50% + 1px), transparent calc(50% + 1px))`,
            backgroundSize: '100% 100%, 50% 100%',
            backgroundPosition: '0 0, 0 0',
            backgroundRepeat: 'no-repeat',
          }} />
        )}
        {/* На узком — обычная стопка: две фигуры рядом в 375px не встанут, а
            круг с секторами там превратился бы в кашу. */}
        {narrow ? (
          <div style={{ position: 'relative', padding: '10px 12px', display: 'grid', gap: 6 }}>
            {sec('gains', 'Gains', stickers('gains', gainIds, '', 'var(--gain)', true))}
            {sec('jobs', 'Customer Jobs', stickers('jobs', jobIds, '', 'var(--job)', true))}
            {sec('pains', 'Pains', stickers('pains', painIds, '', 'var(--pain)', true))}
          </div>
        ) : (
          <>
            {/* Каждому сектору СВОЯ зона: у абсолютных блоков нет общего потока,
                и Gains с Pains наезжали бы друг на друга. */}
            {sec('gains', 'Gains', stickers('gains', gainIds, '', 'var(--gain)', true),
              { position: 'absolute', left: '6%', top: '9%', width: '40%', height: '38%', textAlign: 'center' })}
            {sec('jobs', 'Customer Jobs', stickers('jobs', jobIds, '', 'var(--job)', true),
              { position: 'absolute', right: '5%', top: '50%', transform: 'translateY(-50%)', width: '40%', maxHeight: '56%', textAlign: 'center' })}
            {sec('pains', 'Pains', stickers('pains', painIds, '', 'var(--pain)', true),
              { position: 'absolute', left: '6%', bottom: '9%', width: '40%', height: '38%', textAlign: 'center' })}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={S.wrap}>
      {nav}
      <div
        ref={canvasRef}
        style={narrow
          ? { position: 'relative', display: 'grid', gap: 12 }
          : S.canvas}
      >
        {!narrow && (
          <svg ref={svgRef} style={S.links}>
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                stroke={p.done ? 'var(--suc)' : 'var(--wrn)'}
                strokeWidth={2}
                strokeDasharray={p.done ? undefined : '5 4'}
                opacity={hover && p.a !== hover && p.b !== hover ? 0.12 : 1}
              />
            ))}
          </svg>
        )}
        {valueMap}
        {!narrow && <div />}
        {profile}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 'var(--fs-sm)', color: 'var(--t2)', marginTop: 10 }}>
        <span><i style={{ display: 'inline-block', width: 22, borderTop: '2px solid var(--suc)', verticalAlign: 'middle', marginRight: 5 }} />
          {t('lore.product.canvas.legendDone', 'сделано — снимает, даёт, выполняет')}</span>
        <span><i style={{ display: 'inline-block', width: 22, borderTop: '2px dashed var(--wrn)', verticalAlign: 'middle', marginRight: 5 }} />
          {t('lore.product.canvas.legendClaimed', 'только заявлено')}</span>
      </div>
    </div>
  );
}
