// SPRINT_LORE_PRODUCT_BACKLOG/AN-09 · ADR-LORE-030 §2 срез G «граф линейки».
// decision:D-2026-LORE-FEATURE-BUILDS-ON-EDGE: связь «опирается на → открывает
// дорогу» — ребро BUILDS_ON (фича → фича, на которую она опирается), а не
// текстовые ссылки context_md. Срез features отдаёт обе стороны ребра; здесь
// они сводятся в один список без дублей.

export type LineageRow = {
  uc_id: string;
  title: string | null;
  builds_on_ids: (string | null)[] | null;
  enables_ids: (string | null)[] | null;
};

export type LineageEdge = { from: string; to: string };

const ids = (v: (string | null)[] | null | undefined): string[] =>
  (v ?? []).filter((x): x is string => !!x);

// mermaid-id: только буквы, цифры, дефис и подчёркивание.
const mid = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

export function featureLineageOf(rows: LineageRow[]) {
  const seen = new Set<string>();
  const edges: LineageEdge[] = [];
  const add = (from: string, to: string) => {
    const k = `${from}\u0000${to}`;
    if (seen.has(k)) return;
    seen.add(k); edges.push({ from, to });
  };
  for (const r of rows) {
    ids(r.builds_on_ids).forEach(to => add(r.uc_id, to));
    ids(r.enables_ids).forEach(from => add(from, r.uc_id));
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const touched = new Set(edges.flatMap(e => [e.from, e.to]));
  const buildsOn = new Set(edges.map(e => e.from));
  const isolated = rows.map(r => r.uc_id).filter(id => !touched.has(id)).sort();
  // Основание: на неё опираются, сама ни на что не опирается.
  const foundations = [...touched].filter(id => !buildsOn.has(id)).sort();
  const titles = new Map(rows.map(r => [r.uc_id, r.title ?? r.uc_id]));
  const mermaid = edges.length
    ? ['graph RL',
       ...[...touched].sort().map(id => `  ${mid(id)}["${(titles.get(id) ?? id).replace(/"/g, "'")}"]`),
       ...edges.map(e => `  ${mid(e.from)} --> ${mid(e.to)}`)].join('\n')
    : '';
  return { edges, linked: touched.size, isolated, foundations, mermaid };
}
