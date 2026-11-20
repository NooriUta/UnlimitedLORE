// Вкладка «Динамика» раздела «Аналитика» (SPRINT_UXR_S13_KIT4/K4-CHARTS). Решение владелицы 19.11.2026 «10 → а3»:
// мини-ряды ленты «Новостей» не трогаем, а полные графики тех же рядов — здесь, на графиках kit.
// Источник — тот же, что у мини-рядов (NewsSource: /lore/news/v2/dynamics и /lore/news/v2), расчёт — dynamicsModel.
// Период «Неделя / Месяц» — как у блока «Динамика» ленты, в адресе (?aper=month).
import { useMemo } from 'react';
import { BarChart, LineChart, useKitLang, useLoadState, useUrlParam } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { DEFAULT_NEWS_QUERY, buildNewsParams } from '../news/feed/model';
import { dynamicsParams, type NewsDynamicsPeriod } from '../news/feed/dynamics';
import { newsT, type NewsKey } from '../news/feed/i18n';
import type { NewsSource } from '../news/feed/source';
import { burnByDay, dynamicsBlocks, DYNAMICS_BLOCKS } from './dynamicsModel';

/** Окно сгорания по дням — как у ленты за месяц. */
const BURN_QUERY = { ...DEFAULT_NEWS_QUERY, period: 'month' as const, matrix: 0 };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''));

export function AnalyticsDynamics({ source }: { source: NewsSource }) {
  const lang = useKitLang();
  const t = (k: AppKey, p?: Record<string, string | number>) => appT(lang, k, p);
  const nt = (k: NewsKey, p?: Record<string, string | number>) => newsT(lang, k, p);
  const [rawPeriod, setPeriod] = useUrlParam('aper');
  const period: NewsDynamicsPeriod = rawPeriod === 'month' ? 'month' : 'week';
  const key = dynamicsParams(DEFAULT_NEWS_QUERY, period).toString();
  const dyn = useLoadState(
    async signal => (source.loadDynamics ? source.loadDynamics(new URLSearchParams(key), signal) : null),
    [key, source],
  );
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const burnKey = buildNewsParams(BURN_QUERY, { timeZone: tz }).toString();
  const burn = useLoadState(signal => source.load(new URLSearchParams(burnKey), signal), [burnKey, source]);

  const blocks = useMemo(() => (dyn.data ? dynamicsBlocks(dyn.data) : null), [dyn.data]);
  const days = useMemo(() => (burn.data ? burnByDay(burn.data) : null), [burn.data]);

  const failed = (state: string, error: unknown) => (state === 'error' || state === 'forbidden'
    ? t(state === 'forbidden' ? 'analytics.forbidden' : 'analytics.error', { reason: errText(error) })
    : undefined);
  const dynError = failed(dyn.state, dyn.error) ?? (dyn.data === null ? `${nt('dyn.unavailable')}: ${nt('dyn.unavailable.noSource')}` : undefined);
  const burnError = failed(burn.state, burn.error) ?? (days?.state === 'unavailable' ? `${nt('dyn.unavailable')}: ${days.reason}` : undefined);
  const per = (m: string) => t(period === 'month' ? 'analytics.dyn.perMonth' : 'analytics.dyn.perWeek', { m });

  return (
    <>
      <div className="an-dynbar">
        <p className="an-lead">{t('analytics.dynLead')}</p>
        <div role="radiogroup" aria-label={t('analytics.dyn.period')} className="sk-list__views" data-testid="an-dyn-period">
          {(['week', 'month'] as const).map(p => (
            <button key={p} type="button" role="radio" aria-checked={period === p}
              className={`sk-list__view${period === p ? ' is-on' : ''}`} onClick={() => setPeriod(p === 'week' ? null : p, { replace: true })}>
              {nt(p === 'week' ? 'dyn.week' : 'dyn.month')}
            </button>
          ))}
        </div>
      </div>
      <div className="an-grid">
        <div className="an-block" data-block="burnDays">
          <LineChart title={t('analytics.dyn.burn')} source="/lore/news/v2 · tasks.days" unit={t('analytics.tasksUnit')}
            loading={burn.state === 'loading'} {...(burnError ? { error: burnError, onRetry: burn.reload } : {})}
            series={days?.state === 'ok' ? [{ key: 'burn', label: t('analytics.dyn.burnSeries'), points: days.points }] : []} />
        </div>
        {DYNAMICS_BLOCKS.map(id => {
          const b = blocks?.find(x => x.id === id);
          const name = nt(`dyn.m.${id}` as NewsKey);
          const why = b?.state === 'unavailable'
            ? `${nt('dyn.unavailable')}${b.forbidden ? ` · ${nt('dyn.forbidden')}` : ''}${b.reason ? `: ${b.reason}` : ''}`
            : undefined;
          const error = dynError ?? why;
          const groups = id === 'accepted'
            ? [{ key: 'adr', label: 'ADR' }, { key: 'decision', label: t('analytics.dyn.decisions') }]
            : [{ key: 'v', label: name }];
          return (
            <div key={id} className="an-block" data-block={id}>
              <BarChart title={per(name)} source="/lore/news/v2/dynamics" loading={dyn.state === 'loading'}
                {...(error ? { error, onRetry: dyn.reload } : {})} groups={groups} data={b?.data ?? []} />
              {b?.current && !error && <p className="an-note">{t('analytics.dyn.current', { period: b.current })}</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}
