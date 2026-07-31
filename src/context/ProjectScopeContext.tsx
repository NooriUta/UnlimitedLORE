// AL-78: реальная замена tenant-стаба в AppShell — контекст данных вместо
// декоративного переключателя. Единственный слайс, уже принимающий `project`
// (ADR-LORE-017), — 'sprints'; сюда и пробрасываем выбор. Другие типы слайсов
// (adrs/specs/docs/components) сегодня принимают только `component`, решение
// по их проектной оси не принято (ADR-036-D6) — не изобретаем поведение для
// них здесь.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchLoreSlice } from '../api/lore';

export interface GitProjectRow {
  slug: string;
  name: string | null;
}

interface ProjectScopeValue {
  /** null = «все проекты» (умолчание, прежнее поведение без фильтра) */
  project: string | null;
  setProject: (slug: string | null) => void;
  projects: GitProjectRow[];
}

export const PROJECT_SCOPE_STORAGE_KEY = 'lore-project-scope';

// Чистая функция — что реально пробрасывать в fetchLoreSlice('sprints', …).
// Вынесена отдельно, чтобы вызывающий код и тест смотрели на одно и то же
// правило, а не дублировали тройной оператор в каждом компоненте.
export function sliceParamsForProject(project: string | null): { project: string } | undefined {
  return project ? { project } : undefined;
}

// Чистая функция — должен ли текущий выбор пережить свежий список проектов.
// Персистентный slug из прошлой сессии мог быть удалён/переименован — тогда
// молча откатываемся на «все проекты» вместо вечного пустого фильтра.
// Пока список проектов ещё не загружен (projects.length === 0), решение не
// принимается — иначе валидный выбор сбрасывался бы на долю секунды каждой
// перезагрузки, до того как git_projects успеет прийти.
export function reconcileProjectScope(project: string | null, projects: GitProjectRow[]): string | null {
  if (!project || projects.length === 0) return project;
  return projects.some(p => p.slug === project) ? project : null;
}

const ProjectScopeContext = createContext<ProjectScopeValue>({
  project: null,
  setProject: () => {},
  projects: [],
});

export function ProjectScopeProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<string | null>(() => localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY));
  const [projects, setProjects] = useState<GitProjectRow[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<GitProjectRow>('git_projects', {}, ctrl.signal)
      .then(setProjects)
      .catch(() => { /* селектор просто останется на «все проекты» */ });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const reconciled = reconcileProjectScope(project, projects);
    if (reconciled !== project) {
      setProjectState(reconciled);
      localStorage.removeItem(PROJECT_SCOPE_STORAGE_KEY);
    }
  }, [project, projects]);

  const setProject = (slug: string | null) => {
    setProjectState(slug);
    if (slug) localStorage.setItem(PROJECT_SCOPE_STORAGE_KEY, slug);
    else localStorage.removeItem(PROJECT_SCOPE_STORAGE_KEY);
  };

  return (
    <ProjectScopeContext.Provider value={{ project, setProject, projects }}>
      {children}
    </ProjectScopeContext.Provider>
  );
}

export function useProjectScope(): ProjectScopeValue {
  return useContext(ProjectScopeContext);
}
