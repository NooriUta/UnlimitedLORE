import { Component, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CapabilityRow, StructuralZero } from '../../utils/muninnData';
import { f1Band, fmtF1 } from '../../utils/muninnData';

/**
 * One bad fact must never white-screen the whole panel: a render error inside
 * a screen collapses to an inline message (the rest of the page stays alive).
 */
export class MuninnErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(err: unknown) {
    return { error: String((err as Error)?.message ?? err) };
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="page-error" style={{ padding: 24 }}>
          <span style={{ fontSize: 'var(--fs-base)', color: 'var(--danger)' }}>render failed</span>
          <span className="error-detail">{this.state.error}</span>
          <button type="button" className="btn btn-sm btn-secondary"
                  onClick={() => this.setState({ error: null })}>
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── small shared pieces for the bench screens ─────────────────────────────────

export type BadgeTone = 'suc' | 'warn' | 'err' | 'info' | 'neutral' | 'violet';

// Owner's register B: refutation is a SCIENTIFIC RESULT, not a failure —
// violet, never red. The theme has no violet token, so it is local to bench.
const VIOLET_BADGE: React.CSSProperties = {
  background: 'color-mix(in srgb, #a78bfa 14%, transparent)',
  color: '#b794f4',
  borderColor: 'color-mix(in srgb, #a78bfa 30%, transparent)',
};

export function StatusBadge({ tone, text, style }: { tone: BadgeTone; text: string; style?: React.CSSProperties }) {
  if (tone === 'violet') {
    return <span className="badge" style={{ ...VIOLET_BADGE, ...style }}>{text}</span>;
  }
  return <span className={`badge badge-${tone}`} style={style}>{text}</span>;
}

/** Substrate chip that links to the substrate profile page (blind-dashboard fix). */
export function SubstrateLink({ id, label }: { id: string; label: string }) {
  return (
    <Link to={`/benchmark/substrate/${encodeURIComponent(id)}`} title={id}
          style={{ color: 'var(--acc)', fontFamily: 'var(--mono)', textDecoration: 'none' }}>
      {label}
    </Link>
  );
}

/** Section header — every screen states WHAT slice it shows (no guessing). */
export function ScreenTitle({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span className="analytics-card-title" style={{ margin: 0 }}>{text}</span>
      {hint && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginLeft: 8 }}>{hint}</span>}
    </div>
  );
}

export function campaignTone(status: string | undefined): 'suc' | 'warn' | 'err' | 'info' | 'neutral' {
  if (status === 'closed') return 'suc';
  if (status === 'running') return 'info';
  if (status === 'planned') return 'warn';
  return 'neutral';
}

export function hypothesisTone(status: string | undefined): BadgeTone {
  if (status === 'confirmed') return 'suc';
  if (status === 'refuted') return 'violet'; // scientific result, not a failure
  if (status === 'registered_bet') return 'warn';
  if (status === 'open') return 'info';
  return 'neutral';
}

export function PanelMsg({ kind, text, onRetry }: {
  kind: 'loading' | 'error' | 'info';
  text: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (kind === 'loading') return <div className="page-loading">{text}</div>;
  return (
    <div className="page-error" style={{ padding: 24 }}>
      <span style={{ fontSize: 'var(--fs-base)', color: kind === 'error' ? 'var(--danger)' : 'var(--t2)' }}>{text}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
          {t('bench.reload', 'Reload')}
        </button>
      )}
    </div>
  );
}

/**
 * Registry footer (owner's general rule): when a registry's entities link to
 * neighbouring objects, the bottom of the screen aggregates those links as
 * chips — "confirmed by…", "originates from…", "linked to…". One row per
 * relation, chips with counts; optional onClick chips deep-link.
 */
