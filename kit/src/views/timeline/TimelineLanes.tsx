// Таймлайн с дорожками (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-06): дорожки — та же
// общая группировка, что у списка и доски (ключ поля или разрез по связи
// `rel:<ТИП>`), полосы — от даты начала до даты конца. Честность: записи без
// валидной даты не пропадают молча — счётчик «Без дат, не на шкале: N»;
// ни одной даты — пустое состояние, а не пустая шкала.
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { KitConfig, KitData, KitRecord } from '../../core/contract';
import { kitT, useKitLang } from '../../i18n';
import { LIST_BUDGET } from '../../list/listModel';
import { groupTitle } from '../../list/groupLabel';
import { timelineLanes } from '../../list/grouping';
import { EmptyState } from '../../states/StateViews';
import { useNarrow } from '../../core/narrow';

export interface TimelineLanesProps {
  config: KitConfig;
  /** Связи и заголовки связанных записей для разрезов. */
  data: KitData;
  /** Записи на шкале (уже отфильтрованные); по умолчанию — data.records. */
  records?: readonly KitRecord[];
  /** Ключ общей группировки (как lg списка); null — одна дорожка. */
  group: string | null;
  /** Поле даты начала (`fields.start`) и конца (необязательно — тогда точка). */
  start: string;
  end?: string;
  href?: (id: string) => string;
  budget?: Partial<{ maxGroups: number; topGroups: number }>;
  className?: string;
  /**
   * Узкий экран: вместо шкалы — список по датам начала (S4-MOBILE-EDGE, как
   * v1 MOB-03). Не задан — по единому порогу kit (useNarrow, ≤720px).
   */
  narrow?: boolean;
}

const DAY = 86_400_000;
const dayOf = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);

export function TimelineLanes({
  config, data, records, group, start, end, href, budget, className, narrow: narrowProp,
}: TimelineLanesProps) {
  const lang = useKitLang();
  const narrow = useNarrow(narrowProp);
  const pool = records ?? data.records;
  const model = useMemo(
    () => timelineLanes(pool, group, config, data, { start, end }, { ...LIST_BUDGET, ...budget }),
    [pool, group, config, data, start, end, budget],
  );
  const statuses = useMemo(() => new Map(config.statuses.items.map(s => [s.code, s])), [config]);

  const undated = model.undated.length > 0 && (
    <p className="sk-tl__undated" data-testid="kit-timeline-undated">
      {kitT(lang, 'kit.timeline.undated', { n: model.undated.length })}
    </p>
  );

  if (!model.range) {
    return (
      <div className={['sk-tl', className].filter(Boolean).join(' ')}>
        <EmptyState
          title={kitT(lang, 'kit.timeline.empty')}
          hint={kitT(lang, 'kit.timeline.emptyHint', { field: start })}
        />
        {undated}
      </div>
    );
  }

  if (narrow) {
    // Телефон (S4-MOBILE-EDGE): полгода в 300 px не читаются, полосы режутся
    // справа. Те же записи, что на шкале, — группами по МЕСЯЦУ начала, по
    // возрастанию (как ось слева направо): выбор владелицы 11.11 по прототипу
    // («2б») — по дню почти у каждой записи был свой заголовок. Внутри месяца —
    // по дате начала, при равной дате — порядок шкалы (дорожка за дорожкой).
    // Срок и дорожка — в строке: со шкалы не теряется ничего.
    const months = new Map<string, { item: (typeof model.lanes)[number]['items'][number]; lane: string | null; order: number }[]>();
    let order = 0;
    for (const { lane, items } of model.lanes) {
      const laneTitle = group ? groupTitle(config, lang, group, lane) : null;
      for (const it of items) {
        const key = it.start.slice(0, 7);
        const row = months.get(key) ?? [];
        row.push({ item: it, lane: laneTitle, order: order++ });
        months.set(key, row);
      }
    }
    for (const rows of months.values()) {
      rows.sort((a, b) => (a.item.start < b.item.start ? -1 : a.item.start > b.item.start ? 1 : a.order - b.order));
    }
    const ordered = [...months.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const monthFmt = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const monthTitle = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
    return (
      <div
        className={['sk-tl', 'sk-tl--dates', className].filter(Boolean).join(' ')}
        role="region"
        aria-label={kitT(lang, 'kit.timeline.label')}
      >
        <p className="sk-tl__range">{kitT(lang, 'kit.timeline.range', model.range)}</p>
        {ordered.map(([ym, rows]) => (
          <section key={ym} className="sk-tl__day" data-month={ym} aria-label={kitT(lang, 'kit.list.lane', { title: monthTitle(ym), n: rows.length })}>
            <h3 className="sk-tl__head">
              <span className="sk-tl__title">{monthTitle(ym)}</span>
              <span className="sk-tl__count">{rows.length}</span>
            </h3>
            <ul className="sk-tl__items">
              {rows.map(({ item: it, lane }) => {
                const s = statuses.get(it.record.status);
                const label = kitT(lang, 'kit.timeline.bar', { title: it.record.title, start: it.start, end: it.end });
                const when = it.end === it.start ? it.start : `${it.start} — ${it.end}`;
                return (
                  <li
                    key={it.record.id}
                    className="sk-tl__item"
                    data-record-id={it.record.id}
                    data-status={it.record.status}
                    style={{ '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties}
                  >
                    {href
                      ? <a className="sk-tl__label" href={href(it.record.id)} aria-label={label}>{it.record.title}</a>
                      : <span className="sk-tl__label">{it.record.title}</span>}
                    <span className="sk-tl__meta">
                      <span className="sk-tl__when">{when}</span>
                      {lane && <span className="sk-tl__lanechip">{lane}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {undated}
      </div>
    );
  }

  const min = dayOf(model.range.min);
  const span = dayOf(model.range.max) - min + 1;
  const pct = (d: number) => `${((d / span) * 100).toFixed(3)}%`;

  return (
    <div
      className={['sk-tl', className].filter(Boolean).join(' ')}
      role="region"
      aria-label={kitT(lang, 'kit.timeline.label')}
    >
      <p className="sk-tl__range">{kitT(lang, 'kit.timeline.range', model.range)}</p>
      {model.lanes.map(({ lane, items }) => {
        const title = group ? groupTitle(config, lang, group, lane) : kitT(lang, 'kit.timeline.label');
        return (
          <section
            key={lane.key}
            className="sk-tl__lane"
            data-lane-key={lane.key}
            aria-label={kitT(lang, 'kit.list.lane', { title, n: items.length })}
          >
            <h3 className={lane.missing || lane.none || lane.unknown ? 'sk-tl__head is-unknown' : 'sk-tl__head'}>
              <span className="sk-tl__title">{title}</span>
              <span className="sk-tl__count">{items.length}</span>
            </h3>
            <ul className="sk-tl__track">
              {items.map(it => {
                const s = statuses.get(it.record.status);
                const from = dayOf(it.start) - min;
                const len = dayOf(it.end) - dayOf(it.start) + 1;
                const label = kitT(lang, 'kit.timeline.bar', { title: it.record.title, start: it.start, end: it.end });
                const style = { left: pct(from), width: pct(len), '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties;
                return (
                  <li key={it.record.id} className="sk-tl__bar" data-record-id={it.record.id} data-status={it.record.status} style={style} title={label}>
                    {href
                      ? <a className="sk-tl__label" href={href(it.record.id)} aria-label={label}>{it.record.title}</a>
                      : <span className="sk-tl__label">{label}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {undated}
    </div>
  );
}
