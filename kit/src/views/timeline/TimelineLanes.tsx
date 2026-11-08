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
}

const DAY = 86_400_000;
const dayOf = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);

export function TimelineLanes({
  config, data, records, group, start, end, href, budget, className,
}: TimelineLanesProps) {
  const lang = useKitLang();
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
