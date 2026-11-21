// Баннер-вердикт, сетка-дашборд, полоски «мин–макс» (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «доделай», пункт 5;
// образцы — экран «Сейчас» прототипа GLADSHEIM /appnew и /app).
//   • VerdictBanner — одна крупная фраза состояния и подробность. Какой вердикт — решает приложение
//     («всё в порядке» только когда все источники ответили и всё на связи); kit только рисует тон.
//   • DashGrid + DashCell — сетка плиток разного размера (span × rows): асимметрия без дыр (grid-auto-flow: dense);
//     в ячейку приложение кладёт что угодно — план, погоду, фото.
//   • RangeBars — полоски «мин–макс» по дням на общей шкале; картинка дня — от приложения.
import type { CSSProperties, ReactNode } from 'react';

export type VerdictTone = 'ok' | 'warn' | 'bad' | 'unknown';

export function VerdictBanner({ tone, headline, detail }: { tone: VerdictTone; headline: string; detail?: string }) {
  return (
    <section className={`sk-verdict is-${tone}`} role="status">
      <span className="sk-verdict__headline">{headline}</span>
      {detail && <span className="sk-verdict__detail">{detail}</span>}
    </section>
  );
}

export function DashGrid({ children, min = 220, cols }: { children: ReactNode; /** Минимальная ширина колонки, px. */ min?: number;
  /** Мозаика с заданным числом колонок (как «Сейчас» в GLADSHEIM /app — 4): уже 1000px — 2, на телефоне — 1. */ cols?: number }) {
  const style = (cols ? { ['--dash-cols' as string]: String(cols) } : { ['--dash-min' as string]: `${min}px` }) as CSSProperties;
  return <div className={cols ? 'sk-dash sk-dash--cols' : 'sk-dash'} style={style}>{children}</div>;
}

export function DashCell({ span = 1, rows = 1, title, children, muted }: { span?: number; rows?: number; title?: string; children: ReactNode; muted?: boolean }) {
  return (
    <section className={muted ? 'sk-dash__cell is-muted' : 'sk-dash__cell'} style={{ gridColumn: `span ${span}`, gridRow: `span ${rows}` }}>
      {title && <span className="sk-dash__title">{title}</span>}
      {children}
    </section>
  );
}

export interface RangeDay { label: string; min: number; max: number; icon?: ReactNode }

/** Геометрия полосок: общая шкала lo..hi; у дня — left и width в процентах (ширина не меньше 2 %). */
export function rangeGeometry(days: readonly { min: number; max: number }[]) {
  const lo = Math.min(...days.map((d) => d.min)), hi = Math.max(...days.map((d) => d.max)), span = hi - lo || 1;
  return { lo, hi, bars: days.map((d) => ({ left: Math.round(((d.min - lo) / span) * 1000) / 10, width: Math.max(2, Math.round(((d.max - d.min) / span) * 1000) / 10) })) };
}

export function RangeBars({ days, unit = '', empty }: { days: readonly RangeDay[]; unit?: string; empty?: string }) {
  if (!days.length) return <span className="sk-range__empty">{empty ?? '—'}</span>;
  const g = rangeGeometry(days);
  return (
    <div className="sk-range">
      {days.map((d, i) => (
        <div key={`${d.label}-${i}`} className="sk-range__row">
          <span className="sk-range__label">{d.label}</span>
          <span className="sk-range__icon">{d.icon}</span>
          <span className="sk-range__min">{`${Math.round(d.min)}${unit}`}</span>
          <span className="sk-range__track"><span className="sk-range__bar" style={{ left: `${g.bars[i].left}%`, width: `${g.bars[i].width}%` }} /></span>
          <span className="sk-range__max">{`${Math.round(d.max)}${unit}`}</span>
        </div>))}
    </div>
  );
}
