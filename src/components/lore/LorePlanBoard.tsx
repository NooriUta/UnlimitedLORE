// LorePlanBoard — renders system_aida_lore plan data as a readable swimlane
// timeline (vis-timeline). Tracks → groups, plan items → range bars, milestones
// → boxes, releases → points, sections → background bands. Built-in zoom/pan
// (Ctrl+wheel zoom, wheel/drag pan) replaces the old hand-rolled Gantt canvas.
// Spec: PLAN_AS_DB_RENDER.md · write-path LAL-23a · time-travel LAL-25
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import type { TimelineOptions, TimelineItem, TimelineGroup } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import './lore-timeline.css';
import {
  fetchLoreSlice, postLoreStatus, registerLoreSprint, updateLoreSprint,
  type LorePlanConfig, type LorePlanSection,
  type LorePlanItem, type LorePlanCheckpoint, type LoreMilestone, type LoreRelease,
  type LorePlanItemStatus, type LoreSprintDep,
  type LoreSprintDoneDate, type LoreSprintTask, type LoreSprintRow,
  type LoreComponent,
} from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta, taskTick } from './lore-status';
import gameIcons from '@iconify-json/game-icons/icons.json';

// ── Status helpers ───────────────────────────────────────────────────────────
// Status colour + icon come from the single source of truth (lore-status.ts),
// so the board matches the chips/ticks and adapts to theme + palette.
const ICON_BODIES = gameIcons.icons as Record<string, { body: string }>;

