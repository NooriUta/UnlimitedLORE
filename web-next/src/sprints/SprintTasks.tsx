// Раскрытая строка спринта — его задачи со статусами (S4-09). Задачи первыми:
// это то, ради чего строку раскрывают («не вижу задачи и статусы в два клика»).
// Смена статуса — StatusChip kit (S4-07): касание чипа → касание статуса,
// сохранение POST /lore/status, отказ — откат и причина на экране.
// Грузится лениво — только когда строку раскрыли (ListView рисует содержимое
// лишь у раскрытой строки).
import { useMemo, type CSSProperties } from 'react';
import { EmptyState, LoadStateView, StatusChip, useKitLang, useLoadState } from '@seidr/kit';
import type { KitConfig, KitRecord } from '@seidr/kit';
import { appT, useAppT, type AppKey } from '../i18n';
import { defaultLoreClient, type LoreClient, type SliceBody } from './loreClient';
import { planStatusOf, planStatuses } from './taskStatus';
import './sprints.css';

export interface SprintTaskRow {
  task_uid: string;
  task_id: string;
  title: string | null;
  status_raw: string | null;
  order_index?: number | null;
}

/** Конфиг kit для задач: статусы плана LORE на языке приложения. */
export function useTaskConfig(): KitConfig {
  const lang = useKitLang();
  return useMemo(() => ({
    modules: [],
    menu: { groups: [] },
    kinds: { task: { title: appT(lang, 'sprints.kind.task'), icon: 'checkbox-tree' } },
    statuses: planStatuses(code => appT(lang, `status.${code}` as AppKey)),
  }), [lang]);
}

export function SprintTasks({ sprintId, client = defaultLoreClient }: { sprintId: string; client?: LoreClient }) {
  const t = useAppT();
  const config = useTaskConfig();
  const result = useLoadState<SliceBody<SprintTaskRow>>(
    signal => client.slice<SprintTaskRow>('tasks_of_sprint', { sprint_id: sprintId }, signal),
    [client, sprintId],
  );
  const save = useMemo(
    () => (c: { id: string; to: unknown }) => client.setStatus('task', c.id, String(c.to)),
    [client],
  );

  return (
    <div className="sprint-tasks" data-sprint-tasks={sprintId}>
      <LoadStateView
        result={result}
        empty={<EmptyState compact title={t('sprints.tasks.empty')} hint={t('sprints.tasks.emptyHint')} />}
      >
        {body => (
          // PU-23: колонка кода одной ширины на весь список — по самому длинному коду (код
          // моноширинный, ширина в ch точная); название начинается с одной вертикали.
          <ul className="sprint-tasks__list" aria-label={t('sprints.tasks.label', { id: sprintId })}
            style={{ '--sprint-code-w': `${Math.max(1, ...body.rows.map(r => r.task_id.length))}ch` } as CSSProperties}>
            {body.rows.map(r => {
              const rec: KitRecord = {
                id: r.task_uid, kind: 'task', title: r.title ?? r.task_id, status: planStatusOf(r.status_raw), fields: {},
              };
              return (
                <li key={r.task_uid} className="sprint-tasks__item">
                  {/* Вложенная строка под ▸ — статус только иконкой, имя в подсказке (владелица 08.11). */}
                  <StatusChip record={rec} config={config} save={save} compact />
                  <span className="sprint-tasks__code" title={r.task_id}>{r.task_id}</span>
                  <span className="sprint-tasks__title">{rec.title}</span>
                </li>
              );
            })}
          </ul>
        )}
      </LoadStateView>
    </div>
  );
}
