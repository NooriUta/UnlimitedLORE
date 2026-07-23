import { useMemo, useState, type ReactNode } from 'react';
import type { TestNode, TestStatus, TestKind } from '../api';

export interface FilterState {
  statuses: Set<TestStatus>;
  kinds: Set<TestKind>;
  modules: Set<string>;
  ucs: Set<string>;
  frontends: Set<string>;
}

export const emptyFilter = (): FilterState => ({
  statuses: new Set(),
  kinds: new Set(),
  modules: new Set(),
  ucs: new Set(),
  frontends: new Set(),
});

const KIND_LABEL: Record<TestKind, string> = {
  'e2e-ui': '🖥 E2E UI',
  'api':    '🔌 API',
  'unit':   '🧪 Unit',
  'visual': '📸 Visual',
  'a11y':   '♿ A11y',
  'setup':  '🔐 Setup',
};

interface Props {
  nodes: TestNode[];
  filtered: TestNode[];
  state: FilterState;
  onChange: (next: FilterState) => void;
}

const STATUS_META: Record<TestStatus, { label: string; color: string; icon: string }> = {
  active:     { label: 'active',     color: 'var(--suc)',    icon: '✓' },
  planned:    { label: 'planned',    color: 'var(--wrn)',    icon: '📝' },
  blocked:    { label: 'blocked',    color: 'var(--t3)',     icon: '🚧' },
  freeze:     { label: 'freeze',     color: 'var(--inf)',    icon: '❄️' },
  deprecated: { label: 'deprecated', color: 'var(--danger)', icon: '✗' },
};

const SETUP_PROJECTS = new Set(['setup', 'teardown']);
const Info = ({ tip }: { tip: string }): React.ReactNode => (
  <span title={tip} style={{ fontSize: 'var(--fs-xs)', cursor: 'help', opacity: 0.6 }}>ⓘ</span>
);

