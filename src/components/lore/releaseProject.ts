// SPRINT_LORE_PROJECT_SCOPE/AL-96 — проект релиза: РЕБРО BELONGS_TO_PROJECT
// (решение владельца 04.11.2026), плоское git_project — запасной вариант для
// старых релизов без ребра. У вершины без рёбер обход отдаёт `[null]`, а не
// пустой массив — null-ы отбрасываются (та же ловушка, что закрыта в AL-96/PR #332).
export function releaseProjectOf(r: { projects?: (string | null)[] | null; git_project?: string | null }): string | null {
  const viaEdge = (r.projects ?? []).find((p): p is string => typeof p === 'string' && p.length > 0);
  return viaEdge ?? r.git_project ?? null;
}
