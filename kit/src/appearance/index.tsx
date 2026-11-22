// Панель «Вид» и обои (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «доделай», пункт 3).
//   • ViewPanel — палитра, режим, плотность, размер текста, полоски статусов (функции tokens/prefs уже были —
//     не было самой панели) и раздел «Обои». Своё место (выпадашка, вкладка настроек) выбирает приложение.
//   • ViewQuick — быстрые переключатели на виду: точки палитр и «тёмная / светлая».
//   • WallpaperFrame — обои под содержимым экрана: фото приложения или своя картинка (асимметрия — слева, по
//     центру, справа; затемнение 0..0.9) либо узор из мобилки miniLORE (перелив четырьмя пятнами палитры по кругу
//     из восьми точек, шаг ~0,5 с при смене phaseKey; узоры «плотные шестерёнки» и «паркет»).
// Выбор хранится в браузере под ключом приложения (storageKey); в продукте место хранения решает приложение.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { kitT, useKitLang, type KitKey } from '../i18n';
import {
  DEFAULT_DISPLAY, DEFAULT_PREFS, DENSITIES, MODES, PALETTES, TEXT_SIZES, applyDisplay, applyTheme,
  type DisplayPrefs, type ThemePrefs,
} from '../tokens/prefs';

// ── обои: данные ──────────────────────────────────────────────────────────

export type WallPos = 'left' | 'center' | 'right';
export type WallSkin = 'none' | 'mesh' | 'gearsDense' | 'parquet';
export interface WallPrefs { src: string | null; pos: WallPos; dim: number; skin?: WallSkin }
export interface WallPhoto { id: string; src: string; label: string }

export const DEFAULT_WALL: WallPrefs = { src: null, pos: 'right', dim: 0.6, skin: 'none' };
/** Своя картинка хранится в браузере — держим её небольшой. */
export const WALL_PHOTO_LIMIT = 1.5 * 1048576;
const POS: Record<WallPos, string> = { left: '15% 50%', center: '50% 50%', right: '85% 50%' };
const cssUrl = (src: string) => `url("${src.replace(/"/g, '%22')}")`;
const EVT = 'kit:wallpaper-change';