export function CatalogFilters({ nodes, filtered, state, onChange }: Props) {
  const [ucOpen, setUcOpen] = useState(false);
  const dims = useMemo(() => {
    const statuses = new Map<TestStatus, number>();
    const kinds = new Map<TestKind, number>();
    const modules = new Map<string, number>();
    const ucs = new Map<string, number>();
    const frontends = new Map<string, number>();

    for (const n of nodes) {
      const s = n.allure.status;
      statuses.set(s, (statuses.get(s) ?? 0) + 1);
      if (n.allure.testKind) kinds.set(n.allure.testKind, (kinds.get(n.allure.testKind) ?? 0) + 1);
      for (const m of n.allure.modules) modules.set(m, (modules.get(m) ?? 0) + 1);
      for (const u of n.allure.ucs)     ucs.set(u, (ucs.get(u) ?? 0) + 1);
      for (const f of n.allure.frontends) frontends.set(f, (frontends.get(f) ?? 0) + 1);
    }

    const sortByCount = (m: Map<string, number>): [string, number][] =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    return {
      statuses:  sortByCount(statuses) as [TestStatus, number][],
      kinds:     sortByCount(kinds) as [TestKind, number][],
      modules:   sortByCount(modules),
      ucs:       sortByCount(ucs),
      frontends: sortByCount(frontends),
    };
  }, [nodes]);

  const toggleSet = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    return next;
  };

  const totalActive = state.statuses.size + state.kinds.size + state.modules.size + state.ucs.size + state.frontends.size;
  const reset = (): void => onChange(emptyFilter());

  const Row = ({ k, v }: { k: ReactNode; v: React.ReactNode }): React.ReactNode => (
    <div className="cf-row">
      <div className="cf-key">{k}</div>
      <div className="cf-vals">{v}</div>
    </div>
  );

  return (
    <div className="cat-filters">
      <Row k="Статус" v={<>
        {dims.statuses.map(([s, count]) => {
          const m = STATUS_META[s];
          const on = state.statuses.has(s);
          return (
            <button
              key={s}
              className={`fchip${on ? ' on' : ''}`}
              style={on ? { background: `color-mix(in srgb, ${m.color} 18%, transparent)`, color: m.color, borderColor: `color-mix(in srgb, ${m.color} 40%, transparent)` } : { color: m.color }}
              onClick={() => onChange({ ...state, statuses: toggleSet(state.statuses, s) })}
            >
              <span>{m.icon}</span> {m.label} <span className="fchip-c">{count}</span>
            </button>
          );
        })}
      </>} />

      {dims.kinds.length > 0 && (
        <Row k="Тип" v={<>
          {dims.kinds.map(([k, count]) => {
            const on = state.kinds.has(k);
            return (
              <button
                key={k}
                className={`fchip${on ? ' on' : ''}`}
                onClick={() => onChange({ ...state, kinds: toggleSet(state.kinds, k) })}
              >
                {KIND_LABEL[k]} <span className="fchip-c">{count}</span>
              </button>
            );
          })}
        </>} />
      )}

      {dims.frontends.length > 0 && (
        <Row k={<>Frontend <Info tip="Только E2E-тесты — юнит-тесты не привязаны к фронтенду" /></>} v={<>
          {dims.frontends.map(([f, count]) => {
            const on = state.frontends.has(f);
            return (
              <button
                key={f}
                className={`fchip${on ? ' on' : ''}`}
                onClick={() => onChange({ ...state, frontends: toggleSet(state.frontends, f) })}
              >
                {f} <span className="fchip-c">{count}</span>
              </button>
            );
          })}
        </>} />
      )}

      {dims.modules.length > 0 && (
        <Row k={<>Модуль <Info tip="Тест может входить в несколько модулей — суммы чипов могут превышать общее количество" /></>} v={<>
          {dims.modules.map(([m, count]) => {
            const on = state.modules.has(m);
            return (
              <button
                key={m}
                className={`fchip${on ? ' on' : ''}`}
                onClick={() => onChange({ ...state, modules: toggleSet(state.modules, m) })}
              >
                {m} <span className="fchip-c">{count}</span>
              </button>
            );
          })}
        </>} />
      )}

      {dims.ucs.length > 0 && (
        <div className="cf-row cf-row-collapsible">
          <button
            type="button"
            className="cf-key cf-key-toggle"
            onClick={() => setUcOpen((v) => !v)}
            aria-expanded={ucOpen}
          >
            <span className="cf-caret">{ucOpen ? '▾' : '▸'}</span>
            UC <span className="cf-key-count">{dims.ucs.length}</span>
            {state.ucs.size > 0 && (
              <span className="cf-key-active">· выбрано {state.ucs.size}</span>
            )}
          </button>
          {ucOpen && (
            <div className="cf-vals">
              {dims.ucs.map(([uc, count]) => {
                const on = state.ucs.has(uc);
                return (
                  <button
                    key={uc}
                    className={`fchip fchip-uc${on ? ' on' : ''}`}
                    onClick={() => onChange({ ...state, ucs: toggleSet(state.ucs, uc) })}
                    title={uc}
                  >
                    {uc.length > 36 ? uc.slice(0, 36) + '…' : uc}
                    <span className="fchip-c">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="cf-summary">
        {(() => {
          const filteredCount = filtered.filter(n => !SETUP_PROJECTS.has(n.project)).length;
          const totalCount = nodes.filter(n => !SETUP_PROJECTS.has(n.project)).length;
          return <>Найдено: <b>{filteredCount}</b> из <b>{totalCount}</b> тест-кейсов</>;
        })()}
        {totalActive > 0 && (
          <button className="cf-reset" onClick={reset}>✕ сбросить фильтры ({totalActive})</button>
        )}
      </div>
    </div>
  );
}

/** Pure filter — apply FilterState к массиву TestNode. */
export function applyFilters(nodes: TestNode[], f: FilterState, search = ''): TestNode[] {
  const q = search.trim().toLowerCase();
  return nodes.filter((n) => {
    if (f.statuses.size > 0  && !f.statuses.has(n.allure.status)) return false;
    if (f.kinds.size > 0     && !(n.allure.testKind && f.kinds.has(n.allure.testKind))) return false;
    if (f.frontends.size > 0 && !n.allure.frontends.some((x) => f.frontends.has(x))) return false;
    if (f.modules.size > 0   && !n.allure.modules.some((x) => f.modules.has(x))) return false;
    if (f.ucs.size > 0       && !n.allure.ucs.some((x) => f.ucs.has(x))) return false;
    if (q && !(
      n.testTitle.toLowerCase().includes(q) ||
      n.file.toLowerCase().includes(q) ||
      n.project.toLowerCase().includes(q) ||
      (n.allure.epic    ?? '').toLowerCase().includes(q) ||
      (n.allure.feature ?? '').toLowerCase().includes(q) ||
      (n.allure.story   ?? '').toLowerCase().includes(q) ||
      (n.allure.owner   ?? '').toLowerCase().includes(q) ||
      n.allure.tags.some((t) => t.toLowerCase().includes(q)) ||
      n.allure.ucs.some((u) => u.toLowerCase().includes(q)) ||
      n.allure.modules.some((m) => m.toLowerCase().includes(q)) ||
      n.allure.frontends.some((f) => f.toLowerCase().includes(q))
    )) return false;
    return true;
  });
}
