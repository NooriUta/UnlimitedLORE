// Список проектов для выбора в шапке (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03) —
// из существующих слайсов, новых эндпоинтов не нужно:
//   git_projects        — все git-проекты (slug, name, default_branch…);
//   user_project_roles  — проекты, где у пользователя есть роль (по kc_sub).
//
// «Мои» честные: без пользователя, без записи в графе ролей или при сбое слайса
// ролей — mine:'unknown' с причиной, а не «у вас ничего нет». Сам список при
// этом остаётся: сбой ролей не повод прятать проекты.
import type { ScopeOption, SliceCompletenessMeta } from '@seidr/kit';
import type { SliceBody } from '../api/loreSlice';

export interface GitProjectRow {
  slug: string;
  name?: string | null;
  default_branch?: string | null;
}

export interface UserRolesRow {
  kc_sub?: string;
  projects?: (string | null)[] | null;
  roles?: (string | null)[] | null;
}

export type MineReason = 'no-user' | 'not-registered' | 'roles-error';

export type ProjectScopeData = SliceCompletenessMeta & {
  rows: ScopeOption[];
  mine: 'known' | 'unknown';
  mineReason?: MineReason;
};

type Fetch = <T>(slice: string, params: Record<string, string>, signal?: AbortSignal) => Promise<SliceBody<T>>;

export interface LoadProjectScopeInput {
  fetch: Fetch;
  /** kc_sub вошедшего пользователя; нет — «мои» не проверить. */
  sub?: string | null;
  signal?: AbortSignal;
}

export async function loadProjectScope({ fetch, sub, signal }: LoadProjectScopeInput): Promise<ProjectScopeData> {
  const rolesP: Promise<{ ids: Set<string> } | MineReason> = sub
    ? fetch<UserRolesRow>('user_project_roles', { kc_sub: sub }, signal).then(
        b => (b.rows.length === 0
          ? 'not-registered' as const
          : { ids: new Set(b.rows.flatMap(r => r.projects ?? []).filter((p): p is string => !!p)) }),
        () => 'roles-error' as const,
      )
    : Promise.resolve('no-user' as const);

  const [body, roles] = await Promise.all([fetch<GitProjectRow>('git_projects', {}, signal), rolesP]);
  const { rows, ...meta } = body;
  const known = typeof roles === 'object';
  const options: ScopeOption[] = rows
    .filter(r => r && typeof r.slug === 'string' && r.slug)
    .map(r => {
      const o: ScopeOption = { id: r.slug };
      if (r.name) o.title = r.name;
      if (r.default_branch) o.hint = r.default_branch;
      if (known) o.mine = roles.ids.has(r.slug);
      return o;
    });
  return known
    ? { ...meta, rows: options, mine: 'known' }
    : { ...meta, rows: options, mine: 'unknown', mineReason: roles };
}
