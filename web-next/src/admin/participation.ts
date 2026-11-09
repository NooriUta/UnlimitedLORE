// «Кто где» в админке v2 (SPRINT_UXR_S7B_ADMIN; сценарий UC-8 в
// SPEC-ADMIN-LORE-UC 1.2.0). Владелица 09.11.2026: «фокус на — в скольких
// [проектах] человек участвует, и со стороны проекта — кто ты в нём и кто в
// нём твои агенты».
//
// Сервер новых вызовов для этого не делает (d8097ab4, 09.11): хватает того,
// что есть.
//   • role_matrix — человек и его проекты с ролями (массивы projects/roles
//     одной длины, по позиции);
//   • agent_owners — агенты и их владельцы.
// Агент видит все проекты владельца (наследует, SPEC-RBAC-OMILORE-AGENTS
// §10.6), поэтому «его агенты в проекте» = агенты владельца, если у владельца
// в проекте есть роль. Это сборка на клиенте, а не новое правило.
import { fetchSlice } from '../api/loreSlice';
import { fetchAgents, type AgentRow } from './agents';

export interface PersonProject { slug: string; role: string }
export interface Person {
  kc_sub: string;
  name: string;
  projects: PersonProject[];
  agents: AgentRow[];
}
export interface ProjectMember { kc_sub: string; name: string; role: string; agents: AgentRow[] }
export interface ProjectView { slug: string; members: ProjectMember[]; agentCount: number }

export interface Participation {
  people: Person[];
  projects: ProjectView[];
  /** Агенты, у которых нет владельца среди людей матрицы: их не потерять. */
  orphanAgents: AgentRow[];
  truncated: boolean;
  /** Агенты не прочитались — людей и проекты показываем, про агентов говорим честно. */
  agentsError: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function buildParticipation(
  matrixRows: Array<Record<string, unknown>>,
  agents: AgentRow[] | { error: string },
  truncated = false,
): Participation {
  const agentList = Array.isArray(agents) ? agents : [];
  const people: Person[] = matrixRows.map(r => {
    const projects = Array.isArray(r.projects) ? r.projects.map(String) : [];
    const roles = Array.isArray(r.roles) ? r.roles.map(String) : [];
    const kc = str(r.kc_sub);
    return {
      kc_sub: kc,
      name: str(r.display_name) || kc,
      projects: projects.map((slug, i) => ({ slug, role: roles[i] ?? '' }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      agents: agentList.filter(a => a.owner_kc_subs.includes(kc)),
    };
  }).filter(p => p.kc_sub !== '')
    .sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name));

  const byProject = new Map<string, ProjectMember[]>();
  for (const p of people) {
    for (const pr of p.projects) {
      const list = byProject.get(pr.slug) ?? [];
      list.push({ kc_sub: p.kc_sub, name: p.name, role: pr.role, agents: p.agents });
      byProject.set(pr.slug, list);
    }
  }
  const projects: ProjectView[] = [...byProject].map(([slug, members]) => ({
    slug,
    members: members.sort((a, b) => a.name.localeCompare(b.name)),
    agentCount: members.reduce((n, m) => n + m.agents.length, 0),
  })).sort((a, b) => a.slug.localeCompare(b.slug));

  const known = new Set(people.map(p => p.kc_sub));
  const orphanAgents = agentList.filter(a => !a.owner_kc_subs.some(k => known.has(k)));
  return {
    people, projects, orphanAgents, truncated,
    agentsError: Array.isArray(agents) ? null : agents.error,
  };
}

export async function fetchParticipation(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<Participation> {
  const [matrix, agents] = await Promise.all([
    fetchSlice<Record<string, unknown>>('role_matrix', { limit: '1000' }, { signal, fetchImpl }),
    fetchAgents(signal, fetchImpl).then(
      d => d.rows,
      (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
    ),
  ]);
  return buildParticipation(matrix.rows, agents, matrix.truncated === true);
}
