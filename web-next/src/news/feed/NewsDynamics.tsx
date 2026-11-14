// Блок «Динамика» экрана новостей v2 (SPRINT_UXR_S7A_NEWS/S7A-11). Слово владелицы
// 14.11.2026: «чего не хватает на странице „Новости“, что было раньше в аналитике —
// кроме сгорания, объёмных метрик по динамике… показатель неделя к неделе, месяц к месяцу».
//
// Рисует ответ GET /lore/news/v2/dynamics: у каждого показателя — число текущего периода,
// Δ и % к прошлому (процент — только если сервер его прислал: при прошлом 0 его нет),
// мини-ряд по периодам со значениями в подсказке. Ни одного числа клиент не считает сам.
// Честные состояния: загрузка; «не смогли посчитать» с причиной (≠ 0); честный ноль.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Forbidden, LoadError, Skeleton, classifyError, errorDetail, pushUrlState, readUrlState, useKitLang, useLoadState } from '@seidr/kit';
import type { KitLang } from '@seidr/kit';
import { newsT, type NewsKey } from './i18n';
import { axisLabel, pctText, signTone, signed, type NewsQuery, type NewsScope } from './model';
import type { NewsSource } from './source';
import {
  dynamicsParams, type NewsDynamicsBucket, type NewsDynamicsMetric, type NewsDynamicsPeriod, type NewsDynamicsResponse,
} from './dynamics';

export interface NewsDynamicsPanelProps {
  source: NewsSource;
  /** Разрез ленты: его фильтры применяются и к динамике. */
  query: NewsQuery;
  scope?: NewsScope;
  /** Префикс параметров в URL (период динамики — `${prefix}y`); null — только в памяти. */
  urlPrefix?: string | null;
}

type T = (k: NewsKey, vars?: Record<string, string | number>) => string;

/** Показатели, у которых рост — не «хорошо» и не «плохо»: тон дельты нейтральный. */
const NEUTRAL = new Set(['tasks_created']);

function readPeriod(prefix: string | null): NewsDynamicsPeriod {
  if (prefix === null || typeof window === 'undefined') return 'week';
  return readUrlState().get(`${prefix}y`) === 'month' ? 'month' : 'week';
}

/** ISO-момент → «дд.мм» (UTC: границы периодов динамики — UTC). */
function ddmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Последний день периода [from, to): to − 1 мс. */
function lastDay(b: NewsDynamicsBucket): string {
  return ddmm(new Date(new Date(b.to).getTime() - 1).toISOString());
}

export function NewsDynamicsPanel({ source, query, scope, urlPrefix = null }: NewsDynamicsPanelProps) {
  const lang = useKitLang();
  const t: T = (k, vars) => newsT(lang, k, vars);
  const [period, setPeriodState] = useState<NewsDynamicsPeriod>(() => readPeriod(urlPrefix));
  const setPeriod = (p: NewsDynamicsPeriod) => {
    setPeriodState(p);
    if (urlPrefix !== null && typeof window !== 'undefined') pushUrlState({ [`${urlPrefix}y`]: p === 'week' ? null : p }, { replace: true });
  };
  const key = dynamicsParams(query, period, scope).toString();
  const res = useLoadState<NewsDynamicsResponse | null>(
    async signal => (source.loadDynamics ? source.loadDynamics(new URLSearchParams(key), signal) : null),
    [key, source],
  );

  let body;
  if (res.error !== undefined && res.error !== null) {
    body = classifyError(res.error) === 'forbidden'
      ? <Forbidden reason={errorDetail(res.error)} />
      : <LoadError error={res.error} onRetry={res.reload} />;
  } else if (res.data === undefined) {
    body = <Skeleton lines={3} />;
  } else if (res.data === null) {
    body = (
      <p className="sk-news__why" data-state="unavailable" data-testid="news-dyn-nosource">
        {`${t('dyn.unavailable')}: ${t('dyn.unavailable.noSource')}`}
      </p>
    );
  } else {
    const d = res.data;
    const ignored = d.meta.ignored_filters ?? [];
    body = (
      <>
        <div className="sk-news__dyncards">
          {d.metrics.map(m => <Card key={m.id} m={m} buckets={d.buckets} period={period} t={t} lang={lang} />)}
        </div>
        <p className="sk-news__note">{t('dyn.rule')}</p>
        {ignored.length > 0 && (
          <p className="sk-news__note" data-testid="news-dyn-ignored">
            {t('dyn.ignored', { list: ignored.map(a => (a === 'els' ? t('dyn.ignored.els') : axisLabel(a, lang))).join(', ') })}
          </p>
        )}
      </>
    );
  }

  return (
    <section className="sk-news__panel sk-news__dyn" data-testid="news-dynamics" aria-label={t('dyn')}>
      <div className="sk-news__ph">
        <h3 className="sk-news__pt">{t('dyn')}</h3>
        <span className="sk-news__dynsub">{t(period === 'month' ? 'dyn.compare.month' : 'dyn.compare.week')}</span>
        <div role="radiogroup" aria-label={t('dyn.period')} className="sk-list__views" data-testid="news-dyn-period">
          {(['week', 'month'] as const).map(p => (
            <button key={p} type="button" role="radio" aria-checked={period === p}
              className={`sk-list__view${period === p ? ' is-on' : ''}`} onClick={() => setPeriod(p)}>
              {t(p === 'week' ? 'dyn.week' : 'dyn.month')}
            </button>
          ))}
        </div>
      </div>
      {body}
    </section>
  );
}

