// Вкладка «Аналитика» личной страницы человека (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE; прототип
// docs/prototypes/ap-people-page.html, владелица 21.11.2026: «аналитика и лента активностей должна быть»).
// Те же графики и правила, что у паспортов спринта, вехи и проекта (пачки 19.11): слот kit `charts`, свёртка
// на телефоне (Fold), честные состояния — сбой словами с причиной и «Повторить», а не пустые оси.
//   №6  закрыто по неделям — task_done_dates ∩ его задачи (user_tasks), то же правило, что у вехи;
//   ·   задачи сейчас по статусам — user_tasks, корзины жизненного цикла;
//   ·   где работает — user_tasks по проекту спринта, пять крупных и «прочие».
// Время цикла по неделям из прототипа не рисуем: история статусов читается срезом task_status_versions только по
// спринту или проекту, по человеку её пришлось бы тянуть целиком.
import { useMemo } from 'react';
import { BarChart, useLoadState } from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { chartLoader, chartState, isPartial, rowsOfBody, type ChartLoader } from './chartCommon';
import { tasksClosedWeekly } from './batch2Model';
import { Fold } from './TaskFlowCharts';
import { userProjectBars, userStatusBars, type UserTaskRow } from './userModel';
import type { TaskRow } from '../analytics/analyticsModel';

export interface UserChartsProps { kcSub: string; load?: ChartLoader; fetchImpl?: typeof fetch; now?: number; narrow?: boolean }

export function UserCharts(p: UserChartsProps) {
  const t = useAppT();
  return <Fold hint={t('charts.hint.user')} {...(p.narrow !== undefined ? { narrow: p.narrow } : {})}>{() => <UserChartsBody {...p} />}</Fold>;
}

function UserChartsBody({ kcSub, load, fetchImpl, now }: UserChartsProps) {
  const t = useAppT();
  const get = useMemo(() => chartLoader(load, fetchImpl), [load, fetchImpl]);
  const today = now ?? Date.now();
  const res = useLoadState(async signal => {
    const [tasks, done] = await Promise.all([get('user_tasks', { kc_sub: kcSub }, signal), get('task_done_dates', {}, signal)]);
    return { tasks, done };
  }, [kcSub, get]);
  const calc = useMemo(() => {
    const d = res.data;
    if (!d) return null;
    const tasks = rowsOfBody<UserTaskRow>(d.tasks);
    const mine = new Set(tasks.map(r => (typeof r.task_uid === 'string' ? r.task_uid : '')).filter(Boolean));
    const closed = tasksClosedWeekly(rowsOfBody<TaskRow>(d.done), uid => mine.has(uid), today, 12);
    return {
      closed,
      closedTotal: closed.reduce((s, w) => s + (w.values.t ?? 0), 0),
      status: userStatusBars(tasks).map(b => ({ ...b, category: t(`userCharts.bucket.${b.category}` as AppKey) })),
      projects: userProjectBars(tasks).map(b => (b.category === 'other' ? { ...b, category: t('userCharts.other') } : b)),
      partial: isPartial(d.tasks) || isPartial(d.done),
    };
  }, [res.data, today, t]);
  const common = chartState(t, res);
  const groups = [{ key: 't', label: t('analytics.tasks') }];
  return (
    <section className="an-grid pch__grid" data-testid="user-charts" aria-label={t('charts.toggle')}
      {...(calc ? { 'data-closed': String(calc.closedTotal) } : {})}>
      <div className="an-block" data-block="user-closed">
        <BarChart {...common} title={t('userCharts.closed')} source="task_done_dates · user_tasks" groups={groups} data={calc?.closed ?? []} />
      </div>
      <div className="an-block" data-block="user-status">
        <BarChart {...common} title={t('userCharts.status')} source="user_tasks" groups={groups} data={calc?.status ?? []} />
      </div>
      <div className="an-block" data-block="user-projects">
        <BarChart {...common} title={t('userCharts.projects')} source="user_tasks" groups={groups} data={calc?.projects ?? []} />
      </div>
      {calc?.partial && <p className="an-partial" role="status">{t('analytics.partial', { slices: 'user_tasks · task_done_dates' })}</p>}
    </section>
  );
}
