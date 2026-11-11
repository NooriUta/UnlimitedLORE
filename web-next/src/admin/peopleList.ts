// «Люди и их проекты» — стандартный список kit (SPRINT_UXR_S7B_ADMIN/S7B-28).
// Владелица 11.11.2026: «Люди должны быть табличным стандартным значением, а тот
// экран, который собран сейчас, должен стать паспортом». Ответы на прототип:
// стандартные виды (таблица / карточки), сортировка и фильтры kit; роль и проект
// фильтрами + «без проектов» и поиск; первые 50 + «ещё» (LIST_BUDGET.perGroup);
// разрез по роли есть, но выключен по умолчанию.
import type { KitConfig, KitLang, KitRecord } from '@seidr/kit';
import { appT } from '../i18n';
import type { Participation } from './participation';

/** Человек → запись списка. Проектов нет — поля нет: быстрый фильтр «без проектов» ловит пустое. */
export function peopleRecords(p: Participation, meSub: string | null, youLabel = 'это вы'): KitRecord[] {
  return p.people.map(x => {
    const roles = [...new Set(x.projects.map(pr => pr.role).filter(Boolean))].sort();
    const fields: Record<string, unknown> = {
      roles,
      n_projects: x.projects.length,
      agents: x.agents.length,
      login: x.kc_sub,
    };
    if (x.projects.length) fields.projects = x.projects.map(pr => pr.slug);
    // Поиск — как раньше на этом экране (S7B-25): имя, логин, проект, имя и клиент агента.
    const search = [x.kc_sub, ...x.projects.map(pr => pr.slug), ...x.agents.flatMap(a => [a.name ?? '', a.client_id ?? '', a.actor_id])].join(' ');
    return { id: x.kc_sub, kind: 'person', title: x.kc_sub === meSub ? `${x.name} · ${youLabel}` : x.name, status: '', fields, search };
  });
}

export function peopleListConfig(lang: KitLang): KitConfig {
  const t = (k: Parameters<typeof appT>[1]) => appT(lang, k);
  return {
    modules: [],
    menu: { groups: [] },
    kinds: {
      person: {
        title: t('admin.people.kind'),
        icon: 'person',
        fields: [
          { key: 'roles', title: t('admin.col.role'), type: 'enum' },
          { key: 'projects', title: t('admin.people.projects'), type: 'enum' },
          { key: 'n_projects', title: t('admin.people.nProjects'), type: 'number' },
          { key: 'agents', title: t('admin.people.agents'), type: 'number' },
        ],
      },
    },
    // Статусной оси у человека нет (K-14: законный конфиг).
    statuses: { items: [] },
    list: {
      views: ['list', 'cards'],
      quick: [{ id: 'no-projects', title: t('admin.people.noProjects'), filter: { projects: '' } }],
      filters: ['fields.roles', 'fields.projects'],
      groupings: ['roles'],
      columns: ['title', 'roles', 'n_projects', 'agents'],
    },
  };
}
