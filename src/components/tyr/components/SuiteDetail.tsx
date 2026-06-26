import { useMemo, useState } from 'react';
import type { Suite } from '../lib/suites';
import { HOUND_STEP_LABELS } from '../lib/suites';
import type { TestNode, TestStatus } from '../api';
import { api } from '../api';

// Statuses that cycling through click visits (active → planned → deprecated → active …)
const STATUS_CYCLE: TestStatus[] = ['active', 'planned', 'deprecated'];

const STATUS_PILL: Record<TestStatus, { icon: string; color: string; label: string }> = {
  active:     { icon: '✓',  color: 'var(--suc)',    label: 'active' },
  planned:    { icon: '📝', color: 'var(--wrn)',    label: 'planned' },
  blocked:    { icon: '🚧', color: 'var(--t3)',     label: 'blocked' },
  freeze:     { icon: '❄️', color: 'var(--inf)',    label: 'freeze' },
  deprecated: { icon: '✗',  color: 'var(--danger)', label: 'deprecated' },
};

interface Props {
  suite: Suite;
  selected: Set<string>;
  selectable: boolean;
  busy: boolean;
  onToggleTest: (id: string) => void;
  onToggleSuite: (suite: Suite) => void;
  onNodeChange: (id: string, patch: { status?: TestStatus }) => void;
  onRun: (descr: string, filter: string) => void;
  /** Каталог-режим: клик по строке теста открывает полную карточку */
  onPickTest?: (t: TestNode) => void;
}

