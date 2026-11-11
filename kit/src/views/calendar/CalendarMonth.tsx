// Вид «Календарь» — месяц сеткой (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-CALENDAR).
//
// Прототип утверждён владелицей 11.11.2026: месяц сеткой на десктопе, список
// по дням на телефоне; в клетке до трёх записей, дальше «ещё N»; записи без
// даты не теряются — их число в шапке. Какое поле — дата и что за записи,
// решает приложение (`list.calendar.date`, K-14). Цвет полоски — статус записи;
// цвет типа придёт с K4-MENTION-LOOK (модель отдаст канон типа).
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { KitConfig, KitRecord } from '../../core/contract';
import { kitT, useKitLang } from '../../i18n';
import { useNarrow } from '../../core/narrow';
import { calendarMonth, shiftMonth } from './calendarModel';

export interface CalendarMonthProps {
  config: KitConfig;
  records: readonly KitRecord[];
  /** Поле даты (ключ fields или updated_at). */
  date: string;
  /** Месяц YYYY-MM; не задан — текущий (управляемый, если задан onMonth). */
  month?: string;
  onMonth?: (month: string) => void;
  href?: (id: string) => string;
  onOpen?: (id: string) => void;
  /** Сколько записей видно в клетке. По умолчанию 3 (прототип). */
  perDay?: number;
  narrow?: boolean;
  /** «Сегодня» YYYY-MM-DD — для витрины и снимков (иначе снимок менялся бы каждый день). */
  today?: string;
  className?: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function CalendarMonth({ config, records, date, month: monthProp, onMonth, href, onOpen, perDay = 3, narrow: narrowProp, today: todayProp, className }: CalendarMonthProps) {
  const lang = useKitLang();
  const narrow = useNarrow(narrowProp);
  const today = todayProp ?? todayIso();
  const [own, setOwn] = useState(() => (monthProp ?? today.slice(0, 7)));
  const month = monthProp ?? own;
  const go = (m: string) => { if (monthProp === undefined) setOwn(m); onMonth?.(m); };
  const model = useMemo(() => calendarMonth(records, date, month), [records, date, month]);
  const statuses = useMemo(() => new Map(config.statuses.items.map(s => [s.code, s])), [config]);
  const monthTitle = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dows = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 2 + i))));

  const ev = (r: KitRecord) => {
    const s = statuses.get(r.status);
    const style = { '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties;
    const label = kitT(lang, 'kit.calendar.event', { title: r.title, status: s?.title ?? r.status });
    const body = <span className="sk-cal__evt">{r.title}</span>;
    return (
      <li key={r.id} className="sk-cal__ev" data-record-id={r.id} data-status={r.status} style={style} title={label}>
        {href
          ? <a href={href(r.id)} aria-label={label} onClick={onOpen ? e => { e.preventDefault(); onOpen(r.id); } : undefined}>{body}</a>
          : onOpen ? <button type="button" className="sk-cal__evbtn" aria-label={label} onClick={() => onOpen(r.id)}>{body}</button> : body}
      </li>
    );
  };

  const head = (
    <div className="sk-cal__head">
      <button type="button" className="sk-btn" aria-label={kitT(lang, 'kit.calendar.prev')} onClick={() => go(shiftMonth(month, -1))}>‹</button>
      <h3 className="sk-cal__month">{monthTitle}</h3>
      <button type="button" className="sk-btn" aria-label={kitT(lang, 'kit.calendar.next')} onClick={() => go(shiftMonth(month, 1))}>›</button>
      <button type="button" className="sk-btn" onClick={() => go(today.slice(0, 7))}>{kitT(lang, 'kit.calendar.today')}</button>
      {model.undated.length > 0 && <span className="sk-cal__undated">{kitT(lang, 'kit.calendar.undated', { n: model.undated.length })}</span>}
    </div>
  );

  if (narrow) {
    const days = model.weeks.flat().filter(d => d.inMonth && d.records.length);
    return (
      <div className={['sk-cal', 'sk-cal--days', className].filter(Boolean).join(' ')} role="region" aria-label={kitT(lang, 'kit.calendar.label')}>
        {head}
        {days.length === 0 && <p className="sk-cal__none">{kitT(lang, 'kit.calendar.emptyMonth')}</p>}
        {days.map(d => (
          <section key={d.date} className="sk-cal__pday" data-date={d.date} data-today={d.date === today ? '' : undefined}>
            <h4 className="sk-cal__pdh">{dayFmt.format(new Date(`${d.date}T00:00:00Z`))}</h4>
            <ul className="sk-cal__evs">{d.records.map(ev)}</ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className={['sk-cal', className].filter(Boolean).join(' ')} role="region" aria-label={kitT(lang, 'kit.calendar.label')}>
      {head}
      <div className="sk-cal__grid">
        {dows.map(w => <div key={w} className="sk-cal__dow" aria-hidden="true">{w}</div>)}
        {model.weeks.flat().map(d => {
          const shown = d.records.slice(0, perDay);
          const rest = d.records.length - shown.length;
          return (
            <div key={d.date} className="sk-cal__day" data-date={d.date}
              data-out={d.inMonth ? undefined : ''} data-today={d.date === today ? '' : undefined}>
              <span className="sk-cal__n">{Number(d.date.slice(8))}</span>
              {shown.length > 0 && <ul className="sk-cal__evs">{shown.map(ev)}</ul>}
              {rest > 0 && <span className="sk-cal__more">{kitT(lang, 'kit.calendar.more', { n: rest })}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