function Card({ m, buckets, period, t, lang }: {
  m: NewsDynamicsMetric; buckets: NewsDynamicsBucket[]; period: NewsDynamicsPeriod; t: T; lang: KitLang;
}) {
  const label = t(`dyn.m.${m.id}` as NewsKey);
  if (m.state !== 'ok' || m.value === null || !m.series) {
    const why = m.state === 'filtered_out' ? t('dyn.filteredOut')
      : `${t('dyn.unavailable')}${m.forbidden ? ` · ${t('dyn.forbidden')}` : ''}`;
    return (
      <div className="sk-news__kpi sk-news__dyncard" data-testid={`news-dyn-card-${m.id}`} data-state={m.state}
        data-tone={m.state === 'filtered_out' ? undefined : 'wrn'}>
        <span className="sk-news__kl">{label}</span>
        <span className="sk-news__dynna">{why}</span>
        {m.reason && <span className="sk-news__why">{m.reason}</span>}
      </div>
    );
  }
  const prevBucket = buckets[buckets.length - 2];
  const delta = m.delta ?? 0;
  const max = Math.max(1, ...m.series);
  const excluded = Object.entries(m.excluded ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="sk-news__kpi sk-news__dyncard" data-testid={`news-dyn-card-${m.id}`} data-state="ok">
      <span className="sk-news__kl">{label}</span>
      <span className="sk-news__dynrow">
        <span className="sk-news__kv" data-testid="news-dyn-value">{m.value}</span>
        <span className="sk-news__delta" data-testid="news-dyn-delta" data-tone={NEUTRAL.has(m.id) ? undefined : signTone(delta)}
          title={t(period === 'month' ? 'dyn.prev.month' : 'dyn.prev.week', { period: prevBucket?.label ?? '', prev: m.previous ?? 0 })}>
          {signed(delta)}{typeof m.pct === 'number' ? ` · ${m.pct > 0 ? '+' : m.pct < 0 ? '−' : ''}${pctText(Math.abs(m.pct), lang)}` : ''}
        </span>
      </span>
      <span className="sk-news__dynbars" role="group" aria-label={label}>
        {m.series.map((v, i) => {
          const b = buckets[i];
          const tip = `${t('dyn.bar', { period: b?.label ?? '', from: b ? ddmm(b.from) : '', to: b ? lastDay(b) : '', v })}`
            + (m.by_type ? ` (${t('dyn.byType', { adr: m.by_type.adr?.[i] ?? 0, decision: m.by_type.decision?.[i] ?? 0 })})` : '')
            + (b?.partial ? ` · ${t('dyn.bar.partial')}` : '');
          return (
            <span key={b?.key ?? i} className="sk-news__dynbar" role="img" data-testid={`news-dyn-bar-${b?.key ?? i}`}
              data-current={b?.current ? 'true' : undefined} data-state={v === 0 ? 'zero' : undefined}
              style={v ? { '--h': `${Math.max(8, Math.round((v / max) * 100))}%` } as CSSProperties : undefined}
              title={tip} aria-label={tip} />
          );
        })}
      </span>
      {excluded.length > 0 && (
        <span className="sk-news__why" data-testid="news-dyn-excluded">
          {`${t('dyn.ex')}: ${excluded.map(([k, n]) => t(`dyn.ex.${k}` as NewsKey, { n })).join(' · ')}`}
        </span>
      )}
    </div>
  );
}