export function SuiteDetail({
  suite, selected, selectable, busy,
  onToggleTest, onToggleSuite, onNodeChange, onRun, onPickTest,
}: Props) {
  const [search, setSearch]     = useState('');
  const [pendingId, setPending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suite.tests;
    return suite.tests.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.testTitle.toLowerCase().includes(q) ||
      t.file.toLowerCase().includes(q),
    );
  }, [suite.tests, search]);

  const allIds   = suite.tests.map((t) => t.id);
  const selCount = allIds.filter((id) => selected.has(id)).length;
  const allSel   = selCount === allIds.length && allIds.length > 0;

  // Group tests by project (for chain-suite rendering)
  const byProject = useMemo(() => {
    const m: Record<string, TestNode[]> = {};
    for (const t of filtered) (m[t.project] ??= []).push(t);
    return m;
  }, [filtered]);

  const cycleStatus = async (t: TestNode): Promise<void> => {
    const cur = STATUS_CYCLE.indexOf(t.allure.status as TestStatus);
    const next = STATUS_CYCLE[(cur < 0 ? 1 : (cur + 1)) % STATUS_CYCLE.length];
    setPending(t.id);
    try {
      await api.setMeta({ testId: t.id, status: next });
      onNodeChange(t.id, { status: next });
    } finally {
      setPending(null);
    }
  };

  const runFilter = suite.projects.map((p) => `--project=${p}`).join(' ');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="suite-detail">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="suite-detail-hdr">
        <div className="suite-detail-title">
          <h2>{suite.label}</h2>
          <div className="suite-detail-meta">
            <span className="muted">{suite.tests.length} тест-кейсов</span>
            {suite.isChain && (
              <span className="suite-chain-badge" title="Проекты выполняются строго по цепочке">
                ⛓ цепочка зависимостей
              </span>
            )}
          </div>
        </div>
        <div className="suite-detail-btns">
          <button className="primary" disabled={busy} onClick={() => onRun(suite.label, runFilter)}>
            ▶ Запустить suite
          </button>
          {selectable && (
            <button onClick={() => onToggleSuite(suite)}>
              {allSel ? '☐ Снять выбор' : `☑ Выбрать все (${suite.tests.length})`}
            </button>
          )}
        </div>
      </div>

      {/* ── Chain step visualization ────────────────────────────────────────── */}
      {suite.isChain && (
        <div className="suite-chain-steps">
          {suite.projects.map((p, i) => {
            const cnt = suite.tests.filter((t) => t.project === p).length;
            return (
              <span key={p} className="chain-step-item">
                {i > 0 && <span className="chain-arrow">→</span>}
                <span className="chain-step-pill">
                  <span className="chain-step-name">{HOUND_STEP_LABELS[p] ?? p}</span>
                  <span className="chain-step-cnt">{cnt}</span>
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="suite-detail-search">
        <input
          type="text"
          placeholder="🔎 Фильтр по тесту…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="clear-btn" onClick={() => setSearch('')} title="Сбросить">✕</button>
        )}
        <span className="muted">
          {filtered.length !== suite.tests.length
            ? `${filtered.length} из ${suite.tests.length}`
            : filtered.length}
          {selectable && selCount > 0 && (
            <> · <b style={{ color: 'var(--acc)' }}>{selCount} выбрано</b></>
          )}
        </span>
      </div>

      {/* ── Test list ──────────────────────────────────────────────────────── */}
      <div className="suite-test-list">
        {suite.isChain
          ? suite.projects.map((proj) => {
              const rows = byProject[proj] ?? [];
              if (rows.length === 0) return null;
              return (
                <div key={proj} className="suite-test-group">
                  <div className="suite-test-group-hdr">
                    {HOUND_STEP_LABELS[proj] ?? proj}
                    <span className="muted"> · {rows.length}</span>
                  </div>
                  {rows.map((t) => (
                    <TestRow
                      key={t.id}
                      test={t}
                      isSel={selected.has(t.id)}
                      selectable={selectable}
                      isPending={pendingId === t.id}
                      onToggle={onToggleTest}
                      onCycleStatus={cycleStatus}
                      onPick={onPickTest}
                    />
                  ))}
                </div>
              );
            })
          : filtered.map((t) => (
              <TestRow
                key={t.id}
                test={t}
                isSel={selected.has(t.id)}
                selectable={selectable}
                isPending={pendingId === t.id}
                onToggle={onToggleTest}
                onCycleStatus={cycleStatus}
                onPick={onPickTest}
              />
            ))
        }
        {filtered.length === 0 && (
          <div className="muted" style={{ padding: 24 }}>Ничего не найдено.</div>
        )}
      </div>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

interface RowProps {
  test: TestNode;
  isSel: boolean;
  selectable: boolean;
  isPending: boolean;
  onToggle: (id: string) => void;
  onCycleStatus: (t: TestNode) => Promise<void>;
  /** If provided, clicking the row body opens the full test detail card */
  onPick?: (t: TestNode) => void;
}

function TestRow({ test: t, isSel, selectable, isPending, onToggle, onCycleStatus, onPick }: RowProps) {
  const sp = STATUS_PILL[t.allure.status] ?? STATUS_PILL.active;
  return (
    <div
      className={[
        'suite-test-row',
        isSel ? 'suite-test-row--sel' : '',
        onPick ? 'suite-test-row--clickable' : '',
      ].join(' ')}
      onClick={onPick ? () => onPick(t) : undefined}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      onKeyDown={onPick ? (e) => { if (e.key === 'Enter') onPick(t); } : undefined}
      title={onPick ? 'Открыть карточку теста' : undefined}
    >
      {selectable && (
        <input
          type="checkbox"
          className="tcard-cb suite-test-cb"
          checked={isSel}
          onChange={() => onToggle(t.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <button
        className="suite-status-btn"
        style={{
          color: sp.color,
          borderColor: `color-mix(in srgb, ${sp.color} 40%, transparent)`,
          background:   `color-mix(in srgb, ${sp.color} 10%, transparent)`,
          opacity: isPending ? 0.5 : 1,
          cursor: isPending ? 'default' : 'pointer',
        }}
        onClick={(e) => { e.stopPropagation(); void onCycleStatus(t); }}
        title={`${sp.label} — клик для смены статуса`}
        disabled={isPending}
      >
        {sp.icon} {sp.label}
      </button>
      <div className="suite-test-info">
        {t.describePath.length > 0 && (
          <span className="suite-test-path">{t.describePath.join(' › ')} ›</span>
        )}
        <span className="suite-test-title">{t.testTitle}</span>
      </div>
      <code className="suite-test-file">{t.file}:{t.line}</code>
      {onPick && <span className="suite-test-open" title="Открыть">›</span>}
    </div>
  );
}