export function wallpaperLayer(p: WallPrefs): { backgroundImage: string; backgroundPosition: string; dim: number } | null {
  if (!p.src) return null;
  return { backgroundImage: cssUrl(p.src), backgroundPosition: POS[p.pos] ?? POS.center, dim: Math.max(0, Math.min(0.9, p.dim)) };
}
export function readWallpaper(key: string): WallPrefs {
  try { return { ...DEFAULT_WALL, ...JSON.parse(localStorage.getItem(`${key}.wallpaper`) ?? '{}') }; } catch { return DEFAULT_WALL; }
}
export function writeWallpaper(key: string, p: WallPrefs): void {
  try { localStorage.setItem(`${key}.wallpaper`, JSON.stringify(p)); } catch { /* приватный режим или переполнение */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
}
function useWallpaper(key: string): [WallPrefs, (patch: Partial<WallPrefs>) => void] {
  const [w, setW] = useState(() => readWallpaper(key));
  useEffect(() => { const f = () => setW(readWallpaper(key)); window.addEventListener(EVT, f); return () => window.removeEventListener(EVT, f); }, [key]);
  return [w, (patch) => { const n = { ...readWallpaper(key), ...patch }; writeWallpaper(key, n); setW(n); }];
}

// ── узоры из мобилки (AIDA/miniLORE app_flutter/lib/src/theme/dialogue_skin.dart) ──

const RING: [number, number][] = [[0.80, 0.10], [0.60, 0.20], [0.35, 0.25], [0.25, 0.60], [0.20, 0.90], [0.40, 0.80], [0.65, 0.75], [0.75, 0.40]];
function ringAt(phase: number): [number, number] {
  const i = Math.floor(phase), f = phase - i;
  const a = RING[((i % 8) + 8) % 8], b = RING[(((i + 1) % 8) + 8) % 8];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
/** Четыре пятна перелива при phase — в долях стороны (пятно k на 2k точек дальше), как в мобилке. */
export function meshPoints(phase: number): [number, number][] { return [0, 1, 2, 3].map((k) => ringAt(phase + 2 * k)); }
const MESH_TOKENS = ['var(--wrn)', 'var(--acc)', 'var(--suc)', 'var(--inf)'];
const r2 = (n: number) => Number(n.toFixed(2));

export function parquetTile(): string {
  const cell = 48, plank = cell / 3;
  let d = '';
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const x0 = col * cell, y0 = row * cell, hz = (row + col) % 2 === 0;
    d += `M${x0},${y0}L${x0 + cell},${y0}M${x0},${y0}L${x0},${y0 + cell}`;
    for (let k = 1; k < 3; k++) d += hz ? `M${x0},${r2(y0 + k * plank)}L${x0 + cell},${r2(y0 + k * plank)}` : `M${r2(x0 + k * plank)},${y0}L${r2(x0 + k * plank)},${y0 + cell}`;
    for (let k = 0; k < 3; k++) {
      const t = (k % 2 === 0 ? 0.38 : 0.66) * cell;
      d += hz ? `M${r2(x0 + t)},${r2(y0 + k * plank + 3)}L${r2(x0 + t)},${r2(y0 + (k + 1) * plank - 3)}` : `M${r2(x0 + k * plank + 3)},${r2(y0 + t)}L${r2(x0 + (k + 1) * plank - 3)},${r2(y0 + t)}`;
    }
  }
  for (const [cx, cy] of [[0, 0], [cell, cell]]) d += `M${cx},${cy - 7}L${cx + 7},${cy}L${cx},${cy + 7}L${cx - 7},${cy}ZM${cx + 1.6},${cy}A1.6,1.6 0 1 0 ${cx - 1.6},${cy}A1.6,1.6 0 1 0 ${cx + 1.6},${cy}`;
  return d;
}
const circ = (cx: number, cy: number, r: number) => `M${r2(cx + r)},${r2(cy)}A${r},${r} 0 1 0 ${r2(cx - r)},${r2(cy)}A${r},${r} 0 1 0 ${r2(cx + r)},${r2(cy)}`;
function gear(cx: number, cy: number, teeth: number, pitch: number, phase: number): string {
  const outer = pitch + 2.8, root = pitch - 2.8, step = (2 * Math.PI) / teeth;
  const at = (r: number, a: number) => `${r2(cx + r * Math.cos(a))},${r2(cy + r * Math.sin(a))}`;
  let d = '';
  for (let i = 0; i < teeth; i++) { const a = (i + phase) * step; d += `${i ? 'L' : 'M'}${at(root, a)}L${at(outer, a + step * 0.18)}L${at(outer, a + step * 0.42)}L${at(root, a + step * 0.6)}`; }
  d += 'Z';
  const big = pitch > 25, hub = big ? 9 : 4.5;
  d += circ(cx, cy, hub) + circ(cx, cy, big ? 3 : 1.6);
  if (big) { const rim = pitch - 9; d += circ(cx, cy, rim); for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3 + phase * step; d += `M${at(hub, a)}L${at(rim, a)}`; } }
  return d;
}
export function denseGearsTile(): string { const h = 56; return gear(0, 0, 17, 39.6, 0) + gear(h, h, 17, 39.6, 0.5) + gear(h, 0, 7, 16.4, 0.5) + gear(0, h, 7, 16.4, 0); }
const TILES: Record<'gearsDense' | 'parquet', [string, number]> = { gearsDense: [denseGearsTile(), 112], parquet: [parquetTile(), 96] };

function usePhase(key: unknown): number {
  const [phase, setPhase] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (typeof requestAnimationFrame !== 'function') return;
    const from = Math.round(phase), t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 500); setPhase(from + k); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return phase;
}

