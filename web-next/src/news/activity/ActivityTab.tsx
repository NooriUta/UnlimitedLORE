// Вкладка «Активность» паспорта (SPRINT_UXR_S7A_NEWS/S7A-06): лента
// GET /lore/news/v2, суженная до своей записи — проекта, вехи, спринта или
// релиза. Паспорта строит S5: он вставляет вкладку одной строкой в
// KindConfig.tabs — activityKindTab({ kind: 'sprint' }) — без своей логики.
//
// Правила (D-2026-UXR-NEWS-V2-RULES, SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0):
//  - числа рисуем, не считаем: сводка — поля metrics ответа как есть;
//  - время местное и машинное рядом; «только дата» — «время неизвестно»;
//  - задачи и спеки (и прочие записи) — ссылки на свои паспорта;
//  - честные состояния (S7A-07): пусто ≠ сбой ≠ нет прав ≠ неполно ≠ не проверено.
import { useMemo, type ReactNode } from 'react';
import type { KindConfig, KitRecord } from '@seidr/kit';
import { Pill } from '@seidr/kit';
import { useKitLang, type KitLang } from '@seidr/kit';
import { EmptyState, Forbidden, LoadError, Skeleton } from '@seidr/kit';
import { useLoadState } from '@seidr/kit';
import {
  activityBurn, activityParams, activityState, machineTime,
  type ActivityOptions, type ActivityTarget,
} from './activityModel';
import { defaultActivitySource, type ActivitySource } from './activitySource';
import { activityLabel, activityT } from './locale';
import type { NewsV2Response, NewsV2Row, NewsV2TaskPart } from './newsV2';

export interface ActivityTabProps extends ActivityOptions {
  target: ActivityTarget;
  /** Источник ленты; по умолчанию — defaultActivitySource() (фикстура/живой API). */
  source?: ActivitySource;
  /** Ссылка на паспорт записи строки; нет — строка без ссылки. */
  hrefFor?: (row: NewsV2Row) => string | null | undefined;
}

export function ActivityTab({ target, source, hrefFor, days, tz, limit }: ActivityTabProps) {
  const lang = useKitLang();
  const params = activityParams(target, { days, tz, limit });
  if (!params.ok) {
    const key = params.reason === 'release-no-sprints' ? 'kit.activity.unsupported.release' : 'kit.activity.unsupported.noId';
    return (
      <section className="sk-act" aria-label={activityT(lang, 'kit.activity.label')}>
        <p className="sk-act__banner sk-act__banner--wrn" data-testid="kit-activity-unsupported">{activityT(lang, key)}</p>
      </section>
    );
  }
  return <ActivityLoaded target={target} query={params.query} source={source} hrefFor={hrefFor} lang={lang} />;
}

interface LoadedProps {
  target: ActivityTarget;
  query: string;
  source?: ActivitySource;
  hrefFor?: ActivityTabProps['hrefFor'];
  lang: KitLang;
}

function ActivityLoaded({ target, query, source, hrefFor, lang }: LoadedProps) {
  const src = useMemo(() => source ?? defaultActivitySource(), [source]);
  const result = useLoadState<NewsV2Response>(signal => src(query, signal), [query, src], { rows: d => d.events ?? [] });
  const label = activityT(lang, 'kit.activity.label');

  if (result.state === 'loading') return <section className="sk-act" aria-label={label}><Skeleton lines={4} /></section>;
  if (result.state === 'error') {
    return <section className="sk-act" aria-label={label}><LoadError error={result.error} onRetry={result.reload} /></section>;
  }
  if (result.state === 'forbidden') {
    const reason = result.error instanceof Error ? result.error.message : undefined;
    return <section className="sk-act" aria-label={label}><Forbidden reason={reason} /></section>;
  }

  const data = result.data as NewsV2Response;
  const st = activityState(data);
  const rows = data.events ?? [];
  const tzName = data.meta?.period?.tz;

  return (
    <section className="sk-act" aria-label={label} data-testid="kit-activity" data-state={st.state}>
      <Summary data={data} target={target} lang={lang} />
      {st.state === 'partial' && (
        <div className="sk-act__banner sk-act__banner--dng" role="alert" data-testid="kit-activity-partial">
          <p className="sk-act__banner-text">{activityT(lang, 'kit.activity.partial')}</p>
          <ul className="sk-act__errors">
            {st.errors.map((e, i) => (
              <li key={`${e.source}:${i}`}><code className="sk-act__src">{e.source}</code> {e.error}</li>
            ))}
          </ul>
        </div>
      )}
      {st.state === 'unverified' && (
        <p className="sk-act__banner sk-act__banner--wrn" data-testid="kit-activity-unverified">{activityT(lang, 'kit.activity.unverified')}</p>
      )}
      {st.validationFailed && (
        <p className="sk-act__banner sk-act__banner--wrn" data-testid="kit-activity-validation">{activityT(lang, 'kit.activity.validation')}</p>
      )}
      {st.truncated && (
        <p className="sk-act__banner sk-act__banner--inf" data-testid="kit-activity-truncated">{activityT(lang, 'kit.activity.truncated')}</p>
      )}
      {st.state === 'empty' ? (
        <div data-testid="kit-activity-empty">
          <EmptyState compact title={activityT(lang, 'kit.activity.empty.title')} hint={activityT(lang, 'kit.activity.empty.hint')} />
        </div>
      ) : rows.length > 0 && (
        <Feed rows={rows} hrefFor={hrefFor} lang={lang} tz={tzName} />
      )}
    </section>
  );
}

