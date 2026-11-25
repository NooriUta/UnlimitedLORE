// Цифры в шапке личной страницы человека и карточки агента (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE; прототип
// docs/prototypes/ap-people-page.html; решение владельца 25.11.2026, 3а): в работе, на приёмке, закрыто за 30 дней,
// медиана цикла. Считаются по его задачам (user_tasks / agent_tasks), истории их статусов
// (user_task_status_versions / agent_task_status_versions) и датам закрытия (task_done_dates).
// Честно: не прочитали — причина словами, а не нули; медианы нет (закрытых с циклом не было) — «—», не 0.
import { useMemo } from 'react';
import { useKitLang, useLoadState, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { chartLoader, rowsOfBody, type ChartLoader } from '../charts/chartCommon';
import { personSources, personStats, type PersonSubject, type UserTaskRow } from '../charts/userModel';
import type { StatusVersionRow } from '../charts/flowModel';
import type { TaskRow } from '../analytics/analyticsModel';

export interface PersonStatsProps { subject: PersonSubject; load?: ChartLoader; fetchImpl?: typeof fetch; now?: number; lang?: KitLang }

export function PersonStats({ subject, load, fetchImpl, now, lang }: PersonStatsProps) {
  const appLang = useKitLang();
  const t = (k: AppKey) => appT(lang ?? appLang, k);
  const get = useMemo(() => chartLoader(load, fetchImpl), [load, fetchImpl]);
  const src = personSources(subject);
  const res = useLoadState(async signal => {
    const [tasks, history, done] = await Promise.all([
      get(src.tasks.slice, src.tasks.params, signal),
      get(src.history.slice, src.history.params, signal),
      get('task_done_dates', {}, signal),
    ]);
    return { tasks, history, done };
  }, [subject.kind, subject.id, get]);
  const today = now ?? Date.now();
  const s = useMemo(() => (res.data ? personStats({
    tasks: rowsOfBody<UserTaskRow>(res.data.tasks), history: rowsOfBody<StatusVersionRow>(res.data.history),
    done: rowsOfBody<TaskRow>(res.data.done), today,
  }) : null), [res.data, today]);

  if (res.state === 'error' || res.state === 'forbidden') {
    return (
      <p className="person-stats person-stats--err" role="status" data-testid="person-stats-error">
        {t('personStats.error')}: {res.error instanceof Error ? res.error.message : String(res.error ?? '')}
      </p>
    );
  }
  if (!s) return <p className="person-stats person-stats--loading" aria-busy="true">…</p>;
  const cycle = s.medianCycleDays === null ? '—' : `${String(s.medianCycleDays).replace('.', ',')} ${t('personStats.daysShort')}`;
  const cells: [string, string, AppKey][] = [
    ['work', String(s.work), 'personStats.work'],
    ['review', String(s.review), 'personStats.review'],
    ['closed30', String(s.closed30), 'personStats.closed30'],
    ['cycle', cycle, 'personStats.cycle'],
  ];
  return (
    <dl className="person-stats" aria-label={t('personStats.label')}>
      {cells.map(([k, v, label]) => (
        <div key={k} className="person-stats__cell" data-testid={`person-stat-${k}`}>
          <dt className="person-stats__k">{t(label)}</dt>
          <dd className="person-stats__v">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