function SkinLayer({ skin, phaseKey }: { skin: WallSkin; phaseKey: unknown }) {
  const phase = usePhase(phaseKey);
  const light = typeof document !== 'undefined' && document.documentElement.getAttribute('data-mode') === 'light';
  const mix = light ? 72 : 40;
  const spots = meshPoints(phase).map(([x, y], k) =>
    `radial-gradient(circle at ${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%, color-mix(in srgb, ${MESH_TOKENS[k]} ${mix}%, transparent) 0, transparent 62%)`).join(', ');
  const tile = skin === 'gearsDense' || skin === 'parquet' ? TILES[skin] : null;
  return (
    <div className="sk-wall__skin" aria-hidden="true" style={{ background: `${spots}, var(--bg0)` }}>
      {tile && (
        <svg className={light ? 'sk-wall__lines is-light' : 'sk-wall__lines'} width="100%" height="100%">
          <defs><pattern id={`sk-wall-${skin}`} width={tile[1]} height={tile[1]} patternUnits="userSpaceOnUse">
            <g className="sk-wall__stroke">
              {[[0, 0], [tile[1], 0], [0, tile[1]], [tile[1], tile[1]]].map(([dx, dy]) => <path key={`${dx}-${dy}`} d={tile[0]} transform={`translate(${dx} ${dy})`} />)}
            </g>
          </pattern></defs>
          <rect width="100%" height="100%" fill={`url(#sk-wall-${skin})`} />
        </svg>)}
    </div>
  );
}

/** Обои под содержимым экрана. phaseKey — смена шага перелива (обычно текущий раздел). */
export function WallpaperFrame({ storageKey, phaseKey, children }: { storageKey: string; phaseKey?: unknown; children: ReactNode }) {
  const [w] = useWallpaper(storageKey);
  const l = wallpaperLayer(w);
  const skin = w.skin ?? 'none';
  return (
    <div className="sk-wall">
      {l && <div className="sk-wall__photo" aria-hidden="true" style={{ backgroundImage: l.backgroundImage, backgroundPosition: l.backgroundPosition }}>
        <div className="sk-wall__dim" style={{ opacity: l.dim }} /></div>}
      {!l && skin !== 'none' && <SkinLayer skin={skin} phaseKey={phaseKey} />}
      <div className="sk-wall__content">{children}</div>
    </div>
  );
}

// ── панель «Вид» ──────────────────────────────────────────────────────────

/** Пара шрифтов — как в мобилке miniLORE («Пара шрифтов»): pair — Manrope + Unbounded + IBM Plex Mono; mono — только
 *  IBM Plex Mono. Переключает переменные --font/--display (атрибут data-font на корне), шрифты нигде не зашиты. */
