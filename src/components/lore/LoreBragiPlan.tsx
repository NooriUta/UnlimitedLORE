// LoreBragiPlan — FE-03: "План" tab of LoreBragiScreen. Month calendar grid +
// static channel-cadence block, matching bragi-archive-prototype.html's
// .cal/.cal-head layout. No reusable month-grid component exists in this repo
// (vis-timeline, used by LorePlanBoard, is a horizontal Gantt — see FE-01 note)
// so this is a small from-scratch grid over bragi_calendar.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../api/lore';
import LoreBragiPublicationEditor from './LoreBragiPublicationEditor';

interface CalendarRow {
  variant_id: string;
  status: string | null;
  published_at: string; // YYYY-MM-DD
  url: string | null;
  publication_id: string[];
  title: string[];
  channel_id: string[];
}

const CHANNEL_COLOR: Record<string, string> = {
  'CH-VC': 'var(--acc)', 'CH-HABR': 'var(--inf)', 'CH-TG': 'var(--suc)', 'CH-SITE': 'var(--wrn)',
};
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_FALLBACK: Record<string, string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
const CADENCE_KEYS: { key: string; channel: string; rule: string }[] = [
  { key: 'vc',       channel: 'VC.ru',    rule: '1 лонгрид / 1.5–2 нед' },
  { key: 'habr',     channel: 'Habr',     rule: '1 техничка / 2–3 нед' },
  { key: 'telegram', channel: 'Telegram', rule: '2 поста/нед (якорь + тёплый)' },
  { key: 'seed',     channel: 'посев',    rule: 'после VC/Habr' },
];

