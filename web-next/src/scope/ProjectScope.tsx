// Выбор нескольких проектов в шапке v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03).
// Вид и действия — kit ScopePicker (поповер / лист на телефоне); здесь только
// проводка: список из слайсов LORE (loadProjectScope.ts), честное состояние
// (useLoadState), выбор — в URL (?proj=a,b), чтобы ссылка открывала тот же срез.
import { useMemo, useState } from 'react';
import { ScopePicker, createSafeStorage, formatScopeParam, parseScopeParam, useLoadState, useUrlParam, type SafeStorage } from '@seidr/kit';
import { sliceFetcher } from '../api/loreSlice';
import type { SliceFetcher } from '../api/loreSlice';
import { useAppT } from '../i18n';
import type { AppKey } from '../i18n';
import { loadProjectScope } from './loadProjectScope';
import { myProjects } from '../api/me.projects';
import type { MineReason, ProjectScopeData } from './loadProjectScope';

/** Параметр URL с выбранными проектами — общий для экранов списков S4. */
export const PROJECT_SCOPE_PARAM = 'proj';

/** S9-04: недавно выбранные проекты — личное, в хранилище браузера (не в адресе). */
const RECENT_KEY = 'lore.v2.scope.recent';
const RECENT_MAX = 5;
function readRecent(st: SafeStorage): string[] {
  try { const v = JSON.parse(st.get(RECENT_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}

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
  /**
   * «Мои проекты» с сервера (S7B-14). По умолчанию — GET /lore/me/projects:
   * сервер сам знает, кто спрашивает. null — вернуться к прежнему пути через
   * срез по kc_sub (тесты, встройка).
   */
  me?: ((signal?: AbortSignal) => Promise<readonly string[]>) | null;
  /** Телефон/широкий принудительно; не задан — по ширине экрана. */
  narrow?: boolean;
  onChange?: (projects: string[]) => void;
  /** Хранилище «Недавних» (тесты); по умолчанию — localStorage с откатом в память. */
  storage?: SafeStorage;
}

/** Выбранные проекты из URL — для экранов, которые фильтруют по ним. */
export function useProjectScope(): string[] {
  const [raw] = useUrlParam(PROJECT_SCOPE_PARAM);
  return useMemo(() => parseScopeParam(raw), [raw]);
}

export function ProjectScope({ fetch, sub, me, narrow, onChange, storage: storageProp }: ProjectScopeProps) {
  const storage = useMemo(() => storageProp ?? createSafeStorage(), [storageProp]);
  const [recent, setRecent] = useState<string[]>(() => readRecent(storage));
  const t = useAppT();
  const doFetch = useMemo(() => fetch ?? sliceFetcher(), [fetch]);
  const result = useLoadState<ProjectScopeData>(
    signal => loadProjectScope({
      fetch: doFetch,
      sub,
      me: me === null ? undefined : (me ?? (sig => myProjects(sig).then(list => list.map(p => p.slug)))),
      signal,
    }),
    [doFetch, sub, me],
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
        // S9-04: только что добавленные — в начало «Недавних» (без повторов, не больше пяти).
        const added = next.filter(id => !value.includes(id));
        if (added.length) {
          const list = [...added.reverse(), ...recent.filter(id => !added.includes(id))].slice(0, RECENT_MAX);
          setRecent(list);
          storage.set(RECENT_KEY, JSON.stringify(list));
        }
        onChange?.(next);
      }}
      state={result.state}
      error={result.error}
      onRetry={result.reload}
      completeness={result.completeness}
      forbiddenReason={data?.outside_scope?.reason}
      mine={data?.mine ?? 'unknown'}
      mineHint={data?.mineReason ? t(MINE_HINT[data.mineReason]) : undefined}
      // Число своих — из ответа про мои проекты, а не счётом по списку:
      // список бывает обрезан, и своё могло в него не попасть.
      mineCount={data?.mineCount}
      narrow={narrow}
      recent={recent}
    />
  );
}
