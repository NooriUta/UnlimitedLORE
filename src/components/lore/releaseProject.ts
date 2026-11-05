// SPRINT_LORE_PROJECT_SCOPE/AL-96 — проект релиза: РЕБРО BELONGS_TO_PROJECT
// (решение владельца 04.11.2026), плоское git_project — запасной вариант для
// старых релизов без ребра. У вершины без рёбер обход отдаёт `[null]`, а не
// пустой массив — null-ы отбрасываются (та же ловушка, что закрыта в AL-96/PR #332).
export function releaseProjectOf(r: { projects?: (string | null)[] | null; git_project?: string | null }): string | null {
  const viaEdge = (r.projects ?? []).find((p): p is string => typeof p === 'string' && p.length > 0);
  return viaEdge ?? r.git_project ?? null;
}

type ReleaseKey = { release_id: string; release_uid: string | null; git_project: string | null };

/** Ключ строки борда релизов (и значение ?rel=): release_uid, иначе release_id. */
export function uidOfRelease(r: ReleaseKey): string {
  return r.release_uid ?? r.release_id;
}

/**
 * AH-09: ?rel= → строка борда. Принимает uid строки, пару «проект#id»
 * (так её собирает лента новостей) или голый release_id. Голый id неоднозначен
 * между репозиториями — берётся первая строка с этим id, у которой нет uid,
 * а затем любая; точное совпадение uid всегда приоритетнее.
 */
export function resolveReleaseRef<R extends ReleaseKey>(rows: R[], ref: string): R | null {
  const exact = rows.find(r => uidOfRelease(r) === ref);
  if (exact) return exact;
  const hash = ref.lastIndexOf('#');
  if (hash > 0) {
    const proj = ref.slice(0, hash), id = ref.slice(hash + 1);
    const byPair = rows.find(r => r.release_id === id && r.git_project === proj);
    if (byPair) return byPair;
  }
  return rows.find(r => r.release_id === ref && !r.release_uid) ?? rows.find(r => r.release_id === ref) ?? null;
}
