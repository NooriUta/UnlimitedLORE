import { useMemo } from 'react';
import type { TestNode, TestTree, TestStatus, TestKind } from '../api';

const KIND_BADGE: Record<TestKind, { icon: string; label: string; color: string }> = {
  'e2e-ui': { icon: '🖥',  label: 'E2E UI', color: 'var(--acc)' },
  'api':    { icon: '🔌',  label: 'API',    color: 'var(--suc)' },
  'unit':   { icon: '🧪',  label: 'Unit',   color: '#f59e0b' },
  'visual': { icon: '📸',  label: 'Visual', color: '#a78bfa' },
  'a11y':   { icon: '♿',  label: 'A11y',   color: 'var(--wrn)' },
  'setup':  { icon: '🔐',  label: 'Setup',  color: 'var(--t3)' },
};

const STATUS_PILL: Record<TestStatus, { label: string; color: string; icon: string }> = {
  active:     { label: 'active',     color: 'var(--suc)',    icon: '✓' },
  planned:    { label: 'planned',    color: 'var(--wrn)',    icon: '📝' },
  blocked:    { label: 'blocked',    color: 'var(--t3)',     icon: '🚧' },
  freeze:     { label: 'freeze',     color: 'var(--inf)',    icon: '❄️' },
  deprecated: { label: 'deprecated', color: 'var(--danger)', icon: '✗' },
};

interface Props {
  tree: TestTree;
  /** Уже отфильтрованные через CatalogFilters + search ноды */
  nodes: TestNode[];
  active: string | null;
  onPick: (n: TestNode) => void;
  /** true → показываем чекбоксы для мульти-выбора */
  selectable?: boolean;
  selected?: Set<string>;
  /** id-шники, которые включены автоматически (например setup из-за зависимости) */
  autoSelected?: Set<string>;
  onToggle?: (id: string) => void;
}

const SETUP_PROJECTS = new Set(['setup', 'teardown']);

export function FlatTestList({
  tree, nodes, active, onPick,
  selectable = false,
  selected = new Set(),
  autoSelected = new Set(),
  onToggle,
}: Props) {
  const { setups, regulars } = useMemo(() => {
    const sortKey = (n: TestNode): string => `${n.project}\0${n.file}\0${String(n.line).padStart(6, '0')}`;
    const sorted = [...nodes].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return {
      setups:   sorted.filter((n) =>  SETUP_PROJECTS.has(n.project)),
      regulars: sorted.filter((n) => !SETUP_PROJECTS.has(n.project)),
    };
  }, [nodes]);

  const renderCard = (n: TestNode, isSetup: boolean): React.ReactNode => {
    const checked = selected.has(n.id);
    const auto = autoSelected.has(n.id);
    const showChecked = checked || auto;
    return (
      <div
        key={n.id}
        className={[
          'tcard',
          n.id === active ? 'on' : '',
          isSetup ? 'tcard-setup' : '',
          showChecked && selectable ? 'tcard-checked' : '',
          auto ? 'tcard-auto' : '',
        ].join(' ')}
        onClick={(e) => {
          // ignore clicks on the checkbox itself
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          onPick(n);
        }}
        role="button"
        tabIndex={0}
      >
        <div className="tcard-row1">
          {selectable && (
            <input
              type="checkbox"
              className="tcard-cb"
              checked={showChecked}
              disabled={auto && !checked}
              onChange={() => onToggle?.(n.id)}
              onClick={(e) => e.stopPropagation()}
              title={auto && !checked
                ? 'Подключается автоматически — нужен другим выбранным тестам'
                : undefined}
            />
          )}
          {isSetup && <span className="tcard-icon" title="Подготовка">🔐</span>}
          {/* Status chip — слева от заголовка */}
          {!isSetup && (() => {
            const sm = STATUS_PILL[n.allure.status];
            return (
              <span
                className="tcard-status"
                style={{
                  background: `color-mix(in srgb, ${sm.color} 14%, transparent)`,
                  color: sm.color,
                  borderColor: `color-mix(in srgb, ${sm.color} 35%, transparent)`,
                }}
                title={`Статус: ${sm.label}`}
              >{sm.icon}</span>
            );
          })()}
          <span className="tcard-title">{n.testTitle}</span>
          {auto && !checked && <span className="tcard-pin tcard-pin-auto">авто</span>}
          {isSetup && !auto && <span className="tcard-pin">обязательно</span>}
        </div>
        <div className="tcard-row2">
          <span className="tcard-proj">{tree.projectLabels[n.project] ?? n.project}</span>
          {n.allure.testKind && (() => {
            const kb = KIND_BADGE[n.allure.testKind];
            return (
              <>
                <span className="tcard-sep">·</span>
                <span
                  className="tcard-kind"
                  style={{ color: kb.color, borderColor: `color-mix(in srgb, ${kb.color} 40%, transparent)` }}
                  title={`Тип: ${kb.label}`}
                >{kb.icon} {kb.label}</span>
              </>
            );
          })()}
          <span className="tcard-sep">·</span>
          <code className="tcard-path">{n.file}:{n.line}</code>
          {n.allure.modules.length > 0 && (
            <>
              <span className="tcard-sep">·</span>
              <span className="tcard-meta-modules" title="Модули">
                {n.allure.modules.slice(0, 3).join(', ')}
                {n.allure.modules.length > 3 && '…'}
              </span>
            </>
          )}
          {n.history && n.history.recent.length > 0 && (
            <>
              <span className="tcard-sep">·</span>
              <span
                className="spark"
                title={`${n.history.total} прогонов · flaky ${Math.round(n.history.flakyScore * 100)}%`}
              >
                {/* Slice to 5 newest, reverse so newest is on the right */}
                {[...n.history.recent.slice(0, 5)].reverse().map((s, i) => (
                  <span key={i} className={`spark-dot spark-${s}`} title={s} />
                ))}
              </span>
            </>
          )}
        </div>
      </div>
    );
  };

  const totalShown = setups.length + regulars.length;

  return (
    <div className="flat-list">
      {setups.length > 0 && (
        <section className="flat-section flat-section-setup">
          <h3>
            🔐 Подготовка
            <span className="flat-h3-hint">
              — выполняется автоматически перед обычными тестами{selectable ? ', её не нужно отмечать' : ''}
            </span>
          </h3>
          <div className="tcard-grid">
            {setups.map((n) => renderCard(n, true))}
          </div>
        </section>
      )}

      {regulars.length > 0 && (
        <section className="flat-section">
          <h3>
            🧪 Тест-кейсы
            <span className="flat-h3-hint">
              · {regulars.length} {pluralCases(regulars.length)}
              {selectable && selected.size > 0 && (
                <> · выбрано <b style={{ color: 'var(--acc)' }}>{
                  Array.from(selected).filter((id) => regulars.some((r) => r.id === id)).length
                }</b></>
              )}
            </span>
          </h3>
          <div className="tcard-grid">
            {regulars.map((n) => renderCard(n, false))}
          </div>
        </section>
      )}

      {totalShown === 0 && (
        <div className="muted" style={{ padding: 24 }}>
          Ничего не найдено — попробуй сбросить фильтры.
        </div>
      )}
    </div>
  );
}

function pluralCases(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'кейсов';
  const m10 = n % 10;
  if (m10 === 1) return 'кейс';
  if (m10 >= 2 && m10 <= 4) return 'кейса';
  return 'кейсов';
}