export function RegistryFooter({ groups }: {
  groups: Array<{
    label: string;
    chips: Array<{ text: string; tone?: BadgeTone; title?: string }>;
  }>;
}) {
  const visible = groups.filter(g => g.chips.length > 0);
  if (!visible.length) return null;
  return (
    <div data-testid="registry-footer"
         style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
      {visible.map(g => (
        <div key={g.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8,
                                    flexWrap: 'wrap', padding: '3px 0', fontSize: 'var(--fs-sm)' }}>
          <span style={{ color: 'var(--t3)', minWidth: 130 }}>{g.label}</span>
          {g.chips.map((c, i) => (
            <span key={i} className={`badge badge-${c.tone ?? 'neutral'}`} title={c.title}>{c.text}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * RFC-3: the SQL button — every aggregate must be a verifiable statement.
 * Copies the reproducing query (the §1 cell template, generated from the SAME
 * pins that built the number); the tooltip is the aggregate passport.
 */
export function SqlChip({ sql, passport }: { sql: string; passport?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" data-testid="sql-chip"
            title={`${passport ? `${passport}\n\n` : ''}${sql}`}
            onClick={e => {
              e.stopPropagation();
              void navigator.clipboard?.writeText(sql);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', padding: '1px 6px',
                     borderRadius: 5, border: '1px solid var(--bd)', cursor: 'pointer',
                     background: 'transparent', color: copied ? 'var(--suc)' : 'var(--t3)' }}>
      {copied ? '✓' : t('bench.sqlChip', 'SQL')}
    </button>
  );
}

/**
 * Universal registry table controls (owner's rule): every FK/dictionary
 * column gets a filter select AND can be the grouping axis; every column is
 * sortable by clicking its header; text columns keep plain filter+sort.
 * Call BEFORE any early return (it owns React state).
 */
export interface RegCol<T> {
  key: string;
  label: string;
  /** dictionary (fk) column → filter select + groupable */
  fk?: boolean;
  get: (row: T) => string | number | undefined;
}

function cmpVals(a: string | number | undefined, b: string | number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function useRegistryTable<T>(rows: T[], cols: RegCol<T>[]) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [groupBy, setGroupBy] = useState('');

  const fkCols = cols.filter(c => c.fk);
  const filtered = rows.filter(r =>
    fkCols.every(c => !filters[c.key] || String(c.get(r) ?? '—') === filters[c.key]));
  const sortCol = cols.find(c => c.key === sortKey);
  const sorted = sortCol
    ? [...filtered].sort((a, b) => cmpVals(sortCol.get(a), sortCol.get(b)) * sortDir)
    : filtered;
  const groupCol = cols.find(c => c.key === groupBy && c.fk);
  const groups: Array<{ group: string | null; rows: T[] }> = groupCol
    ? (() => {
        const m = new Map<string, T[]>();
        for (const r of sorted) {
          const g = String(groupCol.get(r) ?? '—');
          if (!m.has(g)) m.set(g, []);
          m.get(g)!.push(r);
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
          .map(([group, rs]) => ({ group: `${groupCol.label}: ${group}`, rows: rs }));
      })()
    : [{ group: null, rows: sorted }];

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  };

  const th = (c: RegCol<T>, extra?: React.CSSProperties) => (
    <th key={c.key} onClick={() => toggleSort(c.key)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...extra }}
        title={t('bench.reg.sortHint', 'click to sort')}>
      {c.label}{sortKey === c.key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const controls = (
    <>
      {fkCols.map(c => (
        <Field key={c.key} label={c.label}>
          <MuninnSelect value={filters[c.key] ?? ''}
                       onChange={v => setFilters(f => ({ ...f, [c.key]: v }))}
                       allLabel={t('bench.reg.all', 'all')}
                       options={[...new Set(rows.map(r => String(c.get(r) ?? '—')))].sort()
                         .map(v => ({ value: v, label: v }))} />
        </Field>
      ))}
      <Field label={t('bench.reg.groupBy', 'Group by')}>
        <MuninnSelect value={groupBy} onChange={setGroupBy}
                     allLabel={t('bench.reg.noGroup', 'no grouping')}
                     options={fkCols.map(c => ({ value: c.key, label: c.label }))} />
      </Field>
    </>
  );

  return { groups, controls, th, count: sorted.length };
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
      {label}
      {children}
    </label>
  );
}

const SELECT_STYLE: React.CSSProperties = {
  background: 'var(--bg2)', color: 'var(--t1)', border: '1px solid var(--bd)',
  borderRadius: 6, padding: '5px 8px', fontSize: 'var(--fs-base)', fontFamily: 'var(--mono)', maxWidth: 280,
};

export function MuninnSelect({ value, onChange, options, allLabel }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  /** when set, prepends an empty option with this label (optional filters) */
  allLabel?: string;
}) {
  return (
    <select style={SELECT_STYLE} value={value} onChange={e => onChange(e.target.value)}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/**
 * Structural zeros (capability='none') — design property, never blended into
 * averages; rendered as their own collapsed block under each aggregate table.
 */
export function ZerosBlock({ zeros, subLabel, capabilities }: {
  zeros: StructuralZero[];
  subLabel: (id: string) => string;
  capabilities: CapabilityRow[] | null;
}) {
  const { t } = useTranslation();
  if (zeros.length === 0) return null;

  const rationale = (substrate: string, key: string): string => {
    const hop = key.includes('·') ? key.split('·')[1] : undefined;
    const row = (capabilities ?? []).find(c =>
      c.substrate_id === substrate && (hop === undefined || c.hop_kind_id === hop) && c.capability === 'cap:none');
    return row?.rationale ?? '';
  };

  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
        {t('bench.zerosTitle', 'Structural zeros (capability = none)')} · {zeros.length} —{' '}
        {t('bench.zerosHint', 'Design property, not a failure — never blended into averages')}
      </summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 0' }}>
        {zeros.map(z => (
          <span key={`${z.substrate_id}|${z.key}`} className="scope-tag" title={rationale(z.substrate_id, z.key)}>
            {subLabel(z.substrate_id)} × {z.key} (n={z.n})
          </span>
        ))}
      </div>
    </details>
  );
}

// ── tiny dependency-free SVG charts ───────────────────────────────────────────

export interface ScatterPt {
  x: number;
  f1: number;
  label: string;
}

const BAND_COLOR: Record<string, string> = {
  suc: 'var(--suc)', warn: 'var(--wrn)', err: 'var(--danger)', neutral: 'var(--t3)',
};

export function ScatterSVG({ points, xFmt, title }: {
  points: ScatterPt[];
  xFmt: (x: number) => string;
  title: string;
}) {
  const W = 460, H = 280, PAD = { l: 40, r: 96, t: 18, b: 28 };
  const xMax = Math.max(1, ...points.map(p => p.x));
  const px = (x: number) => PAD.l + (x / xMax) * (W - PAD.l - PAD.r);
  const py = (f1: number) => PAD.t + (1 - Math.min(Math.max(f1, 0), 1)) * (H - PAD.t - PAD.b);

  const LABEL_W = 78, LABEL_H = 11;
  const placed: Array<{ x: number; y: number }> = [];
  const labels = [...points]
    .sort((a, b) => px(a.x) - px(b.x))
    .map(p => {
      const lx = px(p.x) + 7;
      let ly = py(p.f1) + 3;
      while (placed.some(q => Math.abs(q.x - lx) < LABEL_W && Math.abs(q.y - ly) < LABEL_H)) {
        ly += LABEL_H;
      }
      placed.push({ x: lx, y: ly });
      return { p, lx, ly };
    });

  return (
    <svg width={W} height={H} role="img" aria-label={title} style={{ maxWidth: '100%' }}>
      <text x={PAD.l} y={12} fontSize={11} fill="var(--t2)">{title}</text>
      {[0, 0.5, 1].map(v => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={py(v)} y2={py(v)} stroke="var(--bd)" strokeDasharray="3 3" />
          <text x={PAD.l - 6} y={py(v) + 3} fontSize={9} fill="var(--t3)" textAnchor="end">{v.toFixed(1)}</text>
        </g>
      ))}
      {[0.5, 1].map(f => (
        <text key={f} x={px(xMax * f)} y={H - 10} fontSize={9} fill="var(--t3)" textAnchor="middle">
          {xFmt(xMax * f)}
        </text>
      ))}
      {labels.map(({ p, lx, ly }) => (
        <g key={p.label}>
          <circle cx={px(p.x)} cy={py(p.f1)} r={4.5} fill={BAND_COLOR[f1Band(p.f1)]} opacity={0.9}>
            <title>{`${p.label}: F1 ${fmtF1(p.f1)} · ${xFmt(p.x)}`}</title>
          </circle>
          {ly !== py(p.f1) + 3 && (
            <line x1={px(p.x)} y1={py(p.f1)} x2={lx - 2} y2={ly - 3} stroke="var(--bd)" strokeWidth={0.6} />
          )}
          <text x={lx} y={ly} fontSize={9} fill="var(--t2)" fontFamily="var(--mono)">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Horizontal 0..1 strip with one dot per run — replication dispersion. */
export function DotStrip({ points }: { points: Array<{ f1: number; label: string }> }) {
  const W = 320, H = 26, PAD = 10;
  const px = (f1: number) => PAD + Math.min(Math.max(f1, 0), 1) * (W - 2 * PAD);
  const min = Math.min(...points.map(p => p.f1));
  const max = Math.max(...points.map(p => p.f1));
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="var(--bd)" />
      {points.length > 1 && (
        <line x1={px(min)} x2={px(max)} y1={H / 2} y2={H / 2} stroke="var(--t3)" strokeWidth={2} />
      )}
      {points.map(p => (
        <circle key={p.label} cx={px(p.f1)} cy={H / 2} r={5} fill={BAND_COLOR[f1Band(p.f1)]} opacity={0.85}>
          <title>{`${p.label}: ${fmtF1(p.f1)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
