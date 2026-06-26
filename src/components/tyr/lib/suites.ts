import type { TestNode, TestTree, TestKind } from '../api';

export interface Suite {
  id: string;
  label: string;
  kind: TestKind;
  /** Projects in dependency order. Most suites have one. */
  projects: string[];
  /** True when projects must run in a fixed sequence (hound pipeline). */
  isChain: boolean;
  tests: TestNode[];
}

/** Hound parse-pipeline: 4 projects that must run sequentially. */
export const HOUND_CHAIN_PROJECTS = [
  'hound-pltype',
  'hound-pltype-object',
  'hound-grammar',
  'hound-ddl-batch2',
] as const;

export const HOUND_STEP_LABELS: Record<string, string> = {
  'hound-pltype':        'PL/SQL TYPE',
  'hound-pltype-object': 'OBJECT + PIPELINED',
  'hound-grammar':       'Grammar Rules',
  'hound-ddl-batch2':    'HR DDL Batch 2',
};

const HOUND_SET = new Set<string>(HOUND_CHAIN_PROJECTS);

/**
 * Groups TestTree nodes into logical suites.
 * - Hound 4-project chain → one suite  (isChain = true)
 * - Every other project   → one suite each
 * Result is sorted by label.
 */
export function buildSuites(tree: TestTree): Suite[] {
  const allProjects = [...new Set(tree.nodes.map((n) => n.project))];
  const suites: Suite[] = [];

  // 1. Hound chain → one combined suite
  const houndTests = tree.nodes.filter((n) => HOUND_SET.has(n.project));
  const presentHound = HOUND_CHAIN_PROJECTS.filter((p) => allProjects.includes(p));
  if (houndTests.length > 0) {
    suites.push({
      id: 'hound-pipeline',
      label: '08 · Hound Parse Pipeline',
      kind: 'api',
      projects: presentHound,
      isChain: true,
      tests: houndTests,
    });
  }

  // 2. Every other project — one suite each
  for (const proj of allProjects) {
    if (HOUND_SET.has(proj)) continue;
    const tests = tree.nodes.filter((n) => n.project === proj);
    const kind = (tests[0]?.allure.testKind ?? 'e2e-ui') as TestKind;
    suites.push({
      id: proj,
      label: tree.projectLabels[proj] ?? proj,
      kind,
      projects: [proj],
      isChain: false,
      tests,
    });
  }

  return suites.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}