export type FontPair = 'pair' | 'mono';
export const FONT_PAIRS: readonly FontPair[] = ['pair', 'mono'];
type ViewPrefs = ThemePrefs & DisplayPrefs & { font?: FontPair };
function applyFont(f: FontPair | undefined) {
  if (f === 'mono') document.documentElement.setAttribute('data-font', 'mono');
  else document.documentElement.removeAttribute('data-font');
}
function readView(key: string): ViewPrefs {
  try { return { ...DEFAULT_PREFS, ...DEFAULT_DISPLAY, ...JSON.parse(localStorage.getItem(`${key}.view`) ?? '{}') }; } catch { return { ...DEFAULT_PREFS, ...DEFAULT_DISPLAY }; }
}
/** Применить сохранённый вид к корню документа — до первого кадра, чтобы не мигало. */
export function applyStoredView(key: string): void {
  const v = readView(key);
  applyTheme(document.documentElement, v);
  applyDisplay(document.documentElement, v);
  applyFont(v.font);
}
function useView(key: string): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const [v, setV] = useState(() => readView(key));
  return [v, (patch) => {
    const n = { ...readView(key), ...patch };
    applyTheme(document.documentElement, n); applyDisplay(document.documentElement, n); applyFont(n.font);
    try { localStorage.setItem(`${key}.view`, JSON.stringify(n)); } catch { /* приватный режим */ }
    setV(n);
  }];
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return <div className="sk-view__row"><span className="sk-view__title">{title}</span><div className="sk-view__opts">{children}</div></div>;
}
function Opt({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return <button type="button" className="sk-btn sk-view__opt" aria-pressed={on} aria-label={label} onClick={onClick}>{children}</button>;
}

/** Быстрые переключатели на виду: точки палитр и «тёмная / светлая». */
export function ViewQuick({ storageKey }: { storageKey: string }) {
  const lang = useKitLang();
  const [v, set] = useView(storageKey);
  return (
    <span className="sk-view__quick">
      {PALETTES.map((p) => <button key={p.id} type="button" className="sk-view__dot" title={p.label} aria-label={p.label} aria-pressed={v.palette === p.id}
        style={{ background: p.swatch }} onClick={() => set({ palette: p.id })} />)}
      <button type="button" className="sk-btn sk-view__opt" onClick={() => set({ mode: v.mode === 'dark' ? 'light' : 'dark' })}>
        {kitT(lang, v.mode === 'dark' ? 'kit.view.dark' : 'kit.view.light')}</button>
    </span>
  );
}

export function ViewPanel({ storageKey, photos = [] }: { storageKey: string; photos?: WallPhoto[] }) {
  const lang = useKitLang();
  const t = (k: string, vars?: Record<string, string | number>) => kitT(lang, k as KitKey, vars);
  const [v, set] = useView(storageKey);
  const [w, setW] = useWallpaper(storageKey);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const own = w.src?.startsWith('data:') ?? false;
  const pick = (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    if (!f.type.startsWith('image/')) return setErr(t('kit.view.badType'));
    if (f.size > WALL_PHOTO_LIMIT) return setErr(t('kit.view.tooBig', { mb: Math.round((WALL_PHOTO_LIMIT / 1048576) * 10) / 10 }));
    const rd = new FileReader();
    rd.onload = () => setW({ src: String(rd.result), skin: 'none' });
    rd.onerror = () => setErr(t('kit.view.readFail'));
    rd.readAsDataURL(f);
  };
  return (
    <div className="sk-view" role="group" aria-label={t('kit.view.title')}>
      <Row title={t('kit.view.palette')}>
        {PALETTES.map((p) => <Opt key={p.id} on={v.palette === p.id} onClick={() => set({ palette: p.id })}><span className="sk-view__swatch" style={{ background: p.swatch }} />{p.label}</Opt>)}
      </Row>
      <Row title={t('kit.view.mode')}>{MODES.map((m) => <Opt key={m} on={v.mode === m} onClick={() => set({ mode: m })}>{t(m === 'dark' ? 'kit.view.dark' : 'kit.view.light')}</Opt>)}</Row>
      <Row title={t('kit.view.density')}>{DENSITIES.map((d) => <Opt key={d} on={v.density === d} onClick={() => set({ density: d })}>{t(`kit.view.density.${d}`)}</Opt>)}</Row>
      <Row title={t('kit.view.fontPair')}>{FONT_PAIRS.map((f) => <Opt key={f} on={(v.font ?? 'pair') === f} onClick={() => set({ font: f })}>{t(`kit.view.font.${f}`)}</Opt>)}</Row>
      <Row title={t('kit.view.textSize')}>{TEXT_SIZES.map((s) => <Opt key={s} on={v.textSize === s} onClick={() => set({ textSize: s })}>{s}</Opt>)}</Row>
      <Row title={t('kit.view.stripes')}>
        <Opt on={v.stripes} onClick={() => set({ stripes: true })}>{t('kit.view.on')}</Opt><Opt on={!v.stripes} onClick={() => set({ stripes: false })}>{t('kit.view.off')}</Opt>
      </Row>
      <Row title={t('kit.view.wallSkin')}>
        {(['none', 'mesh', 'gearsDense', 'parquet'] as WallSkin[]).map((s) => <Opt key={s} on={!w.src && (w.skin ?? 'none') === s} onClick={() => setW({ skin: s, src: null })}>{t(`kit.view.skin.${s}`)}</Opt>)}
      </Row>
      <Row title={t('kit.view.wallPhoto')}>
        {photos.map((p) => <button key={p.id} type="button" className="sk-view__thumb" aria-label={p.label} aria-pressed={w.src === p.src}
          style={{ backgroundImage: cssUrl(p.src) }} onClick={() => setW({ src: p.src, skin: 'none' })} />)}
        <Opt on={own} onClick={() => file.current?.click()}>{t('kit.view.own')}</Opt>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </Row>
      {w.src && (
        <Row title="">
          {(['left', 'center', 'right'] as WallPos[]).map((p) => <Opt key={p} on={w.pos === p} onClick={() => setW({ pos: p })}>{t(`kit.view.pos.${p}`)}</Opt>)}
          <label className="sk-view__dimlabel">{t('kit.view.dim')}
            <input type="range" min={0} max={90} value={Math.round(w.dim * 100)} onChange={(e) => setW({ dim: Number(e.target.value) / 100 })} /></label>
        </Row>)}
      {err && <span className="sk-view__err" role="alert">{err}</span>}
    </div>
  );
}
