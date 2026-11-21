// Плитки показаний и устройств (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «вставь в кит все»).
// Пять видов, отобранных на прототипе GLADSHEIM /appnew («Плитки: варианты»), и мини-линия:
//   A · TileRow     — капсула с кружком-иконкой, подпись и значение строкой (образец — Mushroom, Home Assistant);
//   B · TileSquare  — квадрат «включено / спит»: активное ярче (образец — Apple Home);
//   C · TileBar     — капсула, фон заливается долей шкалы (образец — Bubble Card);
//   D · GroupCard   — карточка группы: главное значение крупно, остальное чипами, линия фоном (room-summary);
//   E · TileGauge   — кольцо-шкала: дуга по доле, тревога — цветом (gauge);
//   Sparkline       — мини-линия: пропуск рвёт линию, а не тянет её к нулю.
// kit предметных имён не знает: картинку (icon), цвет вида (tone — токен темы), подписи и значения даёт приложение.
// «Оценка» (estimate) — значение не с датчика (макет, сводка): приглушено и со звёздочкой, пояснение — в title.
import type { CSSProperties, ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import { Sparkline, type SparkPoint } from '../charts/spark';

/** Доля значения на шкале [min, max], прижатая к 0..1; нет значения — null (не ноль). */
export function tileFraction(value: number | null | undefined, scale: [number, number]): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const [lo, hi] = scale;
  if (hi === lo) return null;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

/** Общие части плиток. tone — токен темы цвета вида: 'var(--inf)'. */
export interface TileCommon {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: string;
  /** Значение не с датчика (макет, сводка) — приглушено и со звёздочкой. */
  estimate?: boolean;
  /** Тревога (душно, протечка) — значение и рамка цветом опасности. */
  alarm?: boolean;
  /** Уточнение второй строкой («20,1–24,3», «не отвечает 1»). */
  sub?: string;
}

const toneVar = (tone?: string): CSSProperties => (tone ? ({ ['--tile-tone' as string]: tone } as CSSProperties) : {});

function Value({ value, estimate }: { value: string; estimate?: boolean }) {
  const lang = useKitLang();
  return (
    <span className={estimate ? 'sk-tile__value is-estimate' : 'sk-tile__value'} title={estimate ? kitT(lang, 'kit.tile.estimate') : undefined}>
      {value}{estimate && <sup className="sk-tile__mark">*</sup>}
    </span>
  );
}

function Bubble({ icon }: { icon: ReactNode }) {
  return <span className="sk-tile__bubble"><span className="sk-tile__bubble-bg" /><span className="sk-tile__icon">{icon}</span></span>;
}

const cls = (base: string, p: { alarm?: boolean }, extra?: string) => [base, p.alarm ? 'is-alarm' : '', extra].filter(Boolean).join(' ');

// ── A ──────────────────────────────────────────────────────────────────────
export function TileRow(p: TileCommon) {
  return (
    <div className={cls('sk-tilerow', p)} style={toneVar(p.tone)}>
      <Bubble icon={p.icon} />
      <span className="sk-tilerow__text">
        <span className="sk-tile__label">{p.label}</span>
        <Value value={p.value} estimate={p.estimate} />
        {p.sub && <span className="sk-tile__sub">{p.sub}</span>}
      </span>
    </div>
  );
}

// ── B ──────────────────────────────────────────────────────────────────────
export function TileSquare(p: TileCommon & { active: boolean }) {
  return (
    <div className={cls('sk-tilesq', p, p.active ? 'is-on' : '')} style={toneVar(p.tone)}>
      <span className="sk-tile__icon">{p.icon}</span>
      <span className="sk-tilesq__text">
        <span className="sk-tile__label">{p.label}</span>
        <Value value={p.value} estimate={p.estimate} />
        {p.sub && <span className="sk-tile__sub">{p.sub}</span>}
      </span>
    </div>
  );
}

// ── C ──────────────────────────────────────────────────────────────────────
export function TileBar(p: TileCommon & { fraction: number | null }) {
  const pct = p.fraction == null ? null : Math.round(p.fraction * 100);
  return (
    <div className={cls('sk-tilebar', p)} style={toneVar(p.tone)} role="meter" aria-label={p.label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={p.value}>
      {pct != null && <span className="sk-tilebar__fill" style={{ width: `${pct}%` }} />}
      <span className="sk-tilebar__bubble"><span className="sk-tile__icon">{p.icon}</span></span>
      <span className="sk-tile__label sk-tilebar__label">{p.label}</span>
      <Value value={p.value} estimate={p.estimate} />
    </div>
  );
}

// ── D ──────────────────────────────────────────────────────────────────────
export interface GroupChip { key: string; icon: ReactNode; text: string; tone?: string; alarm?: boolean }

export function GroupCard({ title, main, empty, chips, series, estimate, alarm, tone, onOpen, background, details, size, photo = 'cover' }: {
  title: string; main: string | null; empty?: string; chips: GroupChip[]; series?: readonly SparkPoint[];
  estimate?: boolean; alarm?: boolean; tone?: string; onOpen?: () => void;
  /** Фон-картинка (фото комнаты, как в GLADSHEIM /app): адрес даёт приложение; поверх — затемнение для читаемости. */
  background?: string;
  /** Подробности (крупная карточка): списки и строки приложения под чипами. */
  details?: ReactNode;
  /** large — крупная карточка (2×2 в раскладке «бенто»): линия выше, главное значение крупнее. */
  size?: 'normal' | 'large';
  /** Как лежит фон-картинка: cover — на всю карточку; top — узкой приглушённой полосой сверху (карточка комнаты в /app). */
  photo?: 'cover' | 'top';
}) {
  const lang = useKitLang();
  const body = (
    <>
      {background && <span className="sk-groupcard__photo" style={{ backgroundImage: `url("${background.replace(/"/g, '%22')}")` }} aria-hidden="true" />}
      {series && <Sparkline className="sk-groupcard__bg" points={series} height={30} area />}
      <span className="sk-groupcard__head">
        <span className="sk-groupcard__title">{title}</span>
        {estimate && <span className="sk-tile__sub" title={kitT(lang, 'kit.tile.estimate')}>*</span>}
      </span>
      {main == null
        ? <span className="sk-groupcard__empty">{empty ?? kitT(lang, 'kit.stat.none')}</span>
        : <span className={estimate ? 'sk-groupcard__main is-estimate' : 'sk-groupcard__main'}>{main}</span>}
      {chips.length > 0 && (
        <span className="sk-groupcard__chips">
          {chips.map((c) => (
            <span key={c.key} className={c.alarm ? 'sk-groupcard__chip is-alarm' : 'sk-groupcard__chip'} style={toneVar(c.tone)}>
              <span className="sk-tile__icon">{c.icon}</span>{c.text}</span>))}
        </span>)}
      {details && <span className="sk-groupcard__details">{details}</span>}
    </>
  );
  const className = cls('sk-groupcard', { alarm }, [background ? (photo === 'top' ? 'has-photo-top' : 'has-photo') : '', size === 'large' ? 'sk-groupcard--large' : ''].filter(Boolean).join(' '));
  return onOpen
    ? <button type="button" className={className} style={toneVar(tone)} onClick={onOpen}>{body}</button>
    : <div className={className} style={toneVar(tone)}>{body}</div>;
}

// ── E ──────────────────────────────────────────────────────────────────────
export function TileGauge(p: TileCommon & { fraction: number | null }) {
  const r = 30, c = 2 * Math.PI * r, arc = 0.75;
  const f = p.fraction ?? 0;
  return (
    <div className={cls('sk-tilegauge', p)} style={toneVar(p.tone)} role="meter" aria-label={p.label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.fraction == null ? undefined : Math.round(f * 100)} aria-valuetext={p.value}>
      <svg className="sk-tilegauge__ring" viewBox="0 0 80 80" aria-hidden="true">
        <circle className="sk-tilegauge__track" cx={40} cy={40} r={r} strokeDasharray={`${c * arc} ${c}`} />
        {p.fraction != null && <circle className="sk-tilegauge__arc" cx={40} cy={40} r={r} strokeDasharray={`${c * arc * f} ${c}`} />}
      </svg>
      <span className="sk-tilegauge__center">
        <span className="sk-tile__icon">{p.icon}</span>
        <Value value={p.value} estimate={p.estimate} />
      </span>
      <span className="sk-tile__label">{p.label}</span>
    </div>
  );
}
