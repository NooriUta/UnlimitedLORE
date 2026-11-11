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
  /**
   * Сколько проектов СВОИХ — по ответу про мои проекты, а не по `rows`
   * (S7B-14 + 10.11.2026). Считать по `rows` нельзя: список git-проектов
   * бывает обрезан, и свой проект может в него не попасть — счёт по нему
   * назвал бы не «сколько своих», а «сколько своих мы успели увидеть».
   * Роли не проверены — числа нет вовсе, и подпись охвата это говорит.
   */
  mineCount?: number;
};

type Fetch = <T>(slice: string, params: Record<string, string>, signal?: AbortSignal) => Promise<SliceBody<T>>;

export interface LoadProjectScopeInput {
  fetch: Fetch;
  /** kc_sub вошедшего пользователя; нет — «мои» не проверить. */
  sub?: string | null;
  /**
   * «Мои проекты» прямо с сервера (SPRINT_UXR_S7B_ADMIN/S7B-14,
   * GET /lore/me/projects). Это лучший источник, чем срез по kc_sub: сервер
   * сам знает, кто спрашивает, и отвечает 401, когда не опознан, — то есть
   * «не знаем, чьи проекты» перестаёт быть догадкой по отсутствию kc_sub.
   * Не передан — остаётся прежний путь через срез user_project_roles.
   */
  me?: (signal?: AbortSignal) => Promise<readonly string[]>;
  signal?: AbortSignal;
}

export async function loadProjectScope({ fetch, sub, me, signal }: LoadProjectScopeInput): Promise<ProjectScopeData> {
  // Сервер знает мои проекты сам (S7B-14). Пустой список — «ролей нет», а не
  // «не опознан»: это разные ответы, и путать их нельзя.
  const meP: Promise<{ ids: Set<string> } | MineReason> | null = me
    ? me(signal).then(
      list => (list.length === 0 ? 'not-registered' as const : { ids: new Set(list) }),
      (e: unknown) => (String(e).includes('401') || String(e).includes('NO_IDENTITY')
        ? 'no-user' as const
        : 'roles-error' as const),
    )
    : null;
  const rolesP: Promise<{ ids: Set<string> } | MineReason> = meP ?? (sub
    ? fetch<UserRolesRow>('user_project_roles', { kc_sub: sub }, signal).then(
        b => (b.rows.length === 0
          ? 'not-registered' as const
          : { ids: new Set(b.rows.flatMap(r => r.projects ?? []).filter((p): p is string => !!p)) }),
        () => 'roles-error' as const,
      )
    : Promise.resolve('no-user' as const));

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
    ? { ...meta, rows: options, mine: 'known', mineCount: roles.ids.size }
    : { ...meta, rows: options, mine: 'unknown', mineReason: roles };
}
