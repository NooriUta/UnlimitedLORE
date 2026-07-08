// LorePlanBoard — renders system_aida_lore plan data as a readable swimlane
// timeline (vis-timeline). Sprints (planned_start/end_date) → range bars,
// milestones → markers, releases → points, sections → background bands.
// Built-in zoom/pan (Ctrl+wheel zoom, wheel/drag pan) replaces the old
// hand-rolled Gantt canvas.
// Spec: PLAN_AS_DB_RENDER.md · write-path LAL-23a · time-travel LAL-25
// SPRINT_PLANITEM_RETIRE/T-12: bars now come straight from the `sprints`
// slice (planned_start_date/planned_end_date, real calendar dates) instead
// of `plan_items` (week-indexed). The placeholder/stub concept (a bar not
// backed by a real KnowSprint) is gone — every bar IS a sprint from
// creation (T-13: "＋ Спринт" navigates to the existing create-sprint
// screen instead of registering a sprint against a plan-item placeholder).
// Milestones/sections/releases stay week-indexed (their own slices haven't
// migrated), so `w0`/`W_NOW` remain for those; sprint bars compare real
// Date objects directly.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import type { TimelineOptions, TimelineItem, TimelineGroup } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import './lore-timeline.css';
import {
  fetchLoreSlice,
  type LorePlanConfig, type LorePlanSection,
  type LorePlanCheckpoint, type LoreMilestone, type LoreRelease,
  type LoreSprintDep,
  type LoreSprintDoneDate, type LoreSprintRow,
  type LoreComponent,
} from '../../api/lore';
import { areaColor, compArea } from './LoreComponentList';
import { useIsNarrow } from '../../hooks/useMediaQuery';
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

const NO_PROJECT   = '__no_project__';
const NO_COMPONENT = '__no_component__';
const WEEK_MS = 7 * 86400 * 1000;
const DAY_MS = 86400 * 1000;
function addWeeks(base: Date, w: number): Date {
  return new Date(base.getTime() + w * WEEK_MS);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  onError: (e: unknown) => void;
  /** Navigate to a sprint's passport (set when the board is wired into LorePage). */
  onNavigateToSprint?: (sprintId: string) => void;
}