// Inline game-icon SVG for embedding in a vis-timeline item's HTML content.
// `color` is a token (var(--suc)…) so the glyph carries the status colour.
function statusIconSvg(slug: string, color: string): string {
  const body = ICON_BODIES[slug]?.body;
  if (!body) return '';
  return `<svg viewBox="0 0 512 512" width="12" height="12" `
    + `style="vertical-align:-2px;margin-right:5px;flex:none;pointer-events:none;color:${color}" `
    + `fill="currentColor">${body}</svg>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// Map a status to a colour family (drives the fam-* CSS class). Derived from the
// single source (statusMeta.color) so the board never drifts from the chips.
type StatusFamily = 'done' | 'active' | 'warn' | 'blocked' | 'muted';
function statusFamily(status: string | null | undefined): StatusFamily {
  switch (statusMeta(status).color) {
    case 'var(--suc)':    return 'done';
    case 'var(--inf)':    return 'active';
    case 'var(--wrn)':    return 'warn';
    case 'var(--danger)': return 'blocked';
    default:              return 'muted';
  }
}

// Legend ordering + RU labels (legend is built from statuses actually present).
const STATUS_ORDER = ['active', 'high', 'planned', 'design', 'partial', 'blocked', 'backlog', 'todo', 'done', 'deferred', 'cancelled'];
const STATUS_RU: Record<string, string> = {
  active: 'в работе', high: 'важно', planned: 'план', design: 'дизайн', partial: 'частично',
  blocked: 'блок', backlog: 'бэклог', todo: 'не начато', done: 'готово', deferred: 'отложено', cancelled: 'отменено',
};
const STATUS_KEY: Record<string, string> = {
  active: 'active', high: 'high', planned: 'planned', design: 'design', partial: 'partial',
  blocked: 'blocked', backlog: 'backlog', todo: 'todo', done: 'done', deferred: 'deferred', cancelled: 'cancelled',
};

// Canonical token → status_raw (mirrors backend SCD2_STATUS_RAW exactly), for
// optimistic statusBySprint updates so a cycled sprint re-colours before the server
// round-trip — and round-trips cleanly back through taskTick.
const STATUS_RAW: Record<string, string> = {
  todo: '⬜ TODO', planned: '📋 PLANNED', design: '🔬 DESIGN', backlog: '🟣 BACKLOG',
  active: '🔄 IN PROGRESS', partial: '🟡 PARTIAL', ready_for_deploy: '🚀 READY FOR DEPLOY',
  blocked: '🔴 BLOCKED', high: '🔴 P0', done: '✅ DONE', cancelled: '🚫 CANCELLED',
};

// Full cycle over every status the /status endpoint accepts (PLAN_STATUSES), in a
// natural workflow order — not just todo→active→done. Clicking a bar walks the lot.
const STATUS_CYCLE: LorePlanItemStatus[] = [
  'todo', 'planned', 'design', 'backlog', 'active', 'partial',
  'ready_for_deploy', 'blocked', 'high', 'done', 'cancelled',
];
function cycleStatus(current: string | null): LorePlanItemStatus {
  const idx = STATUS_CYCLE.indexOf((current ?? 'todo') as LorePlanItemStatus);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}


const NO_PROJECT   = '__no_project__';
const NO_COMPONENT = '__no_component__';
const WEEK_MS = 7 * 86400 * 1000;
function addWeeks(base: Date, w: number): Date {
  return new Date(base.getTime() + w * WEEK_MS);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  onError: (e: unknown) => void;
  /** Navigate to a sprint's passport (set when the board is wired into LorePage). */
  onNavigateToSprint?: (sprintId: string) => void;
}

// Unique marker icon for placeholder bars (plan items with no real sprint behind
// them). Real sprints inherit their component's game-icon instead.
const STUB_ICON = 'cardboard-box';

// ── Critical path (longest path on hard edges, weighted by sprint duration) ──
function computeCriticalPath(
  deps: LoreSprintDep[],
  durationBySprint: Map<string, number>,   // sprint_id → weeks
): Set<string> {
  const hard = deps.filter(d => d.kind === 'hard');
  if (!hard.length) return new Set();

  // Collect all nodes
  const nodes = new Set<string>();
  hard.forEach(d => { nodes.add(d.from_sprint); nodes.add(d.to_sprint); });

  // Build adjacency list (from → [to])
  const adj = new Map<string, string[]>();
  hard.forEach(d => {
    if (!adj.has(d.from_sprint)) adj.set(d.from_sprint, []);
    adj.get(d.from_sprint)!.push(d.to_sprint);
  });

  // Topological sort (Kahn's algorithm)
  const inDeg = new Map<string, number>();
  nodes.forEach(n => inDeg.set(n, 0));
  hard.forEach(d => inDeg.set(d.to_sprint, (inDeg.get(d.to_sprint) ?? 0) + 1));
  const queue: string[] = [];
  inDeg.forEach((d, n) => { if (d === 0) queue.push(n); });
  const topo: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    topo.push(n);
    (adj.get(n) ?? []).forEach(m => {
      const d = (inDeg.get(m) ?? 1) - 1;
      inDeg.set(m, d);
      if (d === 0) queue.push(m);
    });
  }

  // DP: dist[n] = longest weighted distance ending at n
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  nodes.forEach(n => dist.set(n, durationBySprint.get(n) ?? 1));

  topo.forEach(n => {
    const dn = dist.get(n)!;
    (adj.get(n) ?? []).forEach(m => {
      const candidate = dn + (durationBySprint.get(m) ?? 1);
      if (candidate > (dist.get(m) ?? 0)) {
        dist.set(m, candidate);
        prev.set(m, n);
      }
    });
  });

  // Find the sink with max distance and walk back
  let maxDist = 0; let sink = '';
  dist.forEach((d, n) => { if (d > maxDist) { maxDist = d; sink = n; } });

  const critical = new Set<string>();
  let cur: string | undefined = sink;
  while (cur) { critical.add(cur); cur = prev.get(cur); }
  return critical;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function LorePlanBoard({ onError, onNavigateToSprint }: Props) {
  const { t } = useTranslation();
  const [config,   setConfig]   = useState<LorePlanConfig | null>(null);
  const [comps,    setComps]    = useState<LoreComponent[]>([]);
  const [sections, setSections] = useState<LorePlanSection[]>([]);
  const [items,    setItems]    = useState<LorePlanItem[]>([]);
  const [cps,      setCps]      = useState<LorePlanCheckpoint[]>([]);
  const [mss,      setMss]      = useState<LoreMilestone[]>([]);
  const [releases, setReleases] = useState<LoreRelease[]>([]);

  const [doneBySprint, setDoneBySprint] = useState<Map<string, string>>(new Map());
  // Real sprint status (status_raw) keyed by sprint_id — the bar's status source
  // for sprint bars, so the gantt matches the actual sprint state (not plan_item).
  const [statusBySprint, setStatusBySprint] = useState<Map<string, string>>(new Map());
  const [loading,  setLoading]  = useState(true);

  // ── Sprint dependencies + SVG overlay ─────────────────────────────────────
  const [deps,     setDeps]     = useState<LoreSprintDep[]>([]);
  const [showDeps, setShowDeps] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  // ── Toggles ────────────────────────────────────────────────────────────────
  // Default to the "not the archive" view: done + past hidden. Toggles re-enable
  // them when the user actually wants to look back.
  const [showDone,   setShowDone]   = useState(false);
  const [showActive, setShowActive] = useState(true);
  const [cropPast,   setCropPast]   = useState(true);
  // A bar is a real sprint when it represents one; otherwise it's a standalone
  // plan-item / placeholder ("заглушка"). Both shown by default.
  const [showSprints, setShowSprints] = useState(true);
  const [showStubs,   setShowStubs]   = useState(false);

  // ── Panels ─────────────────────────────────────────────────────────────────
  const [sprintCard, setSprintCard] = useState<LorePlanItem | null>(null);
  const [msPanel,    setMsPanel]    = useState<LoreMilestone | null>(null);
  const [registering, setRegistering] = useState(false);
  const [panelH,     setPanelH]     = useState(238);          // resizable bottom panel
  const panelDragRef = useRef<{ y: number; h: number } | null>(null);

  // Tasks of the sprint behind the selected card (lazy, keyed by represents_sprint)
  const [cardTasks,          setCardTasks]          = useState<LoreSprintTask[]>([]);
  const [cardTasksLoading,   setCardTasksLoading]   = useState(false);
  const [cardSprintStatus,   setCardSprintStatus]   = useState<string | null>(null);
  const [cardReleases,       setCardReleases]       = useState<string[]>([]);
  const [cardSprintPriority, setCardSprintPriority] = useState<string | null>(null);
  const [priorityBusy,       setPriorityBusy]       = useState(false);
  // Task list filter + selected note
  const [taskStatusFilter, setTaskStatusFilter] = useState<Set<string>>(new Set());
  const [selectedTaskUid,  setSelectedTaskUid]  = useState<string | null>(null);

  // ── Timeline plumbing ────────────────────────────────────────────────────────
  const hostRef     = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsDSRef  = useRef<DataSet<TimelineItem> | null>(null);
  // id → source object lookups for the select handler
  const itemByIdRef = useRef<Map<string, LorePlanItem>>(new Map());
  const msByIdRef   = useRef<Map<string, LoreMilestone>>(new Map());

  // ── Load all plan slices ─────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LorePlanConfig>('plan_config',      undefined, ctrl.signal),
      fetchLoreSlice<LorePlanSection>('plan_sections',   undefined, ctrl.signal),
      fetchLoreSlice<LorePlanItem>('plan_items',         undefined, ctrl.signal),
      fetchLoreSlice<LorePlanCheckpoint>('plan_checkpoints', undefined, ctrl.signal),
      fetchLoreSlice<LoreMilestone>('milestones',        undefined, ctrl.signal),
      fetchLoreSlice<LoreRelease>('releases',            undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintDoneDate>('sprint_done_dates', undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintRow>('sprints',            undefined, ctrl.signal),
      fetchLoreSlice<LoreComponent>('components',         undefined, ctrl.signal),
    ])
      .then(([cfgs, secs, its, chkps, milestones, rels, dones, sprints, components]) => {
        setConfig(cfgs[0] ?? null);
        setComps(components);
        setSections(secs);
        // The sprint is the source of truth for status: a plan item that represents
        // a sprint inherits that sprint's (normalised) status, so plan_item.status
        // never drifts from reality. Stubs (no sprint) keep their own status.
        const sprintStatusRaw = new Map(
          sprints.filter(s => s.status_raw).map(s => [s.sprint_id, s.status_raw as string]));
        setItems(its.map(it =>
          it.represents_sprint && sprintStatusRaw.has(it.represents_sprint)
            ? { ...it, status: taskTick(sprintStatusRaw.get(it.represents_sprint)!).status }
            : it));
        setCps(chkps);
        setMss(milestones);
        setReleases(rels.filter(r => r.week != null));
        setDoneBySprint(new Map(
          dones.filter(d => d.done_date).map(d => [d.sprint_id, d.done_date as string])
        ));
        setStatusBySprint(sprintStatusRaw);
        setLoading(false);
        // Load deps in background — not blocking the main render
        fetchLoreSlice<LoreSprintDep>('sprint_deps', undefined, ctrl.signal)
          .then(d => setDeps(d))
          .catch(() => {/* non-critical */});
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  // ── Lazy-load tasks of the sprint behind the selected card ───────────────────
  useEffect(() => {
    const sprintId = sprintCard?.represents_sprint;
    if (!sprintId) {
      setCardTasks([]); setCardSprintStatus(null); setCardReleases([]); setCardSprintPriority(null);
      return;
    }
    setCardTasksLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LoreSprintTask>('tasks_of_sprint', { sprint_id: sprintId }, ctrl.signal),
      fetchLoreSlice<{ status_raw: string | null; release_ids: string[] | null; priority: string | null }>('sprint_tree', { id: sprintId }, ctrl.signal),
    ])
      .then(([tasks, trees]) => {
        setCardTasks(tasks);
        setCardSprintStatus(trees[0]?.status_raw ?? null);
        setCardReleases(trees[0]?.release_ids ?? []);
        setCardSprintPriority(trees[0]?.priority ?? null);
        setCardTasksLoading(false);
      })
      .catch(() => { setCardTasks([]); setCardTasksLoading(false); });
    setTaskStatusFilter(new Set());
    setSelectedTaskUid(null);
    return () => ctrl.abort();
  }, [sprintCard?.represents_sprint]);

  // ── Derived scalars ──────────────────────────────────────────────────────────
  const w0 = useMemo(() => config ? new Date(config.w0_date) : null, [config]);
  const W_NOW = w0 ? Math.round((Date.now() - w0.getTime()) / WEEK_MS) : 0;
  const nowLabel = useMemo(() => {
    if (!w0) return '';
    const d = addWeeks(w0, W_NOW);
    const monthKey = MONTH_KEYS[d.getMonth()];
    return `${d.getDate()} ${t(`lore.planBoard.month.${monthKey}`, MONTHS[d.getMonth()])}`;
  }, [w0, W_NOW, t]);

  const itemsWithPos = items.filter(it => it.week_start != null && it.week_end != null).length;
  const parityPct    = items.length > 0 ? Math.round(itemsWithPos / items.length * 100) : 0;

  // ── Component-tree resolver ───────────────────────────────────────────────
  // The board groups by the real component tree: Project (root) → Component
  // (project's direct child = lane) → bars. Deeper sub-components don't get their
  // own lane — instead the bar carries the leaf component's game-icon.
  const compById = useMemo(
    () => new Map(comps.map(c => [c.component_id, c])), [comps]);

  // Preferred top-level project order; unknown roots fall after.
  const PROJECT_ORDER = useMemo(
    () => ['AIDA', 'ODIN', 'OMILORE', 'BRAGI', 'HARPA', 'TYR'], []);

  // Single source of truth for the board's grouping. Produces:
  //  · laneOfItem  — final vis group id for each plan item's bar
  //  · iconOfItem  — leaf component game-icon slug for each bar
  //  · groupDescs  — ordered vis group descriptors (project parents + lanes)
  // The lane comes from the *most specific* (deepest) linked component, so a sprint
  // on [DALI, VERDANDI, LOOM] lands in SEIDR (LOOM's ancestor) with a LOOM icon.
  // A project that ALSO carries sprints linked directly to its root gets a distinct
  // `<pid>__self` child lane so the project id is never used twice (vis rejects dup ids).
  const board = useMemo(() => {
    const rootOf = (id: string): string => {
      let cur = id, guard = 0;
      while (compById.get(cur)?.parent_id && guard++ < 20) cur = compById.get(cur)!.parent_id!;
      return cur;
    };
    const laneOf = (id: string): string => {
      let cur = id, guard = 0;
      while (guard++ < 20) {
        const p = compById.get(cur)?.parent_id;
        if (!p) return cur;                          // cur is a root project
        if (!compById.get(p)?.parent_id) return cur; // parent is root → cur is lane
        cur = p;
      }
      return cur;
    };
    const depth = (id: string): number => {
      let d = 0, cur = id, guard = 0;
      while (compById.get(cur)?.parent_id && guard++ < 20) { d++; cur = compById.get(cur)!.parent_id!; }
      return d;
    };

    // raw resolution per item
    const raw = new Map<string, { project: string; rawLane: string; icon: string | null }>();
    items.forEach(it => {
      const linked = (it.components ?? []).filter(c => compById.has(c));
      if (!linked.length) {
        raw.set(it.item_id, { project: NO_PROJECT, rawLane: NO_COMPONENT, icon: null });
        return;
      }
      const primary = linked.reduce((a, b) => (depth(b) > depth(a) ? b : a));
      raw.set(it.item_id, {
        project: rootOf(primary), rawLane: laneOf(primary),
        icon: compById.get(primary)?.game_icon ?? null,
      });
    });

    // project → set of raw lanes
    const projLanes = new Map<string, Set<string>>();
    raw.forEach(({ project, rawLane }) => {
      if (!projLanes.has(project)) projLanes.set(project, new Set());
      projLanes.get(project)!.add(rawLane);
    });

    const projLabel = (pid: string) => pid === NO_PROJECT ? t('lore.planBoard.noProject', '— без проекта —')
      : compById.get(pid)?.full_name ?? pid;
    const laneLabel = (lid: string) => lid === NO_COMPONENT ? t('lore.planBoard.noComponent', '— без компонента —')
      : compById.get(lid)?.full_name ?? lid;
    // A project is "flat" (single leaf row) when its only lane is the project itself.
    const isFlat = (pid: string) => {
      const s = projLanes.get(pid)!;
      return s.size === 1 && s.has(pid);
    };
    // Final vis lane id for a (project, rawLane) pair.
    const finalLane = (project: string, rawLane: string): string => {
      if (isFlat(project)) return project;            // flat project → bar on the project row
      return rawLane === project ? project + '__self' : rawLane;
    };

    const rank = (p: string) => {
      const i = PROJECT_ORDER.indexOf(p);
      return i < 0 ? PROJECT_ORDER.length + (p === NO_PROJECT ? 1 : 0) : i;
    };
    const projects = [...projLanes.keys()].sort((a, b) => rank(a) - rank(b));

    // ordered group descriptors. vis-timeline can't always resolve a nested group's
    // tree level → it tags them `vis-group-level-unknown-but-gte1`, whose stock skin
    // is a bright-red warning border (vis-timeline-graph2d.css). lore-timeline.css
    // overrides that class so no red leaks in any theme.
    const groupDescs: { id: string; label: string; nested?: string[] }[] = [];
    projects.forEach(pid => {
      if (isFlat(pid)) {
        groupDescs.push({ id: pid, label: projLabel(pid) });
        return;
      }
      const lanes = [...projLanes.get(pid)!].sort((a, b) =>
        laneLabel(a).localeCompare(laneLabel(b)));
      const childIds = lanes.map(l => finalLane(pid, l));
      groupDescs.push({ id: pid, label: projLabel(pid), nested: childIds });
      lanes.forEach(l => {
        const fid = finalLane(pid, l);
        const label = l === pid ? t('lore.planBoard.commonLane', '{{project}} · общие', { project: projLabel(pid) }) : laneLabel(l);
        groupDescs.push({ id: fid, label });
      });
    });

    const laneOfItem = new Map<string, string>();
    const iconOfItem = new Map<string, string | null>();
    raw.forEach((v, itemId) => {
      laneOfItem.set(itemId, finalLane(v.project, v.rawLane));
      iconOfItem.set(itemId, v.icon);
    });

    return { groupDescs, laneOfItem, iconOfItem };
  }, [items, compById, PROJECT_ORDER, t]);

  // ── Create the Timeline once data is loaded ──────────────────────────────────
  useEffect(() => {
    if (loading || !config || !w0 || !hostRef.current) return;

    // ── 2-level nested groups from the component tree: Project → Component lane.
    // board.groupDescs is already ordered and de-duplicated; a parent carries
    // `nested`, a leaf/flat row doesn't. Each label is prefixed with the component's
    // game-icon (the `__self` lanes resolve to their project's icon).
    const groupLabel = (id: string, label: string): string => {
      const cid  = id.endsWith('__self') ? id.slice(0, -6) : id;
      const slug = compById.get(cid)?.game_icon;
      const icon = slug ? statusIconSvg(slug, 'var(--t2)') : '';
      return icon + esc(label);
    };
    const groups = new DataSet<TimelineGroup>([]);
    board.groupDescs.forEach((g, i) => {
      if (g.nested) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        groups.add({ id: g.id, content: groupLabel(g.id, g.label), order: i,
          nestedGroups: g.nested, showNested: true } as any);
      } else {
        groups.add({ id: g.id, content: groupLabel(g.id, g.label), order: i } as TimelineGroup);
      }
    });

    const itemsDS = new DataSet<TimelineItem>([]);
    itemsDSRef.current = itemsDS;

    const options: TimelineOptions = {
      stack: true,
      orientation: { axis: 'top', item: 'top' },
      groupOrder: 'order',
      zoomMin: 3 * 86400 * 1000,           // 3 days
      zoomMax: 3 * 365 * 86400 * 1000,     // ~3 years
      margin: { item: { horizontal: 3, vertical: 7 }, axis: 8 },
      showCurrentTime: true,
      selectable: true,
      multiselect: false,
      horizontalScroll: true,
      verticalScroll: true,
      zoomKey: 'ctrlKey',
      maxHeight: '100%',
      tooltip: { followMouse: true, overflowMethod: 'flip' },
      // Item content carries our own inline status SVG; labels are HTML-escaped
      // (esc()) so disabling the sanitizer is safe and keeps the icons.
      xss: { disabled: true },
    };

    const tl = new Timeline(hostRef.current, itemsDS, groups, options);
    timelineRef.current = tl;

    // Initial window start: the earliest STILL-OPEN sprint that's already in the
    // past (an overdue bar) so it's never hidden off-screen to the left; otherwise
    // just 3 days before today. End spans ~16 weeks forward from now.
    let earliestOverdue = W_NOW;
    for (const it of items) {
      if (it.week_start == null || it.week_start >= W_NOW) continue;  // future/unpositioned
      const raw = it.represents_sprint ? statusBySprint.get(it.represents_sprint) : undefined;
      const st  = raw ? taskTick(raw).status : (it.status ?? 'todo');
      if (st === 'done' || st === 'cancelled') continue;              // closed → not overdue
      if (it.week_start < earliestOverdue) earliestOverdue = it.week_start;
    }
    const todayMargin = new Date(Date.now() - 3 * 86400 * 1000);
    const overdueDate = addWeeks(w0, earliestOverdue);
    const winStart = overdueDate < todayMargin ? overdueDate : todayMargin;
    tl.setWindow(winStart, addWeeks(w0, W_NOW + 14), { animation: false });
    // Belt-and-suspenders against a 0×0 construction (flex sizes after layout):
    // force one redraw on the next frame so the first paint is never blank.
    requestAnimationFrame(() => { if (timelineRef.current === tl) tl.redraw(); });

    tl.on('select', (props: { items: Array<string | number> }) => {
      const id = props.items[0];
      if (id == null) { setSprintCard(null); setMsPanel(null); return; }
      const sid = String(id);
      if (sid.startsWith('ms_')) {
        const ms = msByIdRef.current.get(sid.slice(3)) ?? null;
        setSprintCard(null); setMsPanel(ms);
      } else {
        const it = itemByIdRef.current.get(sid) ?? null;
        setMsPanel(null);
        // Click on a real sprint → jump to its passport; a placeholder (no sprint)
        // has nowhere to navigate, so it still opens the inline card.
        if (it?.represents_sprint && onNavigateToSprint) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (tl as any).setSelection([]);  // clear so re-clicking the same bar fires again
          onNavigateToSprint(it.represents_sprint);
        } else {
          setSprintCard(it);
        }
      }
    });

    // vis measures the container at construction; under flex the real size only
    // resolves after layout, so redraw when the host's dimensions actually
    // change (guarded to avoid a scrollbar-flutter redraw loop).
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (Math.round(width) === lastW && Math.round(height) === lastH) return;
      lastW = Math.round(width); lastH = Math.round(height);
      tl.redraw();
    });
    ro.observe(hostRef.current);

    return () => { ro.disconnect(); tl.destroy(); timelineRef.current = null; itemsDSRef.current = null; };
    // Re-create only when the structural inputs change.
  }, [loading, config, w0, board.groupDescs, mss.length, releases.length]);

  // ── SVG dep arrows overlay ────────────────────────────────────────────────
  // Map sprint_id → item_id for DOM lookup
  const sprintToItemId = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach(it => { if (it.represents_sprint) m.set(it.represents_sprint, it.item_id); });
    return m;
  }, [items]);

  // Critical path (hard edges only)
  const criticalSprints = useMemo(() => {
    const dur = new Map<string, number>();
    items.forEach(it => {
      if (it.represents_sprint && it.week_start != null && it.week_end != null)
        dur.set(it.represents_sprint, Math.max(1, it.week_end - it.week_start));
    });
    return computeCriticalPath(deps, dur);
  }, [deps, items]);

  const drawArrows = useCallback(() => {
    const svg = svgRef.current;
    const host = hostRef.current;
    if (!svg || !host) { if (svg) svg.innerHTML = ''; return; }

    // vis-timeline doesn't add data-id to DOM nodes; use internal itemSet API instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tlAny = timelineRef.current as any;
    const itemSet = tlAny?.itemSet;

    const svgRect = svg.getBoundingClientRect();
    const parts: string[] = [];

    // ── Milestone markers at top of SVG ──────────────────────────────────────
    // centerContainer is the scrollable item area; use its bounding rect to map
    // time → x pixel, then shift into SVG coordinate space.
    const cc = tlAny?.dom?.centerContainer as HTMLElement | undefined;
    const range = tlAny?.range as { start: number; end: number } | undefined;
    if (cc && range && w0 && mss.length) {
      const ccRect = cc.getBoundingClientRect();
      const span   = range.end - range.start;
      for (const ms of mss) {
        if (ms.week == null) continue;
        const msTime = addWeeks(w0, ms.week).getTime();
        const frac   = (msTime - range.start) / span;
        if (frac < -0.01 || frac > 1.01) continue;
        const x = ccRect.left - svgRect.left + frac * ccRect.width;
        const label = ms.milestone_id;
        const tip   = `${ms.milestone_id}: ${ms.label}` + (ms.date_display ? ' · ' + ms.date_display : '');
        const labelW = label.length * 6 + 12;
        parts.push(
          // vertical guide line (full height, very subtle)
          `<line x1="${x}" y1="0" x2="${x}" y2="${svgRect.height}"` +
          ` stroke="var(--wrn)" stroke-width="1" stroke-dasharray="3 5" opacity="0.2"` +
          ` style="pointer-events:none"/>` +
          // diamond marker at top
          `<polygon points="${x},0 ${x+5},7 ${x},14 ${x-5},7"` +
          ` fill="var(--wrn)" opacity="0.9" style="pointer-events:none"><title>${tip}</title></polygon>` +
          // short solid line below diamond
          `<line x1="${x}" y1="14" x2="${x}" y2="28"` +
          ` stroke="var(--wrn)" stroke-width="1.5" opacity="0.55" style="pointer-events:none"/>` +
          // label to the right of diamond
          `<text x="${x+7}" y="12" fill="var(--wrn)" font-size="9" font-weight="600"` +
          ` font-family="var(--mono)" opacity="0.9" style="pointer-events:none">${label}</text>` +
          // transparent clickable hit-area over diamond + label
          `<rect x="${x-6}" y="0" width="${labelW + 12}" height="28" fill="transparent"` +
          ` data-ms="${ms.milestone_id}" style="pointer-events:auto;cursor:pointer"><title>${tip}</title></rect>`
        );
      }
    }

    if (showDeps && cc) {
      const ccRect  = cc.getBoundingClientRect();
      const ccLeft  = ccRect.left  - svgRect.left;
      const ccRight = ccRect.right - svgRect.left;

      // Resolve the DOM node for a rendered bar (range box or point).
      const itemEl = (id: string): HTMLElement | null => {
        if (itemSet) {
          const d = itemSet.items[id]?.dom;
          if (d) return (d.box ?? d.point ?? null) as HTMLElement | null;
        }
        return host!.querySelector<HTMLElement>(`.vis-iid-${CSS.escape(id)}`);
      };

      // Anchor point for a sprint's bar. On-screen → the bar's edge. Off-screen →
      // the centre of its LANE row clamped to a board edge (`offX`): a prerequisite
      // (upstream) clamps to the LEFT edge, a dependent (downstream) to the RIGHT —
      // same vertical point as the lane, just pinned to the side it lives off toward.
      const anchorFor = (sprint: string, side: 'left' | 'right', offX: number):
          { x: number; y: number; off: boolean } | null => {
        const itemId = sprintToItemId.get(sprint);
        if (!itemId) return null;
        const el = itemEl(itemId);
        // Treat the bar as on-screen while ANY part of it overlaps the visible centre
        // panel (not just its connecting edge) — then anchor to that edge, clamped
        // into view. We only switch to the lane-edge once the bar is FULLY out of the
        // panel, so the endpoint tracks the bar smoothly and never jumps mid-scroll.
        if (el) {
          const r        = el.getBoundingClientRect();
          const barLeft  = r.left  - svgRect.left;
          const barRight = r.right - svgRect.left;
          const fullyOff = barRight < ccLeft || barLeft > ccRight;
          if (!fullyOff) {
            const edge = side === 'right' ? barRight : barLeft;
            const x = Math.max(ccLeft, Math.min(ccRight, edge));  // clamp into view
            return { x, y: (r.top + r.bottom) / 2 - svgRect.top, off: false };
          }
        }
        // Fully off-screen (missing, or entirely outside the panel) → lane-row centre,
        // pinned to the board edge it lives off toward (offX).
        const laneId = board.laneOfItem.get(sprint);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const grp = laneId ? (itemSet?.groups?.[laneId] as any) : null;
        const gel = grp?.dom?.foreground as HTMLElement | undefined;
        if (gel) {
          const gr = gel.getBoundingClientRect();
          return { x: offX, y: (gr.top + gr.bottom) / 2 - svgRect.top, off: true };
        }
        // Last resort: bar element known but no lane row → keep its Y, clamp X.
        if (el) {
          const r = el.getBoundingClientRect();
          return { x: offX, y: (r.top + r.bottom) / 2 - svgRect.top, off: true };
        }
        return null;
      };

      deps.forEach(dep => {
        // prerequisite = to_sprint (right edge, off→left) → dependent = from_sprint (left edge, off→right)
        const a = anchorFor(dep.to_sprint, 'right', ccLeft);
        const b = anchorFor(dep.from_sprint, 'left', ccRight);
        if (!a || !b) return;
        if (a.off && b.off) return;       // both off-screen → nothing meaningful to show

        const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
        const onCp   = criticalSprints.has(dep.from_sprint) && criticalSprints.has(dep.to_sprint);
        const isHard = dep.kind === 'hard';
        // Control points a fixed short distance out of each end → tidy diagonal,
        // never a giant arc across the board.
        const span = Math.abs(x2 - x1);
        const off  = Math.max(18, Math.min(70, span * 0.3));
        const c1x  = x1 + off, c2x = x2 - off;

        const stroke    = onCp ? 'var(--danger)' : isHard ? 'var(--t3)' : 'var(--bd)';
        const strokeW   = onCp ? 2 : isHard ? 1.5 : 1;
        const dash      = isHard || onCp ? '' : ` stroke-dasharray="4 3"`;
        const filter    = onCp ? ' filter="url(#cp-glow)"' : '';
        // Off-screen ends get no arrowhead (it'd point at the void); only an on-screen
        // dependent end carries the marker.
        const markerEnd = b.off ? '' : ` marker-end="${onCp ? 'url(#arr-cp)' : isHard ? 'url(#arr-hard)' : 'url(#arr-soft)'}"`;
        // A small hollow dot marks an off-screen endpoint sitting on the board edge.
        const edgeDot = (p: { x: number; y: number; off: boolean }) => p.off
          ? `<circle cx="${p.x}" cy="${p.y}" r="3" fill="none" stroke="${stroke}" stroke-width="1.2" opacity="0.7"/>` : '';
        const opacity = (a.off || b.off) ? 0.45 : (span > 700 ? 0.5 : 0.85);

        parts.push(
          `<path d="M${x1},${y1} C${c1x},${y1} ${c2x},${y2} ${x2},${y2}"` +
          ` fill="none" stroke="${stroke}" stroke-width="${strokeW}"${dash}${filter}${markerEnd}` +
          ` opacity="${opacity}"/>` + edgeDot(a) + edgeDot(b)
        );
      });
    }

    svg.innerHTML = `
      <defs>
        <filter id="cp-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <marker id="arr-soft" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--bd)" opacity="0.7"/>
        </marker>
        <marker id="arr-hard" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--t3)"/>
        </marker>
        <marker id="arr-cp" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--danger)"/>
        </marker>
      </defs>
      ${parts.join('\n')}
    `;
  }, [deps, sprintToItemId, criticalSprints, showDeps, mss, w0, board]);

  // Re-draw on any change that shifts bar positions. `rangechange` fires
  // continuously during zoom/pan (unlike `rangechanged`, which only fires once at
  // the end) — binding it keeps the overlay glued to the bars through the whole
  // animation instead of snapping back into place afterwards. We rAF-throttle so a
  // burst of range events collapses to one redraw per frame.
  useEffect(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    let raf = 0;
    const draw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawArrows(); }); };
    tl.on('rangechange',  draw);
    tl.on('rangechanged', drawArrows);
    tl.on('changed',      drawArrows);
    drawArrows();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      tl.off('rangechange',  draw);
      tl.off('rangechanged', drawArrows);
      tl.off('changed',      drawArrows);
    };
  }, [drawArrows]);

  // Re-draw when the SVG container resizes (panel open/close, window resize).
  // Firing drawArrows synchronously inside the ResizeObserver reads bar rects BEFORE
  // vis-timeline has finished repositioning them → the critical-path/overlay glitches
  // mid-resize. So we rAF-throttle (run after layout) AND schedule a trailing
  // "settle" redraw once resizing stops, to lock onto the final positions.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let raf = 0;
    let settle = 0;
    const redraw = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawArrows(); });
      clearTimeout(settle);
      settle = window.setTimeout(() => { drawArrows(); }, 120);
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(svg);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [drawArrows]);

  // Milestone clicks — delegated on the SVG overlay (markers carry data-ms).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onClick = (e: MouseEvent) => {
      const target = (e.target as Element)?.closest('[data-ms]');
      if (!target) return;
      const id = target.getAttribute('data-ms');
      if (!id) return;
      const ms = msByIdRef.current.get(id) ?? null;
      setSprintCard(null);
      setMsPanel(ms);
    };
    svg.addEventListener('click', onClick);
    return () => svg.removeEventListener('click', onClick);
  }, []);

  // ── (Re)populate items whenever data / toggles change ────────────────────────
  useEffect(() => {
    const ds = itemsDSRef.current;
    if (!ds || !w0) return;

    const itemById = new Map<string, LorePlanItem>();
    const msById   = new Map<string, LoreMilestone>();
    const next: TimelineItem[] = [];

    // Section background bands
    for (const sec of sections) {
      next.push({
        id: 'sec_' + sec.section_id,
        content: sec.label,
        start: addWeeks(w0, sec.start_week),
        end:   addWeeks(w0, sec.end_week),
        type: 'background',
        className: 'sec',
        style: `background-color:${sec.color}14;border-color:${sec.color}40;`,
      } as TimelineItem);
    }

    // Plan-item bars — real sprints first so stubs never displace them during dedup.
    const seenSprints = new Set<string>();
    const sortedItems = [...items].sort((a, b) =>
      (a.represents_sprint ? 0 : 1) - (b.represents_sprint ? 0 : 1));
    for (const item of sortedItems) {
      const ws = item.week_start;
      const we = item.week_end;
      if (ws == null || we == null) continue;                 // unpositioned → skip
      if (cropPast && we < W_NOW) continue;
      const isStub = item.represents_sprint == null;           // placeholder, not a sprint
      if (!isStub && item.represents_sprint) {
        if (seenSprints.has(item.represents_sprint)) continue; // already rendered this sprint
        seenSprints.add(item.represents_sprint);
      }
      if (!showStubs && isStub) continue;
      if (!showSprints && !isStub) continue;
      // Effective status: for sprint bars use the REAL sprint state (status_raw
      // parsed by taskTick), not plan_item.status which drifts from reality.
      const sprintRaw = item.represents_sprint
        ? statusBySprint.get(item.represents_sprint) : undefined;
      const effStatus = sprintRaw ? taskTick(sprintRaw).status : (item.status ?? 'todo');
      if (effStatus === 'cancelled') continue;
      const isDone = effStatus === 'done';
      if (!showDone && isDone) continue;
      if (!showActive && !isDone) continue;

      itemById.set(item.item_id, item);

      // Actual close week from the sprint's SCD2 done-date, when known.
      const doneIso = isDone && item.represents_sprint
        ? doneBySprint.get(item.represents_sprint) : undefined;
      const weAct = doneIso != null
        ? Math.max(ws + 1, Math.round((new Date(doneIso).getTime() - w0.getTime()) / WEEK_MS))
        : null;
      // Split the "todo" bucket so planned sprints ≠ placeholders:
      //  · todo + has sprint  → planned (acc colour, calendar icon)
      //  · todo + no sprint   → stub/placeholder (hollow dashed, light-bulb)
      //  · everything else    → by real status (done/active/blocked/partial)
      let famClass: string, iconSlug: string, iconColor: string;
      if (effStatus === 'todo' && isStub) {
        famClass = 'fam-stub'; iconSlug = 'light-bulb'; iconColor = 'var(--t3)';
      } else if (effStatus === 'todo') {
        famClass = 'fam-planned'; iconSlug = 'calendar'; iconColor = 'var(--acc)';
      } else {
        const m = statusMeta(effStatus);
        famClass = 'fam-' + statusFamily(effStatus);
        iconSlug = m.icon; iconColor = m.color;
      }

      // One bar per sprint: if done with a known close date, show actual span;
      // otherwise show planned span. Plan vs fact info surfaced in the tooltip.
      const displayEnd = (isDone && weAct != null) ? weAct : we;
      // Lane + type icon: a real sprint inherits its leaf-component's game-icon;
      // a placeholder (stub) gets the single unique STUB_ICON instead.
      const laneId = board.laneOfItem.get(item.item_id) ?? NO_COMPONENT;
      const typeIconSlug = isStub ? STUB_ICON : board.iconOfItem.get(item.item_id);
      const compIcon = typeIconSlug ? statusIconSvg(typeIconSlug, 'var(--t2)') : '';
      next.push({
        id: item.item_id,
        group: laneId,
        content: statusIconSvg(iconSlug, iconColor) + compIcon + esc(cleanLabel(item.label)),
        start: addWeeks(w0, ws),
        end:   addWeeks(w0, Math.max(ws + 1, displayEnd)),
        type: 'range',
        className: `it ${famClass}`,
        title: `${item.label}\n` + t('lore.planBoard.tooltip.plan', 'план W{{ws}}–{{we}}', { ws, we })
          + (weAct != null ? '\n' + t('lore.planBoard.tooltip.fact', 'факт W{{ws}}–{{we}}', { ws, we: weAct }) : '')
          + (item.represents_sprint ? `\n${item.represents_sprint}` : '')
          + '\n' + t('lore.planBoard.tooltip.status', 'статус: {{status}}', { status: effStatus }),
      } as TimelineItem);

    }

    // Milestones are now rendered as SVG overlay markers at the top (see drawArrows).
    // We still populate msByIdRef for the click handler.
    for (const ms of mss) {
      msById.set(ms.milestone_id, ms);
    }

    // Release marker — only the CURRENT release, as one vertical guide-line.
    // (All 71 lines cluttered the board; the full list lives in «Релизы».)
    for (const rel of releases) {
      if (rel.week == null || !rel.is_current) continue;
      const at = addWeeks(w0, rel.week);
      next.push({
        id: 'rel_' + rel.release_id,
        start: at,
        end: new Date(at.getTime() + WEEK_MS * 0.12),
        type: 'background',
        className: 'rel cur',
        title: `${rel.git_tag ?? rel.release_id}\nW${rel.week}${rel.release_date ? ' · ' + rel.release_date.slice(0, 10) : ''}`,
      } as TimelineItem);
    }

    itemByIdRef.current = itemById;
    msByIdRef.current   = msById;
    ds.clear();
    ds.add(next);
  }, [items, sections, mss, cps, releases, doneBySprint, statusBySprint, w0,
      showDone, showActive, cropPast, showSprints, showStubs, W_NOW, board]);

  // ── Drag-resize the bottom detail panel ──────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panelDragRef.current) return;
      const delta = panelDragRef.current.y - e.clientY;   // drag up → taller
      setPanelH(Math.min(560, Math.max(120, panelDragRef.current.h + delta)));
    };
    const onUp = () => { panelDragRef.current = null; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Register a real sprint for a plan-item placeholder ───────────────────────
  function handleRegisterSprint(item: LorePlanItem) {
    setRegistering(true);
    registerLoreSprint(item.item_id, { name: item.label, status: 'active' })
      .then(r => {
        // Optimistically link the bar → it flips from placeholder to sprint, and
        // its colour follows the new sprint's status (active → 🔄 IN PROGRESS).
        setItems(prev => prev.map(it =>
          it.item_id === item.item_id ? { ...it, represents_sprint: r.sprint_id } : it));
        setSprintCard(prev => prev && prev.item_id === item.item_id
          ? { ...prev, represents_sprint: r.sprint_id } : prev);
        setStatusBySprint(prev => {
          const m = new Map(prev); m.set(r.sprint_id, '🔄 IN PROGRESS'); return m;
        });
      })
      .catch(e => onError(e))
      .finally(() => setRegistering(false));
  }

  function startPanelDrag(e: React.MouseEvent) {
    panelDragRef.current = { y: e.clientY, h: panelH };
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  // ── Status cycling helper (panel button) ─────────────────────────────────────
  function applyStatusCycle(target: LorePlanItem) {
    const sid = target.represents_sprint;
    if (sid) {
      // Sprint bar → cycle the REAL sprint status (status_raw); update
      // statusBySprint so the bar re-colours immediately (no reload).
      const prevRaw = statusBySprint.get(sid);
      const cur  = prevRaw ? taskTick(prevRaw).status : 'todo';
      const next = cycleStatus(cur);
      setStatusBySprint(m => { const n = new Map(m); n.set(sid, STATUS_RAW[next] ?? next); return n; });
      postLoreStatus('sprint', sid, next).catch(err => {
        console.error('[lore status cycle]', err);
        setStatusBySprint(m => { const n = new Map(m); if (prevRaw == null) n.delete(sid); else n.set(sid, prevRaw); return n; });
      });
      return;
    }
    // Placeholder (no sprint) → cycle plan_item.status.
    const newStatus = cycleStatus(target.status);
    const prevStatus = target.status;
    setItems(prev => prev.map(it =>
      it.item_id === target.item_id ? { ...it, status: newStatus } : it));
    setSprintCard(prev => prev && prev.item_id === target.item_id
      ? { ...prev, status: newStatus } : prev);
    postLoreStatus('plan_item', target.item_id, newStatus).catch(err => {
      console.error('[lore status cycle]', err);
      setItems(prev => prev.map(it =>
        it.item_id === target.item_id ? { ...it, status: prevStatus } : it));
      setSprintCard(prev => prev && prev.item_id === target.item_id
        ? { ...prev, status: prevStatus } : prev);
    });
  }

  if (loading) return <div style={S.empty}>{t('lore.planBoard.loading', 'Loading plan…')}</div>;
  if (!config)  return <div style={S.empty}>{t('lore.planBoard.configNotFound', 'Plan config not found in system_aida_lore.')}</div>;

  // Effective status of an item (real sprint state for sprint bars).
  const effStatusOf = (it: LorePlanItem): string => {
    const raw = it.represents_sprint ? statusBySprint.get(it.represents_sprint) : undefined;
    return raw ? taskTick(raw).status : (it.status ?? 'todo');
  };

  const shownBars = items.filter(it => {
    if (it.week_start == null || it.week_end == null) return false;
    if (effStatusOf(it) === 'cancelled') return false;
    if (cropPast && it.week_end < W_NOW) return false;
    const isStub = it.represents_sprint == null;
    if (!showStubs && isStub) return false;
    if (!showSprints && !isStub) return false;
    const isDone = effStatusOf(it) === 'done';
    if (!showDone && isDone) return false;
    if (!showActive && !isDone) return false;
    return true;
  }).length;

  // Legend shows only statuses that actually occur (avoids advertising phantoms).
  const presentStatuses = STATUS_ORDER.filter(s => items.some(it => effStatusOf(it) === s));

  return (
    <div style={S.root}>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div style={S.toolbar}>
        <Tog active={showActive} onClick={() => setShowActive(v => !v)}>{t('lore.planBoard.toolbar.active', 'Активные')}</Tog>
        <Tog active={showDone}   onClick={() => setShowDone(v => !v)}>{t('lore.planBoard.toolbar.done', 'Done')}</Tog>
        <Tog active={!cropPast}  onClick={() => setCropPast(v => !v)}>{t('lore.planBoard.toolbar.past', 'Прошлые')}</Tog>
        <span style={S.divider} />
        <Tog active={showSprints} onClick={() => setShowSprints(v => !v)}>{t('lore.planBoard.toolbar.sprints', 'Спринты')}</Tog>
        <Tog active={showStubs}   onClick={() => setShowStubs(v => !v)}>{t('lore.planBoard.toolbar.stubs', 'Заглушки')}</Tog>
        <span style={S.divider} />
        <Tog active={showDeps && deps.length > 0} onClick={() => setShowDeps(v => !v)}
          title={t('lore.planBoard.toolbar.depsTooltip', 'Стрелки зависимостей ({{count}}); красный = критический путь', { count: deps.length })}>
          {t('lore.planBoard.toolbar.deps', 'Зависимости')}{deps.length > 0 ? ` ${deps.length}` : ''}
        </Tog>
        <button style={S.btn} onClick={() => timelineRef.current?.fit({ animation: true })}
          title={t('lore.planBoard.toolbar.fitTooltip', 'Уместить все бары в экран')}>
          {t('lore.planBoard.toolbar.fit', 'Сжать')}
        </button>
        <button style={S.btn} onClick={() => {
          if (!w0) return;
          // «Раздвинуть» → 8-week detail view starting just before today.
          timelineRef.current?.setWindow(
            addWeeks(w0, W_NOW - 0.3), addWeeks(w0, W_NOW + 8), { animation: true });
        }} title={t('lore.planBoard.toolbar.expandTooltip', 'Раздвинуть — 8 недель вокруг сегодня')}>
          {t('lore.planBoard.toolbar.expand', 'Раздвинуть')}
        </button>

        <span style={{ flex: 1 }} />

        <span style={S.stat}>{t('lore.planBoard.toolbar.barsLanes', '{{shown}} / {{total}} баров · {{lanes}} дорожек', { shown: shownBars, total: items.length, lanes: board.groupDescs.filter(g => !g.nested).length })}</span>

        <span
          style={{ ...S.zlabel, color: 'var(--acc)', opacity: 0.85, fontWeight: 600 }}
          title={t('lore.planBoard.toolbar.currentWeekTooltip', 'Текущая неделя плана (W0 = {{w0}})', { w0: config.w0_date })}
        >
          W{W_NOW} · {nowLabel}
        </span>
        <span style={S.stat} title={t('lore.planBoard.toolbar.parityTooltip', 'Паритет: доля баров с позицией (SAGA↔план)')}>
          {t('lore.planBoard.toolbar.parity', '{{pct}}% parity', { pct: parityPct })}
        </span>
        <span style={{ ...S.zlabel, opacity: 0.6 }}>{t('lore.planBoard.toolbar.hint', 'Ctrl+колесо = зум · тащить = листать')}</span>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div style={S.legend}>
        <span style={S.legendCap}>{t('lore.planBoard.legend.caption', 'заливка = статус:')}</span>
        {presentStatuses.filter(s => s !== 'todo').map(s => (
          <LegendStatus key={s} status={s}
            label={t(`lore.planBoard.status.${STATUS_KEY[s] ?? s}`, STATUS_RU[s] ?? s)} />
        ))}
        {presentStatuses.includes('todo') && (
          <>
            <span style={S.legendGlyph}><GameIcon slug="calendar" size={12} style={{ color: 'var(--acc)' }} /> {t('lore.planBoard.legend.planned', 'планируется')}</span>
            <span style={S.legendGlyph}><GameIcon slug="light-bulb" size={12} style={{ color: 'var(--t3)' }} /> {t('lore.planBoard.legend.stub', 'заглушка')}</span>
          </>
        )}
        <span style={S.legendSep} />
        <span style={S.legendGlyph}>
          <span style={{ width: 14, height: 11, borderRadius: 2, display: 'inline-block',
            background: 'var(--bg3)', border: '2px solid var(--acc)' }} /> {t('lore.planBoard.legend.milestone', 'веха')}
        </span>
        <span style={S.legendGlyph}>
          <span style={{ width: 2, height: 13, display: 'inline-block',
            background: 'color-mix(in srgb, var(--wrn) 60%, transparent)' }} /> {t('lore.planBoard.legend.currentRelease', 'текущий релиз')}
        </span>
        <span style={S.legendGlyph}>
          <span style={{ width: 16, height: 11, borderRadius: 2, display: 'inline-block',
            background: 'color-mix(in srgb, var(--acc) 14%, transparent)', border: '1px solid var(--b3)' }} /> {t('lore.planBoard.legend.phase', 'фаза')}
        </span>
        <span style={S.legendDim}>{t('lore.planBoard.legend.clickHint', 'клик по бару → карточка спринта')}</span>
      </div>

      {/* ── Main: timeline host + side panel ───────────────────────────────── */}
      <div style={S.main}>
        <div ref={hostRef} className="lore-tl" style={S.host} />
        {/* SVG dep-arrow overlay — sits above the timeline, pointer-events: none */}
        <svg ref={svgRef} style={S.depSvg} aria-hidden="true" />

        {/* Sprint card panel */}
        {sprintCard && (
          <div style={{ ...S.panel, height: panelH }}>
            <ResizeGrip onDown={startPanelDrag} />
            <div style={S.panelHdr}>
              <TypeBadge isSprint={sprintCard.represents_sprint != null} />
              <span style={S.panelTitle}>{sprintCard.label}</span>
              <button style={S.closeBtn} onClick={() => setSprintCard(null)}>✕</button>
            </div>
            <div style={S.panelBody}>
             <div style={S.panelCol}>
              {/* Placeholder → register a real sprint */}
              {!sprintCard.represents_sprint && (
                <button
                  onClick={() => handleRegisterSprint(sprintCard)}
                  disabled={registering}
                  title={t('lore.planBoard.card.registerTooltip', 'Создать KnowSprint, связать план-элемент (REPRESENTS) и завести начальный статус')}
                  style={{
                    display: 'block', width: '100%', marginBottom: 10,
                    padding: '6px 8px', borderRadius: 4, cursor: registering ? 'default' : 'pointer',
                    fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                    background: 'color-mix(in srgb, var(--acc) 16%, transparent)',
                    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 40%, transparent)',
                    opacity: registering ? 0.6 : 1,
                  }}
                >
                  {registering ? t('lore.planBoard.card.registering', 'Регистрирую…') : t('lore.planBoard.card.registerSprint', '＋ Запланировать спринт')}
                </button>
              )}
              <PRow k="ID"     v={sprintCard.item_id} />
              {sprintCard.represents_sprint && (
                <PRow k="Sprint" v={sprintCard.represents_sprint} color="var(--acc)" />
              )}
              {(sprintCard.week_start != null || sprintCard.week_end != null) && (
                <PRow k={t('lore.planBoard.card.plan', 'План')}  v={`W${sprintCard.week_start ?? '?'}–${sprintCard.week_end ?? '?'}`} />
              )}
              {(() => {
                // Факт: actual close from the sprint's done-date (план vs факт).
                const sp = sprintCard.represents_sprint;
                const dd = sp && w0 ? doneBySprint.get(sp) : undefined;
                if (!dd || !w0) return null;
                const ws = sprintCard.week_start ?? 0, we = sprintCard.week_end ?? ws;
                const wa = Math.max(ws + 1, Math.round((new Date(dd).getTime() - w0.getTime()) / WEEK_MS));
                const c = wa < we ? 'var(--suc)' : wa > we ? 'var(--wrn)' : 'var(--t2)';
                return <PRow k={t('lore.planBoard.card.fact', 'Факт')} v={`W${ws}–${wa} · ${dd.slice(0, 10)}`} color={c} />;
              })()}
              {cardReleases.length > 0 && (
                <PRow k={t('lore.planBoard.card.release', 'Релиз')} v={cardReleases.join(', ')} color="var(--acc)" />
              )}

              {/* Priority picker — only for real sprints (not plan-item stubs) */}
              {sprintCard.represents_sprint && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>{t('lore.planBoard.card.priority', 'Приоритет')}</div>
                  <div style={{ display: 'flex', gap: 4, opacity: priorityBusy ? 0.5 : 1 }}>
                    {[
                      { v: 'P0', c: '#E24B4A' },
                      { v: 'P1', c: '#ef9f27' },
                      { v: 'P2', c: 'var(--t3)' },
                    ].map(({ v, c }) => {
                      const sel = cardSprintPriority === v;
                      return (
                        <button
                          key={v} type="button" disabled={priorityBusy}
                          title={v} aria-pressed={sel}
                          onClick={() => {
                            const sid = sprintCard.represents_sprint!;
                            const next = sel ? null : v;
                            const prev = cardSprintPriority;
                            setCardSprintPriority(next);
                            setPriorityBusy(true);
                            updateLoreSprint(sid, { priority: next })
                              .catch(() => setCardSprintPriority(prev))
                              .finally(() => setPriorityBusy(false));
                          }}
                          style={{
                            padding: '0 7px', height: 18, borderRadius: 3, fontSize: 10,
                            fontWeight: sel ? 600 : 400, cursor: priorityBusy ? 'default' : 'pointer',
                            fontFamily: 'var(--mono)',
                            color: sel ? c : 'var(--t3)',
                            background: sel ? `color-mix(in srgb, ${c} 15%, transparent)` : 'transparent',
                            border: sel ? `1px solid ${c}` : '1px solid var(--bd)',
                          }}
                        >{v}</button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Status cycling badge — reflects the EFFECTIVE status (real sprint
                  status for sprint bars), and updates the board live on click. */}
              {(() => {
                const cs = effStatusOf(sprintCard);
                const m = statusMeta(cs);
                const isCancelled = cs === 'cancelled';
                return (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>{t('lore.planBoard.card.status', 'Статус')}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => applyStatusCycle(sprintCard)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 8px', borderRadius: 3, cursor: 'pointer',
                          fontSize: 11, fontWeight: 600,
                          background: `color-mix(in srgb, ${m.color} 18%, transparent)`,
                          color: m.color, border: `1px solid ${m.color}`,
                        }}
                      >
                        <GameIcon slug={m.icon} size={12} style={{ color: 'inherit' }} />
                        {cs}
                        <span style={{ opacity: 0.7, fontSize: 9 }}>→ {cycleStatus(cs)}</span>
                      </button>
                      {!sprintCard.represents_sprint && !isCancelled && (
                        <button
                          onClick={() => {
                            const prev = sprintCard.status;
                            setItems(p => p.map(it => it.item_id === sprintCard.item_id ? { ...it, status: 'cancelled' } : it));
                            setSprintCard(p => p && p.item_id === sprintCard.item_id ? { ...p, status: 'cancelled' } : p);
                            postLoreStatus('plan_item', sprintCard.item_id, 'cancelled').catch(err => {
                              console.error('[lore cancel]', err);
                              setItems(p => p.map(it => it.item_id === sprintCard.item_id ? { ...it, status: prev } : it));
                              setSprintCard(p => p && p.item_id === sprintCard.item_id ? { ...p, status: prev } : p);
                            });
                          }}
                          style={{
                            fontSize: 10, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                            background: 'transparent', color: 'var(--danger)',
                            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
                          }}
                        >
                          {t('lore.planBoard.card.cancel', '🚫 Отменить')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
             </div>{/* /panelCol */}

              {/* Tasks of the represented sprint */}
              {sprintCard.represents_sprint && (
                <div style={S.panelTasks}>
                  {/* Header: count + status filter chips */}
                  {(() => {
                    const total = cardTasks.length;
                    const done  = cardTasks.filter(t => taskTick(t.status_raw).done).length;
                    const counts: Record<string, number> = {};
                    for (const t of cardTasks) {
                      const k = taskTick(t.status_raw).status;
                      counts[k] = (counts[k] ?? 0) + 1;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, color: 'var(--t3)' }}>{t('lore.planBoard.card.tasks', 'Задачи')}</span>
                        {total > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--t2)' }}>{done}/{total}</span>
                        )}
                        {Object.entries(counts).map(([k, n]) => {
                          const m = statusMeta(k);
                          const active = taskStatusFilter.has(k);
                          return (
                            <button key={k} type="button"
                              title={`${k}: ${n}`}
                              onClick={() => setTaskStatusFilter(prev => {
                                const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s;
                              })}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                padding: '0 5px', height: 16, borderRadius: 9, cursor: 'pointer',
                                fontSize: 10, fontWeight: 700, lineHeight: 1, color: m.color,
                                background: active ? `color-mix(in srgb, ${m.color} 22%, transparent)` : 'transparent',
                                border: `1px solid color-mix(in srgb, ${m.color} ${active ? 90 : 35}%, transparent)`,
                              }}
                            >
                              <GameIcon slug={m.icon} size={10} style={{ color: m.color }} />
                              {n}
                            </button>
                          );
                        })}
                        {cardSprintStatus && (
                          <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 'auto',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}
                            title={cardSprintStatus}>
                            {cardSprintStatus}
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {cardTasksLoading && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{t('lore.planBoard.card.loading', 'Загрузка…')}</div>}
                  {!cardTasksLoading && cardTasks.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{t('lore.planBoard.card.noTasks', 'Задачи не заведены.')}</div>
                  )}
                  {!cardTasksLoading && cardTasks.length > 0 && (() => {
                    const filtered = taskStatusFilter.size === 0
                      ? cardTasks
                      : cardTasks.filter(t => taskStatusFilter.has(taskTick(t.status_raw).status));
                    return (
                      <div style={{ overflowY: 'auto' }}>
                        {filtered.map(t => {
                          const meta    = statusMeta(taskTick(t.status_raw).status);
                          const hasNote = !!(t.note_md && t.note_md.trim());
                          const open    = selectedTaskUid === t.task_uid;
                          return (
                            <div key={t.task_uid}
                              style={{ borderBottom: '1px solid color-mix(in srgb, var(--b2) 40%, transparent)' }}>
                              <div
                                onClick={() => hasNote && setSelectedTaskUid(open ? null : t.task_uid)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 5,
                                  fontSize: 11, lineHeight: 1.7, color: 'var(--t2)', minWidth: 0,
                                  cursor: hasNote ? 'pointer' : 'default', padding: '0 2px',
                                }}
                              >
                                <GameIcon slug={meta.icon} size={12} style={{ color: meta.color, flexShrink: 0 }} />
                                <span style={{ color: 'var(--acc)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                                  {t.task_id}
                                </span>
                                {t.title && (
                                  <span style={{ color: 'var(--t1)', flex: 1, overflow: 'hidden',
                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                                )}
                                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4,
                                  alignItems: 'center', flexShrink: 0 }}>
                                  {t.effort_days != null && (
                                    <span style={{ color: 'var(--t3)', fontSize: 9 }}>{t.effort_days}d</span>
                                  )}
                                  {hasNote && (
                                    <span style={{ fontSize: 9, color: 'var(--t3)' }}>{open ? '▲' : '▼'}</span>
                                  )}
                                </span>
                              </div>
                              {open && hasNote && (
                                <div style={{
                                  fontSize: 11, color: 'var(--t2)', lineHeight: 1.6,
                                  padding: '4px 8px 8px 22px', overflowX: 'auto',
                                  background: 'color-mix(in srgb, var(--b2) 50%, transparent)',
                                }}
                                  dangerouslySetInnerHTML={{ __html: marked.parse(t.note_md!) as string }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Milestone panel — "Что закрыть" */}
        {msPanel && (
          <div style={{ ...S.panel, height: panelH }}>
            <ResizeGrip onDown={startPanelDrag} />
            <div style={S.panelHdr}>
              <span style={{ ...S.panelTitle, color: 'var(--acc)' }}>
                {msPanel.milestone_id} · {msPanel.label}
              </span>
              <button style={S.closeBtn} onClick={() => setMsPanel(null)}>✕</button>
            </div>
            <div style={S.panelBodyCol}>
              {msPanel.date_display && (
                <div style={{ color: 'var(--t3)', marginBottom: 10, fontSize: 11 }}>
                  W{msPanel.week} · {msPanel.date_display}
                </div>
              )}
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11 }}>{t('lore.planBoard.milestone.toClose', 'Что закрыть:')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', columnGap: 24 }}>
                {renderMsGroups(msPanel, items, cps, setMsPanel, setSprintCard, t)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// Strip emoji (renders as boxes/CJK at small sizes on some systems)
function cleanLabel(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
}

// Infer status from label when HAS_STATUS edges are not populated (LAL-23a deferred)
function inferStatus(item: LorePlanItem): string {
  if (item.status) return item.status;
  const l = item.label ?? '';
  if (/DONE|✅|CLOSED|FINISHED/i.test(l)) return 'done';
  if (/ACTIVE|IN.?PROGRESS|WIP/i.test(l)) return 'active';
  if (/PARTIAL|ЧАСТИЧ|🟡/i.test(l)) return 'partial';
  if (/BACKLOG|postpone|ОТЛОЖЕН|blocked|DEFERRED/i.test(l)) return 'blocked';
  return 'todo';
}

function renderMsGroups(
  ms: LoreMilestone,
  items: LorePlanItem[],
  cps: LorePlanCheckpoint[],
  setMsPanel: (m: LoreMilestone | null) => void,
  setSprintCard: (i: LorePlanItem | null) => void,
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string,
) {
  const msItems = items.filter(it => it.milestone_id === ms.milestone_id);
  const grouped = new Map<string, LorePlanItem[]>();
  for (const item of msItems) {
    const st = inferStatus(item);
    if (!grouped.has(st)) grouped.set(st, []);
    grouped.get(st)!.push(item);
  }
  const msCps = cps.filter(cp => cp.milestone === ms.milestone_id);
  return (
    <>
      {msItems.length === 0 && msCps.length === 0 && (
        <div style={{ color: 'var(--t3)', fontSize: 11, padding: '4px 0' }}>
          {t('lore.planBoard.milestone.noTasks', 'Нет связанных задач.')}
        </div>
      )}
      {[...grouped.entries()].map(([st, grp]) => (
        <div key={st} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            color: statusMeta(st).color, marginBottom: 3 }}>
            <GameIcon slug={statusMeta(st).icon} size={11} style={{ color: 'inherit' }} />
            {st} ({grp.length})
          </div>
          {grp.map(it => (
            <div key={it.item_id}
              onClick={() => { setMsPanel(null); setSprintCard(it); }}
              style={{ paddingLeft: 8, color: 'var(--t2)', lineHeight: '1.7',
                fontSize: 11, cursor: 'pointer' }}>
              · {cleanLabel(it.label)}
            </div>
          ))}
        </div>
      ))}
      {msCps.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            color: 'var(--acc)', marginBottom: 3 }}>
            {t('lore.planBoard.milestone.checkpoints', 'Плашки')} ({msCps.length})
          </div>
          {msCps.map(cp => (
            <div key={cp.checkpoint_id}
              title={cp.desc_md ?? ''}
              style={{ paddingLeft: 8, color: 'var(--t2)', lineHeight: '1.7', fontSize: 10 }}>
              ✓ {cp.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Tog({ active, onClick, children, title }: {
  active: boolean; onClick: () => void; children: ReactNode; title?: string;
}) {
  return (
    <button onClick={onClick} style={{
      height: 22, padding: '0 8px',
      border: '1px solid var(--b3)', borderRadius: 3,
      fontSize: 10, cursor: 'pointer',
      background: active ? 'color-mix(in srgb, var(--acc) 20%, transparent)' : 'var(--b2)',
      color: active ? 'var(--acc)' : 'var(--t3)',
    }} title={title}>
      {children}
    </button>
  );
}

function LegendStatus({ status, label }: { status: string; label: string }) {
  const m = statusMeta(status);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--t2)' }}>
      <GameIcon slug={m.icon} size={12} style={{ color: m.color }} />
      {label}
    </span>
  );
}

// Drag handle at the top edge of the bottom panel (resize its height).
function ResizeGrip({ onDown }: { onDown: (e: React.MouseEvent) => void }) {
  const { t } = useTranslation();
  return (
    <div onMouseDown={onDown} title={t('lore.planBoard.resizeGripTooltip', 'Потянуть, чтобы изменить высоту панели')}
      style={{
        height: 9, flexShrink: 0, cursor: 'ns-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderBottom: '1px solid var(--bd)', background: 'var(--b2)',
      }}>
      <span style={{ width: 36, height: 3, borderRadius: 2, background: 'var(--bdh)' }} />
    </div>
  );
}

function TypeBadge({ isSprint }: { isSprint: boolean }) {
  const { t } = useTranslation();
  const c = isSprint ? 'var(--acc)' : 'var(--t3)';
  return (
    <span style={{
      flexShrink: 0, alignSelf: 'flex-start', marginTop: 1,
      fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 3,
      background: `color-mix(in srgb, ${c} 16%, transparent)`,
      color: c, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
    }}>
      {isSprint ? t('lore.planBoard.typeBadge.sprint', 'Спринт') : t('lore.planBoard.typeBadge.planItem', 'План-элемент')}
    </span>
  );
}

function PRow({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 11 }}>
      <span style={{ color: 'var(--t3)', minWidth: 52, flexShrink: 0 }}>{k}</span>
      <span style={{ color: color ?? 'var(--t1)', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    flex: 1, overflow: 'hidden', minWidth: 0,
    display: 'flex', flexDirection: 'column' as const,
    position: 'relative' as const,
  },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
    padding: '5px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  btn: {
    height: 22, padding: '0 8px',
    border: '1px solid var(--b3)', borderRadius: 3,
    fontSize: 10, cursor: 'pointer',
    background: 'var(--b2)', color: 'var(--t2)',
  },
  zlabel: { fontSize: 10, color: 'var(--t3)' },
  stat:   { fontSize: 10, color: 'var(--t3)' },
  divider:{ width: 1, height: 16, background: 'var(--b3)', margin: '0 2px' },
  legend: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const,
    padding: '5px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
    background: 'var(--b1)',
  },
  legendCap:   { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  legendGlyph: { fontSize: 10, color: 'var(--t2)', display: 'inline-flex', gap: 4, alignItems: 'center' },
  legendSep:   { width: 1, height: 14, background: 'var(--b3)' },
  legendDim:   { fontSize: 10, color: 'var(--t3)', marginLeft: 'auto' },
  // Timeline on top, detail panel as a full-width strip at the bottom.
  main: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
    position: 'relative' as const, minWidth: 0,
  },
  host: { flex: 1, minWidth: 0, minHeight: 0, width: '100%', overflow: 'hidden' },
  depSvg: {
    position: 'absolute' as const, top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none' as const, overflow: 'visible',
  },
  panel: {
    flexShrink: 0, height: 232,
    borderTop: '1px solid var(--bd)',
    background: 'var(--b1)',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  panelHdr: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '8px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  // Title wraps fully now (no ellipsis) — the whole description is visible.
  panelTitle: {
    flex: 1, fontWeight: 600, fontSize: 13, lineHeight: 1.35, color: 'var(--t1)',
    overflowWrap: 'anywhere' as const,
  },
  panelBody:    { flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', gap: 24, alignItems: 'stretch' },
  panelBodyCol: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px' },
  panelCol:     { flexShrink: 0, width: 286, borderRight: '1px solid var(--bd)', paddingRight: 22 },
  panelTasks:   { flex: 1, minWidth: 0 },
  closeBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--t3)', fontSize: 13, padding: '0 4px', flexShrink: 0,
  },
};
