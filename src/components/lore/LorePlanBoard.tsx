// LorePlanBoard — renders system_aida_lore plan data as a readable swimlane
// timeline (vis-timeline). Tracks → groups, plan items → range bars, milestones
// → boxes, releases → points, sections → background bands. Built-in zoom/pan
// (Ctrl+wheel zoom, wheel/drag pan) replaces the old hand-rolled Gantt canvas.
// Spec: PLAN_AS_DB_RENDER.md · write-path LAL-23a · time-travel LAL-25
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { marked } from 'marked';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import type { TimelineOptions, TimelineItem, TimelineGroup } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import './lore-timeline.css';
import {
  fetchLoreSlice, postLoreStatus, registerLoreSprint,
  type LorePlanConfig, type LorePlanTrack, type LorePlanSection,
  type LorePlanItem, type LorePlanCheckpoint, type LoreMilestone, type LoreRelease,
  type LorePlanItemStatus, type LorePlanVersion,
  type LoreSprintDoneDate, type LoreSprintTask, type LoreSprintRow,
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
const STATUS_ORDER = ['active', 'high', 'planned', 'partial', 'blocked', 'todo', 'done', 'deferred', 'cancelled'];
const STATUS_RU: Record<string, string> = {
  active: 'в работе', high: 'важно', planned: 'план', partial: 'частично',
  blocked: 'блок', todo: 'не начато', done: 'готово', deferred: 'отложено', cancelled: 'отменено',
};

// Canonical token → status_raw (mirrors backend SCD2_STATUS_RAW), for optimistic
// statusBySprint updates so a cycled sprint re-colours before the server round-trip.
const STATUS_RAW: Record<string, string> = {
  done: '✅ DONE', active: '🔄 IN PROGRESS', partial: '🟡 PARTIAL', todo: '📋 PLANNED',
  blocked: '🔴 BLOCKED', high: '🔴 P0', cancelled: '🚫 CANCELLED',
};

const STATUS_CYCLE: LorePlanItemStatus[] = ['todo', 'active', 'done'];
function cycleStatus(current: string | null): LorePlanItemStatus {
  const idx = STATUS_CYCLE.indexOf((current ?? 'todo') as LorePlanItemStatus);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

const MS_GROUP = '__ms__';
const UNTRACKED = '__untracked__';
const WEEK_MS = 7 * 86400 * 1000;
function addWeeks(base: Date, w: number): Date {
  return new Date(base.getTime() + w * WEEK_MS);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  onError: (e: unknown) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function LorePlanBoard({ onError }: Props) {
  const [config,   setConfig]   = useState<LorePlanConfig | null>(null);
  const [tracks,   setTracks]   = useState<LorePlanTrack[]>([]);
  const [sections, setSections] = useState<LorePlanSection[]>([]);
  const [items,    setItems]    = useState<LorePlanItem[]>([]);
  const [cps,      setCps]      = useState<LorePlanCheckpoint[]>([]);
  const [mss,      setMss]      = useState<LoreMilestone[]>([]);
  const [releases, setReleases] = useState<LoreRelease[]>([]);
  const [versions, setVersions] = useState<LorePlanVersion[]>([]);
  const [doneBySprint, setDoneBySprint] = useState<Map<string, string>>(new Map());
  // Real sprint status (status_raw) keyed by sprint_id — the bar's status source
  // for sprint bars, so the gantt matches the actual sprint state (not plan_item).
  const [statusBySprint, setStatusBySprint] = useState<Map<string, string>>(new Map());
  const [loading,  setLoading]  = useState(true);

  // ── Toggles ────────────────────────────────────────────────────────────────
  // Default to the "not the archive" view: done + past hidden. Toggles re-enable
  // them when the user actually wants to look back.
  const [showDone,   setShowDone]   = useState(false);
  const [showActive, setShowActive] = useState(true);
  const [cropPast,   setCropPast]   = useState(true);
  // A bar is a real sprint when it represents one; otherwise it's a standalone
  // plan-item / placeholder ("заглушка"). Both shown by default.
  const [showSprints, setShowSprints] = useState(true);
  const [showStubs,   setShowStubs]   = useState(true);

  // ── Time-travel (LAL-25) ───────────────────────────────────────────────────
  const [selectedVer, setSelectedVer] = useState('');

  // ── Panels ─────────────────────────────────────────────────────────────────
  const [sprintCard, setSprintCard] = useState<LorePlanItem | null>(null);
  const [msPanel,    setMsPanel]    = useState<LoreMilestone | null>(null);
  const [registering, setRegistering] = useState(false);
  const [panelH,     setPanelH]     = useState(238);          // resizable bottom panel
  const panelDragRef = useRef<{ y: number; h: number } | null>(null);

  // Tasks of the sprint behind the selected card (lazy, keyed by represents_sprint)
  const [cardTasks,        setCardTasks]        = useState<LoreSprintTask[]>([]);
  const [cardTasksLoading, setCardTasksLoading] = useState(false);
  const [cardSprintStatus, setCardSprintStatus] = useState<string | null>(null);
  const [cardReleases,     setCardReleases]     = useState<string[]>([]);
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
      fetchLoreSlice<LorePlanTrack>('plan_tracks',       undefined, ctrl.signal),
      fetchLoreSlice<LorePlanSection>('plan_sections',   undefined, ctrl.signal),
      fetchLoreSlice<LorePlanItem>('plan_items',         undefined, ctrl.signal),
      fetchLoreSlice<LorePlanCheckpoint>('plan_checkpoints', undefined, ctrl.signal),
      fetchLoreSlice<LoreMilestone>('milestones',        undefined, ctrl.signal),
      fetchLoreSlice<LoreRelease>('releases',            undefined, ctrl.signal),
      fetchLoreSlice<LorePlanVersion>('plan_versions',   undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintDoneDate>('sprint_done_dates', undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintRow>('sprints',            undefined, ctrl.signal),
    ])
      .then(([cfgs, trks, secs, its, chkps, milestones, rels, vers, dones, sprints]) => {
        setConfig(cfgs[0] ?? null);
        setTracks(trks);
        setSections(secs);
        setItems(its);
        setCps(chkps);
        setMss(milestones);
        setReleases(rels.filter(r => r.week != null));
        setVersions(vers);
        setDoneBySprint(new Map(
          dones.filter(d => d.done_date).map(d => [d.sprint_id, d.done_date as string])
        ));
        setStatusBySprint(new Map(
          sprints.filter(s => s.status_raw).map(s => [s.sprint_id, s.status_raw as string])
        ));
        if (vers[0]) setSelectedVer(vers[0].version_id);
        setLoading(false);
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  // ── Lazy-load tasks of the sprint behind the selected card ───────────────────
  useEffect(() => {
    const sprintId = sprintCard?.represents_sprint;
    if (!sprintId) { setCardTasks([]); setCardSprintStatus(null); setCardReleases([]); return; }
    setCardTasksLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LoreSprintTask>('tasks_of_sprint', { sprint_id: sprintId }, ctrl.signal),
      fetchLoreSlice<{ status_raw: string | null; release_ids: string[] | null }>('sprint_tree', { id: sprintId }, ctrl.signal),
    ])
      .then(([tasks, trees]) => {
        setCardTasks(tasks);
        setCardSprintStatus(trees[0]?.status_raw ?? null);
        setCardReleases(trees[0]?.release_ids ?? []);
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
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }, [w0, W_NOW]);

  const itemsWithPos = items.filter(it => it.week_start != null && it.week_end != null).length;
  const parityPct    = items.length > 0 ? Math.round(itemsWithPos / items.length * 100) : 0;

  // Tracks that actually carry items (avoid a forest of empty swimlanes)
  const usedTracks = useMemo(() => {
    const ids = new Set(items.map(it => it.track_id ?? UNTRACKED));
    const list = tracks.filter(t => ids.has(t.track_id));
    if (ids.has(UNTRACKED)) list.push({ track_id: UNTRACKED, label: '— без дорожки —', type: null });
    return list;
  }, [tracks, items]);

  // ── Create the Timeline once data is loaded ──────────────────────────────────
  useEffect(() => {
    if (loading || !config || !w0 || !hostRef.current) return;

    const groups = new DataSet<TimelineGroup>([]);
    if (mss.length) {
      groups.add({ id: MS_GROUP, content: 'Вехи', order: -1 } as TimelineGroup);
    }
    usedTracks.forEach((tr, i) =>
      groups.add({ id: tr.track_id, content: tr.label, order: i } as TimelineGroup));

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

    // Initial window: ~16 weeks around today so multiple sprints are visible on
    // load without pressing any button. «Сжать» fits everything, «Раздвинуть»
    // returns to this 8-week detail view.
    const startW = Math.max(0, W_NOW - 2);
    tl.setWindow(addWeeks(w0, startW), addWeeks(w0, startW + 16), { animation: false });
    // Belt-and-suspenders against a 0×0 construction (flex sizes after layout):
    // force one redraw on the next frame so the first paint is never blank.
    requestAnimationFrame(() => { if (timelineRef.current === tl) tl.redraw(); });

    tl.on('select', (props: { items: Array<string | number> }) => {
      const id = props.items[0];
      if (id == null) { setSprintCard(null); setMsPanel(null); return; }
      let sid = String(id);
      if (sid.startsWith('fact_')) sid = sid.slice(5);   // fact baseline → parent sprint
      if (sid.startsWith('ms_')) {
        const ms = msByIdRef.current.get(sid.slice(3)) ?? null;
        setSprintCard(null); setMsPanel(ms);
      } else {
        const it = itemByIdRef.current.get(sid) ?? null;
        setMsPanel(null); setSprintCard(it);
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
  }, [loading, config, w0, usedTracks, mss.length, releases.length]);

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

      // Main bar = PLANNED span (the roadmap position, stable + labelled).
      next.push({
        id: item.item_id,
        group: item.track_id ?? UNTRACKED,
        content: statusIconSvg(iconSlug, iconColor) + esc(cleanLabel(item.label)),
        start: addWeeks(w0, ws),
        end:   addWeeks(w0, Math.max(ws + 1, we)),
        type: 'range',
        className: `it ${famClass}`,
        title: `${item.label}\nплан W${ws}–${we}`
          + (weAct != null ? `\nфакт W${ws}–${weAct} (закрыт)` : '')
          + (item.represents_sprint ? `\n${item.represents_sprint}` : '')
          + `\nстатус: ${effStatus}`,
      } as TimelineItem);

      // Actual span = thin baseline under the bar (sprints only): done → close
      // week; active → up to now. Green = finished early, amber = ran over plan.
      if (item.represents_sprint) {
        const factEnd = weAct != null ? weAct
          : effStatus === 'active' ? Math.max(ws + 1, W_NOW) : null;
        if (factEnd != null) {
          next.push({
            id: 'fact_' + item.item_id,
            group: item.track_id ?? UNTRACKED,
            content: '',
            start: addWeeks(w0, ws),
            end:   addWeeks(w0, Math.max(ws + 1, factEnd)),
            type: 'range',
            className: 'fact' + (factEnd < we ? ' early' : factEnd > we ? ' late' : ''),
            title: `факт W${ws}–${factEnd}` + (isDone ? ' · закрыт' : ' · идёт'),
          } as TimelineItem);
        }
      }
    }

    // Milestones (box) + their checkpoints count in the tooltip
    for (const ms of mss) {
      if (ms.week == null) continue;
      msById.set(ms.milestone_id, ms);
      const grp = cps.filter(c => c.milestone === ms.milestone_id);
      next.push({
        id: 'ms_' + ms.milestone_id,
        group: MS_GROUP,
        content: ms.milestone_id,
        start: addWeeks(w0, ms.week),
        type: 'box',
        className: 'ms',
        title: `${ms.milestone_id}: ${ms.label}\nW${ms.week}${ms.date_display ? ' · ' + ms.date_display : ''}`
          + (grp.length ? `\n⚑ ${grp.length} плашек` : ''),
      } as TimelineItem);
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
      showDone, showActive, cropPast, showSprints, showStubs, W_NOW]);

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

  if (loading) return <div style={S.empty}>Loading plan…</div>;
  if (!config)  return <div style={S.empty}>Plan config not found in system_aida_lore.</div>;

  // Effective status of an item (real sprint state for sprint bars).
  const effStatusOf = (it: LorePlanItem): string => {
    const raw = it.represents_sprint ? statusBySprint.get(it.represents_sprint) : undefined;
    return raw ? taskTick(raw).status : (it.status ?? 'todo');
  };

  const shownBars = items.filter(it => {
    if (it.week_start == null || it.week_end == null) return false;
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
        <Tog active={showActive} onClick={() => setShowActive(v => !v)}>Активные</Tog>
        <Tog active={showDone}   onClick={() => setShowDone(v => !v)}>Done</Tog>
        <Tog active={!cropPast}  onClick={() => setCropPast(v => !v)}>Прошлые</Tog>
        <span style={S.divider} />
        <Tog active={showSprints} onClick={() => setShowSprints(v => !v)}>Спринты</Tog>
        <Tog active={showStubs}   onClick={() => setShowStubs(v => !v)}>Заглушки</Tog>
        <button style={S.btn} onClick={() => timelineRef.current?.fit({ animation: true })}
          title="Уместить все бары в экран">
          Сжать
        </button>
        <button style={S.btn} onClick={() => {
          if (!w0) return;
          // «Раздвинуть» → 8-week detail view starting just before today.
          timelineRef.current?.setWindow(
            addWeeks(w0, W_NOW - 0.3), addWeeks(w0, W_NOW + 8), { animation: true });
        }} title="Раздвинуть — 8 недель вокруг сегодня">
          Раздвинуть
        </button>

        <span style={{ flex: 1 }} />

        <span style={S.stat}>{shownBars} / {items.length} баров · {usedTracks.length} дорожек</span>

        {versions.length > 0 && (
          <select
            value={selectedVer}
            onChange={e => setSelectedVer(e.target.value)}
            style={S.verSel}
            title="Версия плана (time-travel LAL-25)"
          >
            {versions.map(v => (
              <option key={v.version_id} value={v.version_id}>
                {v.version_id}{v.version_date ? ' · ' + v.version_date.slice(0, 10) : ''}
              </option>
            ))}
          </select>
        )}

        <span
          style={{ ...S.zlabel, color: 'var(--acc)', opacity: 0.85, fontWeight: 600 }}
          title={`Текущая неделя плана (W0 = ${config.w0_date})`}
        >
          W{W_NOW} · {nowLabel}
        </span>
        <span style={S.stat} title="Паритет: доля баров с позицией (SAGA↔план)">
          {parityPct}% parity
        </span>
        <span style={{ ...S.zlabel, opacity: 0.6 }}>Ctrl+колесо = зум · тащить = листать</span>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div style={S.legend}>
        <span style={S.legendCap}>заливка = статус:</span>
        {presentStatuses.filter(s => s !== 'todo').map(s => <LegendStatus key={s} status={s} label={STATUS_RU[s] ?? s} />)}
        {presentStatuses.includes('todo') && (
          <>
            <span style={S.legendGlyph}><GameIcon slug="calendar" size={12} style={{ color: 'var(--acc)' }} /> планируется</span>
            <span style={S.legendGlyph}><GameIcon slug="light-bulb" size={12} style={{ color: 'var(--t3)' }} /> заглушка</span>
          </>
        )}
        <span style={S.legendSep} />
        <span style={S.legendGlyph}>
          <span style={{ width: 14, height: 11, borderRadius: 2, display: 'inline-block',
            background: 'var(--bg3)', border: '2px solid var(--acc)' }} /> веха
        </span>
        <span style={S.legendGlyph}>
          <span style={{ width: 2, height: 13, display: 'inline-block',
            background: 'color-mix(in srgb, var(--wrn) 60%, transparent)' }} /> текущий релиз
        </span>
        <span style={S.legendGlyph}>
          <span style={{ width: 16, height: 11, borderRadius: 2, display: 'inline-block',
            background: 'color-mix(in srgb, var(--acc) 14%, transparent)', border: '1px solid var(--b3)' }} /> фаза
        </span>
        <span style={S.legendGlyph}>
          <span style={{ width: 16, height: 8, borderRadius: 2, display: 'inline-block',
            border: '1px dashed var(--t3)' }} /> факт (под баром-планом)
        </span>
        <span style={S.legendDim}>клик по бару → карточка спринта</span>
      </div>

      {/* ── Main: timeline host + side panel ───────────────────────────────── */}
      <div style={S.main}>
        <div ref={hostRef} className="lore-tl" style={S.host} />

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
                  title="Создать KnowSprint, связать план-элемент (REPRESENTS) и завести начальный статус"
                  style={{
                    display: 'block', width: '100%', marginBottom: 10,
                    padding: '6px 8px', borderRadius: 4, cursor: registering ? 'default' : 'pointer',
                    fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                    background: 'color-mix(in srgb, var(--acc) 16%, transparent)',
                    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 40%, transparent)',
                    opacity: registering ? 0.6 : 1,
                  }}
                >
                  {registering ? 'Регистрирую…' : '＋ Запланировать спринт'}
                </button>
              )}
              <PRow k="ID"     v={sprintCard.item_id} />
              {sprintCard.represents_sprint && (
                <PRow k="Sprint" v={sprintCard.represents_sprint} color="var(--acc)" />
              )}
              {(sprintCard.week_start != null || sprintCard.week_end != null) && (
                <PRow k="План"  v={`W${sprintCard.week_start ?? '?'}–${sprintCard.week_end ?? '?'}`} />
              )}
              {(() => {
                // Факт: actual close from the sprint's done-date (план vs факт).
                const sp = sprintCard.represents_sprint;
                const dd = sp && w0 ? doneBySprint.get(sp) : undefined;
                if (!dd || !w0) return null;
                const ws = sprintCard.week_start ?? 0, we = sprintCard.week_end ?? ws;
                const wa = Math.max(ws + 1, Math.round((new Date(dd).getTime() - w0.getTime()) / WEEK_MS));
                const c = wa < we ? 'var(--suc)' : wa > we ? 'var(--wrn)' : 'var(--t2)';
                return <PRow k="Факт" v={`W${ws}–${wa} · ${dd.slice(0, 10)}`} color={c} />;
              })()}
              {sprintCard.track_id && (
                <PRow k="Track"
                  v={tracks.find(t => t.track_id === sprintCard.track_id)?.label ?? sprintCard.track_id} />
              )}
              {cardReleases.length > 0 && (
                <PRow k="Релиз" v={cardReleases.join(', ')} color="var(--acc)" />
              )}

              {/* Status cycling badge — reflects the EFFECTIVE status (real sprint
                  status for sprint bars), and updates the board live on click. */}
              {(() => {
                const cs = effStatusOf(sprintCard);
                const m = statusMeta(cs);
                return (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>Статус</div>
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
                        <span style={{ fontSize: 10, color: 'var(--t3)' }}>Задачи</span>
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

                  {cardTasksLoading && <div style={{ fontSize: 11, color: 'var(--t3)' }}>Загрузка…</div>}
                  {!cardTasksLoading && cardTasks.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Задачи не заведены.</div>
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
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11 }}>Что закрыть:</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', columnGap: 24 }}>
                {renderMsGroups(msPanel, items, cps, setMsPanel, setSprintCard)}
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
          Нет связанных задач.
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
            Плашки ({msCps.length})
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

function Tog({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      height: 22, padding: '0 8px',
      border: '1px solid var(--b3)', borderRadius: 3,
      fontSize: 10, cursor: 'pointer',
      background: active ? 'color-mix(in srgb, var(--acc) 20%, transparent)' : 'var(--b2)',
      color: active ? 'var(--acc)' : 'var(--t3)',
    }}>
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
  return (
    <div onMouseDown={onDown} title="Потянуть, чтобы изменить высоту панели"
      style={{
        height: 9, flexShrink: 0, cursor: 'ns-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderBottom: '1px solid var(--b2)', background: 'var(--b2)',
      }}>
      <span style={{ width: 36, height: 3, borderRadius: 2, background: 'var(--bdh)' }} />
    </div>
  );
}

function TypeBadge({ isSprint }: { isSprint: boolean }) {
  const c = isSprint ? 'var(--acc)' : 'var(--t3)';
  return (
    <span style={{
      flexShrink: 0, alignSelf: 'flex-start', marginTop: 1,
      fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 3,
      background: `color-mix(in srgb, ${c} 16%, transparent)`,
      color: c, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
    }}>
      {isSprint ? 'Спринт' : 'План-элемент'}
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
    padding: '5px 12px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
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
    padding: '5px 12px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
    background: 'var(--b1)',
  },
  legendCap:   { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  legendGlyph: { fontSize: 10, color: 'var(--t2)', display: 'inline-flex', gap: 4, alignItems: 'center' },
  legendSep:   { width: 1, height: 14, background: 'var(--b3)' },
  legendDim:   { fontSize: 10, color: 'var(--t3)', marginLeft: 'auto' },
  verSel: {
    height: 22, padding: '0 6px', fontSize: 10,
    border: '1px solid var(--b3)', borderRadius: 3,
    background: 'var(--b2)', color: 'var(--t2)',
    fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
    maxWidth: 200,
  },
  // Timeline on top, detail panel as a full-width strip at the bottom.
  main: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
    position: 'relative' as const, minWidth: 0,
  },
  host: { flex: 1, minWidth: 0, minHeight: 0, width: '100%', overflow: 'hidden' },
  panel: {
    flexShrink: 0, height: 232,
    borderTop: '1px solid var(--b2)',
    background: 'var(--b1)',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  panelHdr: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '8px 14px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  // Title wraps fully now (no ellipsis) — the whole description is visible.
  panelTitle: {
    flex: 1, fontWeight: 600, fontSize: 13, lineHeight: 1.35, color: 'var(--t1)',
    overflowWrap: 'anywhere' as const,
  },
  panelBody:    { flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', gap: 24, alignItems: 'stretch' },
  panelBodyCol: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px' },
  panelCol:     { flexShrink: 0, width: 286, borderRight: '1px solid var(--b2)', paddingRight: 22 },
  panelTasks:   { flex: 1, minWidth: 0 },
  closeBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--t3)', fontSize: 13, padding: '0 4px', flexShrink: 0,
  },
};
