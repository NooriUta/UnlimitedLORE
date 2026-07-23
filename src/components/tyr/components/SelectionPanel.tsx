import { useMemo } from 'react';
import type { TestNode, TestTree } from '../api';
import { buildSuites } from '../lib/suites';

interface Props {
  tree: TestTree;
  selected: Set<string>;
  selectedNodes: TestNode[];
  busy: boolean;
  onToggleMany: (ids: string[], on: boolean) => void;
  onClear: () => void;
  onRunSelected: () => void;
  onRunAll: () => void;
  onRunFailed: () => void;
  onRunByTag: () => void;
}

export function SelectionPanel({
  tree, selected, selectedNodes, busy,
  onToggleMany, onClear, onRunSelected, onRunAll, onRunFailed, onRunByTag,
}: Props) {
  const stats = useMemo(() => {
    const projects: Record<string, number> = {};
    for (const n of selectedNodes) {
      projects[n.project] = (projects[n.project] ?? 0) + 1;
    }
    const total = tree.nodes.length;
    return {
      total,
      sel: selectedNodes.length,
      pct: total ? Math.round((selectedNodes.length / total) * 100) : 0,
      projects,
    };
  }, [selectedNodes, tree.nodes.length]);

  const allIds = tree.nodes.map((n) => n.id);

  return (
    <div className="sel-panel">
      <div className="sel-hero">
        <div className="sel-count">
          <div className="sel-big">{stats.sel}</div>
          <div className="sel-sub">из {stats.total} тестов выбрано</div>
        </div>
        <div className="sel-bar">
          <div className="sel-bar-fill" style={{ width: `${stats.pct}%` }} />
        </div>
        <div className="sel-meta">
          {stats.sel > 0 ? (
            <>
              {Object.entries(stats.projects).map(([p, c]) => (
                <span key={p} className="sel-proj">{p}: <b>{c}</b></span>
              ))}
            </>
          ) : (
            <span className="muted">Отметь тесты галочками в дереве слева, либо нажми «Все».</span>
          )}
        </div>
      </div>

      <div className="sel-actions">
        <button
          className="primary big"
          onClick={onRunSelected}
          disabled={busy || stats.sel === 0}
        >
          ▶ Запустить выбранные ({stats.sel})
        </button>
      </div>

      <div className="sel-block">
        <h3>Быстрый выбор</h3>
        <div className="qa-row">
          <button onClick={() => onToggleMany(allIds, true)} disabled={busy}>
            ✓ Все ({stats.total})
          </button>
          <button onClick={onClear} disabled={busy || stats.sel === 0}>
            ☓ Очистить
          </button>
        </div>
      </div>

      <div className="sel-block">
        <h3>Шорткаты прогона</h3>
        <button className="qa-wide" onClick={onRunAll} disabled={busy}>
          ▶ Прогнать <b>все</b> тесты, без выбора
        </button>
        <button className="qa-wide" onClick={onRunFailed} disabled={busy}>
          ↻ Только <b>упавшие</b> в прошлый раз (<code>--last-failed</code>)
        </button>
        <button className="qa-wide" onClick={onRunByTag} disabled={busy}>
          # По <b>тегу</b> (smoke / rbac / ...)
        </button>
      </div>

      <div className="sel-block">
        <h3>По suite</h3>
        <div className="qa-projects">
          {buildSuites(tree).map((suite) => {
            const ids = suite.tests.map((t) => t.id);
            const selCount = ids.filter((id) => selected.has(id)).length;
            const allSel = selCount === ids.length && ids.length > 0;
            return (
              <button
                key={suite.id}
                className={allSel ? 'on' : selCount > 0 ? 'partial' : ''}
                onClick={() => onToggleMany(ids, !allSel)}
                disabled={busy}
                title={`${selCount} / ${ids.length} выбрано${suite.isChain ? ' · цепочка' : ''}`}
              >
                {allSel ? '✓' : selCount > 0 ? '—' : '○'} {suite.label}
                {suite.isChain && <span style={{ fontSize: 'var(--fs-xs)' }}> ⛓</span>}
                <span className="muted"> {selCount}/{ids.length}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