// ── Critical path (longest path on hard edges, weighted by sprint duration) ──
function computeCriticalPath(
  deps: LoreSprintDep[],
  durationBySprint: Map<string, number>,   // sprint_id → days
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
  const [sprints,  setSprints]  = useState<LoreSprintRow[]>([]);
  const [cps,      setCps]      = useState<LorePlanCheckpoint[]>([]);
  const [mss,      setMss]      = useState<LoreMilestone[]>([]);
  const [releases, setReleases] = useState<LoreRelease[]>([]);

  const [doneBySprint, setDoneBySprint] = useState<Map<string, string>>(new Map());
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

  // ── Panels ─────────────────────────────────────────────────────────────────
  const [msPanel,    setMsPanel]    = useState<LoreMilestone | null>(null);
  const [panelH,     setPanelH]     = useState(238);          // resizable bottom panel
  const panelDragRef = useRef<{ y: number; h: number } | null>(null);

  // ── Timeline plumbing ────────────────────────────────────────────────────────
  const hostRef     = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsDSRef  = useRef<DataSet<TimelineItem> | null>(null);
  // id → source object lookups for the select handler
  const sprintByIdRef = useRef<Map<string, LoreSprintRow>>(new Map());
  const msByIdRef     = useRef<Map<string, LoreMilestone>>(new Map());

  // ── Load all plan slices ─────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LorePlanConfig>('plan_config',      undefined, ctrl.signal),
      fetchLoreSlice<LorePlanSection>('plan_sections',   undefined, ctrl.signal),
      fetchLoreSlice<LorePlanCheckpoint>('plan_checkpoints', undefined, ctrl.signal),
      fetchLoreSlice<LoreMilestone>('milestones',        undefined, ctrl.signal),
      fetchLoreSlice<LoreRelease>('releases',            undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintDoneDate>('sprint_done_dates', undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintRow>('sprints',            undefined, ctrl.signal),
      fetchLoreSlice<LoreComponent>('components',         undefined, ctrl.signal),
    ])
      .then(([cfgs, secs, chkps, milestones, rels, dones, sprintRows, components]) => {
        setConfig(cfgs[0] ?? null);
        setComps(components);
        setSections(secs);
        setSprints(sprintRows);
        setCps(chkps);
        setMss(milestones);
        setReleases(rels.filter(r => r.week != null));
        setDoneBySprint(new Map(
          dones.filter(d => d.done_date).map(d => [d.sprint_id, d.done_date as string])
        ));
        setStatusBySprint(new Map(
          sprintRows.filter(s => s.status_raw).map(s => [s.sprint_id, s.status_raw as string])
        ));
        setLoading(false);
        // Load deps in background — not blocking the main render
        fetchLoreSlice<LoreSprintDep>('sprint_deps', undefined, ctrl.signal)
          .then(d => setDeps(d))
          .catch(() => {/* non-critical */});
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  // ── Derived scalars ──────────────────────────────────────────────────────────
  const w0 = useMemo(() => config ? new Date(config.w0_date) : null, [config]);
  const W_NOW = w0 ? Math.round((Date.now() - w0.getTime()) / WEEK_MS) : 0;
  const nowLabel = useMemo(() => {
    if (!w0) return '';
    const d = addWeeks(w0, W_NOW);
    const monthKey = MONTH_KEYS[d.getMonth()];
    return `${d.getDate()} ${t(`lore.planBoard.month.${monthKey}`, MONTHS[d.getMonth()])}`;
  }, [w0, W_NOW, t]);

  const sprintsWithPos = sprints.filter(s => s.planned_start_date != null && s.planned_end_date != null).length;
  const parityPct      = sprints.length > 0 ? Math.round(sprintsWithPos / sprints.length * 100) : 0;

  // MOB: on narrow screens the swimlane group labels collapse to icons only,
  // tinted by the component's area (type) colour — same idea as the section nav.
  const narrow = useIsNarrow(720);

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
  //  · laneOfItem  — final vis group id for each sprint's bar
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

    // raw resolution per sprint
    const raw = new Map<string, { project: string; rawLane: string; icon: string | null }>();
    sprints.forEach(s => {
      const linked = (s.components ?? []).filter(c => compById.has(c));
      if (!linked.length) {
        raw.set(s.sprint_id, { project: NO_PROJECT, rawLane: NO_COMPONENT, icon: null });
        return;
      }
      const primary = linked.reduce((a, b) => (depth(b) > depth(a) ? b : a));
      raw.set(s.sprint_id, {
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
    raw.forEach((v, sprintId) => {
      laneOfItem.set(sprintId, finalLane(v.project, v.rawLane));
      iconOfItem.set(sprintId, v.icon);
    });

    return { groupDescs, laneOfItem, iconOfItem };
  }, [sprints, compById, PROJECT_ORDER, t]);

  // ── Create the Timeline once data is loaded ──────────────────────────────────
  useEffect(() => {
    if (loading || !config || !w0 || !hostRef.current) return;

    // ── 2-level nested groups from the component tree: Project → Component lane.
    // board.groupDescs is already ordered and de-duplicated; a parent carries
    // `nested`, a leaf/flat row doesn't. Each label is prefixed with the component's
    // game-icon (the `__self` lanes resolve to their project's icon).
    const groupLabel = (id: string, label: string): string => {
      const cid  = id.endsWith('__self') ? id.slice(0, -6) : id;
      const comp = compById.get(cid);
      const slug = comp?.game_icon;
      // Narrow: colour the icon by the component's area (type) and drop the label.
      const color = narrow ? areaColor(compArea(comp ?? {})) : 'var(--t2)';
      const icon = slug ? statusIconSvg(slug, color) : '';
      return narrow ? (icon || `<span title="${esc(label)}">•</span>`) : icon + esc(label);
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

    // Initial window: always an 8-week view centred just before today (same
    // span "Раздвинуть" jumps to on click) — overdue bars from further back
    // are still on the board, just off-screen to the left until scrolled to,
    // same as any other bar outside the current view. Previously this instead
    // stretched all the way back to the earliest overdue open sprint, which
    // could open the board on a mostly-empty multi-month span with nothing to
    // orient on.
    tl.setWindow(addWeeks(w0, W_NOW - 0.3), addWeeks(w0, W_NOW + 8), { animation: false });
    // Belt-and-suspenders against a 0×0 construction (flex sizes after layout):
    // force one redraw on the next frame so the first paint is never blank.
    requestAnimationFrame(() => { if (timelineRef.current === tl) tl.redraw(); });

    tl.on('select', (props: { items: Array<string | number> }) => {
      const id = props.items[0];
      if (id == null) { setMsPanel(null); return; }
      const sid = String(id);
      if (sid.startsWith('ms_')) {
        const ms = msByIdRef.current.get(sid.slice(3)) ?? null;
        setMsPanel(ms);
      } else {
        const sprint = sprintByIdRef.current.get(sid) ?? null;
        setMsPanel(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tl as any).setSelection([]);  // clear so re-clicking the same bar fires again
        if (sprint) onNavigateToSprint?.(sprint.sprint_id);
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
  }, [loading, config, w0, board.groupDescs, mss.length, releases.length, narrow]);

  // ── SVG dep arrows overlay ────────────────────────────────────────────────
  // Critical path (hard edges only)
  const criticalSprints = useMemo(() => {
    const dur = new Map<string, number>();
    sprints.forEach(s => {
      if (s.planned_start_date && s.planned_end_date) {
        const days = Math.round(
          (new Date(s.planned_end_date).getTime() - new Date(s.planned_start_date).getTime()) / DAY_MS);
        dur.set(s.sprint_id, Math.max(1, days));
      }
    });
    return computeCriticalPath(deps, dur);
  }, [deps, sprints]);

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
      const anchorFor = (sprintId: string, side: 'left' | 'right', offX: number):
          { x: number; y: number; off: boolean } | null => {
        const el = itemEl(sprintId);
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
        const laneId = board.laneOfItem.get(sprintId);
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
  }, [deps, criticalSprints, showDeps, mss, w0, board]);

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
    // T18: ResizeObserver can fire for sub-pixel layout deltas that produce
    // no visible change — round + compare against the last size (same
    // pattern as the vis-timeline ResizeObserver above) instead of
    // redrawing on every callback.
    let lastW = 0, lastH = 0;
    const redraw = (entries: ResizeObserverEntry[]) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.round(width), h = Math.round(height);
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
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
      setMsPanel(ms);
    };
    svg.addEventListener('click', onClick);
    return () => svg.removeEventListener('click', onClick);
  }, []);

  // ── (Re)populate items whenever data / toggles change ────────────────────────
  useEffect(() => {
    const ds = itemsDSRef.current;
    if (!ds || !w0) return;

    const sprintById = new Map<string, LoreSprintRow>();
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

    // Sprint bars.
    const today = new Date();
    for (const sprint of sprints) {
      if (!sprint.planned_start_date || !sprint.planned_end_date) continue;  // unpositioned → skip
      const start = new Date(sprint.planned_start_date);
      const end   = new Date(sprint.planned_end_date);
      if (cropPast && end < today) continue;

      const raw = statusBySprint.get(sprint.sprint_id);
      const effStatus = raw ? taskTick(raw).status : 'todo';
      if (effStatus === 'cancelled') continue;
      const isDone = effStatus === 'done';
      if (!showDone && isDone) continue;
      if (!showActive && !isDone) continue;

      sprintById.set(sprint.sprint_id, sprint);

      // Actual close date from the sprint's SCD2 done-date, when known.
      const doneIso = isDone ? doneBySprint.get(sprint.sprint_id) : undefined;
      const actualEnd = doneIso != null ? new Date(doneIso) : null;
      // One bar per sprint: if done with a known close date, show actual span;
      // otherwise show planned span. Plan vs fact info surfaced in the tooltip.
      const displayEnd = (isDone && actualEnd && actualEnd > start) ? actualEnd : end;

      let famClass: string, iconSlug: string, iconColor: string;
      if (effStatus === 'todo') {
        famClass = 'fam-planned'; iconSlug = 'calendar'; iconColor = 'var(--acc)';
      } else {
        const m = statusMeta(effStatus);
        famClass = 'fam-' + statusFamily(effStatus);
        iconSlug = m.icon; iconColor = m.color;
      }

      const laneId = board.laneOfItem.get(sprint.sprint_id) ?? NO_COMPONENT;
      const typeIconSlug = board.iconOfItem.get(sprint.sprint_id);
      const compIcon = typeIconSlug ? statusIconSvg(typeIconSlug, 'var(--t2)') : '';
      next.push({
        id: sprint.sprint_id,
        group: laneId,
        content: statusIconSvg(iconSlug, iconColor) + compIcon + esc(cleanLabel(sprint.name)),
        start,
        end: displayEnd > start ? displayEnd : new Date(start.getTime() + DAY_MS),
        type: 'range',
        className: `it ${famClass}`,
        title: `${sprint.name}\n` + t('lore.planBoard.tooltip.plan', 'план {{start}} – {{end}}',
            { start: sprint.planned_start_date, end: sprint.planned_end_date })
          + (doneIso ? '\n' + t('lore.planBoard.tooltip.fact', 'факт {{date}}', { date: doneIso.slice(0, 10) }) : '')
          + `\n${sprint.sprint_id}`
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

    sprintByIdRef.current = sprintById;
    msByIdRef.current     = msById;
    ds.clear();
    ds.add(next);
  }, [sprints, sections, mss, cps, releases, doneBySprint, statusBySprint, w0,
      showDone, showActive, cropPast, board, t]);

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

  function startPanelDrag(e: React.MouseEvent) {
    panelDragRef.current = { y: e.clientY, h: panelH };
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  if (loading) return <div style={S.empty}>{t('lore.planBoard.loading', 'Loading plan…')}</div>;
  if (!config)  return <div style={S.empty}>{t('lore.planBoard.configNotFound', 'Plan config not found in system_aida_lore.')}</div>;

  // Effective status of a sprint bar.
  const effStatusOf = (s: LoreSprintRow): string => {
    const raw = statusBySprint.get(s.sprint_id);
    return raw ? taskTick(raw).status : 'todo';
  };

  const today = new Date();
  const shownBars = sprints.filter(s => {
    if (s.planned_start_date == null || s.planned_end_date == null) return false;
    if (effStatusOf(s) === 'cancelled') return false;
    if (cropPast && new Date(s.planned_end_date) < today) return false;
    const isDone = effStatusOf(s) === 'done';
    if (!showDone && isDone) return false;
    if (!showActive && !isDone) return false;
    return true;
  }).length;

  // Legend shows only statuses that actually occur (avoids advertising phantoms).
  const presentStatuses = STATUS_ORDER.filter(s => sprints.some(sp => effStatusOf(sp) === s));

  return (
    <div style={S.root}>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div style={S.toolbar}>
        <Tog active={showActive} onClick={() => setShowActive(v => !v)}>{t('lore.planBoard.toolbar.active', 'Активные')}</Tog>
        <Tog active={showDone}   onClick={() => setShowDone(v => !v)}>{t('lore.planBoard.toolbar.done', 'Done')}</Tog>
        <Tog active={!cropPast}  onClick={() => setCropPast(v => !v)}>{t('lore.planBoard.toolbar.past', 'Прошлые')}</Tog>
        <span style={S.divider} />
        <Tog active={showDeps && deps.length > 0} onClick={() => setShowDeps(v => !v)}
          title={t('lore.planBoard.toolbar.depsTooltip', 'Стрелки зависимостей ({{count}}); красный = критический путь', { count: deps.length })}>
          {t('lore.planBoard.toolbar.deps', 'Зависимости')}{deps.length > 0 ? ` ${deps.length}` : ''}
        </Tog>
        <span style={S.divider} />
        <button style={S.btn} onClick={() => onNavigateToSprint?.('__new')}
          title={t('lore.planBoard.toolbar.newSprintTooltip', 'Создать новый KnowSprint (переход на форму создания)')}>
          {t('lore.planBoard.toolbar.newSprint', '＋ Спринт')}
        </button>
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

        <span style={S.stat}>{t('lore.planBoard.toolbar.barsLanes', '{{shown}} / {{total}} баров · {{lanes}} дорожек', { shown: shownBars, total: sprints.length, lanes: board.groupDescs.filter(g => !g.nested).length })}</span>

        <span
          style={{ ...S.zlabel, color: 'var(--acc)', opacity: 0.85, fontWeight: 600 }}
          title={t('lore.planBoard.toolbar.currentWeekTooltip', 'Текущая неделя плана (W0 = {{w0}})', { w0: config.w0_date })}
        >
          W{W_NOW} · {nowLabel}
        </span>
        <span style={S.stat} title={t('lore.planBoard.toolbar.parityTooltip', 'Паритет: доля спринтов с плановыми датами')}>
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
          <span style={S.legendGlyph}><GameIcon slug="calendar" size={12} style={{ color: 'var(--acc)' }} /> {t('lore.planBoard.legend.planned', 'планируется')}</span>
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
        <span style={S.legendDim}>{t('lore.planBoard.legend.clickHint', 'клик по бару → паспорт спринта')}</span>
      </div>

      {/* ── Main: timeline host + side panel ───────────────────────────────── */}
      <div style={S.main}>
        <div ref={hostRef} className="lore-tl" style={S.host} />
        {/* SVG dep-arrow overlay — sits above the timeline, pointer-events: none */}
        <svg ref={svgRef} style={S.depSvg} aria-hidden="true" />

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
                {renderMsGroups(msPanel, sprints, cps, setMsPanel, onNavigateToSprint, t)}
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

function renderMsGroups(
  ms: LoreMilestone,
  sprints: LoreSprintRow[],
  cps: LorePlanCheckpoint[],
  setMsPanel: (m: LoreMilestone | null) => void,
  onNavigateToSprint: ((sprintId: string) => void) | undefined,
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string,
) {
  // Was s.planned_milestone_id — this file's only sprint↔milestone grouping had
  // NO fallback to the TARGETS_MILESTONE edge (unlike every other view), so it
  // silently under/over-counted whenever the two drifted apart (confirmed live
  // on 62+ sprints). Edge is the sole source of truth now.
  const msSprints = sprints.filter(s => (s.milestone_ids ?? []).includes(ms.milestone_id));
  const grouped = new Map<string, LoreSprintRow[]>();
  for (const sprint of msSprints) {
    const raw = sprint.status_raw;
    const st = raw ? taskTick(raw).status : 'todo';
    if (!grouped.has(st)) grouped.set(st, []);
    grouped.get(st)!.push(sprint);
  }
  const msCps = cps.filter(cp => cp.milestone === ms.milestone_id);
  return (
    <>
      {msSprints.length === 0 && msCps.length === 0 && (
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
          {grp.map(s => (
            <div key={s.sprint_id}
              onClick={() => { setMsPanel(null); onNavigateToSprint?.(s.sprint_id); }}
              style={{ paddingLeft: 8, color: 'var(--t2)', lineHeight: '1.7',
                fontSize: 11, cursor: 'pointer' }}>
              · {cleanLabel(s.name)}
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
  panelBodyCol: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px' },
  closeBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--t3)', fontSize: 13, padding: '0 4px', flexShrink: 0,
  },
};
