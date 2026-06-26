// Top-level shell tabs:
//   Forseti → LORE (plan / sprints / ADRs / decisions / releases / …)
//   HUGINN  → the experiment workspace (research / benchmark / biblio / story)
//   MUNINN  → [stub] memory / knowledge recall module
//   BRAGI   → [stub] marketing / narrative / skald module
//   TYR     → [stub] testing / QA / justice module (TPG runtime)
// Active tab derived from pathname (see AppShell).

export interface ShellTab {
  id: 'projects' | 'research' | 'muninn' | 'bragi' | 'tyr';
  labelKey: string;
  fallback: string;
  /** game-icons slug rendered before the label */
  icon: string;
  /** mirror the icon horizontally */
  flipX?: boolean;
  /** target route on click */
  to: string;
  /** pathname prefix that marks this tab active */
  match: string;
}

export const SHELL_TABS: ShellTab[] = [
  { id: 'projects', labelKey: 'shell.projects', fallback: 'Forseti', icon: 'compass',    to: '/lore?section=plan', match: '/lore'      },
  { id: 'research', labelKey: 'shell.research', fallback: 'HUGINN',  icon: 'raven',      to: '/benchmark',         match: '/benchmark'  },
  { id: 'muninn',   labelKey: 'shell.muninn',   fallback: 'MUNINN',  icon: 'raven', flipX: true, to: '/muninn',    match: '/muninn'     },
  { id: 'tyr',      labelKey: 'shell.tyr',      fallback: 'TYR',     icon: 'scales',     to: '/tyr',               match: '/tyr'        },
  { id: 'bragi',    labelKey: 'shell.bragi',    fallback: 'BRAGI',   icon: 'harp',       to: '/bragi',             match: '/bragi'      },
];
