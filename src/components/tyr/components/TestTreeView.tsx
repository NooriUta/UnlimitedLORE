import { useMemo } from 'react';
import type { TestNode, TestTree } from '../api';

interface Props {
  tree: TestTree;
  selected: Set<string>;
  active: string | null;
  /** false → скрыть чекбоксы, режим «каталог»  */
  selectable?: boolean;
  /** filter substring — фильтрует листья по testTitle / file */
  filter?: string;
  onToggle: (id: string) => void;
  onToggleMany: (ids: string[], on: boolean) => void;
  onPick: (n: TestNode) => void;
}

/** Group nodes by project → file → describePath. */
interface Group {
  key: string;
  label: string;
  ids: string[];
  children?: Group[];
  leafs?: TestNode[];
}

function groupBy(nodes: TestNode[]): Group[] {
  const byProject = new Map<string, TestNode[]>();
  for (const n of nodes) {
    if (!byProject.has(n.project)) byProject.set(n.project, []);
    byProject.get(n.project)!.push(n);
  }

  const out: Group[] = [];
  for (const [project, list] of byProject) {
    const byFile = new Map<string, TestNode[]>();
    for (const n of list) {
      if (!byFile.has(n.file)) byFile.set(n.file, []);
      byFile.get(n.file)!.push(n);
    }
    const fileGroups: Group[] = [];
    for (const [file, ftests] of byFile) {
      // group by joined describePath
      const byDescribe = new Map<string, TestNode[]>();
      for (const n of ftests) {
        const k = n.describePath.join(' › ') || '(root)';
        if (!byDescribe.has(k)) byDescribe.set(k, []);
        byDescribe.get(k)!.push(n);
      }
      const dGroups: Group[] = [];
      for (const [d, dt] of byDescribe) {
        dGroups.push({
          key: `${project}/${file}/${d}`,
          label: d,
          ids: dt.map((n) => n.id),
          leafs: dt,
        });
      }
      fileGroups.push({
        key: `${project}/${file}`,
        label: file.replace(/^tests\//, ''),
        ids: ftests.map((n) => n.id),
        children: dGroups,
      });
    }
    out.push({
      key: project,
      label: project, // overwritten in caller using tree.projectLabels
      ids: list.map((n) => n.id),
      children: fileGroups,
    });
  }
  return out;
}

export function TestTreeView({
  tree, selected, active, selectable = true, filter = '',
  onToggle, onToggleMany, onPick,
}: Props) {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const filterLc = filter.trim().toLowerCase();
  const matches = (n: TestNode): boolean =>
    !filterLc ||
    n.testTitle.toLowerCase().includes(filterLc) ||
    n.file.toLowerCase().includes(filterLc) ||
    n.project.toLowerCase().includes(filterLc);
  const groups = useMemo(() => {
    const filtered = filterLc
      ? tree.nodes.filter(matches)
      : tree.nodes;
    const g = groupBy(filtered);
    for (const p of g) {
      p.label = tree.projectLabels[p.key] ?? p.key;
    }
    return g;
  }, [tree, filterLc]);

  const totalSelected = (g: Group): { sel: number; total: number } => {
    const total = g.ids.length;
    let sel = 0;
    for (const id of g.ids) if (selected.has(id)) sel++;
    return { sel, total };
  };

  const renderGroup = (g: Group, depth: number): React.ReactNode => {
    const { sel, total } = totalSelected(g);
    const all = sel === total;
    const some = sel > 0 && sel < total;
    return (
      <details key={g.key} open={depth === 0 || !!filterLc} style={{ marginLeft: depth * 10 }}>
        <summary>
          {selectable && (
            <input
              type="checkbox"
              checked={all}
              ref={(el) => { if (el) el.indeterminate = some; }}
              onChange={(e) => onToggleMany(g.ids, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <span className="grp-label">{g.label}</span>
          <span className="grp-count">{selectable && sel > 0 ? `${sel}/${total}` : `${total}`}</span>
        </summary>
        {g.children && g.children.map((c) => renderGroup(c, depth + 1))}
        {g.leafs && (
          <ul className="leafs">
            {g.leafs.map((n) => (
              <li key={n.id} className={n.id === active ? 'leaf-active' : ''}>
                <label>
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selected.has(n.id)}
                      onChange={() => onToggle(n.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <span
                    className="leaf-title"
                    onClick={() => { const node = byId.get(n.id); if (node) onPick(node); }}
                  >{n.testTitle}</span>
                  <span className="leaf-loc">{n.file.split('/').pop()}:{n.line}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </details>
    );
  };

  return <div className="tree">{groups.map((g) => renderGroup(g, 0))}</div>;
}
