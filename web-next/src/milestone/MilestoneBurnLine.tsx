// Сгорание вехи строкой и «Цель к сроку» (SPRINT_UXR_POLISH_UAT_1113/PU-27).
//
// Слово владелицы 13.11: «у вех как у спринтов нет сгорания — добавить».
// Веха своих задач не имеет: её объём — задачи её спринтов (ребро
// TARGETS_MILESTONE). Поэтому здесь нет своего расчёта: тот же хук сгорания,
// что у спринта (`useBurnOf`, срезы task_created_dates/task_done_dates — SCD2
// задач), с охватом «спринты вехи», и та же строка (`BurnLineView`) с тем же
// графиком kit (K2-VIEW-TARGET). Числа вехи поэтому — ровно сумма по её
// спринтам (тест milestoneBurn.test.tsx сверяет со строками спринтов).
//
// Срок — из «Когда» вехи (milestoneDue); замороженная историческая веха —
// без прогноза. Короткая история — честное «мало точек» kit (BurnChart).
import { useCallback, useMemo } from 'react';
import { LoadError, rowsOf, useLoadState } from '@seidr/kit';
import { BurnLineView } from '../sprint/SprintBurnLine';
import { inSprints, useBurnOf, type BurnSliceLoader } from '../sprint/useSprintBurn';
import { milestoneDue } from './milestoneDue';
import { sliceFetcher } from '../api/loreSlice';
import { useAppT } from '../i18n';

/** Загрузчик среза с параметрами — тело /lore/slice/{slice}. Нужен тестам. */
export type MilestoneSliceLoader = (slice: string, params: Record<string, string>, signal: AbortSignal) => Promise<unknown>;

export interface MilestoneBurnLineProps {
  milestoneId: string;
  /** «Когда» вехи, если уже известно; нет — берётся из строки вехи. */
  when?: string | null;
  load?: MilestoneSliceLoader;
  /** Подмена fetch (паспорт в тестах) — тот же, что у паспорта. */
  fetchImpl?: typeof fetch;
  /** «Сегодня» для прогноза (ГГГГ-ММ-ДД). Нужен тестам. */
  today?: string;
}

interface MilestoneRow { direct_sprint_ids?: unknown; date_display?: unknown }

/** Спринты вехи из строки milestone_by_id: дыры (null) отбрасываются. */
function sprintsOf(row: MilestoneRow | undefined): string[] {
  const v = row?.direct_sprint_ids;
  const list = Array.isArray(v) ? v : [];
  return [...new Set(list.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()))].sort();
}

export function MilestoneBurnLine({ milestoneId, when, load, fetchImpl, today }: MilestoneBurnLineProps) {
  const t = useAppT();
  const fetcher = sliceFetcher(fetchImpl ? { fetchImpl } : {});
  const get = useCallback<MilestoneSliceLoader>(
    (slice, params, signal) => (load ? load(slice, params, signal) : fetcher(slice, params, signal)),
    [load, fetchImpl], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Строка вехи — за её спринтами (полный список ребра, без страницы) и «Когда».
  const ms = useLoadState(
    signal => get('milestone_by_id', { id: milestoneId, fields: 'milestone_id,date_display,direct_sprint_ids' }, signal),
    [milestoneId, get],
  );
  const row = (rowsOf(ms.data) ?? [])[0] as MilestoneRow | undefined;
  const ids = useMemo(() => sprintsOf(row), [row]);
  const burnLoad = useCallback<BurnSliceLoader>((slice, signal) => get(slice, {}, signal), [get]);
  // Срезы истории грузятся параллельно со строкой вехи: они общие (все задачи),
  // от состава спринтов зависит только отбор — его и пересчитывает scopeKey.
  const burn = useBurnOf(milestoneId, ids.join(','), inSprints(ids), burnLoad);

  if (ms.state === 'error' || ms.state === 'forbidden') {
    return <LoadError compact error={ms.error} onRetry={ms.reload} title={t('milestoneBurn.sprintsFailed')} />;
  }
  if (ms.state === 'loading') return <p className="sprint-burn sprint-burn--loading">{t('milestoneBurn.loading')}</p>;
  if (ids.length === 0) {
    return <p className="sprint-burn sprint-burn--empty" data-testid="milestone-burn-nosprints">{t('milestoneBurn.noSprints')}</p>;
  }
  const whenText = when ?? (typeof row?.date_display === 'string' ? row.date_display : '');
  const { due, frozen } = milestoneDue(whenText);
  return (
    <BurnLineView
      panelKey={milestoneId}
      burn={burn}
      deadline={due}
      today={today}
      frozen={frozen}
      frozenText={t('milestoneBurn.frozen')}
      text={{
        loading: t('milestoneBurn.loading'),
        empty: t('milestoneBurn.empty'),
        failed: t('milestoneBurn.failed'),
        noDeadline: t('milestoneBurn.noDeadline'),
      }}
    />
  );
}
