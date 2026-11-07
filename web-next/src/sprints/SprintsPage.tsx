// Экран «Спринты» v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09): список из listView
// kit на реальном слайсе `sprints`, колонка «задачи x/y» (progress:tasks) и
// раскрытие строки с задачами спринта (SprintTasks) — статус задачи виден и
// меняется за ≤2 касания прямо из списка.
//
// Прогресс догружается после списка пачками tasks_of_sprints_batch: пока
// считается — «…», упавшая пачка — «?» с причиной, а не 0/0.
import { useEffect, useMemo, useState } from 'react';
import { ListView, LoadStateView, useKitLang, useLoadState } from '@seidr/kit';
import type { KitConfig, KitData, KitProgressInput, UrlWindow } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { defaultLoreClient, type LoreClient, type SliceBody } from './loreClient';
import { loadSprintProgress } from './sprintProgress';
import { SprintTasks } from './SprintTasks';
import { planStatusOf, planStatuses } from './taskStatus';
import './sprints.css';

export interface SprintRow {
  sprint_id: string;
  name?: string | null;
  status_raw?: string | null;
  valid_from?: string | null;
}

export function useSprintsConfig(): KitConfig {
  const lang = useKitLang();
  return useMemo(() => ({
    modules: [],
    menu: { groups: [] },
    kinds: {
      sprint: {
        title: appT(lang, 'sprints.title'), icon: 'sprint',
        fields: [{ key: 'tasks', title: appT(lang, 'sprints.col.tasks'), type: 'number' }],
      },
    },
    statuses: planStatuses(code => appT(lang, `status.${code}` as AppKey)),
    list: {
      views: ['list'],
      filters: ['status'],
      groupings: ['status'],
      columns: ['title+id', 'progress:tasks', 'status'],
    },
  }), [lang]);
}

export function toKitData(body: SliceBody<SprintRow>, progress: Map<string, KitProgressInput> | null): KitData {
  const rows = body.rows;
  return {
    records: rows.map(r => ({
      id: r.sprint_id,
      kind: 'sprint',
      title: r.name || r.sprint_id,
      status: planStatusOf(r.status_raw),
      fields: { tasks: progress ? progress.get(r.sprint_id) ?? { loading: true } : { loading: true } },
      updated_at: r.valid_from ?? undefined,
    })),
    edges: [],
    journal: [],
    meta: {
      generated_at: new Date().toISOString(),
      total: body.page?.has_more ? body.page.total : rows.length,
      returned: rows.length,
      truncated: body.truncated === true || body.truncated === 'unknown' || body.page?.has_more === true,
    },
  };
}

export interface SprintsPageProps {
  client?: LoreClient;
  /** Состояние списка в URL (по умолчанию window; false — только в памяти). */
  urlState?: boolean | UrlWindow;
  /** Свой заголовок экрана; false — внутри раздела оболочки, где заголовок уже есть. */
  heading?: boolean;
}

export function SprintsPage({ client = defaultLoreClient, urlState, heading = true }: SprintsPageProps) {
  const lang = useKitLang();
  const config = useSprintsConfig();
  const result = useLoadState<SliceBody<SprintRow>>(
    signal => client.slice<SprintRow>('sprints', {}, signal),
    [client],
  );
  const [progress, setProgress] = useState<Map<string, KitProgressInput> | null>(null);
  const ids = useMemo(() => result.data?.rows.map(r => r.sprint_id) ?? [], [result.data]);

  useEffect(() => {
    if (!ids.length) return;
    const ctl = new AbortController();
    setProgress(null);
    loadSprintProgress(client, ids, ctl.signal).then(
      m => { if (!ctl.signal.aborted) setProgress(m); },
      () => { /* отмена: экран ушёл или список перезагрузился */ },
    );
    return () => ctl.abort();
  }, [client, ids]);

  return (
    <section className="sprints-page" aria-labelledby={heading ? 'sprints-title' : undefined}>
      {heading && <h1 id="sprints-title" className="sprints-page__title">{appT(lang, 'sprints.title')}</h1>}
      <LoadStateView result={result}>
        {body => (
          <ListView
            config={config}
            data={toKitData(body, progress)}
            urlState={urlState}
            expand={{ render: r => <SprintTasks sprintId={r.id} client={client} /> }}
          />
        )}
      </LoadStateView>
    </section>
  );
}

export default SprintsPage;
