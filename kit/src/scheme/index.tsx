// «Схема» — общая смотрелка плана (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «доделай», пункт 4). Подходит
// для плана квартиры, щитка, стойки, склада: kit не знает, что это дом — контуры и точки даёт приложение.
//   • области — многоугольники (ring в единицах приложения, например метрах) с подписью;
//   • точки — со статусом цветом (tone), слоем и подписью; выбор — onSelect(id);
//   • слои — чипы с числом, выключаются касанием; этажи — переключатель; масштаб — кнопки и колесо, сдвиг — тягой;
//   • честно: нет плана — словами; точки без координат не теряются молча — «без места: N».
// Правка плана (рисование, разбор чертежей, расстановка) — у приложения: здесь только показ.
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { kitT, useKitLang } from '../i18n';

export interface SchemeArea { id: string; label?: string; /** Вторая строка подписи (площадь, высота). */ sub?: string; floor: number; ring: [number, number][]; muted?: boolean }
export interface SchemePoint { id: string; floor: number; at: [number, number] | null; layer: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; label: string }
export interface SchemeLayer { id: string; label: string }

/** Границы этажа по контурам и точкам, с полем 0,5; нечего показать — null. */
export function schemeBounds(areas: readonly SchemeArea[], points: readonly SchemePoint[]): { x: number; y: number; w: number; h: number } | null {
  const xs: number[] = [], ys: number[] = [];
  for (const a of areas) for (const [x, y] of a.ring) { xs.push(x); ys.push(y); }
  for (const p of points) if (p.at) { xs.push(p.at[0]); ys.push(p.at[1]); }
  if (!xs.length) return null;
  const pad = 0.5, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
}

const centroid = (ring: [number, number][]) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

export function SchemeView({ areas, points, layers, floors, floor: floorProp, onFloor, onSelect, selected, empty, height = 360 }: {
  areas: readonly SchemeArea[]; points: readonly SchemePoint[]; layers: readonly SchemeLayer[]; floors: readonly number[];
  floor?: number; onFloor?: (f: number) => void; onSelect?: (id: string) => void; selected?: string | null; empty?: string; height?: number;
}) {
  const lang = useKitLang();
  const [floorState, setFloorState] = useState(floors[0]);
  const floor = floorProp ?? floorState;
  const setFloor = (f: number) => { setFloorState(f); onFloor?.(f); };
  const [off, setOff] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fa = areas.filter((a) => a.floor === floor);
  const fp = points.filter((p) => p.floor === floor);
  const b = useMemo(() => schemeBounds(fa, fp), [fa, fp]);
  const shown = fp.filter((p) => p.at && !off.includes(p.layer));
  const unplaced = fp.filter((p) => !p.at).length;
  const unit = b ? Math.max(b.w, b.h) / 100 : 1;
  const vb = b ? { w: b.w / zoom, h: b.h / zoom, x: b.x + (b.w - b.w / zoom) / 2 - pan[0], y: b.y + (b.h - b.h / zoom) / 2 - pan[1] } : null;
  const onWheel = (e: RWheelEvent) => { setZoom((z) => Math.max(1, Math.min(6, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => { drag.current = { x: e.clientX, y: e.clientY, px: pan[0], py: pan[1] }; };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag.current || !vb) return;
    const box = e.currentTarget.getBoundingClientRect();
    const k = box.width ? vb.w / box.width : 0;
    setPan([drag.current.px + (e.clientX - drag.current.x) * k, drag.current.py + (e.clientY - drag.current.y) * k]);
  };
  return (
    <div className="sk-scheme">
      <div className="sk-scheme__bar">
        {floors.length > 1 && floors.map((f) => (
          <button key={f} type="button" className="sk-btn sk-scheme__chip" aria-pressed={f === floor} onClick={() => { setFloor(f); setPan([0, 0]); setZoom(1); }}>{f}</button>))}
        {layers.map((l) => {
          const n = fp.filter((p) => p.layer === l.id && p.at).length;
          if (!n) return null;
          const on = !off.includes(l.id);
          return <button key={l.id} type="button" className="sk-btn sk-scheme__chip" aria-pressed={on}
            onClick={() => setOff((o) => (on ? [...o, l.id] : o.filter((x) => x !== l.id)))}>{`${l.label} ${n}`}</button>;
        })}
        <span className="sk-scheme__zoom">
          <button type="button" className="sk-btn" aria-label={kitT(lang, 'kit.scheme.zoomIn')} onClick={() => setZoom((z) => Math.min(6, z * 1.4))}>+</button>
          <button type="button" className="sk-btn" aria-label={kitT(lang, 'kit.scheme.zoomOut')} onClick={() => { setZoom((z) => Math.max(1, z / 1.4)); }}>−</button>
        </span>
      </div>
      {!b || !vb ? <div className="sk-scheme__empty">{empty ?? kitT(lang, 'kit.scheme.empty')}</div> : (
        <svg className="sk-scheme__svg" style={{ height }} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={kitT(lang, 'kit.scheme.label')}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
          {fa.map((a) => {
            const [cx, cy] = centroid(a.ring);
            return (
              <g key={a.id}>
                <polygon className={a.muted ? 'sk-scheme__area is-muted' : 'sk-scheme__area'} points={a.ring.map((p) => p.join(',')).join(' ')} strokeWidth={unit * 0.7} />
                {a.label && <text className="sk-scheme__label" x={cx} y={cy} fontSize={unit * 2.6} textAnchor="middle">{a.label}</text>}
                {a.label && a.sub && <text className="sk-scheme__sub" x={cx} y={cy + unit * 3.2} fontSize={unit * 2} textAnchor="middle">{a.sub}</text>}
              </g>);
          })}
          {shown.map((p) => (
            <circle key={p.id} className={`sk-scheme__point is-${p.tone}${selected === p.id ? ' is-selected' : ''}`} cx={p.at![0]} cy={p.at![1]}
              r={unit * (selected === p.id ? 1.8 : 1.3)} strokeWidth={unit * 0.4} onClick={() => onSelect?.(p.id)}>
              <title>{p.label}</title></circle>))}
        </svg>)}
      {unplaced > 0 && <div className="sk-scheme__note">{kitT(lang, 'kit.scheme.unplaced', { n: unplaced })}</div>}
    </div>
  );
}
