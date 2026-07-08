import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreAnalytics, fetchLoreSlice, type LoreAnalytics, type LoreAnalyticsSprint, type LoreComponent, type LoreSprintDoneDate, type LoreMilestone, type LoreSprintRow, type LoreRelease, type LoreQGViolation, type LoreQGPendingRec, type LoreQGRoutineRun, type LoreTechRow } from '../../api/lore';
import { statusMeta } from './lore-status';
import { areaColor, compArea } from './LoreComponentList';
import { GameIcon } from './GameIcon';
import LoreSkeleton from './LoreSkeleton';
import { parseRoutine, parseInvariants, type ParsedInv } from '../../lib/qgContentMd';
import { isStale as isTechStale, parseFields as parseTechFields } from './LoreTechRegistry';

interface Props {
  onError: (e: unknown) => void;
  onNavigateToSprint?: (id: string) => void;
  onNavigateToComponent?: (id: string) => void;
  onNavigateToQG?: (id: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  done: 'Готово', in_progress: 'В работе', partial: 'Частично',
  ready_for_deploy: 'К деплою', planned: 'Запланировано', todo: 'TODO',
  design: 'Дизайн', backlog: 'Беклог', blocked: 'Заблок.',
  deferred: 'Отложено', cancelled: 'Отменено', none: 'Без статуса',
};
const STATUS_ORDER = [
  'done', 'in_progress', 'partial', 'ready_for_deploy', 'planned',
  'todo', 'design', 'backlog', 'deferred', 'blocked', 'cancelled', 'none',
];

type AnalyticsTab = 'overview' | 'progress' | 'flow' | 'sprints' | 'quality' | 'tech';
type CompGroupBy  = 'area' | 'platform' | 'project';
type SprintFilter = 'all' | 'active' | 'ready' | 'done' | 'empty';

interface QGRow {
  qg_id: string; name: string; description: string | null;
  component_id: string | null; status: string | null;
  last_run_status: string | null;
  date_created: string | null; sprint_id?: string | null;
  content_md: string | null;
}

// One FAIL/WARN invariant surfaced fleet-wide, joined content_md × latest metric.
// Status recomputed client-side via computeStatus (content_md is the authority per
// ADR-QG-004 — ClRoutineMetric.status can drift from the gate's declared condition,
// see QG-ALGORITHMIC-HEALTH loc_per_class 2026-06-30 incident).
interface FleetInvariant {
  qgId: string; qgName: string; routine: string; inv: ParsedInv;
  value: number | null; status: string;
}

const TODAY = new Date();

// Distinct colors for git-project groups.
const PROJECT_COLORS = ['var(--acc)', 'var(--suc)', 'var(--inf)', 'var(--wrn)', 'var(--dng)', 'var(--t2)'];

// QG severity / priority / run-status helpers (module-level to avoid closure issues).
const SEV_ORDER = ['critical', 'major', 'high', 'medium', 'minor', 'low', 'unknown'];
const sevColor = (s: string): string =>
  s === 'critical' ? 'var(--dng)' : s === 'major' ? 'var(--dng)' : s === 'high' ? 'var(--wrn)' :
  s === 'medium' ? 'var(--inf)' : s === 'minor' ? 'var(--inf)' : s === 'low' ? 'var(--suc)' : 'var(--t3)';
const priColor = (p: string | null): string =>
  p === 'P0' ? 'var(--dng)' : p === 'P1' ? 'var(--wrn)' : p === 'P2' ? 'var(--inf)' : 'var(--t3)';
const runColor = (s: string | null): string =>
  s === 'PASS' ? 'var(--suc)' : s === 'FAIL' ? 'var(--dng)' : s === 'WARN' ? 'var(--wrn)' : 'var(--t3)';

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(nums: number[], q: number): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos), rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Short project name from a git slug like "NooriUta/AIDA" → "AIDA".
function projShort(p: string | null | undefined): string {
  return (p ?? 'unknown').split('/').pop() ?? 'unknown';
}


const TABS: { key: AnalyticsTab; icon: string; label: string }[] = [
  { key: 'overview',   icon: 'pie-chart',     label: 'Обзор'    },
  { key: 'progress',   icon: 'hourglass',     label: 'Прогресс' },
  { key: 'flow',       icon: 'split-arrows',  label: 'Поток'    },
  { key: 'sprints',    icon: 'sprint',        label: 'Спринты'  },
  { key: 'quality',    icon: 'guards',        label: 'Quality'  },
  { key: 'tech',       icon: 'cog',           label: 'Технологии' },
];

const SPRINT_FILTERS: { key: SprintFilter; label: string }[] = [
  { key: 'all',    label: 'Все'           },
  { key: 'active', label: 'В работе'      },
  { key: 'ready',  label: 'К деплою'      },
  { key: 'done',   label: 'Готово'        },
  { key: 'empty',  label: 'Без задач'     },
];

function pct(done: number, total: number) { return total > 0 ? Math.round((100 * done) / total) : 0; }

function classify(s: string | null): string {
  if (!s || !s.trim()) return 'none';
  const u = s.toUpperCase();
  if (/DONE|CLOSED|ЗАВЕРШ|ЗАКРЫТ/.test(u)) return 'done';
  if (/PROGRESS|WIP/.test(u))         return 'in_progress';
  if (/PARTIAL|ЧАСТИЧ/.test(u))       return 'partial';
  if (/READY|ДЕПЛО/.test(u))          return 'ready_for_deploy';
  if (/BLOCK|ЗАБЛОК/.test(u))         return 'blocked';
  if (/CANCEL|ОТМЕН/.test(u))         return 'cancelled';
  if (/PLANNED/.test(u))              return 'planned';
  if (/DESIGN/.test(u))               return 'design';
  if (/BACKLOG/.test(u))              return 'backlog';
  if (/DEFER|ОТЛОЖ/.test(u))          return 'deferred';
  return 'todo';
}

// A sprint only counts as "open" if its status isn't done/cancelled AND its
// tasks aren't all complete. Status text is frequently stale (never flipped
// to a recognized DONE/ЗАКРЫТ string) while every task underneath it is long
// finished — counting those as open makes header KPIs diverge from any
// drilldown that also excludes them, which reads as a bug (a number with
// nothing behind it). Every "open sprint" count in this file must use this
// same definition so header and drilldown numbers can't disagree.
function isGenuinelyOpen(s: LoreAnalyticsSprint): boolean {
  const k = classify(s.status_raw);
  if (k === 'done' || k === 'cancelled') return false;
  return !(s.task_total > 0 && s.task_done >= s.task_total);
}

function filterSprints(list: LoreAnalyticsSprint[], f: SprintFilter) {
  switch (f) {
    case 'active': return list.filter(s => {
      const k = classify(s.status_raw);
      return k !== 'done' && k !== 'cancelled' && k !== 'ready_for_deploy' && s.task_total > 0 && pct(s.task_done, s.task_total) < 100;
    });
    case 'ready': return list.filter(s => classify(s.status_raw) === 'ready_for_deploy');
    case 'done':  return list.filter(s =>
      classify(s.status_raw) === 'done' || (s.task_total > 0 && pct(s.task_done, s.task_total) === 100));
    case 'empty': return list.filter(s => s.task_total === 0);
    default:      return list;
  }
}

// Parse date string from done_date field (may be ISO or "YYYY-MM-DD")
function parseDoneDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const raw = s.split('T')[0].trim().slice(0, 10);
  const d   = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// ISO week key "YYYY-Www"
