// Паспорт спринта в v2 — минимальная обвязка вкладок (S5-02). Шапка, строка-
// вердикт, связи, граф и журнал (K-04) приходят своими задачами S5; здесь —
// только вкладка «Задачи», первой и по умолчанию: задачи и их статусы видны
// за 2 клика. Вкладка — в URL (?tab=…), как требует D-2026-UXR (состояние в URL).
import { Pill, pushUrlState, Tabs } from '@seidr/kit';
import { useAppT } from '../i18n';
import { SprintBurnLine } from './SprintBurnLine';
import { SprintTasksTab } from './SprintTasksTab';

export const SPRINT_TABS = ['tasks'] as const;
export type SprintTab = (typeof SPRINT_TABS)[number];

export function SprintPassport({ sprintId, tab }: { sprintId: string; tab: SprintTab }) {
  const t = useAppT();
  return (
    <article className="sprint-passport" data-passport="sprint">
      <header className="sprint-passport__head">
        <a className="shell-link" href="/">{t('sprintTasks.back')}</a>
        <Pill variant="id">{sprintId}</Pill>
      </header>
      {/* S4-36: burn-down строкой под шапкой — место как в v1. */}
      <SprintBurnLine sprintId={sprintId} />
      <Tabs
        items={[{ id: 'tasks', label: t('sprintTasks.title'), icon: 'checkbox-tree' }]}
        value={tab}
        onChange={id => pushUrlState({ tab: id })}
        label={sprintId}
      >
        <SprintTasksTab sprintId={sprintId} />
      </Tabs>
    </article>
  );
}
