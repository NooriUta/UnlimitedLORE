// Top-level shell tabs — the two faces of the app under the LORE brand:
//   Проекты → LORE (plan / sprints / ADRs / decisions / releases / …)
//   MUNINN  → the experiment workspace (research / benchmark / biblio / story)
// Active tab is derived from pathname (see AppShell): /benchmark* → research,
// everything else → projects.

export interface ShellTab {
  id: 'projects' | 'research';
  labelKey: string;
  fallback: string;
  /** game-icons slug rendered before the label */
  icon: string;
  /** target route on click */
  to: string;
  /** pathname prefix that marks this tab active */
  match: string;
}

export const SHELL_TABS: ShellTab[] = [
  { id: 'projects', labelKey: 'shell.projects', fallback: 'Проекты', icon: 'compass',    to: '/lore?section=plan', match: '/lore' },
  { id: 'research', labelKey: 'shell.research', fallback: 'MUNINN',  icon: 'raven',      to: '/benchmark',         match: '/benchmark' },
];