function monthLabel(d: Date): string {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function LoreBragiPlan() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => new Date());
  const [creatingDate, setCreatingDate] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetchLoreSlice<CalendarRow>('bragi_calendar')
      .then(rs => { setRows(rs); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarRow[]>();
    rows.forEach(r => {
      if (!r.published_at) return;
      const key = r.published_at.slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    });
    return m;
  }, [rows]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const out: { date: Date; otherMonth: boolean }[] = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      out.push({ date: new Date(year, month - 1, daysInPrevMonth - i), otherMonth: true });
    }
    for (let d = 1; d <= daysInMonth; d++) out.push({ date: new Date(year, month, d), otherMonth: false });
    while (out.length % 7 !== 0) {
      const last = out[out.length - 1].date;
      out.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), otherMonth: true });
    }
    return out;
  }, [cursor]);

  const today = new Date();

  if (creatingDate) {
    return (
      <LoreBragiPublicationEditor
        initialPublishedAt={creatingDate}
        onSaved={() => { setCreatingDate(null); load(); }}
        onCancel={() => setCreatingDate(null)}
      />
    );
  }

  if (loading) return <div style={S.hint}>{t('bragi.plan.loading', 'загрузка…')}</div>;

  return (
    <div>
      <div style={S.desc}>{t('bragi.plan.desc', '2-месячный контент-пуш · VC + Habr + Telegram · стадия соцкапитала.')}</div>
      <div style={S.grid2}>
        <div style={S.card}>
          <h2 style={S.cardH2}>
            {t('bragi.plan.calendarTitle', 'календарь публикаций')} <span style={S.meta}>{monthLabel(cursor)}</span>
          </h2>
          <div style={S.monthNav}>
            <span style={S.navBtn} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>{t('bragi.plan.navPrev', '‹ пред.')}</span>
            <span style={S.navBtn} onClick={() => setCursor(new Date())}>{t('bragi.plan.navToday', 'сегодня')}</span>
            <span style={S.navBtn} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>{t('bragi.plan.navNext', 'след. ›')}</span>
          </div>
          <div style={S.legend}>
            {Object.entries(CHANNEL_COLOR).map(([ch, col]) => (
              <span key={ch} style={S.legendItem}><span style={legendDotStyle(col)} />{ch}</span>
            ))}
          </div>
          <div style={S.calHead}>
            {WEEKDAY_KEYS.map(w => <span key={w}>{t('bragi.plan.weekday.' + w, WEEKDAY_FALLBACK[w])}</span>)}
          </div>
          <div style={S.cal}>
            {cells.map((c, i) => {
              const dateStr = ymd(c.date);
              const items = byDate.get(dateStr) ?? [];
              const isToday = isSameDay(c.date, today) && !c.otherMonth;
              return (
                <div
                  key={i}
                  style={cellStyle(c.otherMonth, isToday)}
                  onClick={() => setCreatingDate(dateStr)}
                  title={t('bragi.plan.cellTitle', 'Запланировать публикацию на эту дату')}
                >
                  <div style={dnumStyle(isToday)}>{c.date.getDate()}</div>
                  {items.map(it => (
                    <div key={it.variant_id} style={pchipStyle(CHANNEL_COLOR[it.channel_id[0]] ?? 'var(--t3)')}>
                      {it.channel_id[0] ?? '—'} · {it.title[0] ?? it.variant_id}
                    </div>
                  ))}
                  {items.length === 0 && !c.otherMonth && <div style={S.addHint}>+</div>}
                </div>
              );
            })}
          </div>
        </div>
        <div style={S.card}>
          <h2 style={S.cardH2}>{t('bragi.plan.cadenceTitle', 'ритм')}</h2>
          <div style={{ fontSize: 'var(--fs-md)', lineHeight: 1.9, color: 'var(--t2)' }}>
            {CADENCE_KEYS.map(c => (
              <div key={c.key}><b style={{ color: 'var(--t1)' }}>{c.channel}</b> — {t('bragi.plan.cadence.' + c.key, c.rule)}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function legendDotStyle(color: string): React.CSSProperties {
  return { width: 9, height: 9, borderRadius: 2, display: 'inline-block', background: color, marginRight: 6 };
}
function cellStyle(otherMonth: boolean, isToday: boolean): React.CSSProperties {
  return {
    minHeight: 78, background: 'var(--bg0)', border: `1px solid ${isToday ? 'var(--acc)' : 'var(--bd)'}`,
    borderRadius: 8, padding: 6, opacity: otherMonth ? 0.38 : 1,
    boxShadow: isToday ? 'inset 0 0 0 1px var(--acc)' : undefined,
    cursor: otherMonth ? 'default' : 'pointer',
  };
}
function dnumStyle(isToday: boolean): React.CSSProperties {
  return { fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)', color: isToday ? 'var(--acc)' : 'var(--t2)', textAlign: 'right', marginBottom: 3 };
}
function pchipStyle(color: string): React.CSSProperties {
  return {
    fontSize: 'var(--fs-xs)', border: `1px solid ${color}55`, borderRadius: 5, padding: '2px 5px', marginTop: 3,
    lineHeight: 1.3, color, background: `${color}1a`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
}

const S: Record<string, React.CSSProperties> = {
  desc:      { color: 'var(--t2)', fontSize: 'var(--fs-lg)', marginBottom: 18 },
  hint:      { fontSize: 'var(--fs-base)', color: 'var(--t3)' },
  grid2:     { display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'start' },
  card:      { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px' },
  cardH2:    { fontFamily: 'var(--font)', fontWeight: 600, fontSize: 'var(--fs-lg)', margin: '0 0 12px', display: 'flex',
               justifyContent: 'space-between', alignItems: 'center' },
  meta:      { fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  monthNav:  { display: 'flex', gap: 10, fontSize: 'var(--fs-base)', color: 'var(--t2)', marginBottom: 10 },
  navBtn:    { cursor: 'pointer', color: 'var(--acc)' },
  legend:    { display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 'var(--fs-sm)', color: 'var(--t2)', marginBottom: 12 },
  legendItem:{ display: 'flex', alignItems: 'center' },
  calHead:   { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6,
               fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  cal:       { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 },
  addHint:   { fontSize: 'var(--fs-lg)', color: 'var(--t3)', textAlign: 'center', marginTop: 6 },
};
