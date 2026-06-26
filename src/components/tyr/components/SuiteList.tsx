import { useRef } from 'react';
import type { Suite } from '../lib/suites';
import type { TestKind, TestStatus } from '../api';

const KIND_META: Record<TestKind, { icon: string; label: string; color: string }> = {
  'e2e-ui': { icon: '🖥',  label: 'E2E UI', color: 'var(--acc)' },
  'api':    { icon: '🔌',  label: 'API',    color: 'var(--suc)' },
  'unit':   { icon: '🧪',  label: 'Unit',   color: '#f59e0b' },
  'visual': { icon: '📸',  label: 'Visual', color: '#a78bfa' },
  'a11y':   { icon: '♿',  label: 'A11y',   color: 'var(--wrn)' },
  'setup':  { icon: '🔐',  label: 'Setup',  color: 'var(--t3)' },
};

const STATUS_COLOR: Record<TestStatus, string> = {
  active:     'var(--suc)',
  planned:    'var(--wrn)',
  blocked:    'var(--t3)',
  freeze:     'var(--inf)',
  deprecated: 'var(--danger)',
};

const STATUS_ICON: Record<TestStatus, string> = {
  active:     '✓',
  planned:    '📝',
  blocked:    '🚧',
  freeze:     '❄️',
  deprecated: '✗',
};

interface Props {
  suites: Suite[];
  activeSuiteId: string | null;
  selected: Set<string>;
  selectable: boolean;
  searchText: string;
  onPick: (suite: Suite) => void;
  onToggleSuite: (suite: Suite) => void;
}

export function SuiteList({
  suites, activeSuiteId, selected, selectable, searchText, onPick, onToggleSuite,
}: Props) {
  const q = searchText.trim().toLowerCase();
  const visible = q
    ? suites.filter((s) =>
        s.label.toLowerCase().includes(q) ||
        s.tests.some((t) => t.title.toLowerCase().includes(q))
      )
    : suites;

  if (visible.length === 0) {
    return <div className="muted" style={{ padding: 24 }}>Ничего не найдено.</div>;
  }

  return (
    <div className="suite-list">
      {visible.map((suite) => (
        <SuiteCard
          key={suite.id}
          suite={suite}
          isActive={suite.id === activeSuiteId}
          selected={selected}
          selectable={selectable}
          onPick={onPick}
          onToggle={onToggleSuite}
        />
      ))}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps {
  suite: Suite;
  isActive: boolean;
  selected: Set<string>;
  selectable: boolean;
  onPick: (suite: Suite) => void;
  onToggle: (suite: Suite) => void;
}

function SuiteCard({ suite, isActive, selected, selectable, onPick, onToggle }: CardProps) {
  const cbRef = useRef<HTMLInputElement>(null);
  const allIds = suite.tests.map((t) => t.id);
  const selCount = allIds.filter((id) => selected.has(id)).length;
  const allSel   = selCount > 0 && selCount === allIds.length;
  const someSel  = selCount > 0 && selCount < allIds.length;

  // Sync indeterminate state (React doesn't support it as a prop)
  if (cbRef.current) cbRef.current.indeterminate = someSel;

  const km = KIND_META[suite.kind] ?? KIND_META['e2e-ui'];

  // Status breakdown
  const counts: Partial<Record<TestStatus, number>> = {};
  for (const t of suite.tests) {
    counts[t.allure.status] = (counts[t.allure.status] ?? 0) + 1;
  }

  return (
    <div
      className={[
        'suite-card',
        isActive ? 'on' : '',
        allSel && selectable ? 'suite-card--sel' : '',
      ].join(' ')}
      onClick={() => onPick(suite)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(suite); }
      }}
    >
      <div className="suite-card-top">
        {selectable && (
          <input
            ref={cbRef}
            type="checkbox"
            className="tcard-cb suite-card-cb"
            checked={allSel}
            onChange={() => onToggle(suite)}
            onClick={(e) => e.stopPropagation()}
            title={`${selCount} / ${allIds.length} выбрано`}
          />
        )}
        <span className="suite-card-kind" style={{ color: km.color }} title={km.label}>
          {km.icon}
        </span>
        {suite.isChain && <span className="suite-chain-badge" title="Цепочка зависимостей">⛓</span>}
        <span className="suite-card-cnt">{suite.tests.length} тестов</span>
        {selectable && selCount > 0 && (
          <span className="suite-sel-cnt">· {selCount} выбрано</span>
        )}
      </div>

      <div className="suite-card-label">{suite.label}</div>

      <div className="suite-card-stats">
        {(Object.entries(counts) as [TestStatus, number][]).map(([s, n]) => (
          <span key={s} className="suite-stat-dot" style={{ color: STATUS_COLOR[s] }}>
            {STATUS_ICON[s]} {n}
          </span>
        ))}
      </div>
    </div>
  );
}
