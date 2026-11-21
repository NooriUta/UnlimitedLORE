// Адрес git-хоста (Forgejo) установки — из настроек, а не из кода
// (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE; правило — в образе и бандле нет ни одного нашего имени хоста).
//
// Раньше мастера и подсказки ссылались на литерал нашего Forgejo: чужая установка регистрировала бы проекты
// с адресом нашего хоста и слала людей к нам. Теперь по старшинству:
//   1. параметр приложения forgejo.url (app_setting, «Флаги» админки);
//   2. хост primary-репозитория у уже зарегистрированных проектов (git_projects.hosts) — самый частый;
//   3. ничего — null: экран честно говорит «адрес git-хоста не задан», а не подставляет наш домен.
import { useLoadState } from '@seidr/kit';
import { fetchAppSettings } from './appSettings';
import { fetchGitProjects, type GitProject } from './projectLike';

export const GIT_HOST_SETTING = 'forgejo.url';

/** origin http(s)-адреса или null. */
export function originOf(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Адрес git-хоста: настройка → самый частый хост зарегистрированных проектов → null. */
export function resolveGitHost(setting: string | null | undefined, projects: readonly Pick<GitProject, 'host'>[]): string | null {
  const s = originOf(setting);
  if (s) return s;
  const count = new Map<string, number>();
  for (const p of projects) if (p.host) count.set(p.host, (count.get(p.host) ?? 0) + 1);
  let best: string | null = null;
  for (const [h, n] of count) if (best === null || n > (count.get(best) ?? 0)) best = h;
  return best;
}

/** Подсказка «tea login» для шага «руками»: адрес установки или явная заглушка «адрес не задан». */
export function teaLoginHint(gitHost: string | null, missingLabel: string): string {
  return `tea login add --name forgejo --url ${gitHost ?? `<${missingLabel}>`}`;
}

export async function fetchGitHost(fetchImpl?: typeof fetch): Promise<string | null> {
  const [settings, projects] = await Promise.all([fetchAppSettings(undefined, fetchImpl), fetchGitProjects(fetchImpl)]);
  const row = settings.find(r => r.dict_type === 'app_setting' && r.is_active && r.code === GIT_HOST_SETTING);
  return resolveGitHost(row?.label_ru ?? null, projects);
}

/** Хук: loading → адрес | null («не задан»); сбой загрузки — error (≠ «не задан»). */
export function useGitHost(fetchImpl?: typeof fetch) {
  return useLoadState<string | null>(() => fetchGitHost(fetchImpl), [fetchImpl]);
}
