// Вкладка «Аналитика» личной страницы человека и карточки агента (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE; прототип
// docs/prototypes/ap-people-page.html, владелица 21.11.2026: «аналитика и лента активностей должна быть»; решения
// владельца 25.11.2026: 2а — у агента те же вкладки, 3а — серверная история статусов по человеку).
// Те же графики и правила, что у паспортов спринта, вехи и проекта (пачки 19.11): слот kit `charts`, свёртка
// на телефоне (Fold), честные состояния — сбой словами с причиной и «Повторить», а не пустые оси.
//   №6  закрыто по неделям — task_done_dates ∩ его задачи (user_tasks / agent_tasks), то же правило, что у вехи;
//   ·   задачи сейчас по статусам — корзины жизненного цикла;
//   №1  время цикла — медиана по неделям из истории его задач (user_task_status_versions / agent_task_status_versions);
//   ·   где работает — по проекту спринта задачи, пять крупных и «прочие».
import { useMemo } from 'react';
import { BarChart, LineChart, useLoadState } from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { chartLoader, chartState, ddmm, isPartial, rowsOfBody, type ChartLoader } from './chartCommon';
import { tasksClosedWeekly } from './batch2Model';
import { Fold } from './TaskFlowCharts';
import {
  personCycle, personSources, userProjectBars, userStatusBars, weeklyMedianCycle,
  type PersonSubject, type UserTaskRow,
} from './userModel';
import type { StatusVersionRow } from './flowModel';
import type { TaskRow } from '../analytics/analyticsModel';

export interface PersonChartsProps { subject: PersonSubject; load?: ChartLoader; fetchImpl?: typeof fetch; now?: number; narrow?: boolean }

export function PersonCharts(p: PersonChartsProps) {
  const t = useAppT();
  return <Fold hint={t('charts.hint.user')} {...(p.narrow !== undefined ? { narrow: p.narrow } : {})}>{() => <PersonChartsBody {...p} />}</Fold>;
}

/** Человек по kc_sub — прежний вход. */
export function UserCharts({ kcSub, ...rest }: Omit<PersonChartsProps, 'subject'> & { kcSub: string }) {
  return <PersonCharts subject={{ kind: 'user', id: kcSub }} {...rest} />;
}

function PersonChartsBody({ subject, load, fetchImpl, now }: PersonChartsProps) {
  const t = useAppT();
  const get = useMemo(() => chartLoader(load, fetchImpl), [load, fetchImpl]);
  const today = now ?? Date.now();
  const src = personSources(subject);
  const res = useLoadState(async signal => {
    const [tasks, history, done] = await Promise.all([
      get(src.tasks.slice, src.tasks.params, signal),
      get(src.history.slice, src.history.params, signal),
      get('task_done_dates', {}, signal),
    ]);
    return { tasks, history, done };
  }, [subject.kind, subject.id, get]);
  const calc = useMemo(() => {
    const d = res.data;
    if (!d) return null;
    const tasks = rowsOfBody<UserTaskRow>(d.tasks);
    const mine = new Set(tasks.map(r => (typeof r.task_uid === 'string' ? r.task_uid : '')).filter(Boolean));
    const closed = tasksClosedWeekly(rowsOfBody<TaskRow>(d.done), uid => mine.has(uid), today, 12);
    const cycle = weeklyMedianCycle(personCycle(tasks, rowsOfBody<StatusVersionRow>(d.history)), today, 12);
    return {
      closed,
      closedTotal: closed.reduce((s, w) => s + (w.values.t ?? 0), 0),
      cycle,
      status: userStatusBars(tasks).map(b => ({ ...b, category: t(`userCharts.bucket.${b.category}` as AppKey) })),
      projects: userProjectBars(tasks).map(b => (b.category === 'other' ? { ...b, category: t('userCharts.other') } : b)),
      partial: isPartial(d.tasks) || isPartial(d.history) || isPartial(d.done),
    };
  }, [res.data, today, t]);
  const common = chartState(t, res);
  const groups = [{ key: 't', label: t('analytics.tasks') }];
  const slices = `${src.tasks.slice} · ${src.history.slice} · task_done_dates`;
  return (
    <section className="an-grid pch__grid" data-testid="user-charts" data-subject={subject.kind} aria-label={t('charts.toggle')}
      {...(calc ? { 'data-closed': String(calc.closedTotal) } : {})}>
      <div className="an-block" data-block="user-closed">
        <BarChart {...common} title={t('userCharts.closed')} source={`task_done_dates · ${src.tasks.slice}`} groups={groups} data={calc?.closed ?? []} />
      </div>
      <div className="an-block" data-block="user-status">
        <BarChart {...common} title={t('userCharts.status')} source={src.tasks.slice} groups={groups} data={calc?.status ?? []} />
      </div>
      <div className="an-block" data-block="user-cycle">
        <LineChart {...common} title={t('userCharts.cycle')} source={src.history.slice} unit={t('analytics.days')} xLabel={ddmm}
          series={calc ? [{ key: 'median', label: t('userCharts.cycleMedian'), points: calc.cycle }] : []} />
      </div>
      <div className="an-block" data-block="user-projects">
        <BarChart {...common} title={t('userCharts.projects')} source={src.tasks.slice} groups={groups} data={calc?.projects ?? []} />
      </div>
      {calc?.partial && <p className="an-partial" role="status">{t('analytics.partial', { slices })}</p>}
    </section>
  );
}