/** Строки по местному дню сервера (day_local) — порядок сервера сохраняется. */
function byDay(rows: readonly NewsV2Row[]): [string, NewsV2Row[]][] {
  const out: [string, NewsV2Row[]][] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last[0] === r.day_local) last[1].push(r);
    else out.push([r.day_local, [r]]);
  }
  return out;
}

function Feed({ rows, hrefFor, lang, tz }: { rows: readonly NewsV2Row[]; hrefFor?: ActivityTabProps['hrefFor']; lang: KitLang; tz?: string }) {
  return (
    <ol className="sk-act__days">
      {byDay(rows).map(([day, list]) => (
        <li key={day} className="sk-act__dayblock" data-testid="kit-activity-day" data-day={day}>
          <time className="sk-act__day" dateTime={day}>{day}</time>
          <ol className="sk-act__rows">
            {list.map(r => <Row key={r.key} row={r} href={hrefFor?.(r) ?? null} lang={lang} tz={tz} />)}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function Row({ row, href, lang, tz }: { row: NewsV2Row; href: string | null; lang: KitLang; tz?: string }) {
  const title = row.title?.trim() || row.el;
  const utc = machineTime(row.at_utc);
  return (
    <li
      className="sk-act__row"
      data-testid="kit-activity-row"
      data-type={row.type}
      data-agent={row.author === 'agent' ? 'true' : undefined}
      data-unread={row.unread ? 'true' : undefined}
      data-future={row.future ? 'true' : undefined}
    >
      {row.time_known && row.time_local ? (
        <span className="sk-act__time">
          <time dateTime={row.at_utc ?? undefined} title={tz ? activityT(lang, 'kit.activity.localTimeHint', { tz }) : undefined}>
            {row.time_local}
          </time>
          {utc && <span className="sk-act__utc">{activityT(lang, 'kit.activity.machineTime', { t: utc })}</span>}
        </span>
      ) : (
        <span className="sk-act__time sk-act__time--unknown" title={activityT(lang, 'kit.activity.timeUnknownHint')}>
          {activityT(lang, 'kit.activity.timeUnknown')}
        </span>
      )}
      <Pill tone="t2" className="sk-act__type">{activityLabel(lang, 'type', row.type)}</Pill>
      <span className="sk-act__main">
        {href ? <a className="sk-act__title" href={href}>{title}</a> : <span className="sk-act__title">{title}</span>}
        {row.el !== title && <code className="sk-act__el">{row.el}</code>}
      </span>
      <span className="sk-act__kind">{activityLabel(lang, 'kind', row.kind)}</span>
      {(row.from || row.to) && (
        <span className="sk-act__change" title={activityT(lang, 'kit.activity.change', { from: row.from ?? '—', to: row.to ?? '—' })}>
          {row.from && <span className="sk-act__from">{row.from}</span>}
          {row.from && row.to && <span aria-hidden="true">→</span>}
          {row.to && <span className="sk-act__to">{row.to}</span>}
        </span>
      )}
      {row.mult > 1 && (
        <span className="sk-act__mult" title={activityT(lang, 'kit.activity.multHint', { n: row.mult })}>
          {activityT(lang, 'kit.activity.mult', { n: row.mult })}
        </span>
      )}
      {row.author === 'agent' && <Pill tone="inf" className="sk-act__agent" title={row.who ?? undefined}>{activityT(lang, 'kit.activity.agent')}</Pill>}
      {row.unread && <Pill tone="acc" className="sk-act__unread">{activityT(lang, 'kit.activity.unread')}</Pill>}
      {row.future && <Pill tone="t3" className="sk-act__future">{activityT(lang, 'kit.activity.future')}</Pill>}
    </li>
  );
}

function Metric({ id, label, tone, children }: { id: string; label: string; tone?: 'wrn' | 'dng' | 'suc'; children: ReactNode }) {
  return (
    <div className="sk-act__m" data-testid={`kit-activity-m-${id}`} data-tone={tone}>
      <dt className="sk-act__m-label">{label}</dt>
      <dd className="sk-act__m-val">{children}</dd>
    </div>
  );
}

const num = (v: number | undefined | null) => (typeof v === 'number' ? String(v) : '—');

function Summary({ data, target, lang }: { data: NewsV2Response; target: ActivityTarget; lang: KitLang }) {
  const total = data.metrics?.counts?.total ?? data.meta?.total;
  const burn = activityBurn(data, target);
  const t = (k: Parameters<typeof activityT>[1]) => activityT(lang, k);
  const part: NewsV2TaskPart | undefined = burn.kind === 'group' || burn.kind === 'all' ? burn.total : undefined;
  return (
    <dl className="sk-act__summary" data-testid="kit-activity-summary" aria-label={t('kit.activity.summary')}>
      {total && <Metric id="total" label={t('kit.activity.m.total')}>{`${total.events} · ${total.elements}`}</Metric>}
      {burn.kind === 'group' && burn.own && burn.shared ? (
        <>
          <Metric id="burn-own" label={t('kit.activity.m.burnOwn')}>{num(burn.own.burn)}</Metric>
          <Metric id="burn-shared" label={t('kit.activity.m.burnShared')}>{num(burn.shared.burn)}</Metric>
        </>
      ) : part && <Metric id="burn" label={t('kit.activity.m.burn')}>{num(part.burn)}</Metric>}
      {part && (
        <>
          <Metric id="waiting" label={t('kit.activity.m.waiting')} tone="wrn">{num(part.waiting_t1)}</Metric>
          {typeof part.uat_t1 === 'number' && (
            <Metric id="uat" label={t('kit.activity.m.uat')}>{num(part.uat_t1)}</Metric>
          )}
          <Metric id="ship" label={t('kit.activity.m.ship')}>{num(part.ship_correction)}</Metric>
          <Metric id="react" label={t('kit.activity.m.react')}>
            {part.react ? `${part.react.events} · ${part.react.elements}` : '—'}
          </Metric>
        </>
      )}
      {burn.kind === 'unavailable' && (
        <Metric id="unavailable" label={t('kit.activity.m.unavailable')} tone="dng">{burn.reason ?? '—'}</Metric>
      )}
      {burn.kind === 'missing' && <Metric id="missing" label={t('kit.activity.m.missing')}>—</Metric>}
    </dl>
  );
}

export interface ActivityKindTabOptions extends ActivityOptions {
  kind: ActivityTarget['kind'];
  lang?: KitLang;
  source?: ActivitySource;
  /** Спринты релиза из его записи (ребро IMPLEMENTED_IN_RELEASE). */
  sprintsOf?: (r: KitRecord) => readonly string[] | undefined;
}

/**
 * Вкладка для KindConfig.tabs паспорта (S5 вставляет её одной строкой).
 * Ссылки строк — через ctx.href(id) приложения.
 */
export function activityKindTab(o: ActivityKindTabOptions): NonNullable<KindConfig['tabs']>[number] {
  return {
    key: 'activity',
    title: activityT(o.lang ?? 'ru', 'kit.activity.tab'),
    render: (r, ctx) => (
      <ActivityTab
        target={{ kind: o.kind, id: r.id, sprints: o.sprintsOf?.(r) }}
        source={o.source}
        hrefFor={row => ctx.href(row.el)}
        days={o.days}
        tz={o.tz}
        limit={o.limit}
      />
    ),
  };
}