function isoWeekKey(d: Date): string {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const thu = new Date(tmp);
  thu.setUTCDate(thu.getUTCDate() - (tmp.getUTCDay() + 6) % 7 + 3);
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const w    = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
  return `${thu.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

// ── shared primitives ─────────────────────────────────────────────────────

function StatusBar({ data, total }: { data: Record<string, number>; total: number }) {
  const { t } = useTranslation();
  const keys = STATUS_ORDER.filter(k => data[k]);
  const statusLabel = (k: string) => t(`lore.analytics.status.${k}`, STATUS_LABEL[k] ?? k);
  return (
    <div>
      <div style={S.segBar}>
        {keys.map(k => (
          <div key={k} title={`${statusLabel(k)}: ${data[k]}`}
            style={{ width: `${(100 * data[k]) / total}%`, background: statusMeta(k).color, height: '100%' }} />
        ))}
      </div>
      <div style={S.legend}>
        {keys.map(k => (
          <span key={k} style={S.legendItem}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: statusMeta(k).color, flexShrink: 0 }} />
            {statusLabel(k)} <b style={{ color: 'var(--t1)' }}>{data[k]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniBar({ done, total, color, wide }: { done: number; total: number; color: string; wide?: boolean }) {
  return (
    <div style={{ ...S.progressWrap, ...(wide ? { width: '100%' } : {}) }}
      title={`${done}/${total} (${pct(done, total)}%)`}>
      <div style={{ ...S.progressFill, width: `${pct(done, total)}%`, background: color }} />
    </div>
  );
}

function Kpi({ icon, label, value, sub, color, highlight, hint }: {
  icon: string; label: string; value: string | number; sub: string; color: string; highlight?: boolean; hint?: string;
}) {
  return (
    <div title={hint} style={{ ...S.card, cursor: hint ? 'help' : 'default', ...(highlight ? { background: `color-mix(in srgb, ${color} 8%, var(--b2))`, borderColor: `color-mix(in srgb, ${color} 30%, transparent)` } : {}) }}>
      <div style={{ ...S.cardIcon, color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
        <GameIcon slug={icon} size={18} style={{ color: 'inherit' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, minWidth: 0 }}>
        <span style={{ ...S.cardValue, ...(highlight ? { color } : {}) }}>{value}</span>
        <span style={{ ...S.cardLabel, display: 'flex', alignItems: 'center', gap: 3 }}>
          {label}{hint && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span>}
        </span>
        {sub && <span style={S.cardSub}>{sub}</span>}
      </div>
    </div>
  );
}


function SprintRowItem({ s, onNavigate }: { s: LoreAnalyticsSprint; onNavigate?: (id: string) => void }) {
  const k = classify(s.status_raw);
  return (
    <div style={S.trow} onClick={() => onNavigate?.(s.sprint_id)} role={onNavigate ? 'button' : undefined}>
      <GameIcon slug={statusMeta(k).icon} size={12} style={{ color: statusMeta(k).color, flexShrink: 0 }} />
      <span style={S.sprintId}>{s.sprint_id}</span>
      <MiniBar done={s.task_done} total={s.task_total} color={statusMeta(k).color} />
      <span style={S.count}>{s.task_done}/{s.task_total}</span>
      <span style={S.pctNum}>{pct(s.task_done, s.task_total)}%</span>
    </div>
  );
}

// ── Velocity chart (SVG) ──────────────────────────────────────────────────

type VelocityWeek = { key: string; label: string; count: number; isCurrent: boolean };
type VelocityStack = { label: string; color: string; counts: Record<string, number> }; // per-week counts

function VelocityChart({ weeks, stacks }: { weeks: VelocityWeek[]; stacks?: VelocityStack[] }) {
  const maxVal = Math.max(...weeks.map(w => w.count), 1);
  const W = 600, H = 90, pad = 4;
  const barW = Math.floor((W - pad * (weeks.length + 1)) / weeks.length);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 24}`} style={{ display: 'block', overflow: 'visible' }}
      role="img" aria-label={`График скорости по неделям: ${weeks.length} нед., пик ${maxVal} за неделю`}>
      {weeks.map((w, i) => {
        const x = pad + i * (barW + pad);
        const totalH = Math.max(2, Math.round((w.count / maxVal) * H));
        const baseCol = w.isCurrent ? 'var(--acc)' : 'color-mix(in srgb,var(--acc) 30%,var(--b3))';

        if (!stacks || stacks.length === 0) {
          const y = H - totalH;
          return (
            <g key={w.key}>
              <rect x={x} y={y} width={barW} height={totalH} fill={baseCol} rx={2} />
              {w.count > 0 && <text x={x + barW / 2} y={Math.max(y - 3, 10)} textAnchor="middle" fontSize={8} fill="var(--t2)">{w.count}</text>}
              <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={7} fill={w.isCurrent ? 'var(--acc)' : 'var(--t3)'}>{w.label}</text>
            </g>
          );
        }

        // stacked rendering
        let yOffset = H;
        const segments = stacks.map(s => {
          const cnt = s.counts[w.key] ?? 0;
          const segH = cnt > 0 ? Math.max(1, Math.round((cnt / maxVal) * H)) : 0;
          yOffset -= segH;
          return { color: s.color, segH, y: yOffset };
        }).filter(s => s.segH > 0);

        const topY = segments.length ? segments[segments.length - 1].y : H - totalH;
        return (
          <g key={w.key}>
            {segments.map((seg, si) => (
              <rect key={si} x={x} y={seg.y} width={barW} height={seg.segH} fill={seg.color}
                rx={si === segments.length - 1 ? 2 : 0} />
            ))}
            {w.count > 0 && <text x={x + barW / 2} y={Math.max(topY - 3, 10)} textAnchor="middle" fontSize={8} fill="var(--t2)">{w.count}</text>}
            <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={7} fill={w.isCurrent ? 'var(--acc)' : 'var(--t3)'}>{w.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Cumulative sparkline (SVG) ────────────────────────────────────────────

function CumulativeChart({ points }: { points: { dateMs: number; total: number }[] }) {
  if (points.length < 2) return null;
  const W = 600, H = 60;
  const minMs = points[0].dateMs, maxMs = points[points.length - 1].dateMs;
  const maxTotal = points[points.length - 1].total;
  const rangeMs  = maxMs - minMs || 1;

  const toX = (ms: number) => Math.round(((ms - minMs) / rangeMs) * W);
  const toY = (t: number)  => Math.round(H - (t / maxTotal) * H);

  const pts = points.map(p => `${toX(p.dateMs)},${toY(p.total)}`).join(' ');
  const areaPath = `M0,${H} L${pts.split(' ').join(' L')} L${W},${H} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 4}`} style={{ display: 'block' }}
      role="img" aria-label={`Кумулятивный график завершения: ${points.length} точек, итог ${maxTotal}`}>
      <defs>
        <linearGradient id="cumGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--suc)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--suc)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#cumGrad)" />
      <polyline points={pts} fill="none" stroke="var(--suc)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle cx={toX(maxMs)} cy={toY(maxTotal)} r={3} fill="var(--suc)" />
    </svg>
  );
}

// ── Burnup chart — scope vs done (SVG) ────────────────────────────────────

function BurnupChart({ points }: { points: { ms: number; scope: number; done: number }[] }) {
  if (points.length < 2) return null;
  const W = 600, H = 120;
  const minMs = points[0].ms, maxMs = points[points.length - 1].ms;
  const rangeMs = maxMs - minMs || 1;
  const maxY = Math.max(...points.map(p => p.scope), 1);
  const toX = (ms: number) => ((ms - minMs) / rangeMs) * W;
  const toY = (v: number)  => H - (v / maxY) * H;

  const line = (key: 'scope' | 'done') =>
    points.map(p => `${toX(p.ms).toFixed(1)},${toY(p[key]).toFixed(1)}`).join(' ');
  const gap = points[points.length - 1].scope - points[points.length - 1].done;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 4}`} style={{ display: 'block' }}
      role="img" aria-label={`Burnup график объём/выполнено: объём ${maxY}, остаток ${gap}`}>
      <defs>
        <linearGradient id="scopeGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={`M0,${H} L${line('scope').split(' ').join(' L')} L${W},${H} Z`} fill="url(#scopeGrad)" />
      <polyline points={line('scope')} fill="none" stroke="var(--acc)" strokeWidth="1.5" strokeLinejoin="round" />
      <polyline points={line('done')}  fill="none" stroke="var(--suc)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* gap bracket at the end */}
      <line x1={W - 1} y1={toY(points[points.length - 1].scope)} x2={W - 1} y2={toY(points[points.length - 1].done)}
        stroke="var(--wrn)" strokeWidth="2" />
      <text x={W - 6} y={(toY(points[points.length - 1].scope) + toY(points[points.length - 1].done)) / 2}
        textAnchor="end" fontSize={9} fill="var(--wrn)" dominantBaseline="middle">{gap}</text>
    </svg>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function LoreAnalyticsView({ onError, onNavigateToSprint, onNavigateToComponent, onNavigateToQG }: Props) {
  const { t } = useTranslation();
  const [data,       setData]       = useState<LoreAnalytics | null>(null);
  const [components, setComponents] = useState<LoreComponent[]>([]);
  const [doneDates,  setDoneDates]  = useState<LoreSprintDoneDate[]>([]);
  const [milestoneList, setMilestoneList] = useState<LoreMilestone[]>([]);
  const [sprintRows, setSprintRows] = useState<LoreSprintRow[]>([]);
  const [releases,   setReleases]   = useState<LoreRelease[]>([]);
  const [qgRows,     setQgRows]     = useState<QGRow[]>([]);
  const [qgViolations, setQgViolations] = useState<LoreQGViolation[]>([]);
  const [qgPendingRecs, setQgPendingRecs] = useState<LoreQGPendingRec[]>([]);
  const [qgRoutineRuns, setQgRoutineRuns] = useState<LoreQGRoutineRun[]>([]);
  type QGMetricRow = { routine_name: string; run_date: string | null; metric_key: string; value: number | null; unit: string | null; target: number | null; status: string | null };
  const [qgMetricsLatest, setQgMetricsLatest] = useState<QGMetricRow[]>([]);
  const [sprintStarts, setSprintStarts] = useState<{ sprint_id: string; valid_from: string | null }[]>([]);
  const [blockedRows, setBlockedRows] = useState<{ sprint_id: string }[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<AnalyticsTab>('overview');
  const [groupBy,    setGroupBy]    = useState<CompGroupBy>('area');
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>('active');
  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [chartProj,       setChartProj]       = useState<string>('all');
  const [chartMilestone,  setChartMilestone]  = useState<string>('all');
  const [chartComp,       setChartComp]       = useState<string>('all');
  const [taskDone,   setTaskDone]   = useState<{ task_id: string; valid_from: string | null; states: number | number[] | null; effort_days: number | number[] | null }[]>([]);
  const [taskStarts, setTaskStarts] = useState<{ task_id: string; valid_from: string | null }[]>([]);
  const [techRows,   setTechRows]   = useState<LoreTechRow[]>([]);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreAnalytics(ctrl.signal),
      fetchLoreSlice<LoreComponent>('components', undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintDoneDate>('sprint_done_dates', undefined, ctrl.signal),
      fetchLoreSlice<LoreMilestone>('milestones', undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintRow>('sprints', undefined, ctrl.signal),
      fetchLoreSlice<LoreRelease>('releases', undefined, ctrl.signal),
      fetchLoreSlice<QGRow>('quality_gates', undefined, ctrl.signal),
      fetchLoreSlice<{ sprint_id: string; valid_from: string | null }>('sprint_starts', undefined, ctrl.signal),
      fetchLoreSlice<{ sprint_id: string }>('blocked_sprints', undefined, ctrl.signal),
      fetchLoreSlice<LoreQGViolation>('qg_violations', undefined, ctrl.signal),
      fetchLoreSlice<LoreQGPendingRec>('qg_pending_recs', undefined, ctrl.signal),
      fetchLoreSlice<LoreQGRoutineRun>('qg_routine_runs', undefined, ctrl.signal),
      fetchLoreSlice<{ task_id: string; valid_from: string | null; states: number | number[] | null; effort_days: number | number[] | null }>('task_done_dates', undefined, ctrl.signal),
      fetchLoreSlice<{ task_id: string; valid_from: string | null }>('task_starts', undefined, ctrl.signal),
      fetchLoreSlice<QGMetricRow>('qg_metrics_latest', undefined, ctrl.signal),
      fetchLoreSlice<LoreTechRow>('tech_registry', undefined, ctrl.signal),
    ])
      .then(([d, comps, dones, ms, sp, rel, qg, starts, blocked, viols, recs, runs, tdone, tstarts, qgmet, tech]) => {
        setData(d); setComponents(comps); setDoneDates(dones); setMilestoneList(ms);
        setSprintRows(sp); setReleases(rel); setQgRows(qg); setSprintStarts(starts); setBlockedRows(blocked);
        setQgViolations(viols); setQgPendingRecs(recs); setQgRoutineRuns(runs); setTaskDone(tdone); setTaskStarts(tstarts);
        setQgMetricsLatest(qgmet); setTechRows(tech);
        setLoading(false);
      })
      .catch(e => { if (!ctrl.signal.aborted) { onError(e); setLoading(false); } });
    return () => ctrl.abort();
  }, [onError]);

  // ── derived ───────────────────────────────────────────────────────────────

  const openSprintCount = useMemo(() =>
    data?.by_sprint.filter(isGenuinelyOpen).length ?? 0,
  [data]);

  // open sprints belonging to the current milestone — used for forecast.
  // Only falls back to the system-wide openSprintCount when there's no
  // resolvable current milestone at all (data not loaded yet). A resolved
  // milestone with genuinely zero sprints (direct_sprint_ids, TARGETS_MILESTONE
  // edge) must flow through to 0 — substituting the global count there was a
  // leftover idiom (used to guard against an empty derived list meaning "not
  // loaded"), but empty just as often means "really zero" — that's what caused
  // this header to show a stale "3" while the drilldown below it correctly
  // showed 0. Must use isGenuinelyOpen (not raw classify) or it diverges again
  // whenever a sprint's status text lags behind its actually-completed tasks.
  const milestoneOpenCount = useMemo(() => {
    if (!data || !milestoneList.length) return openSprintCount;
    // find current milestone (first non-done)
    const cur = milestoneList.find(m => !(m.goal_md?.includes('✅') ?? false));
    if (!cur) return openSprintCount;
    const ids = new Set(cur.direct_sprint_ids ?? []);
    return data.by_sprint.filter(s => isGenuinelyOpen(s) && ids.has(s.sprint_id)).length;
  }, [data, milestoneList, openSprintCount]);

  // Velocity by ISO week (last 12 weeks)
  const velocityWeeks = useMemo(() => {
    const todayKey = isoWeekKey(new Date());
    const map = new Map<string, number>();
    doneDates.forEach(d => {
      const dt = parseDoneDate(d.done_date);
      if (!dt) return;
      const key = isoWeekKey(dt);
      map.set(key, (map.get(key) || 0) + 1);
    });
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-13);
    return sorted.map(([key, count]) => ({
      key,
      label: `W${key.split('-W')[1]}`,
      count,
      isCurrent: key === todayKey,
    }));
  }, [doneDates]);

  // Velocity trend: avg last 4 vs prev 4 weeks
  const velocityTrend = useMemo(() => {
    const weeks = velocityWeeks;
    if (weeks.length < 8) return null;
    const last4 = weeks.slice(-4).reduce((s, w) => s + w.count, 0) / 4;
    const prev4 = weeks.slice(-8, -4).reduce((s, w) => s + w.count, 0) / 4;
    return prev4 > 0 ? Math.round(((last4 - prev4) / prev4) * 100) : null;
  }, [velocityWeeks]);

  // Projects present in sprint data (for the burnup/cumulative project filter).
  const chartProjects = useMemo(() => {
    const m = new Map<string, number>();
    sprintRows.forEach(s => { const p = projShort(s.git_projects?.[0]); m.set(p, (m.get(p) ?? 0) + 1); });
    return [...m.entries()].filter(([p]) => p !== 'unknown').sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [sprintRows]);

  // Milestones list for filter (label → sprint_id set)
  const chartMilestones = useMemo(() =>
    milestoneList.map(m => ({
      id: m.milestone_id,
      label: m.label,
      ids: new Set(m.direct_sprint_ids ?? []),
    })),
  [milestoneList]);

  // Top components for filter chips (by sprint count, max 10)
  const chartComps = useMemo(() => {
    const m = new Map<string, number>();
    sprintRows.forEach(s => (s.components ?? []).forEach(c => m.set(c, (m.get(c) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
  }, [sprintRows]);

  // Sprint id set for selected milestone
  const chartMilestoneIds = useMemo(() => {
    if (chartMilestone === 'all') return null;
    return chartMilestones.find(m => m.id === chartMilestone)?.ids ?? null;
  }, [chartMilestone, chartMilestones]);

  // Sprints filtered by project + milestone + component.
  const chartSprints = useMemo(() => sprintRows.filter(s => {
    if (chartProj !== 'all' && projShort(s.git_projects?.[0]) !== chartProj) return false;
    if (chartMilestoneIds !== null && !chartMilestoneIds.has(s.sprint_id)) return false;
    if (chartComp !== 'all' && !(s.components ?? []).includes(chartComp)) return false;
    return true;
  }), [sprintRows, chartProj, chartMilestoneIds, chartComp]);

  // Filtered doneDates (for velocity chart respecting all filters)
  const chartDoneDates = useMemo(() => {
    if (chartProj === 'all' && chartMilestoneIds === null && chartComp === 'all') return doneDates;
    const ids = new Set(chartSprints.map(s => s.sprint_id));
    return doneDates.filter(d => ids.has(d.sprint_id));
  }, [doneDates, chartSprints, chartProj, chartMilestoneIds, chartComp]);

  // Velocity weeks for the filtered set
  const chartVelocityWeeks = useMemo(() => {
    const todayKey = isoWeekKey(new Date());
    const map = new Map<string, number>();
    chartDoneDates.forEach(d => {
      const dt = parseDoneDate(d.done_date);
      if (!dt) return;
      const key = isoWeekKey(dt);
      map.set(key, (map.get(key) || 0) + 1);
    });
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-13);
    return sorted.map(([key, count]) => ({
      key, label: `W${key.split('-W')[1]}`, count, isCurrent: key === todayKey,
    }));
  }, [chartDoneDates]);

  // Velocity stacks by project for the stacked bar chart
  const chartVelocityStacks = useMemo((): VelocityStack[] => {
    // sprint_id → project
    const sprintProj = new Map<string, string>();
    chartSprints.forEach(s => sprintProj.set(s.sprint_id, projShort(s.git_projects?.[0])));
    // collect unique projects in order of frequency
    const projCount = new Map<string, number>();
    chartDoneDates.forEach(d => {
      const p = sprintProj.get(d.sprint_id) ?? 'other';
      projCount.set(p, (projCount.get(p) ?? 0) + 1);
    });
    const projs = [...projCount.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    return projs.map((proj, idx) => {
      const counts: Record<string, number> = {};
      chartDoneDates.forEach(d => {
        const p = sprintProj.get(d.sprint_id) ?? 'other';
        if (p !== proj) return;
        const dt = parseDoneDate(d.done_date);
        if (!dt) return;
        const key = isoWeekKey(dt);
        counts[key] = (counts[key] ?? 0) + 1;
      });
      return { label: proj, color: PROJECT_COLORS[idx % PROJECT_COLORS.length], counts };
    });
  }, [chartSprints, chartDoneDates]);

  // Cumulative chart points — done sprints over time (respects project filter).
  const cumulativePoints = useMemo(() => {
    const sorted = chartSprints
      .map(s => parseDoneDate(s.done_date))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    return sorted.map((d, i) => ({ dateMs: d.getTime(), total: i + 1 }));
  }, [chartSprints]);

  // Sprints flagged as never shipping a versioned release (docs/research/tooling)
  // — excluded from unreleased-burn/deploy-lag so they don't read as perpetually overdue.
  const noReleaseSprintIds = useMemo(() =>
    new Set(sprintRows.filter(s => s.no_release_required).map(s => s.sprint_id)),
  [sprintRows]);

  // Unreleased: sprints done after M2 (Jun 3)
  const M2_DATE = '2026-06-03';
  const sinceM2Count = useMemo(() =>
    doneDates.filter(d => (d.done_date ?? '').slice(0, 10) >= M2_DATE && !noReleaseSprintIds.has(d.sprint_id)).length,
  [doneDates, noReleaseSprintIds]);

  // Milestone classification
  const milestoneStatuses = useMemo(() => {
    let foundCurrent = false;
    return milestoneList.map(m => {
      const isDone = m.goal_md?.includes('✅') ?? false;
      if (isDone) return { ...m, status: 'done' as const };
      if (!foundCurrent) { foundCurrent = true; return { ...m, status: 'current' as const }; }
      return { ...m, status: 'future' as const };
    });
  }, [milestoneList]);

  const currentMilestone = milestoneStatuses.find(m => m.status === 'current');

  // Days until current milestone (parse date_display heuristically)
  const daysUntilCurrent = useMemo(() => {
    if (!currentMilestone) return null;
    // "6 июл" → try to map to a date
    const RU_MONTHS: Record<string, number> = {
      'янв': 0, 'фев': 1, 'мар': 2, 'апр': 3, 'май': 4, 'мая': 4, 'июн': 5,
      'июл': 6, 'авг': 7, 'сен': 8, 'окт': 9, 'ноя': 10, 'дек': 11,
    };
    const m = (currentMilestone.date_display ?? '').match(/(\d+)\s+(\S+)/);
    if (!m) return null;
    const month = RU_MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    const target = new Date(2026, month, parseInt(m[1]));
    return Math.round((target.getTime() - TODAY.getTime()) / 86400000);
  }, [currentMilestone]);

  // ── Plan health / forecast (must run before early returns — hooks order) ────
  const avgVelocity = useMemo(() =>
    velocityWeeks.length ? velocityWeeks.reduce((s, w) => s + w.count, 0) / velocityWeeks.length : 0,
  [velocityWeeks]);

  // Velocity stability — coefficient of variation (σ / mean), lower = steadier
  const velocityCV = useMemo(() => {
    if (velocityWeeks.length < 2 || avgVelocity === 0) return null;
    const variance = velocityWeeks.reduce((s, w) => s + (w.count - avgVelocity) ** 2, 0) / velocityWeeks.length;
    return Math.sqrt(variance) / avgVelocity;
  }, [velocityWeeks, avgVelocity]);

  // Weeks needed to burn down open sprints at current pace
  // weeksToFinish uses milestone-scoped open count, not all-system open count
  const weeksToFinish = avgVelocity > 0 ? milestoneOpenCount / avgVelocity : null;

  // On-track: can we finish open work before the current milestone date?
  const onTrack = useMemo(() => {
    if (weeksToFinish === null || daysUntilCurrent === null) return null;
    const daysNeeded = Math.ceil(weeksToFinish * 7);
    return { daysNeeded, slack: daysUntilCurrent - daysNeeded, ok: daysNeeded <= daysUntilCurrent };
  }, [weeksToFinish, daysUntilCurrent]);

  // Coverage — % of components that actually have sprints
  const coverage = useMemo(() => {
    if (!data) return null;
    return { withSprints: data.by_component.length, total: data.totals.components };
  }, [data]);

  // Pareto — top components by task share (concentration / hot-spots)
  const pareto = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.by_component].sort((a, b) => b.task_total - a.task_total);
    const grand = sorted.reduce((s, c) => s + c.task_total, 0) || 1;
    let cum = 0;
    return sorted.slice(0, 8).map(c => {
      cum += c.task_total;
      return { ...c, share: c.task_total / grand, cumShare: cum / grand };
    });
  }, [data]);

  // ── Flow metrics (sprints/releases slices) ──────────────────────────────────

  const doneStatus = (s: LoreSprintRow) => classify(s.status_raw) === 'done' || !!s.done_date;

  // LoreSprintRow (sprintRows) carries no task_total/task_done of its own —
  // cross-reference the analytics slice's by_sprint (LoreAnalyticsSprint) so
  // agingWIP can apply the same "all tasks done" exclusion as isGenuinelyOpen,
  // instead of only checking status text like doneStatus does.
  const taskTotalsBySprintId = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    (data?.by_sprint ?? []).forEach(s => m.set(s.sprint_id, { total: s.task_total, done: s.task_done }));
    return m;
  }, [data]);

  // Real sprint start = earliest HAS_STATE valid_from (from sprint_starts slice).
  const startBySprint = useMemo(() => {
    const m = new Map<string, Date>();
    sprintStarts.forEach(r => {
      const d = parseDoneDate(r.valid_from);
      if (!d) return;
      const cur = m.get(r.sprint_id);
      if (!cur || d < cur) m.set(r.sprint_id, d);
    });
    return m;
  }, [sprintStarts]);

  // Lead/cycle time — days from real start (min valid_from) to done_date.
  const leadTime = useMemo(() => {
    const durations: number[] = [];
    sprintRows.forEach(s => {
      const start = startBySprint.get(s.sprint_id) ?? parseDoneDate(s.valid_from);
      const done  = parseDoneDate(s.done_date);
      if (start && done && done >= start) durations.push(daysBetween(start, done));
    });
    if (!durations.length) return null;
    // histogram buckets: 0-3, 4-7, 8-14, 15-30, 30+
    const buckets = [
      { label: t('lore.analytics.flow.leadTime.bucket0to3', '0–3д'),  lo: 0,  hi: 3,   n: 0 },
      { label: t('lore.analytics.flow.leadTime.bucket4to7', '4–7д'),  lo: 4,  hi: 7,   n: 0 },
      { label: t('lore.analytics.flow.leadTime.bucket8to14', '8–14д'), lo: 8,  hi: 14,  n: 0 },
      { label: t('lore.analytics.flow.leadTime.bucket15to30', '15–30д'),lo: 15, hi: 30,  n: 0 },
      { label: t('lore.analytics.flow.leadTime.bucket30plus', '30д+'),  lo: 31, hi: 1e9, n: 0 },
    ];
    durations.forEach(d => { const b = buckets.find(b => d >= b.lo && d <= b.hi); if (b) b.n++; });
    return {
      count: durations.length,
      med: median(durations),
      p25: Math.round(quantile(durations, 0.25)),
      p75: Math.round(quantile(durations, 0.75)),
      max: Math.max(...durations),
      buckets,
    };
  }, [sprintRows, startBySprint]);

  // Aging WIP — open sprints sorted by age (today − real start)
  const agingWIP = useMemo(() => {
    return sprintRows
      .filter(s => {
        if (doneStatus(s) || classify(s.status_raw) === 'cancelled') return false;
        const t = taskTotalsBySprintId.get(s.sprint_id);
        return !(t && t.total > 0 && t.done >= t.total);
      })
      .map(s => {
        const start = startBySprint.get(s.sprint_id) ?? parseDoneDate(s.valid_from);
        return { ...s, age: start ? daysBetween(start, TODAY) : null };
      })
      .filter(s => s.age !== null)
      .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  }, [sprintRows, startBySprint, taskTotalsBySprintId]);

  // Burnup — cumulative scope (sprints created by valid_from) vs done (by done_date).
  // Respects the project filter so each project's scope-creep is visible separately.
  const burnup = useMemo(() => {
    const created = chartSprints.map(s => parseDoneDate(s.valid_from)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
    const done    = chartSprints.map(s => parseDoneDate(s.done_date)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
    if (created.length < 2) return null;
    // weekly buckets across span
    const startMs = created[0].getTime(), endMs = TODAY.getTime();
    const weekMs = 604800000;
    const points: { ms: number; scope: number; done: number }[] = [];
    for (let t = startMs; t <= endMs + weekMs; t += weekMs) {
      const scope = created.filter(d => d.getTime() <= t).length;
      const dn    = done.filter(d => d.getTime() <= t).length;
      points.push({ ms: Math.min(t, endMs), scope, done: dn });
    }
    return { points, totalScope: created.length, totalDone: done.length };
  }, [chartSprints]);

  // Release cadence — gaps (days) between consecutive releases, PER PROJECT
  // (pooling all projects is meaningless — they release on overlapping days).
  const releaseCadence = useMemo(() => {
    const norm = (p: string | null | undefined) => (p ?? 'unknown').split('/').pop() ?? 'unknown';
    const byProj = new Map<string, (LoreRelease & { d: Date })[]>();
    releases.forEach(r => {
      const d = parseDoneDate(r.release_date);
      if (!d) return;
      const k = norm(r.git_project);
      if (!byProj.has(k)) byProj.set(k, []);
      byProj.get(k)!.push({ ...r, d });
    });
    // Compare version strings numerically (v1.6.20 > v1.6.19), tolerant of prefixes.
    const verTuple = (v: string | null | undefined) =>
      (v ?? '').replace(/^[^\d]*/, '').split(/[.\-_]/).map(n => parseInt(n) || 0);
    const verCmp = (a: string | null | undefined, b: string | null | undefined) => {
      const ta = verTuple(a), tb = verTuple(b);
      for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
        if ((ta[i] ?? 0) !== (tb[i] ?? 0)) return (ta[i] ?? 0) - (tb[i] ?? 0);
      }
      return 0;
    };
    const projects = [...byProj.entries()].map(([proj, list]) => {
      // Sort by date, tie-break by version number so same-day releases order correctly.
      const dated = list.sort((a, b) => a.d.getTime() - b.d.getTime() || verCmp(a.version, b.version));
      const gaps: number[] = [];
      for (let i = 1; i < dated.length; i++) gaps.push(daysBetween(dated[i - 1].d, dated[i].d));
      // "Last" = the is_current release if flagged, else the newest by date+version.
      const last = dated.find(r => r.is_current) ?? dated[dated.length - 1];
      // Comparable cadence = releases in the last 30 days, normalised to per-week.
      // (Extrapolating tiny spans like "5 releases in 1 day" → 35/wk is misleading.)
      const cutoff = TODAY.getTime() - 30 * 86400000;
      const recent30 = dated.filter(r => r.d.getTime() >= cutoff).length;
      const perWeek = +(recent30 / (30 / 7)).toFixed(1);
      return {
        proj,
        count: dated.length,
        recent30,
        med: gaps.length ? median(gaps) : null,
        avg: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
        perWeek,
        daysSinceLast: daysBetween(last.d, TODAY),
        lastVersion: last.version ?? last.release_id,
        lastDate: last.release_date,
      };
    }).sort((a, b) => b.perWeek - a.perWeek);
    return projects.length ? projects : null;
  }, [releases]);

  // Deploy lag — days from sprint done_date to first release_date
  const deployLag = useMemo(() => {
    const lags: number[] = [];
    sprintRows.forEach(s => {
      const done = parseDoneDate(s.done_date);
      if (!done || !s.release_dates?.length) return;
      const relDates = s.release_dates.map(parseDoneDate).filter((d): d is Date => !!d && d >= done);
      if (relDates.length) lags.push(daysBetween(done, new Date(Math.min(...relDates.map(d => d.getTime())))));
    });
    // done but not yet released — excludes sprints flagged no_release_required
    // (docs/research/tooling that never ships a versioned release; otherwise
    // they'd sit in this count forever as a false "overdue" signal).
    const unreleased = sprintRows.filter(s =>
      parseDoneDate(s.done_date) && !s.release_dates?.length && !s.no_release_required).length;
    if (!lags.length) return { med: null, p75: null, unreleased, count: 0 };
    return { med: median(lags), p75: Math.round(quantile(lags, 0.75)), unreleased, count: lags.length };
  }, [sprintRows]);

  // Blocked rate — sprints that EVER passed through a BLOCKED state (history).
  const blockedStats = useMemo(() => {
    const everBlocked = new Set(blockedRows.map(b => b.sprint_id).filter(Boolean));
    const total = sprintRows.length || data?.totals.sprints || 0;
    const nowBlocked = sprintRows.filter(s => classify(s.status_raw) === 'blocked').length;
    return { ever: everBlocked.size, total, nowBlocked, ids: [...everBlocked] };
  }, [blockedRows, sprintRows, data]);

  // Task throughput by ISO week — real closures only:
  // valid_from >= LORE go-live (12 июн; раньше = массовый импорт) AND states>1
  // (>1 hist state = реальная прогрессия, а не «рождена done»/архивный дамп).
  const TASK_THROUGHPUT_CUTOFF = '2026-06-12';
  const taskThroughput = useMemo(() => {
    const map = new Map<string, number>();
    let counted = 0;
    taskDone.forEach(t => {
      const st = Array.isArray(t.states) ? t.states[0] : t.states;
      const raw = String(t.valid_from ?? '');
      if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return;        // skip epoch/garbage
      const day = raw.slice(0, 10);
      if (day < TASK_THROUGHPUT_CUTOFF) return;            // skip import era
      if (!st || st <= 1) return;                          // skip archived "born done"
      const wk = isoWeekKey(new Date(day));
      map.set(wk, (map.get(wk) ?? 0) + 1); counted++;
    });
    const weeks = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
      .map(([key, count]) => ({ key, label: `W${key.split('-W')[1]}`, count }));
    const avg = weeks.length ? Math.round(counted / weeks.length) : 0;
    return { weeks, counted, avg };
  }, [taskDone]);

  // Effort accuracy — план (effort_days) vs факт (календарная длительность created→done).
  // «Потраченное» = календарь (прокси, не чистые трудозатраты). Только реальные закрытия.
  const effortAccuracy = useMemo(() => {
    const created = new Map<string, string>();
    taskStarts.forEach(r => {
      const raw = String(r.valid_from ?? ''); if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return;
      const d = raw.slice(0, 10); const cur = created.get(r.task_id);
      if (!cur || d < cur) created.set(r.task_id, d);
    });
    let plan = 0, act = 0, n = 0, under = 0, on = 0, over = 0;
    taskDone.forEach(t => {
      const st = Array.isArray(t.states) ? t.states[0] : t.states;
      const ef = Array.isArray(t.effort_days) ? t.effort_days[0] : t.effort_days;
      const raw = String(t.valid_from ?? ''); if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return;
      const done = raw.slice(0, 10);
      if (done < TASK_THROUGHPUT_CUTOFF || !(st && st > 1) || !ef || ef <= 0) return;
      const cr = created.get(t.task_id); if (!cr) return;
      const dur = Math.max(0, Math.round((new Date(done).getTime() - new Date(cr).getTime()) / 86400000));
      n++; plan += ef; act += dur;
      const r = dur / ef;
      if (r < 0.8) under++; else if (r <= 1.25) on++; else over++;
    });
    return { n, plan, act, ratio: plan ? act / plan : 0, under, on, over };
  }, [taskDone, taskStarts]);

  // QG status breakdown + by component
  const qgStats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    qgRows.forEach(q => { const s = q.status ?? 'unknown'; byStatus[s] = (byStatus[s] || 0) + 1; });
    const compsWithQg = new Set(qgRows.map(q => q.component_id).filter(Boolean)).size;
    return { total: qgRows.length, byStatus, compsWithQg };
  }, [qgRows]);

  // Cross-project balance — releases + sprints grouped by git project
  const crossProject = useMemo(() => {
    const map = new Map<string, { releases: number; sprints: number; doneSprints: number }>();
    const norm = (p: string | null | undefined) => (p ?? 'unknown').split('/').pop() ?? 'unknown';
    releases.forEach(r => {
      const k = norm(r.git_project);
      if (!map.has(k)) map.set(k, { releases: 0, sprints: 0, doneSprints: 0 });
      map.get(k)!.releases++;
    });
    sprintRows.forEach(s => {
      const k = norm(s.git_projects?.[0]);
      if (!map.has(k)) map.set(k, { releases: 0, sprints: 0, doneSprints: 0 });
      const g = map.get(k)!; g.sprints++; if (doneStatus(s)) g.doneSprints++;
    });
    return [...map.entries()].map(([proj, v]) => ({ proj, ...v }))
      .filter(p => p.proj !== 'unknown')
      .sort((a, b) => b.sprints - a.sprints);
  }, [releases, sprintRows]);

  // Area rollup for overview

  // Grouped by area (for overview section)
  const groupedByArea = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { area: string; comps: typeof data.by_component }>();
    data.by_component.forEach(c => {
      const area = c.area || 'other';
      if (!map.has(area)) map.set(area, { area, comps: [] });
      map.get(area)!.comps.push(c);
    });
    return [...map.values()]
      .sort((a, b) => b.comps.reduce((s, c) => s + c.task_total, 0) - a.comps.reduce((s, c) => s + c.task_total, 0))
      .map(g => ({ ...g, comps: [...g.comps].sort((a, b) => b.task_total - a.task_total) }));
  }, [data]);

  // Grouped by PLATFORM (root component via parent_id chain — AIDA/SEIDR/…)
  const groupedByPlatform = useMemo(() => {
    if (!data || components.length === 0) return [];
    const byId = new Map(components.map(c => [c.component_id, c]));
    const cache = new Map<string, string>();
    function findRoot(id: string): string {
      if (cache.has(id)) return cache.get(id)!;
      const c = byId.get(id);
      if (!c || !c.parent_id) { cache.set(id, id); return id; }
      const root = findRoot(c.parent_id); cache.set(id, root); return root;
    }
    const map = new Map<string, { rootComp: LoreComponent | undefined; comps: typeof data.by_component }>();
    data.by_component.forEach(c => {
      const rootId = findRoot(c.component_id);
      if (!map.has(rootId)) map.set(rootId, { rootComp: byId.get(rootId), comps: [] });
      map.get(rootId)!.comps.push(c);
    });
    return [...map.values()]
      .sort((a, b) => b.comps.reduce((s, c) => s + c.task_total, 0) - a.comps.reduce((s, c) => s + c.task_total, 0))
      .map(g => ({ ...g, comps: [...g.comps].sort((a, b) => b.task_total - a.task_total) }));
  }, [data, components]);

  // Grouped by real GIT PROJECT — SPRINT-based (each sprint has a project + components).
  // project → components (sprint's primary component, or "— без компонента"). Sprints
  // without a project go to "— без проекта". Task counts come from analytics.by_sprint.
  const groupedByGitProject = useMemo(() => {
    if (!data) return [];
    const byId = new Map(components.map(c => [c.component_id, c]));
    const taskBySprint = new Map(data.by_sprint.map(s => [s.sprint_id, s]));
    const NO_PROJ = t('lore.analytics.overview.noProject', '— без проекта'), NO_COMP = t('lore.analytics.overview.noComponent', '— без компонента');
    // proj → comp → {sprints, task_total, task_done}
    const proj = new Map<string, Map<string, { sprints: number; task_total: number; task_done: number }>>();
    sprintRows.forEach(s => {
      const p = s.git_projects?.length ? projShort(s.git_projects[0]) : NO_PROJ;
      const comp = s.components?.length ? s.components[0] : NO_COMP;
      const tc = taskBySprint.get(s.sprint_id);
      if (!proj.has(p)) proj.set(p, new Map());
      const cm = proj.get(p)!;
      if (!cm.has(comp)) cm.set(comp, { sprints: 0, task_total: 0, task_done: 0 });
      const agg = cm.get(comp)!;
      agg.sprints++; agg.task_total += tc?.task_total ?? 0; agg.task_done += tc?.task_done ?? 0;
    });
    return [...proj.entries()]
      .map(([p, cm]) => ({
        proj: p,
        comps: [...cm.entries()].map(([cid, a]) => ({
          component_id: cid,
          full_name: cid === NO_COMP ? '' : (byId.get(cid)?.full_name ?? ''),
          area: cid === NO_COMP ? null : (byId.get(cid)?.area ?? null),
          sprint_count: a.sprints,
          task_total: a.task_total,
          task_done: a.task_done,
        })).sort((a, b) => b.task_total - a.task_total),
      }))
      .sort((a, b) => b.comps.reduce((s, c) => s + c.task_total, 0) - a.comps.reduce((s, c) => s + c.task_total, 0));
  }, [data, components, sprintRows]);

  function toggleGroup(key: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // QG-вкладка hooks — ДО ранних return (иначе React #310: меняется число хуков).

  // routine_name resolved from content_md (ADR-QG-004 §contract) — NOT qg_id.toLowerCase()/
  // toUpperCase(), which only accidentally matches gates whose qg_id equals their routine name.
  const routineByQg = useMemo(() => {
    const map = new Map<string, string>();
    qgRows.forEach(q => map.set(q.qg_id, parseRoutine(q.content_md, q.qg_id.toLowerCase())));
    return map;
  }, [qgRows]);

  const invariantsByQg = useMemo(() => {
    const map = new Map<string, ParsedInv[]>();
    qgRows.forEach(q => map.set(q.qg_id, parseInvariants(q.content_md)));
    return map;
  }, [qgRows]);

  // Per-routine latest metrics: Map<routine_name, Map<metric_key, QGMetricRow>>
  const qgMetricsByRoutine = useMemo(() => {
    const map = new Map<string, Map<string, QGMetricRow>>();
    qgMetricsLatest.forEach(m => {
      if (!map.has(m.routine_name)) map.set(m.routine_name, new Map());
      map.get(m.routine_name)!.set(m.metric_key, m);
    });
    return map;
  }, [qgMetricsLatest]);

  // Fleet join: every gate's declared invariants × its latest metric. Status comes from
  // ClRoutineMetric.status (computed by the routine script at write time) — NOT recomputed
  // from content_md's target/direction. content_md can drift from what the script actually
  // implements (see QG-AUTH-RUNTIME/ropc_removed: content_md says target=404, but the script
  // emits a bool with target=1 — recomputing against content_md's target would report a false
  // FAIL for an invariant that is really PASS). content_md is used for display context
  // (condition/how_to_verify/target label) only, matching LoreQGDetail.tsx's approach.
  const fleetInvariants = useMemo(() => {
    const out: FleetInvariant[] = [];
    qgRows.forEach(q => {
      if (q.status !== 'active') return;
      const routine = routineByQg.get(q.qg_id)!;
      const metrics = qgMetricsByRoutine.get(routine);
      invariantsByQg.get(q.qg_id)!.forEach(inv => {
        const m = metrics?.get(inv.key);
        const value = m?.value ?? null;
        const status = m?.status ?? 'SKIP';
        out.push({ qgId: q.qg_id, qgName: q.name, routine, inv, value, status });
      });
    });
    return out;
  }, [qgRows, routineByQg, invariantsByQg, qgMetricsByRoutine]);

  // Overall status per gate = worst of its invariants (FAIL > WARN > SKIP > PASS),
  // mirrors ADR-QG-002 compute_status overall rule. Falls back to 'norun' when a
  // gate has no parsed invariants or no metrics yet.
  const overallByQg = useMemo(() => {
    const rank: Record<string, number> = { FAIL: 3, WARN: 2, SKIP: 1, PASS: 0 };
    const map = new Map<string, string>();
    qgRows.forEach(q => {
      const invs = fleetInvariants.filter(f => f.qgId === q.qg_id);
      if (invs.length === 0) { map.set(q.qg_id, 'norun'); return; }
      const worst = invs.reduce((w, f) => (rank[f.status] ?? 0) > (rank[w] ?? 0) ? f.status : w, 'PASS');
      map.set(q.qg_id, worst);
    });
    return map;
  }, [qgRows, fleetInvariants]);

  // Fleet triage list — FAIL/WARN invariants only, FAIL first, grouped by routine downstream.
  const attentionNeeded = useMemo(
    () => fleetInvariants.filter(f => f.status === 'FAIL' || f.status === 'WARN')
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'FAIL' ? -1 : 1)),
    [fleetInvariants],
  );

  // Grouped by gate — gates with an active FAIL surface first.
  const attentionByGate = useMemo(() => {
    const map = new Map<string, FleetInvariant[]>();
    attentionNeeded.forEach(f => {
      if (!map.has(f.qgId)) map.set(f.qgId, []);
      map.get(f.qgId)!.push(f);
    });
    return [...map.entries()].sort((a, b) => {
      const aFail = a[1].some(f => f.status === 'FAIL') ? 1 : 0;
      const bFail = b[1].some(f => f.status === 'FAIL') ? 1 : 0;
      return bFail - aFail || b[1].length - a[1].length;
    });
  }, [attentionNeeded]);

  const violsBySeverity = useMemo(() => {
    const map: Record<string, LoreQGViolation[]> = {};
    qgViolations.forEach(v => {
      const sev = v.severity ?? 'unknown';
      if (!map[sev]) map[sev] = [];
      map[sev].push(v);
    });
    return map;
  }, [qgViolations]);

  void qgRoutineRuns; // used directly in tabQuality grouped view

  const qgByComponent = useMemo(() => {
    const map = new Map<string, QGRow[]>();
    qgRows.forEach(q => {
      const cid = q.component_id ?? '—';
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(q);
    });
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [qgRows]);

  // drilldown state — must be before early returns
  // sprint name lookup from sprintRows
  const sprintNameMap = useMemo(() => {
    const m = new Map<string, string>();
    sprintRows.forEach(s => { if (s.name) m.set(s.sprint_id, s.name); });
    return m;
  }, [sprintRows]);

  // current milestone open sprints for drilldown. Falls back to "show every
  // open sprint" only when there's no resolvable current milestone at all —
  // a resolved milestone with genuinely zero planned sprints must show zero,
  // not every open sprint system-wide (the inverse of milestoneOpenCount's
  // bug above: that one over-counted via a stale fallback, this one would
  // over-list via the same stale "empty means not loaded" assumption).
  const milestoneOpenSprints = useMemo(() => {
    const milestoneIds = currentMilestone ? new Set(currentMilestone.direct_sprint_ids ?? []) : null;
    return (data?.by_sprint ?? [])
      .filter(s => isGenuinelyOpen(s) && (milestoneIds === null || milestoneIds.has(s.sprint_id)))
      .map(s => ({
        ...s,
        name: sprintNameMap.get(s.sprint_id) ?? s.sprint_id,
        open_tasks: Math.max(0, s.task_total - s.task_done),
        klass: classify(s.status_raw),
      }))
      .sort((a, b) => {
        const rank = (k: string) => k === 'blocked' ? 0 : k === 'in_progress' ? 1 : k === 'ready_for_deploy' ? 2 : k === 'partial' ? 3 : 4;
        return rank(a.klass) - rank(b.klass) || b.open_tasks - a.open_tasks;
      });
  }, [data, sprintRows, sprintNameMap, currentMilestone]);

  const [showOpenDrilldown, setShowOpenDrilldown] = React.useState(false);

  // Must be before early returns (React rules of hooks)
  const filteredSprintsForEffort = useMemo(() =>
    data ? filterSprints(data.by_sprint, sprintFilter) : [],
  [data, sprintFilter]);

  const filteredEffortSumTop = useMemo(() =>
    filteredSprintsForEffort.reduce((sum, s) => sum + (s.effort_days_sum ?? 0), 0),
  [filteredSprintsForEffort]);

  // Tech × component matrix — rows are distinct technologies, columns are the
  // components that actually have a tech_registry entry (empty components add
  // no signal to a matrix, so they're left out rather than padding it with dashes).
  const techMatrix = useMemo(() => {
    const compIds = [...new Set(techRows.map(r => r.component_id).filter((c): c is string => !!c))];
    const compById = new Map(components.map(c => [c.component_id, c]));
    const cols = compIds
      .map(id => compById.get(id) ?? { component_id: id, full_name: id, area: '', parent_id: null, game_icon: null, children: [], tech: [] } as LoreComponent)
      .sort((a, b) => compArea(a).localeCompare(compArea(b)) || (a.full_name ?? a.component_id).localeCompare(b.full_name ?? b.component_id));

    const byTech = new Map<string, Map<string, LoreTechRow>>();
    techRows.forEach(r => {
      if (!r.component_id) return;
      if (!byTech.has(r.tech_name)) byTech.set(r.tech_name, new Map());
      byTech.get(r.tech_name)!.set(r.component_id, r);
    });
    const techRowsSorted = [...byTech.entries()]
      .map(([tech, byComp]) => ({ tech, byComp, usageCount: byComp.size }))
      .sort((a, b) => b.usageCount - a.usageCount || a.tech.localeCompare(b.tech));

    return { cols, rows: techRowsSorted };
  }, [techRows, components]);

  if (loading) return <LoreSkeleton />;
  if (!data)   return <div style={S.empty}>{t('lore.analytics.noData', 'Нет данных.')}</div>;

  const totals = data.totals;

  // ── tab bar ───────────────────────────────────────────────────────────────

  const tabBar = (
    <div style={S.tabBar}>
      {TABS.map(tb => (
        <button key={tb.key}
          style={{ ...S.tabBtn, ...(tab === tb.key ? S.tabBtnActive : {}) }}
          onClick={() => setTab(tb.key)}>
          <GameIcon slug={tb.icon} size={12} style={{ color: 'inherit' }} />
          {t(`lore.analytics.tabs.${tb.key}`, tb.label)}
          {tb.key === 'progress' && currentMilestone && daysUntilCurrent !== null && daysUntilCurrent >= 0 && daysUntilCurrent <= 14 && (
            <span style={{ fontSize: 'var(--fs-2xs)', padding: '0 4px', borderRadius: 3, background: daysUntilCurrent <= 7 ? 'var(--dng)' : 'var(--wrn)', color: 'var(--on-accent)', marginLeft: 2 }}>
              {t('lore.analytics.daysSuffix', '{{n}}д', { n: daysUntilCurrent })}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  // ── Tab 1: Обзор ──────────────────────────────────────────────────────────

  const groups: { key: string; label: string; color: string; icon: string | null; comps: typeof data.by_component }[] =
    groupBy === 'area'
      ? groupedByArea.map(g => ({ key: g.area, label: g.area, color: areaColor(g.area), icon: null, comps: g.comps }))
    : groupBy === 'platform'
      ? groupedByPlatform.map(g => ({
          key: g.rootComp?.component_id ?? 'unknown',
          label: g.rootComp?.full_name ?? g.rootComp?.component_id ?? 'unknown',
          color: areaColor(compArea(g.rootComp ?? {})),
          icon: g.rootComp?.game_icon ?? null,
          comps: g.comps,
        }))
      : groupedByGitProject.map((g, i) => ({
          key: g.proj,
          label: g.proj,
          color: PROJECT_COLORS[i % PROJECT_COLORS.length],
          icon: null,
          comps: g.comps,
        }));

  const tabOverview = (
    <>
      {/* Plan health strip */}
      {currentMilestone && (
        <section style={{
          ...S.panel,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const,
          background: onTrack
            ? `color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 6%,var(--b2))`
            : 'var(--b2)',
          borderColor: onTrack
            ? `color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 30%,transparent)`
            : 'var(--bd)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GameIcon slug="crossed-axes" size={16} style={{ color: 'var(--acc)' }} />
            {/* value-then-caption, matching the KPI blocks in this same row
                (big number on top, small label below) — was caption-then-value,
                the mismatched order made this block's text sit at a visibly
                different height than its siblings despite the shared
                alignItems:center on the parent row. */}
            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--t1)' }}>
                {currentMilestone.label} <span style={{ fontWeight: 400, color: 'var(--t2)', fontSize: 'var(--fs-sm)' }}>· {currentMilestone.date_display}</span>
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.analytics.planHealth.currentMilestone', 'Текущая веха')}</span>
            </div>
          </div>

          {daysUntilCurrent !== null && (
            <div title={t('lore.analytics.planHealth.daysUntilHint', 'Календарных дней от сегодня до плановой даты текущей вехи (date_display).')} style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', cursor: 'help' }}>
              <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1,
                color: daysUntilCurrent < 0 ? 'var(--dng)' : daysUntilCurrent <= 7 ? 'var(--wrn)' : 'var(--t1)' }}>
                {daysUntilCurrent >= 0 ? daysUntilCurrent : `+${-daysUntilCurrent}`}
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{daysUntilCurrent >= 0 ? t('lore.analytics.planHealth.daysToDeadline', 'дней до дедлайна ⓘ') : t('lore.analytics.planHealth.daysOverdue', 'дней просрочки ⓘ')}</span>
            </div>
          )}

          <div title={t('lore.analytics.planHealth.openSprintsHint', 'Незакрытые спринты вехи: {{open}}. Всего в системе незакрыто: {{total}}.', { open: milestoneOpenCount, total: openSprintCount })}
            style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', cursor: 'help' }}>
            <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1, color: 'var(--dng)' }}>{milestoneOpenCount}</span>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textAlign: 'center' as const }}>
              {t('lore.analytics.planHealth.openSpMilestone', 'open Sp вехи ⓘ')}
              {milestoneOpenCount !== openSprintCount && <><br /><span style={{ opacity: 0.6 }}>{t('lore.analytics.planHealth.total', 'всего {{n}}', { n: openSprintCount })}</span></>}
            </span>
          </div>

          {weeksToFinish !== null && (
            <div title={t('lore.analytics.planHealth.forecastHint', 'Прогноз: незакрытых Sp вехи ({{open}}) ÷ velocity ({{vel}} Sp/нед) = недель до закрытия.', { open: milestoneOpenCount, vel: avgVelocity.toFixed(1) })}
              style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', cursor: 'help' }}>
              <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1, color: 'var(--t1)' }}>~{Math.ceil(weeksToFinish)}</span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{t('lore.analytics.planHealth.weeksToClose', 'нед до закрытия ⓘ')}<br />@ {avgVelocity.toFixed(1)} Sp/нед</span>
            </div>
          )}

          {onTrack && (
            <div title={t('lore.analytics.planHealth.onTrackHint', 'Сравнение прогноза с дедлайном: нужно ~{{needed}} дн на остаток, до вехи {{days}} дн. {{detail}}', { needed: onTrack.daysNeeded, days: daysUntilCurrent, detail: onTrack.ok ? t('lore.analytics.planHealth.slack', 'Запас {{n}} дн.', { n: onTrack.slack }) : t('lore.analytics.planHealth.deficit', 'Дефицит {{n}} дн.', { n: -onTrack.slack }) })}
              style={{ marginLeft: 'auto', cursor: 'help', display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: `color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 14%,transparent)`,
              border: `1px solid color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 35%,transparent)` }}>
              <GameIcon slug={onTrack.ok ? 'check-mark' : 'padlock'} size={14}
                style={{ color: onTrack.ok ? 'var(--suc)' : 'var(--dng)' }} />
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: onTrack.ok ? 'var(--suc)' : 'var(--dng)' }}>
                  {onTrack.ok ? t('lore.analytics.planHealth.onTrack', 'В графике') : t('lore.analytics.planHealth.atRisk', 'Риск срыва')}
                </span>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>
                  {onTrack.ok ? t('lore.analytics.planHealth.slackShort', 'запас {{n}} дн', { n: onTrack.slack }) : t('lore.analytics.planHealth.deficitShort', 'не хватает {{n}} дн', { n: -onTrack.slack })}
                </span>
              </div>
            </div>
          )}
        </section>
      )}

      <div style={S.cards}>
        <Kpi icon="sprint"     label={t('lore.analytics.overview.kpi.sprints', 'Спринты')}        value={totals.sprints}    color="var(--acc)"
             sub={t('lore.analytics.overview.kpi.sprintsSub', '{{n}} готово', { n: data.sprints_by_status.done ?? 0 })}
             hint={t('lore.analytics.overview.kpi.sprintsHint', 'Всего спринтов в LORE (totals.sprints). Под значением — сколько в статусе done.')} />
        <Kpi icon="check-mark" label={t('lore.analytics.overview.kpi.tasks', 'Задачи')}         value={`${pct(totals.tasks_done, totals.tasks)}%`} color="var(--suc)"
             sub={`${totals.tasks_done} / ${totals.tasks}`}
             hint={t('lore.analytics.overview.kpi.tasksHint', 'Процент выполнения = задачи done / все задачи во всех спринтах (tasks_done / tasks × 100).')} />
        <Kpi icon="open-book"  label={t('lore.analytics.overview.kpi.releases', 'Релизы')}         value={totals.releases}   color="var(--inf)"
             sub={data.current_releases.length ? `current: ${data.current_releases.length}` : ''}
             hint={t('lore.analytics.overview.kpi.releasesHint', 'Всего релизов (KnowRelease, все проекты). current — помеченные is_current.')} />
        <Kpi icon="cog"        label={t('lore.analytics.overview.kpi.components', 'Компоненты')}     value={totals.components} color="var(--wrn)"
             sub={`${data.by_component.length} ${t('lore.analytics.overview.kpi.withSprints', 'со спринтами')} · ${pct(data.by_component.length, totals.components)}%`}
             hint={t('lore.analytics.overview.kpi.componentsHint', 'Всего компонентов. Под значением — сколько из них имеют хотя бы один привязанный спринт (coverage).')} />
        <Kpi icon="hourglass"  label={t('lore.analytics.overview.kpi.openSprints', 'Незакрытых Sp')} value={milestoneOpenCount} color="var(--dng)"
             sub={milestoneOpenCount !== openSprintCount ? t('lore.analytics.overview.kpi.openSprintsSub', 'вехи · всего {{n}}', { n: openSprintCount }) : t('lore.analytics.overview.kpi.openSprintsSubAlt', 'не done / не выпущены')} highlight
             hint={t('lore.analytics.overview.kpi.openSprintsHint', 'Незакрытые спринты текущей вехи: {{open}}. Всего в системе незакрыто: {{total}}.', { open: milestoneOpenCount, total: openSprintCount })} />
      </div>

      <div style={S.row2}>
        <section style={S.panel}>
          <div style={S.panelTitle} title={t('lore.analytics.overview.tasksByStatusHint', 'Распределение всех задач по статусу (классификация status_raw). Длина сегмента = доля статуса.')}>{t('lore.analytics.overview.tasksByStatus', 'Задачи по статусу')} <span style={S.dim}>· {totals.tasks}</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          <StatusBar data={data.tasks_by_status} total={totals.tasks} />
        </section>
        <section style={S.panel}>
          <div style={S.panelTitle} title={t('lore.analytics.overview.sprintsByStatusHint', 'Распределение всех спринтов по статусу (классификация status_raw). Длина сегмента = доля статуса.')}>{t('lore.analytics.overview.sprintsByStatus', 'Спринты по статусу')} <span style={S.dim}>· {totals.sprints}</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          <StatusBar data={data.sprints_by_status} total={totals.sprints} />
        </section>
      </div>

      {/* Area rollup + components grouped */}
      <section style={S.panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ ...S.panelTitle, marginBottom: 0, cursor: 'help' }}
            title={t('lore.analytics.overview.componentsHint', 'Компоненты со спринтами. Группировка: area (поле area) · платформа (корневой компонент-предок: AIDA/SEIDR…) · проект (доминирующий git-проект компонента, выведенный через его спринты: Component←BELONGS_TO←Sprint→BELONGS_TO_PROJECT). Числа: Sp = спринтов, X/Y = задачи done/всего, % = выполнение.')}>
            {t('lore.analytics.overview.components', 'Компоненты')} <span style={S.dim}>· {data.by_component.length}</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{t('lore.analytics.overview.groupBy', 'Группировка:')}</span>
            <div style={S.toggle}>
              {(['area', 'platform', 'project'] as CompGroupBy[]).map(g => (
                <button key={g} style={{ ...S.toggleBtn, ...(groupBy === g ? S.toggleBtnOn : {}) }}
                  onClick={() => setGroupBy(g)}>
                  {g === 'area' ? t('lore.analytics.overview.groupByArea', 'По area') : g === 'platform' ? t('lore.analytics.overview.groupByPlatform', 'По платформе') : t('lore.analytics.overview.groupByProject', 'По проекту')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Column header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px 6px', borderBottom: '1px solid var(--bd)', marginBottom: 4 }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.analytics.overview.componentGroupCol', 'Компонент / группа')}</span>
          <span title={t('lore.analytics.overview.sprintCountHint', 'Число привязанных спринтов')} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', width: 44, textAlign: 'right' as const, cursor: 'help' }}>Sp ⓘ</span>
          <span style={{ width: 60 }} />
          <span title={t('lore.analytics.overview.doneTotalHint', 'Задачи: выполнено / всего')} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', width: 56, textAlign: 'right' as const, cursor: 'help' }}>{t('lore.analytics.overview.doneTotalCol', 'done/всего ⓘ')}</span>
          <span title={t('lore.analytics.overview.pctHint', 'Процент выполнения = done / всего × 100')} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', width: 38, textAlign: 'right' as const, cursor: 'help' }}>% ⓘ</span>
        </div>

        <div style={S.table}>
          {groups.map(group => {
            const isOpen    = !collapsed.has(group.key);
            const totTasks  = group.comps.reduce((s, c) => s + c.task_total, 0);
            const doneTasks = group.comps.reduce((s, c) => s + c.task_done, 0);
            const totSp     = group.comps.reduce((s, c) => s + c.sprint_count, 0);
            const p         = pct(doneTasks, totTasks);
            return (
              <React.Fragment key={group.key}>
                <div style={S.groupHdr} onClick={() => toggleGroup(group.key)}>
                  <span style={{ fontSize: 7, color: 'var(--t3)', width: 8 }}>{isOpen ? '▼' : '▶'}</span>
                  {group.icon
                    ? <GameIcon slug={group.icon} size={11} style={{ color: group.color, flexShrink: 0 }} />
                    : <div style={{ width: 8, height: 8, borderRadius: 2, background: group.color, flexShrink: 0 }} />}
                  <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--t1)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                    {group.label}
                  </span>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }} title={t('lore.analytics.overview.componentsInGroup', 'Компонентов в группе')}>· {group.comps.length}</span>
                  <div title={t('lore.analytics.overview.groupDoneHint', 'Выполнение группы: {{done}} из {{total}} задач', { done: doneTasks, total: totTasks })} style={{ width: 80, height: 4, borderRadius: 2, background: 'var(--b3)', overflow: 'hidden', margin: '0 6px', flexShrink: 0 }}>
                    <div style={{ height: '100%', width: `${p}%`, background: group.color, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)', marginLeft: 'auto', cursor: 'help' }}
                    title={t('lore.analytics.overview.groupSumHint', 'Сумма по группе: {{sp}} спринтов, {{done}}/{{total}} задач выполнено ({{pct}}%)', { sp: totSp, done: doneTasks, total: totTasks, pct: p })}>
                    {totSp}Sp · {p}%
                  </span>
                </div>
                {isOpen && group.comps.map(c => {
                  const col = areaColor(c.area);
                  return (
                    <div key={c.component_id} style={{ ...S.trow, paddingLeft: 18 }}
                      onClick={() => onNavigateToComponent?.(c.component_id)}
                      role={onNavigateToComponent ? 'button' : undefined}>
                      <span style={{ ...S.compTag, color: col,
                        borderColor: `color-mix(in srgb,${col} 30%,transparent)`,
                        background:  `color-mix(in srgb,${col} 12%,transparent)` }}>
                        {c.component_id}
                      </span>
                      <span style={S.compName}>{c.full_name ?? ''}</span>
                      <span style={S.sprintChip} title={t('lore.analytics.overview.linkedSprintsHint', '{{n}} привязанных спринтов', { n: c.sprint_count })}>{c.sprint_count}Sp</span>
                      <MiniBar done={c.task_done} total={c.task_total} color={col} />
                      <span style={S.count} title={t('lore.analytics.overview.doneTotalHint', 'Задачи: выполнено / всего')}>{c.task_done}/{c.task_total}</span>
                      <span style={S.pctNum} title={t('lore.analytics.overview.doneHint', 'Выполнение: {{pct}}%', { pct: pct(c.task_done, c.task_total) })}>{pct(c.task_done, c.task_total)}%</span>
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      <section style={S.panel}>
        <div style={S.panelTitle} title={t('lore.analytics.overview.releasesByProjectHint', 'Число релизов (KnowRelease) в разрезе корневого git-проекта.')}>{t('lore.analytics.overview.releasesByProject', 'Релизы по проектам')} <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
        <div style={S.relRow}>
          {Object.entries(data.releases_by_project).sort((a, b) => b[1] - a[1]).map(([proj, n]) => (
            <div key={proj} style={S.relCard}>
              <span style={S.relProj}>{proj.split('/').pop()}</span>
              <span style={S.relNum}>{n}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );

  // ── Tab 2: Прогресс ───────────────────────────────────────────────────────

  const tabProgress = (
    <>
      {/* Filter bar: project + milestone + component — top of tab */}
      <section style={{ ...S.panel, padding: '10px 14px', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', width: 72, flexShrink: 0, textAlign: 'right' as const, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.analytics.progress.filterProject', 'Проект')}</span>
          <div style={S.filterChips}>
            {['all', ...chartProjects].map(p => (
              <button key={p} style={{ ...S.chip, ...(chartProj === p ? S.chipActive : {}) }}
                onClick={() => setChartProj(p)}>
                {p === 'all' ? t('lore.analytics.progress.filterAll', 'Все') : p}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', width: 72, flexShrink: 0, textAlign: 'right' as const, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.analytics.progress.filterMilestone', 'Веха')}</span>
          <div style={S.filterChips}>
            {[{ id: 'all', label: t('lore.analytics.progress.filterAll', 'Все') }, ...chartMilestones].map(m => (
              <button key={m.id} style={{ ...S.chip, ...(chartMilestone === m.id ? S.chipActive : {}) }}
                onClick={() => setChartMilestone(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {chartComps.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', width: 72, flexShrink: 0, textAlign: 'right' as const, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.analytics.progress.filterComponent', 'Компонент')}</span>
            <div style={S.filterChips}>
              <button style={{ ...S.chip, ...(chartComp === 'all' ? S.chipActive : {}) }}
                onClick={() => setChartComp('all')}>{t('lore.analytics.progress.filterAll', 'Все')}</button>
              {chartComps.map(c => (
                <button key={c} style={{ ...S.chip, ...(chartComp === c ? S.chipActive : {}) }}
                  onClick={() => setChartComp(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {(chartProj !== 'all' || chartMilestone !== 'all' || chartComp !== 'all') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', width: 72 }} />
            <button style={{ fontSize: 'var(--fs-2xs)', color: 'var(--acc)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={() => { setChartProj('all'); setChartMilestone('all'); setChartComp('all'); }}>
              {t('lore.analytics.progress.resetFilters', '× сбросить фильтры')}
            </button>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>
              {t('lore.analytics.progress.sprintsInSelection', '{{n}} спринтов в выборке', { n: chartSprints.length })}
            </span>
          </div>
        )}
      </section>

      {/* Velocity + burn stats */}
      <div style={S.row2}>
        <section style={S.panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap' as const, gap: 4 }}>
            <div style={S.panelTitle} title={t('lore.analytics.progress.velocityHint', 'Спринтов, закрытых за каждую ISO-неделю (по done_date). Столбик = неделя, последняя подсвечена.')}>
              Velocity <span style={S.dim}>· {t('lore.analytics.progress.lastNWeeks', 'последние {{n}} нед', { n: (chartVelocityWeeks.length || velocityWeeks.length) })}</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span title={t('lore.analytics.progress.avgVelocityHint', 'Среднее число закрытых спринтов в неделю за показанный период.')} style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', cursor: 'help' }}>avg <b style={{ color: 'var(--t1)' }}>{avgVelocity.toFixed(1)}</b>/нед</span>
              {velocityTrend !== null && (
                <span title={t('lore.analytics.progress.velocityTrendHint', 'Тренд: средний velocity последних 4 недель vs предыдущих 4, в %.')} style={{ fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--mono)', cursor: 'help',
                  color: velocityTrend >= 0 ? 'var(--suc)' : 'var(--dng)',
                  background: velocityTrend >= 0 ? 'color-mix(in srgb,var(--suc) 12%,transparent)' : 'color-mix(in srgb,var(--dng) 12%,transparent)',
                }}>
                  {velocityTrend >= 0 ? '↑' : '↓'}{Math.abs(velocityTrend)}%
                </span>
              )}
              {velocityCV !== null && (
                <span title={t('lore.analytics.progress.velocityCVHint', 'Стабильность темпа (коэф. вариации; ниже = ровнее)')}
                  style={{ fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--mono)',
                    color: velocityCV <= 0.4 ? 'var(--suc)' : velocityCV <= 0.7 ? 'var(--wrn)' : 'var(--dng)',
                    background: 'var(--b3)' }}>
                  σ {Math.round(velocityCV * 100)}%
                </span>
              )}
            </div>
          </div>
          {/* project legend */}
          {chartVelocityStacks.length > 1 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 6 }}>
              {chartVelocityStacks.map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
          <VelocityChart
            weeks={chartVelocityWeeks.length ? chartVelocityWeeks : velocityWeeks}
            stacks={chartVelocityStacks.length > 1 ? chartVelocityStacks : undefined}
          />
        </section>

        <section style={S.panel}>
          <div style={S.panelTitle} title={t('lore.analytics.progress.unreleasedBurnHint', 'Завершено за проект = все спринты с done_date. После M2 = завершённые с 03.06, ещё не вошедшие в релиз. Открыто = статус не done/cancelled.')}>{t('lore.analytics.progress.unreleasedBurn', 'Незарелиженное / burn')} <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            {/* Done total */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{t('lore.analytics.progress.doneForProject', 'Завершено за проект')}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--suc)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{doneDates.length} Sp</span>
              </div>
              <MiniBar done={doneDates.length} total={doneDates.length + openSprintCount} color="var(--suc)" wide />
            </div>
            {/* Since M2 (незарелиженное) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{t('lore.analytics.progress.sinceM2', 'После M2 (c 3 июн) — незарелиженное')}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--wrn)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{sinceM2Count} Sp</span>
              </div>
              <MiniBar done={sinceM2Count} total={doneDates.length} color="var(--wrn)" wide />
            </div>
            {/* Open */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{t('lore.analytics.progress.openInProgress', 'Открыто / в работе')}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--dng)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{openSprintCount} Sp</span>
              </div>
              <MiniBar done={openSprintCount} total={doneDates.length + openSprintCount} color="var(--dng)" wide />
            </div>
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', borderTop: '1px solid var(--bd)', paddingTop: 8, lineHeight: 1.4 }}>
              {deployLag.unreleased > 0
                ? <><b style={{ color: 'var(--wrn)' }}>{deployLag.unreleased}</b> {t('lore.analytics.progress.doneNotReleased', 'завершённых спринтов ещё не в релизе.')}<br /></>
                : <>{t('lore.analytics.progress.allReleased', 'Все завершённые спринты вошли в релизы.')}<br /></>}
              {t('lore.analytics.progress.m3Date', 'M3 (6 июл) — плановая дата следующего выпуска.')}
            </div>
          </div>
        </section>
      </div>

      {/* Burnup + Cumulative side by side */}
      <div style={S.row2}>
        <section style={S.panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap' as const, gap: 4 }}>
            <div style={S.panelTitle} title={t('lore.analytics.progress.burnupHint', 'Две накопленные линии по неделям: scope = спринты, созданные к дате (по valid_from); done = закрытые к дате (по done_date). Разрыв = backlog (scope creep). Учитывает фильтр проекта.')}>Burnup <span style={S.dim}>· scope vs done</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
            {burnup && (
              <div style={{ display: 'flex', gap: 10, fontSize: 'var(--fs-2xs)' }}>
                <span style={{ color: 'var(--acc)' }}>scope <b>{burnup.totalScope}</b></span>
                <span style={{ color: 'var(--suc)' }}>done <b>{burnup.totalDone}</b></span>
                <span style={{ color: 'var(--wrn)' }}>Δ <b>{burnup.totalScope - burnup.totalDone}</b></span>
              </div>
            )}
          </div>
          {burnup
            ? <BurnupChart points={burnup.points} />
            : <div style={S.empty}>{t('lore.analytics.progress.notEnoughData', 'Мало данных по проекту.')}</div>}
        </section>

        <section style={S.panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap' as const, gap: 4 }}>
            <div style={S.panelTitle} title={t('lore.analytics.progress.cumulativeHint', 'Нарастающий итог закрытых спринтов по дням (по done_date). Крутизна = темп. Учитывает фильтр проекта.')}>{t('lore.analytics.progress.cumulativeDone', 'Накопленное выполнение')} <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>
              <b style={{ color: 'var(--suc)', fontSize: 'var(--fs-md)' }}>{cumulativePoints.length}</b> Sp
            </span>
          </div>
          {cumulativePoints.length >= 2
            ? <>
                <CumulativeChart points={cumulativePoints} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>
                  <span>{t('lore.analytics.progress.apr19', '19 апр')}</span><span>{t('lore.analytics.progress.today', 'сегодня')}</span>
                </div>
              </>
            : <div style={S.empty}>{t('lore.analytics.progress.notEnoughData', 'Мало данных по проекту.')}</div>}
        </section>
      </div>

      {/* Pareto — concentration of work */}
      <section style={S.panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={S.panelTitle} title="Доля задач каждого компонента от всех задач (Парето). Σ — накопленная доля сверху вниз. Покрытие = компоненты со спринтами / все компоненты.">Концентрация работы <span style={S.dim}>· топ-8 компонентов</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          {coverage && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>
              покрытие <b style={{ color: 'var(--t1)' }}>{coverage.withSprints}/{coverage.total}</b>{' '}
              <span style={{ color: 'var(--t3)' }}>({pct(coverage.withSprints, coverage.total)}% компонентов со спринтами)</span>
            </span>
          )}
        </div>
        <div style={S.table}>
          {pareto.map(c => {
            const col = areaColor(c.area);
            return (
              <div key={c.component_id} style={{ ...S.trow, cursor: onNavigateToComponent ? 'pointer' : 'default' }}
                onClick={() => onNavigateToComponent?.(c.component_id)}>
                <span style={{ ...S.compTag, color: col,
                  borderColor: `color-mix(in srgb,${col} 30%,transparent)`,
                  background:  `color-mix(in srgb,${col} 12%,transparent)` }}>
                  {c.component_id}
                </span>
                <span style={S.compName}>{c.full_name ?? ''}</span>
                <div style={{ ...S.progressWrap, width: 120 }} title={`${Math.round(c.share * 100)}% всех задач`}>
                  <div style={{ ...S.progressFill, width: `${Math.round(c.share * 100)}%`, background: col }} />
                </div>
                <span style={S.count}>{c.task_total}</span>
                <span style={{ ...S.pctNum, width: 40 }}>{Math.round(c.share * 100)}%</span>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)', width: 44, textAlign: 'right' as const }}
                  title="Накопленная доля (Парето)">Σ{Math.round(c.cumShare * 100)}%</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );

  // ── Tab 3: Поток ──────────────────────────────────────────────────────────

  const qgDone = (qgStats.byStatus.closed ?? 0);
  const qgActive = (qgStats.byStatus.active ?? 0);

  const tabFlow = (
    <>
      {/* Task throughput */}
      <section style={S.panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={S.panelTitle} title="Закрытых задач за ISO-неделю (KnowTaskHist → DONE). Считаем с 12 июн (раньше — массовый импорт) и только задачи с реальной прогрессией статусов (states>1), исключая архивные «рождённые done».">
            Throughput задач <span style={S.dim}>· закрыто/нед</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span>
          </div>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>avg <b style={{ color: 'var(--t1)' }}>{taskThroughput.avg}</b>/нед · с 12 июн</span>
        </div>
        {taskThroughput.weeks.length === 0 ? <div style={S.empty}>Нет данных за период.</div> : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
            {taskThroughput.weeks.map(w => {
              const max = Math.max(...taskThroughput.weeks.map(x => x.count), 1);
              return (
                <div key={w.key} style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t2)', fontFamily: 'var(--mono)' }}>{w.count}</span>
                  <div title={`${w.label}: ${w.count} задач`} style={{ width: '100%', height: Math.max(3, (w.count / max) * 64),
                    background: 'color-mix(in srgb,var(--suc) 55%,var(--b3))', borderRadius: 3 }} />
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{w.label}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 6 }}>
          Данные с 12 июн 2026 (запуск LORE). Ранее — массовый импорт; архивные задачи (сразу в финале) исключены.
        </div>
      </section>

      {/* Effort accuracy — план vs факт (календарь) */}
      <section style={S.panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={S.panelTitle} title="Точность оценок по закрытым задачам: план = effort_days, факт = календарная длительность (создано→закрыто). ⚠ «потраченное» = календарь (wall-clock), а не чистые трудозатраты. Только реальные закрытия (с 12 июн, states>1).">
            Точность оценок <span style={S.dim}>· план vs факт (календарь)</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span>
          </div>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>n=<b style={{ color: 'var(--t1)' }}>{effortAccuracy.n}</b></span>
        </div>
        {effortAccuracy.n === 0 ? <div style={S.empty}>Нет данных.</div> : (
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' as const }}>
            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <span style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, lineHeight: 1,
                color: effortAccuracy.ratio <= 1.1 && effortAccuracy.ratio >= 0.9 ? 'var(--suc)' : effortAccuracy.ratio > 1.25 ? 'var(--dng)' : 'var(--wrn)' }}>
                {Math.round(effortAccuracy.ratio * 100)}%
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>факт/план · Σ {effortAccuracy.act}/{effortAccuracy.plan} дн</span>
            </div>
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
              {[
                { label: 'быстрее плана (<80%)', n: effortAccuracy.under, col: 'var(--suc)' },
                { label: '~в плане (80–125%)',   n: effortAccuracy.on,    col: 'var(--inf)' },
                { label: 'дольше (>125%)',        n: effortAccuracy.over,  col: 'var(--dng)' },
              ].map(b => (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)' }}>
                  <span style={{ color: 'var(--t2)', minWidth: 150 }}>{b.label}</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--b3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct(b.n, effortAccuracy.n)}%`, background: b.col, borderRadius: 3 }} />
                  </div>
                  <b style={{ color: 'var(--t1)', width: 30, textAlign: 'right' as const }}>{b.n}</b>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 6 }}>
          ⚠ «Потраченное» считается как календарная длительность (создано→закрыто), а не чистые трудозатраты — реального учёта времени в графе нет.
        </div>
      </section>

      <div style={S.row2}>
        {/* Lead / cycle time */}
        <section style={S.panel}>
          <div style={S.panelTitle} title="Дней от реального старта спринта (самый ранний valid_from из истории состояний, слайс sprint_starts) до закрытия (done_date). Медиана/p25/p75/макс + гистограмма по закрытым спринтам.">Lead time спринта <span style={S.dim}>· старт → закрытие</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          {leadTime ? (
            <>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <span style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--t1)', lineHeight: 1 }}>{leadTime.med}<span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>д</span></span>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>медиана</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', gap: 2 }}>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>p25 <b style={{ color: 'var(--t1)' }}>{leadTime.p25}д</b> · p75 <b style={{ color: 'var(--t1)' }}>{leadTime.p75}д</b></span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>макс {leadTime.max}д · n={leadTime.count}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56 }}>
                {leadTime.buckets.map(b => {
                  const max = Math.max(...leadTime.buckets.map(x => x.n), 1);
                  return (
                    <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t2)' }}>{b.n}</span>
                      <div title={`${b.label}: ${b.n}`} style={{ width: '100%', height: Math.max(2, (b.n / max) * 40),
                        background: 'color-mix(in srgb,var(--inf) 50%,var(--b3))', borderRadius: 2 }} />
                      <span style={{ fontSize: 7, color: 'var(--t3)' }}>{b.label}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : <div style={S.empty}>Нет данных о датах спринтов.</div>}
        </section>

        {/* Release cadence — per project */}
        <section style={S.panel}>
          <div style={S.panelTitle} title="Темп релизов по каждому проекту: частота = релизы за последние 30 дней ÷ (30/7) = релизов в неделю. Медиана = медианный разрыв в днях между соседними релизами проекта.">Release cadence <span style={S.dim}>· по проектам · {releases.length} релизов</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          {releaseCadence ? (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {releaseCadence.map(p => (
                <div key={p.proj} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
                  background: 'var(--b3)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', flexDirection: 'column' as const, minWidth: 110 }}>
                    <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{p.proj}</span>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{p.count} релизов</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', minWidth: 64 }} title="Релизов в неделю за последние 30 дней">
                    <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--t1)', lineHeight: 1 }}>
                      {p.perWeek}<span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>/нед</span>
                    </span>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>за 30 дн</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 1, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t2)' }}>
                      медиана {p.med !== null ? `${p.med}д` : '—'} · посл. <span style={{ fontFamily: 'var(--mono)', color: 'var(--inf)' }}>{p.lastVersion}</span>
                    </span>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: p.med !== null && p.daysSinceLast > Math.max(2, p.med * 1.5) ? 'var(--wrn)' : 'var(--t3)' }}>
                      с последнего: {p.daysSinceLast}д {p.med !== null && p.daysSinceLast > Math.max(2, p.med * 1.5) ? '⚠' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : <div style={S.empty}>Нет дат релизов.</div>}
        </section>
      </div>

      <div style={S.row2}>
        {/* Deploy lag */}
        <section style={S.panel}>
          <div style={S.panelTitle} title="Дней от закрытия спринта (done_date) до первого релиза, в который он вошёл (release_dates). Медиана/p75 по таким спринтам. Справа — сколько done-спринтов ещё без релиза.">Deploy lag <span style={S.dim}>· закрытие → релиз</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          {deployLag.med !== null ? (
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <span style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--t1)', lineHeight: 1 }}>{deployLag.med}<span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>д</span></span>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>медиана · p75 {deployLag.p75}д</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, justifyContent: 'center' }}>
                <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: deployLag.unreleased ? 'var(--wrn)' : 'var(--suc)' }}>{deployLag.unreleased}</span>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>готово, ждёт релиза</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', marginLeft: 'auto', textAlign: 'right' as const, cursor: 'help' }}
                title={`Спринтов, прошедших через статус BLOCKED (по истории состояний): ${blockedStats.ever} из ${blockedStats.total} (${pct(blockedStats.ever, blockedStats.total)}%). Сейчас заблокировано: ${blockedStats.nowBlocked}.`}>
                <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: blockedStats.nowBlocked ? 'var(--dng)' : 'var(--t1)' }}>
                  {pct(blockedStats.ever, blockedStats.total)}%
                </span>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>через blocked ({blockedStats.ever}) · сейчас {blockedStats.nowBlocked} ⓘ</span>
              </div>
            </div>
          ) : <div style={S.empty}>Нет данных о связках спринт→релиз.</div>}
        </section>

        {/* Quality gates */}
        <section style={S.panel}>
          <div style={S.panelTitle} title="Распределение Quality Gates по статусу (closed/active/deprecated). Большой % = closed / (closed + active). Внизу — сколько компонентов имеют хотя бы один QG.">Quality Gates <span style={S.dim}>· {qgStats.total}</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <span style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--suc)', lineHeight: 1 }}>{pct(qgDone, qgDone + qgActive)}%</span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>закрыто ({qgDone}/{qgDone + qgActive})</span>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
              {Object.entries(qgStats.byStatus).sort((a, b) => b[1] - a[1]).map(([st, n]) => {
                const col = st === 'closed' ? 'var(--suc)' : st === 'active' ? 'var(--inf)' : 'var(--t3)';
                return (
                  <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 }} />
                    <span style={{ color: 'var(--t2)', minWidth: 70 }}>{st}</span>
                    <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--b3)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct(n, qgStats.total)}%`, background: col, borderRadius: 3 }} />
                    </div>
                    <b style={{ color: 'var(--t1)', width: 20, textAlign: 'right' as const }}>{n}</b>
                  </div>
                );
              })}
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 2 }}>{qgStats.compsWithQg} компонентов с QG</span>
            </div>
          </div>
        </section>
      </div>

      {/* Aging WIP */}
      <section style={S.panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={S.panelTitle} title="Открытые спринты (не done/cancelled), сгруппированы по проекту, отсортированы по возрасту = дней от реального старта (min valid_from из истории) до сегодня. Красный >30д, жёлтый >14д. Ловит «зависшее».">Aging WIP <span style={S.dim}>· открытые по проектам и возрасту</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{agingWIP.length} открытых</span>
        </div>
        {agingWIP.length === 0 ? <div style={S.empty}>Нет открытых спринтов с датой старта.</div> : (() => {
          const byProj = new Map<string, typeof agingWIP>();
          agingWIP.forEach(s => {
            const p = projShort(s.git_projects?.[0]);
            if (!byProj.has(p)) byProj.set(p, []);
            byProj.get(p)!.push(s);
          });
          const groups = [...byProj.entries()].sort((a, b) => (b[1][0]?.age ?? 0) - (a[1][0]?.age ?? 0));
          return (
            <div style={{ ...S.table, maxHeight: 400, overflowY: 'auto' as const }}>
              {groups.map(([proj, list]) => (
                <React.Fragment key={proj}>
                  <div style={{ ...S.groupBucket, display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span>{proj} · {list.length}</span>
                    <span style={{ color: (list[0]?.age ?? 0) > 30 ? 'var(--dng)' : 'var(--t3)' }}>старший {list[0]?.age}д</span>
                  </div>
                  {list.slice(0, 12).map(s => {
                    const age = s.age ?? 0;
                    const col = age > 30 ? 'var(--dng)' : age > 14 ? 'var(--wrn)' : 'var(--t2)';
                    const k = classify(s.status_raw);
                    return (
                      <div key={s.sprint_id} style={S.trow} onClick={() => onNavigateToSprint?.(s.sprint_id)}
                        role={onNavigateToSprint ? 'button' : undefined}>
                        <GameIcon slug={statusMeta(k).icon} size={11} style={{ color: statusMeta(k).color, flexShrink: 0 }} />
                        <span style={{ ...S.sprintId, flex: 'none', maxWidth: 200 }}>{s.sprint_id}</span>
                        <span style={S.compName}>{s.name}</span>
                        <div style={{ width: 100, height: 5, borderRadius: 3, background: 'var(--b3)', overflow: 'hidden', flexShrink: 0 }}
                          title={`${age} дней в работе`}>
                          <div style={{ height: '100%', width: `${Math.min(100, (age / 45) * 100)}%`, background: col, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 'var(--fs-sm)', color: col, fontFamily: 'var(--mono)', fontWeight: 600, width: 44, textAlign: 'right' as const, flexShrink: 0 }}>{age}д</span>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          );
        })()}
      </section>

      {/* Cross-project balance */}
      <section style={S.panel}>
        <div style={S.panelTitle} title="Спринты и релизы, сгруппированные по корневому git-проекту. Зелёная часть полосы = закрытые спринты, светлая = всего. Справа — done/всего Sp и число релизов.">Баланс по проектам <span style={S.dim}>· спринты / релизы</span> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.6 }}>ⓘ</span></div>
        <div style={S.table}>
          {crossProject.map(p => {
            const max = Math.max(...crossProject.map(x => x.sprints), 1);
            return (
              <div key={p.proj} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px', fontSize: 'var(--fs-sm)' }}>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)', minWidth: 110, fontWeight: 600 }}>{p.proj}</span>
                <div style={{ flex: 1, height: 14, borderRadius: 3, background: 'var(--b3)', overflow: 'hidden', position: 'relative' as const }}>
                  <div style={{ height: '100%', width: `${(p.sprints / max) * 100}%`, background: 'color-mix(in srgb,var(--acc) 35%,var(--b3))' }} />
                  <div style={{ position: 'absolute' as const, top: 0, left: 0, height: '100%', width: `${(p.doneSprints / max) * 100}%`, background: 'color-mix(in srgb,var(--suc) 55%,transparent)' }} />
                </div>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', width: 90, textAlign: 'right' as const }}>
                  {p.doneSprints}/{p.sprints} Sp
                </span>
                <span style={{ color: 'var(--inf)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', width: 56, textAlign: 'right' as const }}>{p.releases} rel</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );

  // ── Tab 4: Спринты ────────────────────────────────────────────────────────

  const filteredSprints = filterSprints(data.by_sprint, sprintFilter);
  const filteredEffortSum = filteredEffortSumTop;

  const tabSprints = (
    <>
      {/* Plan health strip — same as Overview */}
      {currentMilestone && (
        <section style={{
          ...S.panel,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const,
          background: onTrack
            ? `color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 6%,var(--b2))`
            : 'var(--b2)',
          borderColor: onTrack
            ? `color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 30%,transparent)`
            : 'var(--bd)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GameIcon slug="crossed-axes" size={16} style={{ color: 'var(--acc)' }} />
            {/* value-then-caption, matching the KPI blocks in this same row
                (big number on top, small label below) — was caption-then-value,
                the mismatched order made this block's text sit at a visibly
                different height than its siblings despite the shared
                alignItems:center on the parent row. */}
            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--t1)' }}>
                {currentMilestone.label} <span style={{ fontWeight: 400, color: 'var(--t2)', fontSize: 'var(--fs-sm)' }}>· {currentMilestone.date_display}</span>
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.analytics.planHealth.currentMilestone', 'Текущая веха')}</span>
            </div>
          </div>
          {daysUntilCurrent !== null && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1,
                color: daysUntilCurrent < 0 ? 'var(--dng)' : daysUntilCurrent <= 7 ? 'var(--wrn)' : 'var(--t1)' }}>
                {daysUntilCurrent >= 0 ? daysUntilCurrent : `+${-daysUntilCurrent}`}
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{daysUntilCurrent >= 0 ? 'дней до дедлайна' : 'дней просрочки'}</span>
            </div>
          )}
          {/* Clickable open Sp chip → opens drilldown */}
          <button onClick={() => setShowOpenDrilldown(v => !v)}
            style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', cursor: 'pointer',
              background: 'none', border: 'none', padding: 0 }}>
            <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1, color: 'var(--dng)',
              textDecoration: showOpenDrilldown ? 'underline' : 'none' }}>{milestoneOpenCount}</span>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textAlign: 'center' as const }}>
              open Sp вехи {showOpenDrilldown ? '▲' : '▼'}
              {milestoneOpenCount !== openSprintCount && (
                <><br /><span style={{ color: 'var(--t3)', opacity: 0.7 }}>всего {openSprintCount}</span></>
              )}
            </span>
          </button>
          {weeksToFinish !== null && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1, color: 'var(--t1)' }}>~{Math.ceil(weeksToFinish)}</span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textAlign: 'center' as const }}>нед до закрытия<br />@ {avgVelocity.toFixed(1)} Sp/нед</span>
            </div>
          )}
          {onTrack && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: `color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 14%,transparent)`,
              border: `1px solid color-mix(in srgb,${onTrack.ok ? 'var(--suc)' : 'var(--dng)'} 35%,transparent)` }}>
              <GameIcon slug={onTrack.ok ? 'check-mark' : 'padlock'} size={14}
                style={{ color: onTrack.ok ? 'var(--suc)' : 'var(--dng)' }} />
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: onTrack.ok ? 'var(--suc)' : 'var(--dng)' }}>
                  {onTrack.ok ? 'В графике' : 'Риск срыва'}
                </span>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>
                  {onTrack.ok ? `запас ${onTrack.slack} дн` : `не хватает ${-onTrack.slack} дн`}
                </span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Drilldown — открытые спринты по группам статуса */}
      {showOpenDrilldown && (
        <section style={S.panel}>
          <div style={{ ...S.panelTitle, marginBottom: 2 }}>
            Незакрытые спринты вехи{currentMilestone ? ` · ${currentMilestone.label}` : ''}
            <span style={S.dim}> · {milestoneOpenSprints.length}</span>
          </div>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginBottom: 10 }}>
            {milestoneOpenSprints.reduce((s, r) => s + r.open_tasks, 0)} незакрытых задач суммарно · нажми строку → открыть спринт
          </div>

          {/* header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr 70px 70px 50px 16px', gap: '0 8px',
            fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontWeight: 600, letterSpacing: '0.05em',
            padding: '0 4px', marginBottom: 4 }}>
            <span/>
            <span>Спринт</span>
            <span style={{ textAlign: 'right' as const }}>Задачи</span>
            <span style={{ textAlign: 'right' as const }}>Open задач</span>
            <span style={{ textAlign: 'right' as const }}>%</span>
            <span/>
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' as const }}>
            {milestoneOpenSprints.length === 0
              ? <div style={S.empty}>Нет открытых спринтов для этой вехи.</div>
              : milestoneOpenSprints.map(s => {
                const statusCol =
                  s.klass === 'blocked'          ? 'var(--dng)' :
                  s.klass === 'in_progress'      ? 'var(--inf)' :
                  s.klass === 'ready_for_deploy' ? 'var(--suc)' :
                  s.klass === 'partial'          ? 'var(--wrn)' : 'var(--t3)';
                const taskPct = s.task_total > 0 ? pct(s.task_done, s.task_total) : null;
                return (
                  <div key={s.sprint_id}
                    onClick={() => onNavigateToSprint?.(s.sprint_id)}
                    role={onNavigateToSprint ? 'button' : undefined}
                    style={{ display: 'grid', gridTemplateColumns: '12px 1fr 70px 70px 50px 16px',
                      gap: '0 8px', alignItems: 'center',
                      padding: '5px 4px', borderRadius: 4,
                      cursor: onNavigateToSprint ? 'pointer' : 'default',
                      borderBottom: '1px solid color-mix(in srgb,var(--bd) 40%,transparent)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: statusCol, flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}
                      title={s.name}>{s.name}</span>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)', textAlign: 'right' as const }}>
                      {s.task_total > 0 ? `${s.task_done}/${s.task_total}` : '—'}
                    </span>
                    <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, fontFamily: 'var(--mono)',
                      color: s.open_tasks > 0 ? 'var(--dng)' : 'var(--suc)', textAlign: 'right' as const }}>
                      {s.open_tasks > 0 ? `${s.open_tasks} open` : '✓'}
                    </span>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: taskPct !== null && taskPct >= 75 ? 'var(--suc)' : 'var(--t3)',
                      fontFamily: 'var(--mono)', textAlign: 'right' as const }}>
                      {taskPct !== null ? `${taskPct}%` : '—'}
                    </span>
                    {onNavigateToSprint
                      ? <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--acc)' }}>→</span>
                      : <span/>}
                  </div>
                );
              })
            }
          </div>

          {/* totals footer */}
          {milestoneOpenSprints.length > 0 && (() => {
            const totalOpen = milestoneOpenSprints.reduce((s, r) => s + r.open_tasks, 0);
            const totalTasks = milestoneOpenSprints.reduce((s, r) => s + r.task_total, 0);
            const totalDone  = milestoneOpenSprints.reduce((s, r) => s + r.task_done, 0);
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr 70px 70px 50px 16px',
                gap: '0 8px', padding: '6px 4px', borderTop: '1px solid var(--bd)',
                fontSize: 'var(--fs-2xs)', color: 'var(--t2)', fontWeight: 600, marginTop: 4 }}>
                <span/><span>Итого</span>
                <span style={{ fontFamily: 'var(--mono)', textAlign: 'right' as const }}>{totalDone}/{totalTasks}</span>
                <span style={{ fontFamily: 'var(--mono)', textAlign: 'right' as const, color: 'var(--dng)' }}>{totalOpen} open</span>
                <span style={{ fontFamily: 'var(--mono)', textAlign: 'right' as const }}>{totalTasks > 0 ? `${pct(totalDone, totalTasks)}%` : '—'}</span>
                <span/>
              </div>
            );
          })()}
        </section>
      )}

      <section style={S.panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ ...S.panelTitle, marginBottom: 0 }}>
            Спринты <span style={S.dim}>· {data.by_sprint.length}</span>
            <span style={{ ...S.openChip, marginLeft: 8 }}>{openSprintCount} открытых</span>
            {filteredEffortSum > 0 && (
              <span style={{ marginLeft: 8, fontSize: 'var(--fs-xs)', color: 'var(--t2)', fontFamily: 'var(--mono)' }}>
                Σ <b style={{ color: 'var(--acc)' }}>{filteredEffortSum}</b> д
              </span>
            )}
          </div>
          <div style={S.filterChips}>
            {SPRINT_FILTERS.map(f => {
              const count = filterSprints(data.by_sprint, f.key).length;
              return (
                <button key={f.key}
                  style={{ ...S.chip, ...(sprintFilter === f.key ? S.chipActive : {}) }}
                  onClick={() => setSprintFilter(f.key)}>
                  {f.label} <span style={S.chipCount}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {sprintFilter === 'active' ? (
          <SprintGroupedActive sprints={filteredSprints} onNavigate={onNavigateToSprint} />
        ) : sprintFilter === 'done' ? (
          <SprintGroupedDone sprints={filteredSprints} onNavigate={onNavigateToSprint} />
        ) : (
          <div style={{ ...S.table, maxHeight: 420, overflowY: 'auto' as const }}>
            {filteredSprints.length === 0
              ? <div style={S.empty}>Нет спринтов в этой группе.</div>
              : filteredSprints.map(s => <SprintRowItem key={s.sprint_id} s={s} onNavigate={onNavigateToSprint} />)}
          </div>
        )}
      </section>
    </>
  );

  // ── Tab 6: Quality Gates dashboard ──────────────────────────────────────

  const tabQuality = (
    <>
      <div style={S.cards}>
        <Kpi icon="guards"     label="QG всего"       value={qgStats.total}      color="var(--acc)"
          sub={`${qgStats.compsWithQg} компонентов`}
          hint="Всего QualityGate вершин в LORE" />
        <Kpi icon="warning"    label="Нарушения open" value={qgViolations.length} color="var(--dng)"
          sub="QGJobTask status=open" highlight={qgViolations.length > 0}
          hint="Открытые нарушения из последних прогонов" />
        <Kpi icon="text"       label="Рекомендации"   value={qgPendingRecs.length} color="var(--wrn)"
          sub="status=pending" highlight={qgPendingRecs.length > 0}
          hint="Ожидающие рекомендации (QGRecommendation WHERE status=pending)" />
        <Kpi icon="check-mark" label="Прогонов"       value={qgRoutineRuns.length} color="var(--inf)"
          sub={`${qgRoutineRuns.filter(r => r.status === 'PASS').length} PASS`}
          hint="ClRoutineRun WHERE routine_name LIKE qg-%" />
      </div>

      <div style={S.row2}>
        <section style={S.panel}>
          <div style={S.panelTitle} title="Цвет = худший статус среди инвариантов гейта (content_md × latest metric, ADR-QG-002 compute_status). Серый = нет прогонов/метрик.">
            QG статус-сетка <span style={S.dim}>· {qgRows.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 5 }}>
            {qgRows.map(q => {
              const runSt = overallByQg.get(q.qg_id) ?? null;
              const col = runColor(runSt === 'norun' ? null : runSt);
              const label = q.qg_id.replace(/^QG-/, '').replace(/-/g, ' ');
              const clickable = !!onNavigateToQG;
              return (
                <div key={q.qg_id}
                  onClick={clickable ? () => onNavigateToQG!(q.qg_id) : undefined}
                  title={`${q.qg_id}\nРутина: ${routineByQg.get(q.qg_id)}\nСтатус: ${runSt === 'norun' ? 'нет прогонов' : runSt}`}
                  style={{ padding: '4px 7px', borderRadius: 5, fontSize: 'var(--fs-2xs)', fontWeight: 600,
                    background: `color-mix(in srgb,${col} 12%,var(--b3))`,
                    border: `1px solid color-mix(in srgb,${col} 30%,transparent)`,
                    color: col, overflow: 'hidden', cursor: clickable ? 'pointer' : 'default' }}>
                  <div style={{ fontSize: 7, color: 'var(--t3)', fontFamily: 'var(--mono)', marginBottom: 2 }}>
                    {runSt === 'norun' ? '—' : runSt}
                  </div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, lineHeight: 1.3 }}>{label}</div>
                </div>
              );
            })}
            {qgRows.length === 0 && <div style={S.empty}>QG не найдены.</div>}
          </div>
        </section>

        <section style={S.panel}>
          <div style={S.panelTitle}>Здоровье по компонентам</div>
          <div style={S.table}>
            {qgByComponent.map(([cid, gates]) => {
              const statuses = gates.map(g => overallByQg.get(g.qg_id) ?? 'norun');
              const nPass = statuses.filter(s => s === 'PASS').length;
              const nFail = statuses.filter(s => s === 'FAIL').length;
              const nWarn = statuses.filter(s => s === 'WARN').length;
              const compCol = nFail > 0 ? 'var(--dng)' : nWarn > 0 ? 'var(--wrn)' : nPass === gates.length ? 'var(--suc)' : 'var(--t3)';
              return (
                <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 5, fontSize: 'var(--fs-sm)' }}>
                  <span style={{ ...S.compTag, color: compCol,
                    borderColor: `color-mix(in srgb,${compCol} 30%,transparent)`,
                    background: `color-mix(in srgb,${compCol} 12%,transparent)` }}>
                    {cid}
                  </span>
                  <span style={{ flex: 1, color: 'var(--t2)', fontSize: 'var(--fs-xs)' }}>{gates.length} QG</span>
                  {nPass > 0 && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--suc)', fontFamily: 'var(--mono)' }}>{nPass}✓</span>}
                  {nWarn > 0 && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--wrn)', fontFamily: 'var(--mono)' }}>{nWarn}⚠</span>}
                  {nFail > 0 && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--dng)', fontFamily: 'var(--mono)' }}>{nFail}✗</span>}
                </div>
              );
            })}
            {qgByComponent.length === 0 && <div style={S.empty}>Нет QG с компонентами.</div>}
          </div>
        </section>
      </div>

      {/* ── ADR-QG-004 fleet triage: ЧТО+ПОЧЕМУ collapsed to a prioritized list; ────
          детали (source/спарклайн/методика) — в LoreQGDetail по клику. ─────────── */}
      <section style={S.panel}>
        <div style={S.panelTitle} title="FAIL/WARN инварианты по всему флоту (content_md × latest ClRoutineMetric, статус пересчитан через compute_status — ADR-QG-002/004). Полная детализация — по клику на гейт.">
          Что требует внимания <span style={S.dim}>· {attentionNeeded.length} инвариантов в {attentionByGate.length} гейтах</span>
        </div>
        {attentionByGate.length === 0
          ? <div style={S.empty}>✅ Все инварианты в норме (PASS) или нет прогонов.</div>
          : <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {attentionByGate.map(([qgId, invs]) => {
                const worst = invs.some(f => f.status === 'FAIL') ? 'FAIL' : 'WARN';
                const col = runColor(worst);
                const clickable = !!onNavigateToQG;
                return (
                  <div key={qgId} style={{ background: 'var(--bg1)', border: '1px solid var(--bd)',
                    borderLeft: `3px solid ${col}`, borderRadius: 6, padding: '8px 10px' }}>
                    <div
                      onClick={clickable ? () => onNavigateToQG!(qgId) : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: clickable ? 'pointer' : 'default' }}>
                      <span style={{ fontSize: 'var(--fs-sm)', color: col, fontWeight: 700 }}>{worst === 'FAIL' ? '✗' : '⚠'}</span>
                      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--t1)', flex: 1, fontFamily: 'var(--mono)' }}>{qgId}</span>
                      <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{invs[0].routine}</span>
                      {clickable && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--inf)' }}>→</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                      {invs.map(f => {
                        const mc = f.status === 'FAIL' ? 'var(--dng)' : 'var(--wrn)';
                        const vf = f.value == null || f.value === -1 ? '—' : (Number.isInteger(f.value) ? f.value : f.value.toFixed(1));
                        const tf = f.inv.target == null ? null : (Number.isInteger(f.inv.target) ? f.inv.target : f.inv.target.toFixed(1));
                        return (
                          <div key={f.inv.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 'var(--fs-xs)' }}>
                            <span style={{ ...S.compTag, fontSize: 'var(--fs-2xs)', flexShrink: 0, color: mc,
                              borderColor: `color-mix(in srgb,${mc} 30%,transparent)`,
                              background: `color-mix(in srgb,${mc} 12%,transparent)` }}>{f.status}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{f.inv.key}</span>
                                <span style={{ color: mc, fontWeight: 600, fontFamily: 'var(--mono)' }}>{vf}{f.inv.unit ? ` ${f.inv.unit}` : ''}</span>
                                {tf != null && <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-2xs)' }}>/ цель {f.inv.direction === 'lte' ? '≤' : '≥'}{tf}</span>}
                              </div>
                              {f.inv.condition && <div style={{ color: 'var(--t3)', fontSize: 'var(--fs-2xs)', marginTop: 1 }}>{f.inv.condition}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
        }
      </section>

      <section style={S.panel}>
        <div style={S.panelTitle} title="Прогоны сгруппированы по run_id (или routine+дата). Время берётся из started_at/finished_at.">
          История прогонов <span style={S.dim}>· {qgRoutineRuns.length} записей</span>
        </div>
        {(() => {
          // Group by run_id (if exists) else routine_name+run_date — one «session» per group
          const groups = new Map<string, LoreQGRoutineRun[]>();
          [...qgRoutineRuns]
            .sort((a, b) => ((b.run_date ?? '') + (b.started_at ?? '')).localeCompare((a.run_date ?? '') + (a.started_at ?? '')))
            .forEach(r => {
              const key = r.run_id ?? `${r.routine_name}__${r.run_date ?? ''}`;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(r);
            });
          const sessions = [...groups.entries()].slice(0, 30);
          if (sessions.length === 0) return <div style={S.empty}>Нет записей ClRoutineRun для qg-* рутин.</div>;
          // Group sessions by date for date separators
          let lastDate = '';
          return (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2 }}>
              {sessions.map(([key, runs]) => {
                const dateStr = (runs[0].run_date ?? '').slice(0, 10);
                const timeStr = runs[0].started_at ? runs[0].started_at.slice(11, 16) : null;
                const finStr  = runs[0].finished_at ? runs[0].finished_at.slice(11, 16) : null;
                const showDate = dateStr !== lastDate;
                lastDate = dateStr;
                // worst status in group
                const worstStatus = runs.reduce<string>((w, r) => {
                  const rank = (s: string | null) => s === 'FAIL' ? 3 : s === 'WARN' ? 2 : s === 'PARTIAL' ? 1 : 0;
                  return rank(r.status) > rank(w) ? (r.status ?? w) : w;
                }, runs[0].status ?? '');
                const col = runColor(worstStatus);
                const icon = worstStatus === 'PASS' || worstStatus === 'OK' ? '✓' : worstStatus === 'FAIL' ? '✗' : worstStatus === 'WARN' ? '⚠' : '?';
                return (
                  <React.Fragment key={key}>
                    {showDate && (
                      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)', padding: '5px 6px 2px',
                        borderTop: showDate && lastDate !== dateStr ? '1px solid var(--bd)' : 'none', marginTop: 2 }}>
                        {dateStr}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 6px', borderRadius: 5,
                      background: `color-mix(in srgb,${col} 5%,transparent)`, borderLeft: `2px solid ${col}` }}>
                      <span style={{ fontSize: 'var(--fs-sm)', color: col, width: 14, textAlign: 'center' as const, paddingTop: 1 }}>{icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                          {runs.map((r, ri) => {
                            const rc = runColor(r.status);
                            return (
                              <span key={ri} style={{ fontSize: 'var(--fs-xs)', color: rc, fontFamily: 'var(--mono)', fontWeight: 600 }}>
                                {r.routine_name.replace('qg-', '')}
                                <span style={{ fontWeight: 400, color: `color-mix(in srgb,${rc} 60%,var(--t3))`, marginLeft: 2 }}>
                                  {r.status === 'PASS' || r.status === 'OK' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'WARN' ? '⚠' : '?'}
                                </span>
                              </span>
                            );
                          })}
                          <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                            {timeStr ?? '—'}{finStr && finStr !== timeStr ? `→${finStr}` : ''}
                          </span>
                        </div>
                        {runs[0].flags && (
                          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {runs[0].flags}
                          </div>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          );
        })()}
      </section>

      <section style={S.panel}>
        <div style={S.panelTitle} title="QGJobTask WHERE status=open, по severity.">
          Открытые нарушения <span style={S.dim}>· {qgViolations.length}</span>
        </div>
        {qgViolations.length === 0
          ? <div style={S.empty}>✅ Открытых нарушений нет.</div>
          : <div style={S.table}>
              {SEV_ORDER.filter(s => violsBySeverity[s]).map(sev => {
                const viols = violsBySeverity[sev];
                const col = sevColor(sev);
                return (
                  <React.Fragment key={sev}>
                    <div style={{ ...S.groupBucket, color: col, marginTop: 4 }}>{sev} · {viols.length}</div>
                    {viols.slice(0, 10).map(v => (
                      <div key={v.job_id} style={{ ...S.trow, cursor: v.qg_id && onNavigateToQG ? 'pointer' : 'default' }}
                        onClick={v.qg_id && onNavigateToQG ? () => onNavigateToQG!(v.qg_id!) : undefined}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 }} />
                        <span style={{ fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', color: 'var(--t3)', flexShrink: 0, width: 80 }}>
                          {(v.run_date ?? '').slice(0, 10)}
                        </span>
                        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {v.qg_id ?? v.component_id ?? '—'} / {v.inv_id ?? v.job_id}
                        </span>
                        {v.note_md && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{v.note_md}</span>}
                      </div>
                    ))}
                    {viols.length > 10 && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', padding: '2px 6px' }}>…ещё {viols.length - 10}</div>}
                  </React.Fragment>
                );
              })}
            </div>}
      </section>

      <section style={S.panel}>
        <div style={S.panelTitle} title="QGRecommendation WHERE status=pending, отсортированы P0→P1→P2.">
          Рекомендации к выполнению <span style={S.dim}>· {qgPendingRecs.length}</span>
        </div>
        {qgPendingRecs.length === 0
          ? <div style={S.empty}>✅ Нет pending рекомендаций.</div>
          : <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
              {qgPendingRecs.map(r => {
                const pc = priColor(r.priority);
                const sc = sevColor(r.severity ?? '');
                return (
                  <div key={r.rec_id} style={{ padding: '8px 10px', borderRadius: 7, background: 'var(--b3)',
                    border: `1px solid color-mix(in srgb,${pc} 25%,var(--bd))` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' as const }}>
                      {r.priority && <span style={{ fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                        color: pc, background: `color-mix(in srgb,${pc} 14%,transparent)`,
                        border: `1px solid color-mix(in srgb,${pc} 30%,transparent)` }}>{r.priority}</span>}
                      {r.severity && <span style={{ fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                        color: sc, background: `color-mix(in srgb,${sc} 14%,transparent)`,
                        border: `1px solid color-mix(in srgb,${sc} 30%,transparent)` }}>{r.severity}</span>}
                      {r.effort_days != null && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{r.effort_days}д</span>}
                      {r.component_id && <span style={{ ...S.compTag, fontSize: 'var(--fs-2xs)', color: 'var(--inf)',
                        borderColor: 'color-mix(in srgb,var(--inf) 25%,transparent)',
                        background: 'color-mix(in srgb,var(--inf) 10%,transparent)' }}>{r.component_id}</span>}
                      <span
                        onClick={r.qg_id && onNavigateToQG ? () => onNavigateToQG!(r.qg_id!) : undefined}
                        style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', color: 'var(--inf)',
                          cursor: r.qg_id && onNavigateToQG ? 'pointer' : 'default' }}>{r.qg_id}{r.qg_id && onNavigateToQG ? ' →' : ''}</span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>{r.title}</div>
                    {r.body_md && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', marginTop: 3, lineHeight: 1.5,
                      whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }}>{r.body_md}</div>}
                    {r.fix_cmd && <div style={{ fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', color: 'var(--acc)',
                      background: 'var(--b2)', padding: '3px 7px', borderRadius: 4, marginTop: 4,
                      overflowX: 'auto' as const, whiteSpace: 'nowrap' as const }}>$ {r.fix_cmd}</div>}
                    {r.how_to_verify && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 4 }}>✓ {r.how_to_verify}</div>}
                    {r.tags && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const, marginTop: 5 }}>
                      {r.tags.split(',').map(tag => (
                        <span key={tag} style={{ fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3,
                          color: 'var(--t2)', background: 'var(--b2)', border: '1px solid var(--bd)' }}>
                          {tag.trim()}
                        </span>
                      ))}
                    </div>}
                  </div>
                );
              })}
            </div>}
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, padding: '4px 2px 0' }}>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Регламент:</span>
        {['ADR-QG-001', 'ADR-QG-002', 'ADR-QG-004'].map(id => (
          <span key={id} style={{ fontSize: 'var(--fs-2xs)', padding: '1px 6px', borderRadius: 3,
            color: 'var(--pro, #bc8cff)', background: 'color-mix(in srgb, var(--pro, #bc8cff) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--pro, #bc8cff) 22%, transparent)' }}>{id}</span>
        ))}
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>— полная методика и source-evidence: клик по гейту</span>
      </div>
    </>
  );

  // ── Tab: Технологии (tech × component matrix) ───────────────────────────────

  const tabTech = (
    <>
      {techMatrix.rows.length === 0 ? (
        <div style={S.empty}>{t('lore.analytics.tech.empty', 'Технологии не зарегистрированы ни для одного компонента.')}</div>
      ) : (
        <section style={S.panel}>
          <div style={S.panelTitle}>
            {t('lore.analytics.tech.title', 'Матрица технологии × компоненты')}
            <span style={{ ...S.dim, marginLeft: 6, fontSize: 'var(--fs-xs)' }}>
              {t('lore.analytics.tech.subtitle', '{{techs}} технологий · {{comps}} компонентов', { techs: techMatrix.rows.length, comps: techMatrix.cols.length })}
            </span>
          </div>
          <div style={{ overflowX: 'auto' as const }}>
            <table style={{ ...S.matrixTable }}>
              <thead>
                <tr>
                  <th style={{ ...S.matrixCornerCell }}>{t('lore.analytics.tech.col.tech', 'Технология')}</th>
                  {techMatrix.cols.map(c => (
                    <th key={c.component_id} style={{ ...S.matrixColHead, color: areaColor(compArea(c)) }} title={c.full_name ?? c.component_id}>
                      <span style={S.matrixColHeadLabel}>{c.full_name ?? c.component_id}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {techMatrix.rows.map(({ tech, byComp, usageCount }) => (
                  <tr key={tech}>
                    <td style={S.matrixRowHead}>
                      {tech}
                      <span style={{ ...S.dim, marginLeft: 5, fontSize: 'var(--fs-2xs)' }}>{usageCount}</span>
                    </td>
                    {techMatrix.cols.map(c => {
                      const row = byComp.get(c.component_id);
                      if (!row) return <td key={c.component_id} style={S.matrixCellEmpty}>·</td>;
                      const f = parseTechFields(row.content_md);
                      const stale = isTechStale(row.checked_at);
                      const hint = [
                        `${tech} ${row.version ?? ''}`.trim(),
                        f.license && `Лицензия: ${f.license}`,
                        f.ourRelease && `Наш релиз: ${f.ourRelease}`,
                        f.usage && `Использование: ${f.usage}`,
                        row.checked_at ? `Проверено: ${row.checked_at.slice(0, 10)}` : null,
                      ].filter(Boolean).join('\n');
                      return (
                        <td key={c.component_id} style={{ ...S.matrixCell, color: stale ? 'var(--wrn)' : 'var(--t1)' }} title={hint}>
                          {row.version ?? '✓'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );

  return (
    <div style={S.root}>
      {tabBar}
      {tab === 'overview'   && tabOverview}
      {tab === 'progress'   && tabProgress}
      {tab === 'flow'       && tabFlow}
      {tab === 'sprints'    && tabSprints}
      {tab === 'quality'    && tabQuality}
      {tab === 'tech'       && tabTech}
    </div>
  );
}

// ── Sprint grouped sub-components ─────────────────────────────────────────

function SprintGroupedActive({ sprints, onNavigate }: { sprints: LoreAnalyticsSprint[]; onNavigate?: (id: string) => void }) {
  const hi  = sprints.filter(s => pct(s.task_done, s.task_total) >= 75).sort((a, b) => pct(b.task_done, b.task_total) - pct(a.task_done, a.task_total));
  const mid = sprints.filter(s => { const p = pct(s.task_done, s.task_total); return p >= 25 && p < 75; }).sort((a, b) => pct(b.task_done, b.task_total) - pct(a.task_done, a.task_total));
  const lo  = sprints.filter(s => pct(s.task_done, s.task_total) < 25).sort((a, b) => pct(b.task_done, b.task_total) - pct(a.task_done, a.task_total));
  if (sprints.length === 0) return <div style={S.empty}>Нет активных спринтов.</div>;
  return (
    <div style={{ ...S.table, maxHeight: 420, overflowY: 'auto' as const }}>
      {hi.length  > 0 && <><div style={{ ...S.groupBucket, color: 'var(--suc)' }}>≥ 75% · {hi.length}</div>{hi.map(s => <SprintRowItem key={s.sprint_id} s={s} onNavigate={onNavigate} />)}</>}
      {mid.length > 0 && <><div style={{ ...S.groupBucket, color: 'var(--wrn)', marginTop: 6 }}>25–74% · {mid.length}</div>{mid.map(s => <SprintRowItem key={s.sprint_id} s={s} onNavigate={onNavigate} />)}</>}
      {lo.length  > 0 && <><div style={{ ...S.groupBucket, color: 'var(--dng)', marginTop: 6 }}>&lt; 25% · {lo.length}</div>{lo.map(s => <SprintRowItem key={s.sprint_id} s={s} onNavigate={onNavigate} />)}</>}
    </div>
  );
}

function SprintGroupedDone({ sprints, onNavigate }: { sprints: LoreAnalyticsSprint[]; onNavigate?: (id: string) => void }) {
  const byStatus = sprints.filter(s => classify(s.status_raw) === 'done');
  const by100    = sprints.filter(s => classify(s.status_raw) !== 'done' && s.task_total > 0 && pct(s.task_done, s.task_total) === 100);
  if (sprints.length === 0) return <div style={S.empty}>Нет завершённых спринтов.</div>;
  return (
    <div style={{ ...S.table, maxHeight: 420, overflowY: 'auto' as const }}>
      {byStatus.length > 0 && <><div style={S.groupBucket}>Статус «done» · {byStatus.length}</div>{byStatus.map(s => <SprintRowItem key={s.sprint_id} s={s} onNavigate={onNavigate} />)}</>}
      {by100.length    > 0 && <><div style={{ ...S.groupBucket, marginTop: 6 }}>100% задач, не done · {by100.length}</div>{by100.map(s => <SprintRowItem key={s.sprint_id} s={s} onNavigate={onNavigate} />)}</>}
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────────────────

const S = {
  root:        { flex: 1, overflowY: 'auto' as const, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12 },
  empty:       { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },

  tabBar:      { display: 'flex', gap: 1, borderBottom: '1px solid var(--bd)', paddingBottom: 0 },
  tabBtn:      {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '7px 14px', borderRadius: '6px 6px 0 0',
    fontSize: 'var(--fs-sm)', fontWeight: 500, cursor: 'pointer',
    border: '1px solid transparent', borderBottom: 'none',
    background: 'transparent', color: 'var(--t3)', transition: 'color .12s',
  },
  tabBtnActive: {
    background: 'var(--b2)', color: 'var(--acc)',
    border: '1px solid var(--bd)', borderBottom: '1px solid var(--b2)',
    marginBottom: -1,
  },

  cards:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 8 },
  card:        { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 10 },
  cardIcon:    { width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardValue:   { fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--t1)', lineHeight: 1.1 },
  cardLabel:   { fontSize: 'var(--fs-xs)', color: 'var(--t2)', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  cardSub:     { fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 1 },

  row2:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 },
  panel:       { background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 },
  panelTitle:  { fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--t1)', marginBottom: 10, display: 'inline-flex', alignItems: 'center' } as React.CSSProperties,
  dim:         { color: 'var(--t3)', fontWeight: 400 },

  segBar:      { display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden', background: 'var(--b3)' },
  legend:      { display: 'flex', flexWrap: 'wrap' as const, gap: '4px 10px', marginTop: 7 },
  legendItem:  { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', color: 'var(--t2)' },

  table:       { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  trow:        { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 5, fontSize: 'var(--fs-sm)', cursor: 'pointer' },
  groupHdr:    { display: 'flex', alignItems: 'center', gap: 5, padding: '7px 4px 3px', cursor: 'pointer', userSelect: 'none' as const },
  groupBucket: { fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--t3)', letterSpacing: '0.05em', padding: '4px 6px 2px', textTransform: 'uppercase' as const },

  compTag:     { fontSize: 'var(--fs-xs)', padding: '1px 6px', borderRadius: 3, border: '1px solid', flexShrink: 0, fontFamily: 'var(--mono)' },
  compName:    { flex: 1, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0, fontSize: 'var(--fs-sm)' },
  sprintId:    { flex: 1, color: 'var(--t1)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0 },
  sprintChip:  { fontSize: 'var(--fs-2xs)', padding: '1px 4px', borderRadius: 3, flexShrink: 0, fontFamily: 'var(--mono)', color: 'var(--acc)', background: 'color-mix(in srgb,var(--acc) 12%,transparent)', border: '1px solid color-mix(in srgb,var(--acc) 30%,transparent)' },
  openChip:    { fontSize: 'var(--fs-2xs)', padding: '1px 6px', borderRadius: 3, fontFamily: 'var(--mono)', color: 'var(--dng)', background: 'color-mix(in srgb,var(--dng) 12%,transparent)', border: '1px solid color-mix(in srgb,var(--dng) 30%,transparent)' },
  progressWrap: { width: 100, height: 5, borderRadius: 3, background: 'var(--b3)', overflow: 'hidden', flexShrink: 0 },
  progressFill: { height: '100%', borderRadius: 3 },
  count:       { fontSize: 'var(--fs-xs)', color: 'var(--t2)', fontFamily: 'var(--mono)', width: 52, textAlign: 'right' as const, flexShrink: 0 },
  pctNum:      { fontSize: 'var(--fs-xs)', color: 'var(--t3)', width: 32, textAlign: 'right' as const, flexShrink: 0 },

  filterChips: { display: 'flex', gap: 4, flexWrap: 'wrap' as const },
  chip:        { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)' },
  chipActive:  { background: 'color-mix(in srgb,var(--acc) 12%,transparent)', color: 'var(--acc)', borderColor: 'color-mix(in srgb,var(--acc) 35%,transparent)' },
  chipCount:   { fontSize: 'var(--fs-2xs)', opacity: 0.7, fontFamily: 'var(--mono)' },

  toggle:      { display: 'flex', border: '1px solid var(--bd)', borderRadius: 5, overflow: 'hidden' },
  toggleBtn:   { fontSize: 'var(--fs-xs)', padding: '3px 10px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)' },
  toggleBtnOn: { background: 'color-mix(in srgb,var(--acc) 12%,transparent)', color: 'var(--acc)', fontWeight: 600 },

  relRow:      { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  relCard:     { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2, padding: '8px 16px', background: 'var(--b3)', border: '1px solid var(--bd)', borderRadius: 8 },
  relProj:     { fontSize: 'var(--fs-xs)', color: 'var(--t2)' },
  relNum:      { fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--inf)' },
  relTypeTag:  (type: string | null) => {
    const col = type === 'major' ? 'var(--dng)' : type === 'minor' ? 'var(--wrn)' : type === 'patch' ? 'var(--inf)' : 'var(--t3)';
    return { fontSize: 'var(--fs-2xs)', padding: '0 5px', borderRadius: 3, fontFamily: 'var(--mono)' as const,
      color: col, background: `color-mix(in srgb,${col} 14%,transparent)`,
      border: `1px solid color-mix(in srgb,${col} 30%,transparent)` };
  },

  matrixTable:        { borderCollapse: 'collapse' as const, fontSize: 'var(--fs-sm)', width: 'max-content' },
  matrixCornerCell:   { position: 'sticky' as const, left: 0, zIndex: 1, background: 'var(--b2)', textAlign: 'left' as const, padding: '4px 10px 4px 4px', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid var(--bd)' },
  matrixColHead:      { padding: '4px 8px', fontSize: 'var(--fs-xs)', fontWeight: 600, borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', writingMode: 'vertical-rl' as const, transform: 'rotate(180deg)', maxHeight: 110, whiteSpace: 'nowrap' as const, verticalAlign: 'bottom' as const },
  matrixColHeadLabel: { display: 'inline-block', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' as const },
  matrixRowHead:      { position: 'sticky' as const, left: 0, background: 'var(--b2)', padding: '4px 10px 4px 4px', fontSize: 'var(--fs-sm)', color: 'var(--t1)', fontWeight: 500, whiteSpace: 'nowrap' as const, borderTop: '1px solid var(--bd)' },
  matrixCell:         { padding: '4px 8px', fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)', textAlign: 'center' as const, borderTop: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', cursor: 'help' as const },
  matrixCellEmpty:    { padding: '4px 8px', fontSize: 'var(--fs-xs)', textAlign: 'center' as const, color: 'var(--t4, var(--t3))', borderTop: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', opacity: 0.35 },
};
