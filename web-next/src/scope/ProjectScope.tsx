// Выбор нескольких проектов в шапке v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03).
// Вид и действия — kit ScopePicker (поповер / лист на телефоне); здесь только
// проводка: список из слайсов LORE (loadProjectScope.ts), честное состояние
// (useLoadState), выбор — в URL (?proj=a,b), чтобы ссылка открывала тот же срез.
import { useMemo } from 'react';
import { ScopePicker, formatScopeParam, parseScopeParam, useLoadState, useUrlParam } from '@seidr/kit';
import { sliceFetcher } from '../api/loreSlice';
import type { SliceFetcher } from '../api/loreSlice';
import { useAppT } from '../i18n';
import type { AppKey } from '../i18n';
import { loadProjectScope } from './loadProjectScope';
import type { MineReason, ProjectScopeData } from './loadProjectScope';

/** Параметр URL с выбранными проектами — общий для экранов списков S4. */
export const PROJECT_SCOPE_PARAM = 'proj';

const MINE_HINT: Record<MineReason, AppKey> = {
  'no-user': 'scope.mine.noUser',
  'not-registered': 'scope.mine.notRegistered',
  'roles-error': 'scope.mine.rolesError',
};

export interface ProjectScopeProps {
  /** Загрузчик слайсов (тесты, заголовки входа); по умолчанию — /lore/slice. */
  fetch?: SliceFetcher;
  /** kc_sub вошедшего пользователя; вход в v2 ещё не подключён — undefined. */
  sub?: string | null;
  /** Телефон/широкий принудительно; не задан — по ширине экрана. */
  narrow?: boolean;
  onChange?: (projects: string[]) => void;
}

/** Выбранные проекты из URL — для экранов, которые фильтруют по ним. */
export function useProjectScope(): string[] {
  const [raw] = useUrlParam(PROJECT_SCOPE_PARAM);
  return useMemo(() => parseScopeParam(raw), [raw]);
}

export function ProjectScope({ fetch, sub, narrow, onChange }: ProjectScopeProps) {
  const t = useAppT();
  const doFetch = useMemo(() => fetch ?? sliceFetcher(), [fetch]);
  const result = useLoadState<ProjectScopeData>(
    signal => loadProjectScope({ fetch: doFetch, sub, signal }),
    [doFetch, sub],
  );
  const [raw, setRaw] = useUrlParam(PROJECT_SCOPE_PARAM);
  const value = useMemo(() => parseScopeParam(raw), [raw]);
  const data = result.data;

  return (
    <ScopePicker
      options={data?.rows ?? []}
      value={value}
      onChange={next => {
        setRaw(formatScopeParam(next));
        onChange?.(next);
      }}
      state={result.state}
      error={result.error}
      onRetry={result.reload}
      completeness={result.completeness}
      forbiddenReason={data?.outside_scope?.reason}
      mine={data?.mine ?? 'unknown'}
      mineHint={data?.mineReason ? t(MINE_HINT[data.mineReason]) : undefined}
      narrow={narrow}
    />
  );
}
